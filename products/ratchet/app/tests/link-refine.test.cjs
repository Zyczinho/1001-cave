'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {refineArgs,refinePrompt,parseProposal,refineLink,applyRefinement,undoRefinement,friendlyError}=require('../link-refine.cjs');
const {normalizeItem}=require('../core.cjs');
// The owner's real shortcut (19.11) and the note he gave as an example.
const LINK={id:'li',title:'Praca · LinkedIn: e-commerce i growth (24 h)',kind:'url',group:'Praca',
  target:'https://www.linkedin.com/jobs/search/?keywords=e-commerce%20OR%20growth&location=Warszawa&f_TPR=r86400&f_E=1%2C2%2C3&sortBy=DD'};
function fakeClaude(stdout,{code=0,stderr=''}={}){
  const calls=[];
  const spawnClaude=(cmd,args,opts)=>{
    calls.push({cmd,args,opts});
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    setImmediate(()=>{if(stdout)child.stdout.emit('data',stdout);if(stderr)child.stderr.emit('data',stderr);child.emit('close',code);});
    return child;
  };
  return {spawnClaude,calls};
}
test('Claude gets the link and the note, with no tools and no shell',async()=>{
  const answer='{"url":"https://www.linkedin.com/jobs/search/?keywords=(e-commerce%20OR%20growth)%20NOT%20consulting&location=Warszawa&f_TPR=r86400&f_E=1%2C2&sortBy=DD","change":"Tylko junior i mid, bez consultingu"}';
  const {spawnClaude,calls}=fakeClaude(answer);
  const p=await refineLink(LINK,'za dużo seniorów i firm konsultingowych',{spawnClaude,command:'claude.exe'});
  assert.equal(p.change,'Tylko junior i mid, bez consultingu');
  assert.match(p.url,/NOT%20consulting/);
  const {args,opts}=calls[0];
  assert.equal(args[args.indexOf('--tools')+1],'','no tools at all');
  assert.equal(opts.shell,false);
  assert.equal(opts.env.RATCHET_QUIET_SESSION,'1');
  assert.match(args.at(-1),/za dużo seniorów/);
  assert.match(args.at(-1),/f_E=1%2C2%2C3/);
});
test('a proposal must stay on the same site and be a real https link',()=>{
  assert.throws(()=>parseProposal('{"url":"https://evil.example/jobs","change":"x"}',LINK.target),/inną stronę/);
  assert.throws(()=>parseProposal('{"url":"javascript:alert(1)","change":"x"}',LINK.target));
  assert.throws(()=>parseProposal('Nie wiem',LINK.target),/nie zwrócił/);
  const ok=parseProposal('Proszę:\n{"url":"https://linkedin.com/jobs/search/?keywords=growth","change":"Krócej"}',LINK.target);
  assert.equal(ok.url,'https://linkedin.com/jobs/search/?keywords=growth');
});
test('not logged in turns into one clear instruction',async()=>{
  assert.match(friendlyError('Invalid API key · Please run /login'),/claude.cmd" auth login/);
  const {spawnClaude}=fakeClaude('Not logged in · Please run /login',{code:1});
  await assert.rejects(refineLink(LINK,'bez seniorów',{spawnClaude}),/claude.cmd" auth login/);
});
test('an empty note or a folder never starts Claude',async()=>{
  const {spawnClaude,calls}=fakeClaude('{}');
  await assert.rejects(refineLink(LINK,'  ',{spawnClaude}),/Napisz/);
  await assert.rejects(refineLink({...LINK,kind:'folder'},'x',{spawnClaude}),/linki do stron/);
  assert.equal(calls.length,0);
});
test('save keeps the old address; undo brings it back; history survives a restart',()=>{
  const next='https://www.linkedin.com/jobs/search/?keywords=growth&f_E=1%2C2';
  const saved=applyRefinement(LINK,{url:next,change:'Bez seniorów',note:'za dużo seniorów'},new Date('2026-11-19T10:00:00Z'));
  assert.equal(saved.target,next);
  assert.equal(saved.history[0].target,LINK.target);
  const reloaded=normalizeItem('links',JSON.parse(JSON.stringify(saved)));
  assert.equal(reloaded.history[0].change,'Bez seniorów');
  assert.equal(undoRefinement(reloaded).target,LINK.target);
  assert.throws(()=>undoRefinement(LINK),/wcześniejszej/);
  assert.throws(()=>applyRefinement(LINK,{url:'https://pracuj.pl/praca'}),/inną stronę/);
});
test('prompt names the real filter codes and forbids leaving the site',()=>{
  const p=refinePrompt(LINK,'za dużo seniorów');
  assert.match(p,/ta sama domena/);assert.match(p,/"url"/);
  // Checked on the sites 19.11: without these Claude cut "mid" thinking it was senior.
  assert.match(p,/4 mid-senior/);assert.match(p,/17 junior, 4 mid, 18 senior/);assert.match(p,/praca-zdalna/);
  const args=refineArgs(p);
  assert.ok(args.includes('--no-session-persistence'));
  // The owner's plugins and MCP servers are not loaded for this one-shot call.
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--setting-sources')+1],'project');
  assert.ok(!args.includes('--bare'),'--bare drops claude.ai login');
});
test("Rachet's own Claude call does not show up as a session row",()=>{
  const hook=path.join(__dirname,'..','scripts','claude-hook.cjs');
  const r=spawnSync(process.execPath,[hook],{input:JSON.stringify({session_id:'s',hook_event_name:'SessionStart'}),
    env:{...process.env,RATCHET_QUIET_SESSION:'1',RATCHET_HOOK_PORT:'1'},timeout:5000});
  assert.equal(r.status,0);
  assert.match(fs.readFileSync(hook,'utf8'),/RATCHET_QUIET_SESSION==='1'\)process\.exit\(0\)/);
});
test('panel: tune button on url shortcuts, nothing saved before Zapisz',()=>{
  const js=fs.readFileSync(path.join(__dirname,'..','ui','panel.js'),'utf8');
  assert.match(js,/x\.kind==='url'&&\/\\\?\.\/\.test\(x\.target\)\?'<button class="row-act quiet-act" data-action="refine"/);
  assert.match(js,/act==='refine-save'&&refineProposal\)\{\s*await bridge\.applyLink/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','scripts','build-candidate.cjs'),'utf8'),/'link-refine\.cjs'/);
});
