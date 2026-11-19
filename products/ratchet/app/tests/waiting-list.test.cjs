'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const js=fs.readFileSync(path.join(__dirname,'..','ui','panel.js'),'utf8');
// 19.11: the owner never opened GitHub, the PR list or "Skopiuj stan"; the panel
// answers one question instead: which sessions wait for me, longest wait first.
function load(agents){
  const src=js.match(/const WAITING=[^\n]+\n/)[0]+js.match(/function waitingAgents\(\)\{[\s\S]*?\n\}/)[0];
  const ctx={state:()=>({agents})};vm.createContext(ctx);vm.runInContext(src+';this.waitingAgents=waitingAgents;',ctx);
  return ctx.waitingAgents();
}
test('waiting list: questions, errors and finished work, longest wait first',()=>{
  const list=load([
    {id:'a',status:'working',updatedAt:'2026-11-19T08:00:00Z'},
    {id:'b',status:'ready',updatedAt:'2026-11-19T09:30:00Z'},
    {id:'c',status:'needs_attention',updatedAt:'2026-11-19T09:00:00Z'},
    {id:'d',status:'idle',updatedAt:'2026-11-19T07:00:00Z'},
    {id:'e',status:'blocked',updatedAt:'2026-11-19T09:10:00Z'},
  ]);
  assert.deepEqual(list.map(a=>a.id),['c','e','b']);
});
test('waiting list sits on top of Dziś and every row jumps into its session',()=>{
  assert.match(js,/Czeka na Ciebie · /);
  assert.match(js,/function waitingRow\(a\)[\s\S]*?agentOpen\(a\)/);
  assert.match(js,/data-action="agent-finish"/);
});
test('GitHub, PR list and copy-state are gone from the panel and the orb',()=>{
  const orb=fs.readFileSync(path.join(__dirname,'..','ui','orb.js'),'utf8');
  for(const gone of [/Skopiuj stan/,/Otwarte PR-y/,/github-refresh/,/data-action="handoff"/,/renderFilteredAgents/,/snapshot\.github/])
    assert.doesNotMatch(js,gone);
  assert.doesNotMatch(orb,/github/);
});
