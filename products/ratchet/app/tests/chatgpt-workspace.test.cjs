'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {ChatGPTWorkspaceWatcher,normalizeChatGPTRuns,chatUrl,newTask}=require('../chatgpt-workspace.cjs');

const input={title:'City Route — test ChatGPT',triggerId:'agtch_cityroute123',input:'Sprawdź ścieżkę dodawania nowych miejsc do katalogu.'};
const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
const docRun=(id,status,extra={})=>({id,api_trigger_id:input.triggerId,status,conversation_url:'https://chatgpt.com/c/abcdef123',...extra});

test('Workspace adapter: no token means no API calls and no accidental task launch',async()=>{
  const jobs=[],calls=[];
  const watcher=new ChatGPTWorkspaceWatcher({getJobs:()=>jobs,persist:()=>{},notify:()=>{},token:'',fetchImpl:async x=>{calls.push(x);throw Error('never');}});
  assert.equal(watcher.isConfigured(),false);
  await assert.rejects(()=>watcher.create(input),/Brak tokenu/);
  await watcher.poll();
  assert.deepEqual(jobs,[]);
  assert.equal(calls.length,0);
});
test('Workspace adapter: only known API IDs and trusted ChatGPT links',()=>{
  assert.throws(()=>newTask({...input,triggerId:'https://evil.example/'}),/agtch_/);
  assert.equal(chatUrl('https://chatgpt.com/c/abcdef123'),'https://chatgpt.com/c/abcdef123');
  assert.equal(chatUrl('https://chatgpt.com.evil.example/c/abcdef123'),'');
  assert.equal(chatUrl('http://chatgpt.com/c/abcdef123'),'');
  assert.equal(chatUrl('https://chatgpt.com/c/abcdef123?x=1'),'');
  assert.equal(chatUrl('javascript:alert(1)'),'');
});
test('Workspace adapter: real API 202 -> queued -> in_progress -> completed, one human alert',async()=>{
  const jobs=[],notices=[],calls=[];
  let polled=0,persists=0;
  const watcher=new ChatGPTWorkspaceWatcher({
    getJobs:()=>jobs,persist:()=>{persists++;},
    notify:(...n)=>notices.push(n),token:'test-secret-never-log',
    fetchImpl:async(url,opts)=>{
      calls.push({url,opts});
      if(opts.method==='POST')return response(202,{agent_trigger_run_id:'apirun_abc123',conversation_url:'https://chatgpt.com/c/abcdef123'});
      polled++;
      return response(200,docRun('apirun_abc123',polled===1?'in_progress':'completed'));
    }
  });
  const job=await watcher.create(input);
  assert.equal(job.status,'queued');
  assert.equal(job.runId,'apirun_abc123');
  assert.equal(calls[0].opts.headers['OpenAI-Beta'],'workspace_agent_runs=v1');
  assert.match(calls[0].opts.headers.Authorization,/^Bearer test-secret/);
  assert.equal(calls[0].opts.headers['Idempotency-Key'],job.idempotencyKey);
  await watcher.poll();assert.equal(job.status,'in_progress');
  await watcher.poll();assert.equal(job.status,'completed');
  await watcher.poll();
  assert.equal(notices.length,1);
  assert.equal(notices[0][3],'chatgpt');
  assert.equal(notices[0][4],'https://chatgpt.com/c/abcdef123');
  assert.ok(persists>=4);
  assert.equal(polled,2);
  const disk=JSON.stringify(normalizeChatGPTRuns(jobs));
  assert.ok(!disk.includes('test-secret-never-log'));
  assert.ok(!disk.includes(input.input),'Prompt text should not be persisted to local profile');
});
test('Workspace adapter: failed is not reported as completed',async()=>{
  const jobs=[],notices=[];
  const watcher=new ChatGPTWorkspaceWatcher({
    getJobs:()=>jobs,persist:()=>{},notify:(...n)=>notices.push(n),token:'token',
    fetchImpl:async(url,o)=>o.method==='POST'
      ?response(202,{agent_trigger_run_id:'apirun_abc123'})
      :response(200,docRun('apirun_abc123','failed',{error:{code:'run_failed'}}))
  });
  const job=await watcher.create(input);
  await watcher.poll();
  assert.equal(job.status,'failed');
  assert.equal(job.reason,'run_failed');
  assert.equal(notices.length,1);
  assert.equal(notices[0][3],'chatgpt-failure');
  assert.doesNotMatch(notices[0][0],/zakończył zadanie/);
});
test('Workspace adapter: accepting trigger without run ID is not a success and never resends',async()=>{
  const jobs=[],notices=[],calls=[];
  const watcher=new ChatGPTWorkspaceWatcher({
    getJobs:()=>jobs,persist:()=>{},notify:(...n)=>notices.push(n),token:'token',
    fetchImpl:async(url,o)=>{calls.push(url);return response(202,{conversation_url:'https://chatgpt.com/c/abcdef123'});}
  });
  const job=await watcher.create(input);
  assert.equal(job.status,'attention');assert.equal(job.runId,'');
  await watcher.poll();await watcher.poll();
  assert.equal(calls.length,1);
  assert.equal(notices.length,1);
  assert.match(job.reason,/nie zwróciło ID/);
});
test('Workspace adapter: network flaps never claim completion; polling can be manually resumed',async()=>{
  const jobs=[],notices=[];
  let bad=true;
  const watcher=new ChatGPTWorkspaceWatcher({
    getJobs:()=>jobs,persist:()=>{},notify:(...n)=>notices.push(n),token:'token',
    fetchImpl:async(url,o)=>{
      if(o.method==='POST')return response(202,{agent_trigger_run_id:'apirun_abc123'});
      if(bad)throw Error('offline');
      return response(200,docRun('apirun_abc123','completed'));
    }
  });
  const job=await watcher.create(input);
  await watcher.poll();await watcher.poll();await watcher.poll();
  assert.equal(job.status,'attention');
  assert.match(job.reason,/Nie oznacza/);
  assert.equal(notices.length,1);
  bad=false;
  await watcher.resumeMonitoring(job.id);
  assert.equal(job.status,'completed');
  assert.equal(notices.filter(n=>n[3]==='chatgpt').length,1);
});
test('Workspace adapter: no spoofed run ID can mark success',async()=>{
  const jobs=[],notices=[];
  const watcher=new ChatGPTWorkspaceWatcher({
    getJobs:()=>jobs,persist:()=>{},notify:(...n)=>notices.push(n),token:'token',
    fetchImpl:async(url,o)=>o.method==='POST'
      ?response(202,{agent_trigger_run_id:'apirun_abc123'})
      :response(200,docRun('apirun_other','completed'))
  });
  const job=await watcher.create(input);
  await watcher.poll();
  assert.equal(job.status,'queued');
  assert.equal(notices.length,0);
});
test('Workspace adapter: UI does not request credentials in form or assert ordinary ChatGPT browser completions',()=>{
  const ui=fs.readFileSync(path.resolve(__dirname,'../ui/panel.js'),'utf8');
  const server=fs.readFileSync(path.resolve(__dirname,'../server.cjs'),'utf8');
  const native=fs.readFileSync(path.resolve(__dirname,'../Ratchet-Kuleczka.ps1'),'utf8');
  assert.match(ui,/function renderChatGPTWorkspace/);
  assert.match(ui,/Zwykłe rozmowy ChatGPT nie są tutaj automatycznie monitorowane/);
  assert.match(ui,/data-action="chatgpt-refresh"/);
  assert.doesNotMatch(ui,/name="apiKey"|name="token"/);
  assert.match(server,/RATCHET_WORKSPACE_AGENT_TOKEN/);
  assert.match(server,/chatgptWatcher\.poll/);
  assert.match(native,/'chatgpt' \{ return/);
  assert.match(native,/'chatgpt-failure' \{ return/);
});
