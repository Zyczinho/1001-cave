'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {providerFor,ResponseReader,decodeWords,parseHeaders,bodyText,classify,parseAmount,parseDue,vendorName,applyEvents,checkMailbox}=require('../mail.cjs');
const {normalizeBill}=require('../bills.cjs');
// 22.11: invoices and failed payments arrive by mail; Rachet reads them so the owner never types them.
const msg=(o)=>({subject:'',from:'billing@example.com',fromName:'Example',date:'2026-11-10T10:00:00.000Z',text:'',source:'me@gmail.com',...o});
const bill=o=>normalizeBill({title:'Telefon',day:12,since:'2026-11-01',...o});

test('providers: Gmail and Onet addresses map to their IMAP servers',()=>{
  assert.equal(providerFor('ktos@gmail.com').host,'imap.gmail.com');
  assert.equal(providerFor('ktos@op.pl').host,'imap.poczta.onet.pl');
  assert.equal(providerFor('ktos@firma.example'),null);
});
test('IMAP reader keeps literal bytes and waits for the rest',()=>{
  const r=new ResponseReader();
  r.push(Buffer.from('* 1 FETCH (UID 7 BODY[HEADER] {13}\r\nSubject: ab'));
  assert.equal(r.next(),null);
  r.push(Buffer.from('\r\n)\r\nR1 OK done\r\n'));
  const first=r.next();
  assert.match(first.text,/UID 7/);assert.equal(first.literals[0].toString(),'Subject: ab\r\n');
  assert.equal(r.next().text,'R1 OK done');
});
test('headers: encoded words and folded lines are decoded',()=>{
  assert.equal(decodeWords('=?UTF-8?B?WmHFvMOzxYLEhw==?= =?utf-8?Q?_g=C4=99=C5=9Bl?='),'Zażółć gęśl');
  const h=parseHeaders(Buffer.from('Subject: =?utf-8?Q?Faktura_za_us=C5=82ugi?=\r\n continued\r\nFrom: "Operator - faktura" <faktura@op.example>\r\n'));
  assert.equal(h.subject,'Faktura za usługi continued');assert.match(h.from,/Operator/);
});
test('body: multipart quoted-printable plain text wins over html',()=>{
  const raw='--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>html</p>\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nKwota: 99,90 z=C5=82=\r\n do zap=C5=82aty\r\n--b1--';
  assert.equal(bodyText(Buffer.from(raw,'latin1'),{'content-type':'multipart/alternative; boundary="b1"'}).trim(),'Kwota: 99,90 zł do zapłaty');
  const html=Buffer.from('<div>Zapłać <b>80,00 zł</b></div>').toString('base64');
  assert.match(bodyText(Buffer.from(html),{'content-type':'text/html; charset=utf-8','content-transfer-encoding':'base64'}),/Zapłać\s+80,00 zł/);
});
test('amounts and due dates in the forms operators use',()=>{
  assert.deepEqual(parseAmount('Kwota: 99.9 PLN'),{amount:99.9,currency:'zł'});
  assert.deepEqual(parseAmount('Wystawiono fakturę na kwote: 80.00 termin'),{amount:80,currency:'zł'});
  assert.deepEqual(parseAmount('Kwota: -37,22 zł'),{amount:37.22,currency:'zł'});
  assert.deepEqual(parseAmount('Your payment of €12.44 was applied'),{amount:12.44,currency:'€'});
  assert.equal(parseDue('termin płatności dla powyższej faktury: 11.12.2026').getDate(),11);
  assert.equal(parseDue('Dzień dobry, 12.10.2026 upływa termin płatności').getMonth(),9);
  assert.equal(parseDue('nic tu nie ma'),null);
});
test('classify: failed, overdue, paid, invoice and noise',()=>{
  assert.equal(classify(msg({subject:'$60.00 payment to Newsletter Inc was unsuccessful',from:'failed-payments+x@stripe.com',fromName:'Newsletter Inc'})).kind,'failed');
  assert.equal(classify(msg({subject:'Ads: Payment was declined for 123'})).kind,'failed');
  assert.equal(classify(msg({subject:'Minął termin Twojej płatności - ureguluj swój rachunek'})).kind,'overdue');
  assert.equal(classify(msg({subject:"Ads: We've received your payment"})).kind,'paid');
  const inv=classify(msg({subject:'Operator: Twoja miesięczna f@ktura numer faktury: 1',text:'Kwota: 99.9 PLN'}));
  assert.equal(inv.kind,'invoice');assert.equal(inv.amount,99.9);
  assert.equal(classify(msg({subject:'Przypomnienie o terminie płatności',text:'Dzień dobry, 12.12.2026 upływa termin płatności za ostatnią fakturę.'})).kind,'invoice');
  assert.equal(classify(msg({subject:'Nowa wpłata od Kupującego',text:'Otrzymałeś wpłatę'})),null);
  assert.equal(classify(msg({subject:'Black Friday: -50%'})),null);
});
test('vendor names drop company suffixes and mail labels',()=>{
  assert.equal(vendorName({fromName:'Newsletter Inc'}),'Newsletter');
  assert.equal(vendorName({fromName:'Operator - faktura'}),'Operator');
  assert.equal(vendorName({fromName:'',from:'billing@shopper.com'}),'Shopper');
});
test('events: failed then receipt clears; invoice updates amount and day; unknown failures appear',()=>{
  const bills=[bill({title:'Newsletter',mode:'auto',day:21}),bill({title:'Operator (telefon)',amount:90})];
  const ev=(kind,at,o={})=>({kind,at,vendor:'Newsletter',subject:kind,source:'me@gmail.com',header:'Newsletter',...o});
  let r=applyEvents(bills,[ev('paid','2026-10-29T08:00:00.000Z'),ev('failed','2026-10-27T18:00:00.000Z'),ev('failed','2026-11-21T13:00:00.000Z')]);
  assert.equal(r.bills[0].alert.at,'2026-11-21T13:00:00.000Z');
  r=applyEvents(r.bills,[ev('paid','2026-11-23T08:00:00.000Z')]);
  assert.equal(r.bills[0].alert,null);
  r=applyEvents(r.bills,[{kind:'invoice',at:'2026-11-28T10:00:00.000Z',vendor:'Operator',subject:'faktura',header:'Operator',amount:99.9,currency:'zł',due:new Date(2026,11,14).toISOString()}]);
  assert.equal(r.bills[1].amount,99.9);assert.equal(r.bills[1].day,14);
  r=applyEvents(r.bills,[{kind:'failed',at:'2026-11-25T10:00:00.000Z',vendor:'Ads',subject:'Payment was declined',header:'Ads payments',source:'me@gmail.com'}]);
  assert.equal(r.bills.length,3);assert.equal(r.bills[2].title,'Ads');assert.equal(r.bills[2].mode,'auto');assert.ok(r.bills[2].alert);
  assert.deepEqual(applyEvents(r.bills,[{kind:'invoice',at:'2026-11-28T10:00:00.000Z',vendor:'Shop',subject:'faktura',header:'Shop'}]).changes,[]);
});
test('two bills of one vendor: the mailbox decides',()=>{
  const bills=[bill({title:'Allegro (prywatne)',mode:'auto',mailbox:'home@op.pl'}),bill({title:'Allegro (sklep)',mode:'auto',mailbox:'shop@gmail.com'})];
  const r=applyEvents(bills,[{kind:'failed',at:'2026-11-16T09:00:00.000Z',vendor:'Allegro',subject:'Minął termin',header:'Allegro',source:'shop@gmail.com'}]);
  assert.equal(r.bills[0].alert,null);assert.ok(r.bills[1].alert);
});
test('a mailbox check reads only, skips seen mail and fetches bodies only for money mail',async()=>{
  const commands=[];
  const head=(subject,from,id)=>Buffer.from('Subject: '+subject+'\r\nFrom: '+from+'\r\nDate: Mon, 10 Nov 2026 10:00:00 +0000\r\nMessage-ID: <'+id+'>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n');
  const fake={
    connect:async()=>{},login:async()=>{commands.push('LOGIN');},
    folders:async()=>['INBOX','[Gmail]/Spam'],
    examine:async f=>commands.push('EXAMINE '+f),
    searchSince:async()=>[1,2,3],
    fetch:async(uids,section)=>{commands.push(section.slice(0,20)+' '+uids.join(','));
      if(/HEADER/.test(section))return [{uid:1,data:head('Black Friday','Shop <a@shop.example>','a')},{uid:2,data:head('Payment was declined','Ads Payments <p@ads.example>','b')},{uid:3,data:head('Faktura','Seen <s@x.example>','c')}];
      return [{uid:2,data:Buffer.from('Your bank declined the payment.')}];},
    logout:async()=>commands.push('LOGOUT')
  };
  const r=await checkMailbox({email:'me@gmail.com',password:'x',since:new Date(),seen:new Set(['<c>']),connect:()=>fake});
  assert.deepEqual(r.events.map(e=>e.kind),['failed','failed']);
  assert.ok(commands.every(c=>!/STORE|\\Seen|SELECT/.test(c)),'never writes flags');
  assert.ok(commands.filter(c=>c.startsWith('BODY.PEEK[TEXT]')).every(c=>c.endsWith(' 2')),'body only for the money mail');
  assert.equal(commands.at(-1),'LOGOUT');
  const imap=fs.readFileSync(path.join(__dirname,'..','mail.cjs'),'utf8');
  assert.match(imap,/'EXAMINE '/);assert.doesNotMatch(imap,/'SELECT |STORE /);
});
test('passwords never reach the panel snapshot',()=>{
  const store=fs.readFileSync(path.join(__dirname,'..','mail-store.cjs'),'utf8');
  assert.match(store,/view\(\)\{return this\.data\.accounts\.map\(a=>\(\{email:a\.email,lastCheck/);
  assert.match(store,/ConvertFrom-SecureString/);
  const server=fs.readFileSync(path.join(__dirname,'..','server.cjs'),'utf8');
  assert.match(server,/mail:\{accounts:mailStore\?mailStore\.view\(\)/);
});
