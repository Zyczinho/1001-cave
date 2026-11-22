'use strict';
// Poczta (owner, 22.11): bills and failed payments arrive by mail (Gmail = Box2Box,
// op.pl = home). Rachet reads both mailboxes once an hour, read-only (EXAMINE and
// BODY.PEEK, so nothing is marked as read), spam folder included, and turns a few kinds
// of mail into bill updates. No dependencies: a minimal IMAP client over TLS.
const tls=require('node:tls');
const {normalizeBill,markPaid}=require('./bills.cjs');

// ---------- IMAP ----------
const PROVIDERS=[
  {match:/@(gmail|googlemail)\.com$/i,host:'imap.gmail.com',port:993,label:'Gmail'},
  {match:/@(op|onet|poczta\.onet|vp|onet\.eu|autograf|buziaczek|spoko|amorki)\.pl$|@onet\.(eu|com\.pl)$/i,host:'imap.poczta.onet.pl',port:993,label:'Onet'},
  {match:/@(wp|o2|tlen)\.pl$/i,host:'imap.wp.pl',port:993,label:'WP'},
  {match:/@(outlook|hotmail|live)\.(com|pl)$/i,host:'outlook.office365.com',port:993,label:'Outlook'}
];
function providerFor(email){return PROVIDERS.find(p=>p.match.test(String(email||'').trim()))||null;}
let caCache=null;
function trustedCAs(){
  if(caCache)return caCache;
  try{caCache=tls.getCACertificates?[...new Set([...tls.getCACertificates('default'),...tls.getCACertificates('system')])]:undefined;}
  catch{caCache=undefined;}
  return caCache;
}
const quote=s=>'"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

// Splits raw IMAP bytes into complete responses; a line ending in {n} carries n literal bytes.
class ResponseReader{
  constructor(){this.buf=Buffer.alloc(0);}
  push(chunk){this.buf=Buffer.concat([this.buf,chunk]);}
  // Returns {text, literals} for the next complete response, or null if more bytes are needed.
  next(){
    let pos=0,text='';const literals=[];
    for(;;){
      const nl=this.buf.indexOf('\r\n',pos,'latin1');
      if(nl<0)return null;
      const line=this.buf.slice(pos,nl).toString('utf8');
      const m=line.match(/\{(\d+)\}$/);
      if(!m){text+=line;this.buf=this.buf.slice(nl+2);return {text,literals};}
      const size=Number(m[1]),start=nl+2;
      if(this.buf.length<start+size)return null;
      literals.push(this.buf.slice(start,start+size));
      text+=line.slice(0,-m[0].length)+'\u0000L'+(literals.length-1)+'\u0000';
      pos=start+size;
    }
  }
}
class Imap{
  constructor({host,port=993,timeoutMs=30000}){this.host=host;this.port=port;this.timeoutMs=timeoutMs;this.tag=0;this.reader=new ResponseReader();this.waiters=[];this.untagged=[];}
  connect(){
    return new Promise((resolve,reject)=>{
      // Trust Windows' certificate store too: Avast Mail Shield re-signs mail connections
      // with its own root, which Windows trusts but Node's bundled list does not.
      // Verification stays on.
      this.sock=tls.connect({host:this.host,port:this.port,servername:this.host,ca:trustedCAs()},()=>{});
      this.sock.setTimeout(this.timeoutMs,()=>this.sock.destroy(Error('Skrzynka nie odpowiada ('+this.host+')')));
      this.sock.on('data',d=>{this.reader.push(d);this.pump();});
      this.sock.on('error',e=>{reject(e);this.fail(e);});
      this.sock.on('close',()=>this.fail(Error('Połączenie z '+this.host+' zamknięte')));
      this.greeting=r=>{if(/^\* (OK|PREAUTH)/i.test(r.text))resolve();else reject(Error('Serwer poczty odmówił: '+r.text.slice(0,120)));};
    });
  }
  fail(e){for(const w of this.waiters.splice(0))w.reject(e);}
  pump(){
    let r;
    while((r=this.reader.next())){
      if(this.greeting){const g=this.greeting;this.greeting=null;g(r);continue;}
      const w=this.waiters[0];
      if(w&&r.text.startsWith(w.tag+' ')){
        this.waiters.shift();
        const responses=this.untagged.splice(0);
        if(/^\S+ OK/i.test(r.text))w.resolve(responses);
        else w.reject(Error(r.text.replace(/^\S+ (NO|BAD)\s*/i,'').replace(/\[[^\]]*\]\s*/,'').slice(0,200)||'Błąd IMAP'));
      }else this.untagged.push(r);
    }
  }
  cmd(command){
    const tag='R'+(++this.tag);
    return new Promise((resolve,reject)=>{this.waiters.push({tag,resolve,reject});this.sock.write(tag+' '+command+'\r\n');});
  }
  async login(user,pass){await this.cmd('LOGIN '+quote(user)+' '+quote(pass));}
  // Folders to read: the inbox and whichever folder the server marks as spam (\Junk).
  async folders(){
    const list=await this.cmd('LIST "" "*"');
    const out=['INBOX'];
    for(const r of list){
      const m=r.text.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i);
      if(!m)continue;
      const name=m[2].startsWith('"')?m[2].slice(1,-1).replace(/\\(.)/g,'$1'):m[2];
      if(/\\Junk/i.test(m[1])||/^(spam|junk|\[gmail\]\/spam)$/i.test(name))out.push(name);
    }
    return [...new Set(out)];
  }
  async examine(folder){await this.cmd('EXAMINE '+quote(folder));}
  async searchSince(date){
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d=date.getDate()+'-'+months[date.getMonth()]+'-'+date.getFullYear();
    const res=await this.cmd('UID SEARCH SINCE '+d);
    const line=res.find(r=>/^\* SEARCH/i.test(r.text));
    return line?line.text.replace(/^\* SEARCH\s*/i,'').split(/\s+/).filter(Boolean).map(Number):[];
  }
  // Fetches the given section for many UIDs at once; returns [{uid, data: Buffer}].
  async fetch(uids,section){
    const out=[];
    for(let i=0;i<uids.length;i+=80){
      const res=await this.cmd('UID FETCH '+uids.slice(i,i+80).join(',')+' (UID '+section+')');
      for(const r of res){
        const uid=Number((r.text.match(/UID (\d+)/)||[])[1]);
        if(uid&&r.literals.length)out.push({uid,data:r.literals[0]});
      }
    }
    return out;
  }
  async logout(){try{await this.cmd('LOGOUT');}catch{}try{this.sock.end();}catch{}}
}

// ---------- MIME ----------
function decodeBytes(buf,charset){
  try{return new TextDecoder(String(charset||'utf-8').toLowerCase().replace(/^(utf8|unicode-1-1-utf-8)$/,'utf-8')).decode(buf);}
  catch{return buf.toString('latin1');}
}
function decodeQP(s){
  const bytes=[];
  const t=s.replace(/=\r?\n/g,'');
  for(let i=0;i<t.length;i++){
    if(t[i]==='='&&/^[0-9A-F]{2}$/i.test(t.slice(i+1,i+3))){bytes.push(parseInt(t.slice(i+1,i+3),16));i+=2;}
    else bytes.push(t.charCodeAt(i)&255);
  }
  return Buffer.from(bytes);
}
// =?utf-8?B?...?= and =?iso-8859-2?Q?...?= in headers.
function decodeWords(s){
  return String(s||'').replace(/\?=\s+=\?/g,'?==?').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi,(_,cs,enc,txt)=>
    decodeBytes(enc.toUpperCase()==='B'?Buffer.from(txt,'base64'):decodeQP(txt.replace(/_/g,' ')),cs));
}
function parseHeaders(raw){
  const text=raw.toString('latin1').replace(/\r?\n[ \t]+/g,' ');
  const h={};
  for(const line of text.split(/\r?\n/)){const i=line.indexOf(':');if(i>0)h[line.slice(0,i).trim().toLowerCase()]=line.slice(i+1).trim();}
  // Header bytes may be raw UTF-8: re-read them so Polish letters survive.
  for(const k of Object.keys(h))h[k]=decodeWords(Buffer.from(h[k],'latin1').toString('utf8'));
  return h;
}
function htmlToText(s){
  return s.replace(/<(style|script)[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}
// Plain text of a (possibly cut) message body: prefers text/plain, falls back to html.
function bodyText(raw,headers){
  const ctype=headers['content-type']||'text/plain';
  const boundary=(ctype.match(/boundary="?([^";]+)"?/i)||[])[1];
  const decodePart=(body,h)=>{
    const enc=(h['content-transfer-encoding']||'').toLowerCase();
    const cs=((h['content-type']||'').match(/charset="?([^";\s]+)/i)||[])[1]||'utf-8';
    const bytes=enc==='base64'?Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g,''),'base64'):enc==='quoted-printable'?decodeQP(body):Buffer.from(body,'latin1');
    const text=decodeBytes(bytes,cs);
    return /html/i.test(h['content-type']||'')?htmlToText(text):text;
  };
  const s=raw.toString('latin1');
  if(!boundary)return decodePart(s,headers);
  let plain='',html='';
  for(const part of s.split('--'+boundary).slice(1)){
    const split=part.search(/\r?\n\r?\n/);
    if(split<0)continue;
    const h=parseHeaders(Buffer.from(part.slice(0,split),'latin1'));
    const body=part.slice(split).replace(/^\r?\n\r?\n/,'');
    if(/multipart\//i.test(h['content-type']||'')){const inner=bodyText(Buffer.from(body,'latin1'),h);if(inner&&!plain)plain=inner;continue;}
    if(/text\/plain/i.test(h['content-type']||'text/plain')&&!plain)plain=decodePart(body,h);
    else if(/text\/html/i.test(h['content-type']||'')&&!html)html=decodePart(body,h);
  }
  return plain||html;
}
function senderOf(from){
  const m=String(from||'').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return m?{name:m[1].trim(),address:m[2].trim().toLowerCase()}:{name:'',address:String(from||'').trim().toLowerCase()};
}

// ---------- Rules ----------
// Only mail that looks like money is fetched in full; everything else stays a header.
const CANDIDATE=/faktur|rachun|płatno|platno|wpłat|payment|invoice|receipt|bill\b|declined|odrzuc|windykac|termin|subscription|subskrypc|renew|charge|zaległ|past due|suspension/i;
const FAILED=/(payment|charge)[^.\n]{0,50}(unsuccessful|failed|declined|nie powiod)|declined a payment|payment (was )?declined|payment failed|failed payment|weren't able to charge|were not able to charge|nie (udało się|mogliśmy) (pobrać|obciążyć)|płatnoś\S* (została )?odrzucon|odrzucił\S* płatnoś|outstanding [^.\n]{0,30}payment|haven't paid|past due|risk of suspension/i;
const OVERDUE=/minął termin|po terminie|zaległ\S* (płatnoś|rachun)|windykac/i;
const PAID=/payment (received|successful)|received your payment|we've received your payment|your receipt from|payment has been made successfully|you've been charged|potwierdzamy (twoją )?płatnoś|potwierdzenie (otrzymania )?płatnoś|otrzymaliśmy (twoją )?(płatnoś|wpłat)|płatność została (przyjęta|zaksięgowana)|dziękujemy za (wpłatę|płatność)/i;
const INVOICE=/faktur|rachunek|invoice|\bbill\b|do zapłaty/i;
function parseAmount(text){
  const t=String(text).replace(/ /g,' ');
  const num=s=>Number(s.replace(/\s/g,'').replace(',','.'));
  let m=t.match(/kwot\S*[^0-9\n-]{0,25}(-?\d[\d ]{0,8}[.,]\d{1,2})\s*(PLN|zł|EUR|€|USD|\$)?/i);
  if(m)return {amount:Math.abs(num(m[1])),currency:cur(m[2])};
  m=t.match(/(\d[\d ]{0,8}[.,]\d{2})\s*(PLN|zł|EUR|€|USD)\b/i)||t.match(/(\d[\d ]{0,8}[.,]\d{2})\s*(zł)/i);
  if(m)return {amount:num(m[1]),currency:cur(m[2])};
  m=t.match(/(€|\$)\s?(\d[\d,]{0,8}\.\d{2})/);
  if(m)return {amount:Number(m[2].replace(/,/g,'')),currency:m[1]};
  return null;
  function cur(c){c=String(c||'').toLowerCase();return c==='eur'||c==='€'?'€':c==='usd'||c==='$'?'$':'zł';}
}
function parseDue(text){
  const t=String(text);
  const ymd=(y,m,d)=>{const date=new Date(Number(y),Number(m)-1,Number(d));return date.getMonth()===Number(m)-1?date:null;};
  let m=t.match(/termin\S*\s+(?:płatności|zapłaty)[^0-9\n]{0,60}(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/i);
  if(m)return ymd(m[3],m[2],m[1]);
  m=t.match(/termin\S*\s+(?:płatności|zapłaty)[^0-9\n]{0,60}(\d{4})-(\d{2})-(\d{2})/i);
  if(m)return ymd(m[1],m[2],m[3]);
  m=t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+upływa termin/i);
  if(m)return ymd(m[3],m[2],m[1]);
  m=t.match(/(?:due|payable)(?: date| by| on)?[:\s]+([A-Z][a-z]+ \d{1,2},? \d{4})/);
  if(m){const d=new Date(m[1]);return isNaN(d)?null:d;}
  return null;
}
// One mail -> one event, or null when it is not about money.
function classify(msg){
  const head=(msg.subject||'')+'\n'+(msg.fromName||'')+' '+(msg.from||'');
  const all=head+'\n'+(msg.text||'');
  const base={at:msg.date,vendor:vendorName(msg),subject:String(msg.subject||'').slice(0,160),source:msg.source||''};
  if(/failed-payments@/i.test(msg.from||'')||FAILED.test(head)||FAILED.test(String(msg.text||'').slice(0,800)))return {...base,kind:'failed'};
  if(OVERDUE.test(head))return {...base,kind:'overdue'};
  if(PAID.test(head)||PAID.test(String(msg.text||'').slice(0,600)))return {...base,kind:'paid'};
  const amount=parseAmount(all),due=parseDue(all);
  // An invoice with an amount or a due date, or a "termin płatności" reminder with a date.
  if((INVOICE.test(head)&&(amount||due))||(due&&/termin/i.test(head)))
    return {...base,kind:'invoice',...(amount||{}),due:due?due.toISOString():''};
  return null;
}
// A readable vendor: "Klaviyo Inc" -> "Klaviyo", "T-Mobile - faktura" -> "T-Mobile".
function vendorName(msg){
  let n=String(msg.fromName||'').replace(/\s*[-–|·]\s*(faktura|powiadomienie|billing|payments?|e-?faktura|rachunki?)\b.*$/i,'')
    .replace(/\b(inc\.?|ltd\.?|llc|sp\.? z o\.?o\.?|s\.?a\.?|gmbh)\b/gi,'').replace(/\s{2,}/g,' ').trim();
  if(!n){const d=(String(msg.from||'').split('@')[1]||'').split('.');n=d.length>1?d[d.length-2]:d[0]||'';n=n.charAt(0).toUpperCase()+n.slice(1);}
  return n.slice(0,60);
}
// Which bill a mail is about: the bill's first word (T-Mobile, italnet, Klaviyo…) or its own
// "mail" words must appear in the sender or subject. The mailbox decides between two
// bills of the same vendor (Allegro private on op.pl, Allegro Box2Box on Gmail).
function billFor(bills,ev,msgText){
  const hay=(ev.vendor+' '+ev.subject+' '+(msgText||'')).toLowerCase();
  const key=b=>(b.mailWords&&b.mailWords.length?b.mailWords:[b.title.toLowerCase().split(/[\s(]/)[0]]).filter(w=>w.length>=3);
  const hits=bills.filter(b=>key(b).some(w=>hay.includes(w.toLowerCase())));
  if(hits.length<2)return hits[0]||null;
  return hits.find(b=>b.mailbox&&b.mailbox===ev.source)||hits[0];
}
const ymOf=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
// Applies events oldest first, so a receipt after a failed payment clears it.
function applyEvents(bills,events,now=new Date()){
  let list=bills.map(b=>({...b}));
  const changes=[];
  for(const ev of [...events].sort((a,b)=>String(a.at).localeCompare(String(b.at)))){
    const at=new Date(ev.at);
    let i=list.findIndex(b=>b===billFor(list,ev,ev.header));
    if(ev.kind==='failed'||(ev.kind==='overdue'&&(i<0||list[i].mode==='auto'))){
      if(i<0){
        list.push(normalizeBill({title:ev.vendor||'Płatność',day:at.getDate(),mode:'auto',mailbox:ev.source,since:ymOf(at)+'-01'},now));
        i=list.length-1;changes.push('Nowy: '+list[i].title);
      }
      if(!list[i].alert||list[i].alert.at<ev.at){list[i]={...list[i],alert:{text:ev.subject,at:ev.at}};changes.push('Nie przeszła: '+list[i].title);}
    }else if(ev.kind==='paid'&&i>=0){
      const b=list[i];
      if(b.alert&&b.alert.at<ev.at){list[i]={...b,alert:null};changes.push('Opłacone: '+b.title);}
      else if(b.mode==='manual'&&!b.paid.includes(ymOf(at))){list[i]=markPaid(b,ymOf(at));changes.push('Zapłacone: '+b.title);}
    }else if(ev.kind==='invoice'){
      const due=ev.due?new Date(ev.due):null;
      if(i<0){
        if(!due)continue;
        list.push(normalizeBill({title:ev.vendor||'Rachunek',amount:ev.amount??'',currency:ev.currency,day:due.getDate(),mode:'manual',mailbox:ev.source,since:ymOf(at)+'-01'},now));
        changes.push('Nowy rachunek: '+ev.vendor);continue;
      }
      const b=list[i],next={...b};
      if(ev.amount!==undefined&&ev.amount!==null&&ev.amount!==b.amount){next.amount=ev.amount;next.currency=ev.currency||b.currency;}
      if(due&&due.getDate()!==b.day&&b.mode==='manual')next.day=due.getDate();
      if(next.amount!==b.amount||next.day!==b.day){list[i]=next;changes.push('Faktura: '+b.title);}
    }
  }
  return {bills:list,changes};
}

// ---------- One mailbox check ----------
// Reads mail since `since`, skips message ids seen before, returns events (no bill changes).
async function checkMailbox({email,password,since,seen=new Set(),connect=o=>new Imap(o)}){
  const p=providerFor(email);
  if(!p)throw Error('Nie znam serwera poczty dla '+email);
  const imap=connect({host:p.host,port:p.port});
  const events=[],ids=[];
  try{
    await imap.connect();
    await imap.login(email,password);
    for(const folder of await imap.folders()){
      await imap.examine(folder);
      const uids=await imap.searchSince(since);
      if(!uids.length)continue;
      const heads=await imap.fetch(uids,'BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)]');
      const wanted=[];const byUid=new Map();
      for(const {uid,data} of heads){
        const h=parseHeaders(data);
        const id=h['message-id']||folder+':'+uid+':'+(h.date||'');
        if(seen.has(id))continue;
        ids.push(id);
        const s=senderOf(h.from);
        const msg={uid,id,subject:h.subject||'',from:s.address,fromName:s.name,date:new Date(h.date||Date.now()).toISOString(),headers:h,source:email};
        if(CANDIDATE.test(msg.subject+' '+msg.fromName+' '+msg.from)){wanted.push(uid);byUid.set(uid,msg);}
      }
      if(!wanted.length)continue;
      for(const {uid,data} of await imap.fetch(wanted,'BODY.PEEK[TEXT]<0.12000>')){
        const msg=byUid.get(uid);if(!msg)continue;
        msg.text=bodyText(data,msg.headers).replace(/\s+/g,' ').slice(0,4000);
        const ev=classify(msg);
        if(ev)events.push({...ev,header:msg.fromName+' '+msg.from});
      }
    }
  }finally{await imap.logout();}
  return {events,ids};
}
module.exports={PROVIDERS,providerFor,ResponseReader,Imap,decodeWords,parseHeaders,bodyText,senderOf,classify,parseAmount,parseDue,vendorName,billFor,applyEvents,checkMailbox,CANDIDATE};
