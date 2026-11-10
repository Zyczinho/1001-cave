'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {startSignal,updateSignal,normalizeSignals}=require('../chatgpt-signal.cjs');
const {chatUrl}=require('../chatgpt-workspace.cjs');
const root=path.resolve(__dirname,'..');
const args={title:'Sprawdzenie City Route',clientKey:'city-route-issue-142-test',conversationUrl:'https://chatgpt.com/c/abcde123'};

test('MCP: explicit task start is idempotent and never claims automatic web completion',()=>{
 const list=[];const a=startSignal(list,args),b=startSignal(list,args);
 assert.equal(a.created,true);assert.equal(b.created,false);
 assert.equal(a.signal.id,b.signal.id);assert.equal(list.length,1);
 assert.equal(a.signal.status,'working');
});
test('MCP: completing or blocking requires a real tracked ID and emits only one state change',()=>{
 const list=[],a=startSignal(list,args).signal;
 const first=updateSignal(list,{id:a.id,status:'reported_done',note:'Analiza gotowa.'});
 assert.equal(first.changed,true);
 assert.equal(first.signal.status,'reported_done');
 const repeated=updateSignal(list,{id:a.id,status:'reported_done'});
 assert.equal(repeated.changed,false);
 assert.throws(()=>updateSignal(list,{id:'unknown',status:'reported_done'}),/Najpierw wywołaj start/);
 assert.throws(()=>updateSignal(list,{id:a.id,status:'needs_attention'}),/już zakończono/);
 const b=startSignal(list,{...args,clientKey:'another-issue-143'}).signal;
 updateSignal(list,{id:b.id,status:'needs_attention',note:'Brak dostępu do repo.'});
 assert.equal(b.status,'needs_attention');
});
test('MCP: safe URL and persisted data normalization',()=>{
 const arr=[];
 const a=startSignal(arr,{...args,conversationUrl:'https://chatgpt.com.evil.example/c/abcde123'}).signal;
 assert.equal(a.conversationUrl,'');
 updateSignal(arr,{id:a.id,status:'reported_done',conversationUrl:'https://chatgpt.com/c/abcde123'});
 assert.equal(a.conversationUrl,chatUrl('https://chatgpt.com/c/abcde123'));
 const stored=normalizeSignals(arr);
 assert.equal(stored.length,1);
 assert.equal(stored[0].status,'reported_done');
});
test('MCP: integration does not read browser cookies or expose public listener',()=>{
 const plugin=fs.readFileSync(path.resolve(root,'../integrations/chatgpt-mcp/server.js'),'utf8');
 const server=fs.readFileSync(path.resolve(root,'server.cjs'),'utf8');
 const native=fs.readFileSync(path.resolve(root,'Ratchet-Kuleczka.ps1'),'utf8');
 assert.match(plugin,/server\.registerTool\('ratchet_task_started'/);
 assert.match(plugin,/server\.registerTool\('ratchet_task_completed'/);
 assert.match(plugin,/server\.registerTool\('ratchet_task_needs_attention'/);
 assert.match(plugin,/listen\(port,'127\.0\.0\.1'/);
 assert.match(plugin,/RATCHET_API_BASE/);
 assert.doesNotMatch(plugin,/cookie|document\.querySelector|sessionStorage/i);
 assert.match(server,/chatgpt:signal-complete/);
 assert.match(native,/'chatgpt-signal' \{ return/);
});
