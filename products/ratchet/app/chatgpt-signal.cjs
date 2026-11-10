'use strict';
// Explicit, opt-in signals submitted by a ChatGPT MCP tool, not host-verified turn events.
const {randomUUID}=require('node:crypto');
const {chatUrl}=require('./chatgpt-workspace.cjs');
const MAX=60;
const trim=(s,n)=>String(s??'').trim().slice(0,n);
const validState=new Set(['working','reported_done','needs_attention']);
function normalizeSignals(input){
  if(!Array.isArray(input))return [];
  return input.slice(0,MAX).filter(x=>x&&typeof x==='object'&&x.id&&x.title).map(x=>({
    id:trim(x.id,90),title:trim(x.title,160),clientKey:trim(x.clientKey,100),
    status:validState.has(x.status)?x.status:'working',
    note:trim(x.note,350),conversationUrl:chatUrl(x.conversationUrl),
    startedAt:trim(x.startedAt,60),updatedAt:trim(x.updatedAt,60)
  }));
}
function startSignal(signals,raw){
  if(signals.length>=MAX)throw Error('Limit 60 sygnałów. Usuń stare wpisy.');
  const title=trim(raw?.title,160),clientKey=trim(raw?.clientKey,100);
  if(title.length<3)throw Error('Podaj nazwę zadania.');
  if(clientKey.length<8)throw Error('Podaj niepowtarzalny identyfikator zadania.');
  const existing=signals.find(x=>x.clientKey===clientKey);
  if(existing)return {signal:existing,created:false};
  const at=new Date().toISOString();
  const signal={id:randomUUID(),title,clientKey,status:'working',note:'',
    conversationUrl:chatUrl(raw?.conversationUrl),startedAt:at,updatedAt:at};
  signals.unshift(signal);
  return {signal,created:true};
}
function updateSignal(signals,raw){
  const signal=signals.find(s=>s.id===trim(raw?.id,90));
  if(!signal)throw Error('Nie znaleziono zgłoszonego zadania. Najpierw wywołaj start.');
  const status=raw?.status;
  if(status!=='reported_done'&&status!=='needs_attention')throw Error('Nieprawidłowy status sygnału.');
  if(signal.status===status)return {signal,changed:false};
  if(signal.status!=='working')throw Error('Zadanie już zakończono lub zablokowano. Utwórz nowe.');
  signal.status=status;signal.note=trim(raw?.note,350);
  signal.conversationUrl=chatUrl(raw?.conversationUrl)||signal.conversationUrl;
  signal.updatedAt=new Date().toISOString();
  return {signal,changed:true};
}
module.exports={normalizeSignals,startSignal,updateSignal};
