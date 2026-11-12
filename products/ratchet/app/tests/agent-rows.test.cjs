'use strict';
// One project = one row. Cases taken from the owner's real Agenci list (2026-11-12).
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectName,chatProjectName,tidyAgentRows,browserChatOutcome,rowKey}=require('../core.cjs');

const SCRATCH='C:\\Users\\me\\AppData\\Local\\Claude-Data\\claude_x\\scratch-workspaces\\9c7f\\c9dd\\';
const NAMED='https://chatgpt.com/g/g-p-6a9fea15096881918994147ef39e514e-szukamy-pracy/c/6af5db25-d998-83ed-9b98-b6a3f5330062';
const NAMELESS='https://chatgpt.com/g/g-p-6a9fea15096881918994147ef39e514e/c/6af5db25-d998-83ed-9b98-b6a3f5330062';
const now=Date.parse('2026-11-12T16:00:00Z');
const at=min=>new Date(now-min*60000).toISOString();

test('every Claude chat without a folder shares one row',()=>{
  assert.equal(projectName(SCRATCH+'scratch-2026-11-12-835967'),'Szybkie czaty Claude');
  assert.equal(projectName(SCRATCH+'scratch-2026-11-11-7401b1'),'Szybkie czaty Claude');
  assert.equal(projectName('C:\\Users\\me\\BOX2BOX\\.claude\\worktrees\\store-results'),'BOX2BOX','real projects keep their name');
});

test('a ChatGPT address without the project name joins the named project row',()=>{
  assert.equal(chatProjectName(NAMELESS,[NAMED]),'szukamy-pracy');
  assert.equal(chatProjectName(NAMELESS,[]),'','unknown until a named address is seen');
  assert.equal(chatProjectName('https://chatgpt.com/c/6af5db25-d998-83ed-9b98-b6a3f5330062',[NAMED]),'','plain chats are not in a project');
  const r=browserChatOutcome({url:NAMELESS,state:'done',title:'CV - ChatGPT'},{project:'szukamy-pracy',now});
  assert.equal(r.title,'szukamy-pracy · CV');
});

test('old duplicate rows are tidied: scratch rows merge, nameless ChatGPT row goes, resting rows fade',()=>{
  const rows=[
    {id:'project:claude:scratch-2026-11-12-835967',title:'scratch-2026-11-12-835967',source:'hook',status:'working',target:SCRATCH+'scratch-2026-11-12-835967',updatedAt:at(5)},
    {id:'project:claude:scratch-2026-11-12-ba5dcc',title:'scratch-2026-11-12-ba5dcc',source:'hook',status:'idle',target:SCRATCH+'scratch-2026-11-12-ba5dcc',updatedAt:at(30)},
    {id:'project:chatgpt:szukamy-pracy',title:'szukamy-pracy',source:'browser',status:'ready',target:NAMED,updatedAt:at(30)},
    {id:'project:chatgpt:chatgpt',title:'ChatGPT',source:'browser',status:'idle',target:NAMELESS,updatedAt:at(31)},
    {id:'project:claude:old-repo',title:'old-repo',source:'hook',status:'idle',target:'C:\\old-repo',updatedAt:at(4*24*60)},
    {id:'project:claude:busy-repo',title:'busy-repo',source:'hook',status:'ready',target:'C:\\busy-repo',updatedAt:at(4*24*60)},
    {id:'manual-1',title:'Ręczny agent',source:'manual',status:'idle',target:'',updatedAt:at(30*24*60)},
  ];
  const out=tidyAgentRows(rows,now);
  assert.deepEqual(out.map(a=>a.id),[rowKey('claude','Szybkie czaty Claude'),'project:chatgpt:szukamy-pracy','project:claude:busy-repo','manual-1']);
  assert.equal(out[0].status,'working','the newest scratch chat decides the shared row');
  assert.equal(out[0].title,'Szybkie czaty Claude');
  assert.equal(tidyAgentRows(out,now).length,out.length,'tidying twice changes nothing');
});
