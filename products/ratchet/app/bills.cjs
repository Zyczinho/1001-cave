'use strict';
// Rachunki (owner, 22.11): phone, internet, rent and subscriptions live in many apps and
// in the owner's head. Rachet keeps one list and says only what needs him now: a manual
// bill 3 days before its due day (or overdue), and any failed payment. Amounts and names
// stay local in %APPDATA%\Ratchet; nothing here leaves the computer.
const {randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');

const SOON_DAYS=3;
const CURRENCIES=['zł','€','$'];
const DAY_MS=86400000;
const pad=n=>String(n).padStart(2,'0');
const text=(v,max)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);
const ymOf=d=>d.getFullYear()+'-'+pad(d.getMonth()+1);
const dateOf=d=>ymOf(d)+'-'+pad(d.getDate());
const midnight=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x;};
function shiftMonth(ym,delta){const [y,m]=ym.split('-').map(Number);const d=new Date(y,m-1+delta,1);return ymOf(d);}

function normalizeBill(raw,now=new Date()){
  if(!raw||typeof raw!=='object')throw Error('Nieprawidłowe dane rachunku');
  const title=text(raw.title,80);
  if(!title)throw Error('Podaj nazwę rachunku');
  const day=Math.floor(Number(raw.day));
  if(!(day>=1&&day<=31))throw Error('Dzień płatności to liczba od 1 do 31');
  const amountText=String(raw.amount??'').replace(',','.').replace(/\s/g,'');
  const amount=amountText===''?null:Number(amountText);
  if(amount!==null&&!(amount>=0&&amount<1e7))throw Error('Kwota musi być liczbą');
  const link=text(raw.link,2048);
  if(link&&!/^https?:\/\//i.test(link))throw Error('Link do płatności musi zaczynać się od https://');
  const since=/^\d{4}-\d{2}-\d{2}$/.test(String(raw.since||''))?raw.since:dateOf(now);
  const paid=[...new Set((Array.isArray(raw.paid)?raw.paid:[]).filter(x=>/^\d{4}-\d{2}$/.test(String(x))))].sort().slice(-24);
  const alert=raw.alert&&text(raw.alert.text,240)?{text:text(raw.alert.text,240),at:text(raw.alert.at,40)||now.toISOString()}:null;
  return {
    id:text(raw.id,100)||randomUUID(),title,amount:amount===null?null:Math.round(amount*100)/100,
    currency:CURRENCIES.includes(raw.currency)?raw.currency:'zł',day,
    // manual = you pay it (reminder + "Zapłacone"); auto = the card is charged, Rachet only shows it.
    mode:raw.mode==='auto'?'auto':'manual',
    link,note:text(raw.note,200),since,paid,alert
  };
}
function normalizeBills(list){
  if(!Array.isArray(list))return [];
  const out=[];
  for(const raw of list.slice(0,100)){try{out.push(normalizeBill(raw));}catch{}}
  return out;
}
// The due date of one month's bill; day 31 falls on the last day of shorter months.
function dueDate(bill,ym){
  const [y,m]=ym.split('-').map(Number);
  const last=new Date(y,m,0).getDate();
  return new Date(y,m-1,Math.min(bill.day,last));
}
// The month cycle that needs you now: unpaid, due in 3 days or less, or overdue.
// Months before the bill was added never count, so a new bill does not start overdue.
function billDue(bill,now=new Date()){
  if(bill.mode!=='manual')return null;
  const today=midnight(now),cur=ymOf(today);
  for(const ym of [shiftMonth(cur,-1),cur,shiftMonth(cur,1)]){
    const due=dueDate(bill,ym);
    if(dateOf(due)<bill.since||bill.paid.includes(ym))continue;
    const daysLeft=Math.round((due-today)/DAY_MS);
    if(daysLeft<=SOON_DAYS)return {cycle:ym,due:dateOf(due),daysLeft};
  }
  return null;
}
// Everything a bill wants from you, most urgent first: failed payments, then overdue, then soon.
function billsNeedingYou(bills,now=new Date()){
  const items=[];
  for(const bill of bills){
    if(bill.alert)items.push({bill,kind:'alert',rank:-1000});
    const due=billDue(bill,now);
    if(due)items.push({bill,kind:'due',...due,rank:due.daysLeft});
  }
  return items.sort((a,b)=>a.rank-b.rank);
}
function markPaid(bill,cycle){
  if(!/^\d{4}-\d{2}$/.test(String(cycle||'')))throw Error('Nieprawidłowy miesiąc');
  return {...bill,paid:[...new Set([...bill.paid,cycle])].sort().slice(-24)};
}
// This month at a glance: every bill with its state, and the totals per currency.
function monthView(bills,now=new Date()){
  const today=midnight(now),ym=ymOf(today);
  const rows=bills.map(bill=>{
    const due=dueDate(bill,ym),passed=due<today;
    const state=bill.alert?'alert'
      :bill.mode==='auto'?(passed||dateOf(due)===dateOf(today)?'charged':'upcoming')
      :bill.paid.includes(ym)?'paid'
      // Added after this month's due day: Rachet does not know, so it does not nag.
      :dateOf(due)<bill.since?'untracked'
      :passed?'overdue'
      :Math.round((due-today)/DAY_MS)<=SOON_DAYS?'soon':'upcoming';
    return {id:bill.id,title:bill.title,amount:bill.amount,currency:bill.currency,mode:bill.mode,due:dateOf(due),state};
  }).sort((a,b)=>a.due.localeCompare(b.due)||a.title.localeCompare(b.title));
  const totals={};
  for(const r of rows){
    if(r.amount===null)continue;
    const t=totals[r.currency]||(totals[r.currency]={all:0,left:0,done:0});
    t.all+=r.amount;
    // A bill added after its day this month is neither left nor done.
    if(['paid','charged'].includes(r.state))t.done+=r.amount;
    else if(r.state!=='untracked')t.left+=r.amount;
  }
  for(const t of Object.values(totals))for(const k of ['all','left','done'])t[k]=Math.round(t[k]*100)/100;
  return {month:ym,rows,totals};
}
function money(amount,currency){
  if(amount===null||amount===undefined)return '';
  const n=Number(amount).toLocaleString('pl-PL',{minimumFractionDigits:Number.isInteger(amount)?0:2,maximumFractionDigits:2});
  return currency==='zł'?n+' zł':currency+n;
}
function dueWords(item){
  if(item.daysLeft<0)return 'po terminie '+(-item.daysLeft)+' '+(item.daysLeft===-1?'dzień':'dni');
  if(item.daysLeft===0)return 'termin dziś';
  if(item.daysLeft===1)return 'termin jutro';
  return 'termin za '+item.daysLeft+' dni';
}
// One reminder per bill and month (and per failed payment), never repeated after a restart.
function billReminders(bills,reminded,now=new Date()){
  const out=[];
  for(const item of billsNeedingYou(bills,now)){
    const key=item.kind==='alert'?'bill:'+item.bill.id+':alert:'+item.bill.alert.at:'bill:'+item.bill.id+':'+item.cycle;
    if(reminded[key])continue;
    const amount=money(item.bill.amount,item.bill.currency);
    out.push({key,text:item.kind==='alert'
      ?'Płatność nie przeszła: '+item.bill.title+'. '+item.bill.alert.text
      :'Rachunek: '+item.bill.title+(amount?' · '+amount:'')+' · '+dueWords(item)+'.'});
  }
  return out;
}
// One-time start list: %APPDATA%\Ratchet\rachunki-start.json is read once into the store
// and renamed, so the owner never types the bills found in his mail by hand.
function importStartList(dir,bills,now=new Date()){
  const file=path.join(dir,'rachunki-start.json');
  if(!fs.existsSync(file))return {bills,imported:0};
  let list=[];
  try{list=normalizeBills(JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,'')).map(b=>({since:dateOf(now),...b})));}catch{return {bills,imported:0};}
  const titles=new Set(bills.map(b=>b.title.toLowerCase()));
  const fresh=list.filter(b=>!titles.has(b.title.toLowerCase()));
  try{fs.renameSync(file,file.replace(/\.json$/,'.zaimportowane.json'));}catch{}
  return {bills:[...bills,...fresh],imported:fresh.length};
}
module.exports={SOON_DAYS,CURRENCIES,normalizeBill,normalizeBills,dueDate,billDue,billsNeedingYou,markPaid,monthView,money,dueWords,billReminders,importStartList};
