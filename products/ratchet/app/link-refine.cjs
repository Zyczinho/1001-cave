'use strict';
// "Popraw link": the owner writes one sentence about a saved search ("za dużo seniorów")
// and Claude rewrites the address. Rachet only proposes; nothing is saved until "Zapisz".
const {spawn}=require('node:child_process');
const os=require('node:os');
const {claudeCommand}=require('./coordinator.cjs');
const {validateTarget}=require('./core.cjs');

const REFINE_TIMEOUT_MS=90*1000;
const NOTE_MAX=300;
const HISTORY_MAX=5;

function refinePrompt(link,note){
  return [
    'Przepisz link do wyszukiwarki ofert pracy zgodnie z uwagą użytkownika.',
    'Link: '+link.target,
    'Nazwa skrótu: '+link.title,
    'Uwaga użytkownika: '+String(note).slice(0,NOTE_MAX),
    '',
    'Zasady:',
    '- Zostań na tej samej stronie (ta sama domena). Zmieniaj tylko ścieżkę i parametry wyszukiwania.',
    '- Używaj tylko tych filtrów (kody sprawdzone na stronach 19.11.2026):',
    '  LinkedIn: keywords (AND, OR, NOT, nawiasy, cudzysłowy), location, geoId, sortBy=DD,',
    '    f_E poziom: 1 staż, 2 entry (junior), 3 associate, 4 mid-senior, 5 director, 6 executive (przecinki jako %2C),',
    '    f_TPR świeżość: r86400 = 24 h, r604800 = 7 dni, f_WT: 1 stacjonarnie, 2 zdalnie, 3 hybrydowo.',
    '  Pracuj.pl: et poziom: 1 staż, 3 asystent, 17 junior, 4 mid, 18 senior, 19 ekspert, 20 menedżer; brak wykluczania słów.',
    '  RocketJobs: ścieżka /oferty-pracy/<miasto lub praca-zdalna>/<kategoria>, experience-level=junior,mid,senior; brak wykluczania słów.',
    '- Najpierw sprawdź, co link już filtruje. Jeśli już spełnia uwagę, zwróć ten sam url.',
    '- Jeśli czegoś nie da się zrobić linkiem na tej stronie, zrób to, co się da.',
    '- Zachowaj resztę wyszukiwania bez zmian.',
    '',
    'Odpowiedz wyłącznie jednym obiektem JSON, bez komentarza:',
    '{"url":"<pełny link https>","change":"<najwyżej 15 słów po polsku: co zmieniłeś; albo dlaczego nic nie zmieniłeś lub czego nie da się zrobić>"}'
  ].join('\n');
}
// No tools at all: Claude only reads the prompt and answers. The owner's own settings,
// plugins and MCP servers are not loaded (35 s → ~20 s to start, measured 19.11), and
// claude-hook.cjs exits on RATCHET_QUIET_SESSION, so no "Claude · Temp" row appears.
function refineArgs(prompt){
  return ['-p','--permission-mode','dontAsk','--tools','','--disallowedTools','mcp__*',
    '--strict-mcp-config','--setting-sources','project',
    '--disable-slash-commands','--no-session-persistence','--max-turns','1',
    '--model','sonnet','--output-format','text',prompt];
}
const sameSite=(a,b)=>{
  const host=u=>new URL(u).hostname.replace(/^www\./,'');
  return host(a)===host(b);
};
// The answer is checked before the panel ever shows it: a real https address on the
// same site, and a short description of the change.
function parseProposal(stdout,oldUrl){
  const m=String(stdout||'').match(/\{[\s\S]*\}/);
  if(!m)throw Error('Claude nie zwrócił nowego linku. Spróbuj inaczej opisać zmianę.');
  let data;
  try{data=JSON.parse(m[0]);}catch{throw Error('Claude zwrócił nieczytelną odpowiedź. Spróbuj jeszcze raz.');}
  const url=validateTarget('url',data.url);
  if(!sameSite(url,oldUrl))throw Error('Claude zaproponował inną stronę. Link zostaje bez zmian.');
  const change=String(data.change||'').trim().slice(0,200)||'Zmieniony link wyszukiwania';
  return {url,change,same:url===validateTarget('url',oldUrl)};
}
function friendlyError(text){
  const t=String(text||'');
  if(/not logged in|\/login|authenticat|log in/i.test(t))
    // npm's claude is not on PATH on the owner's PC, so the hint names the full command.
    return 'Claude nie jest zalogowany dla Racheta. W PowerShell wpisz: & "$env:APPDATA\\npm\\claude.cmd" auth login';
  return 'Claude nie odpowiedział: '+(t.trim().slice(0,160)||'bez szczegółów');
}
function refineLink(link,note,{spawnClaude=spawn,command=claudeCommand(),timeoutMs=REFINE_TIMEOUT_MS}={}){
  const text=String(note||'').trim();
  if(!text)return Promise.reject(Error('Napisz, co jest nie tak z wynikami.'));
  if(link.kind!=='url')return Promise.reject(Error('Poprawiać można tylko linki do stron.'));
  return new Promise((resolve,reject)=>{
    let child,out='',err='',done=false;
    try{
      child=spawnClaude(command,refineArgs(refinePrompt(link,text)),{
        cwd:os.tmpdir(),shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],
        env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='RATCHET_WORKSPACE_AGENT_TOKEN')),
          RATCHET_QUIET_SESSION:'1',RATCHET_DISABLE_HOOKS:'1'}
      });
    }catch(e){reject(Error('Nie uruchomiono Claude: '+e.message));return;}
    const finish=fn=>{if(done)return;done=true;clearTimeout(timer);fn();};
    const timer=setTimeout(()=>finish(()=>{try{child.kill();}catch{}reject(Error('Claude nie odpowiedział w 90 sekund. Spróbuj jeszcze raz.'));}),timeoutMs);
    child.stdout?.on('data',d=>{out+=d;if(out.length>20000)out=out.slice(-20000);});
    child.stderr?.on('data',d=>{err+=d;if(err.length>4000)err=err.slice(-4000);});
    child.on('error',e=>finish(()=>reject(Error(/ENOENT/.test(e.message)?'Nie znaleziono Claude Code na tym komputerze.':'Nie uruchomiono Claude: '+e.message))));
    child.on('close',code=>finish(()=>{
      if(code!==0&&!/\{[\s\S]*"url"/.test(out)){reject(Error(friendlyError(err||out)));return;}
      try{resolve(parseProposal(out,link.target));}
      catch(e){reject(/nie zwrócił/.test(e.message)&&/log/i.test(out+err)?Error(friendlyError(out+err)):e);}
    }));
  });
}
// Saving keeps the previous address so one click brings it back.
function applyRefinement(link,{url,change,note},now=new Date()){
  const target=validateTarget('url',url);
  if(!sameSite(target,link.target))throw Error('Nowy link prowadzi na inną stronę.');
  const history=[{target:link.target,note:String(note||'').slice(0,NOTE_MAX),change:String(change||'').slice(0,200),at:now.toISOString()},
    ...(Array.isArray(link.history)?link.history:[])].slice(0,HISTORY_MAX);
  return {...link,target,history};
}
function undoRefinement(link){
  const [last,...rest]=Array.isArray(link.history)?link.history:[];
  if(!last)throw Error('Nie ma wcześniejszej wersji tego linku.');
  return {...link,target:last.target,history:rest};
}
module.exports={refinePrompt,refineArgs,parseProposal,refineLink,applyRefinement,undoRefinement,friendlyError,HISTORY_MAX};
