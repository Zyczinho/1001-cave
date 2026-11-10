'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'ui/panel.js'),'utf8');
const css=fs.readFileSync(path.join(root,'ui/style.css'),'utf8');
const html=fs.readFileSync(path.join(root,'ui/panel.html'),'utf8');
function renderGuide(seen,open,step){
  // Evaluate the isolated, pure HTML renderer without loading the app or launching agents.
  const i=js.indexOf('const agentGuideSteps=[');
  const j=js.indexOf('function renderCoordinator(){',i);
  assert.ok(i>=0&&j>i);
  const snippet=js.slice(i,j);
  const render=new Function('agentGuideSeen','agentGuideOpen','agentGuideStep','I','esc',
    snippet+'\nreturn {steps:agentGuideSteps,html:renderAgentGuide()};');
  return render(seen,open,step,n=>'<span data-icon="'+n+'"></span>',
    s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'));
}
test('Agents tutorial: exactly three steps, safe content, progress and controls',()=>{
  const a=renderGuide(false,false,0);
  assert.equal(a.steps.length,3);
  assert.match(a.html,/Krok 1 z 3/);
  assert.match(a.html,/data-action="agent-guide-next"/);
  assert.match(a.html,/data-action="agent-guide-skip"/);
  assert.doesNotMatch(a.html,/data-action="coordinator-toggle"/);
  assert.match(a.steps[0].note,/ChatGPT w przeglądarce nie wysyła/);
  const b=renderGuide(false,true,1);
  assert.match(b.html,/Krok 2 z 3/);
  assert.match(b.html,/agent-guide-back/);
  const c=renderGuide(false,true,2);
  assert.match(c.html,/Zakończ samouczek/);
});
test('Agents tutorial: completed guide becomes manual replay link',()=>{
  const result=renderGuide(true,false,0);
  assert.match(result.html,/data-action="agent-guide-restart"/);
  assert.doesNotMatch(result.html,/data-action="agent-guide-next"/);
  assert.match(renderGuide(true,true,0).html,/Krok 1 z 3/);
});
test('Agents tutorial: first viewing cannot enable automation or spend AI credits',()=>{
  assert.match(js,/const AGENT_GUIDE_KEY='ratchet-agents-intro-v1'/);
  assert.match(js,/function finishAgentGuide\(\)/);
  assert.match(js,/localStorage\.setItem\(AGENT_GUIDE_KEY,'seen'\)/);
  assert.match(js,/html\+=renderAgentGuide\(\)/);
  assert.match(js,/if\(act==='agent-guide-next'\)/);
  assert.match(js,/if\(act==='agent-guide-skip'\)/);
  assert.match(js,/if\(act==='agent-guide-restart'\)/);
  const start=js.indexOf("if(act==='agent-guide-restart')");
  const end=js.indexOf("if(act==='coordinator-toggle')",start);
  assert.ok(start>=0&&end>start);
  const handlers=js.slice(start,end);
  assert.doesNotMatch(handlers,/coordinatorEnable|coordinatorCreate|scheduleAction|open-target/);
  assert.match(html,/data-tab="agents"/);
});
test('Agents tutorial: compact layout and accessible semantic progress',()=>{
  assert.match(css,/\.agent-guide\{/);
  assert.match(css,/\.agent-guide-reopen\{/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(js,/role="progressbar"/);
  assert.match(js,/aria-valuenow=/);
});
