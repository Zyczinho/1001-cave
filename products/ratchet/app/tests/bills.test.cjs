'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {normalizeBill,billDue,billsNeedingYou,markPaid,monthView,billReminders,importStartList}=require('../bills.cjs');
const {normalizeStore}=require('../core.cjs');
// 22.11: phone, internet and subscriptions were spread across apps and the owner's head.
// Rachet says only what needs him: a manual bill 3 days before its day, overdue, or a failed payment.
const at=s=>new Date(s+'T10:00:00');
const bill=(over={})=>normalizeBill({title:'Telefon',amount:'99,90',day:12,since:'2026-11-01',...over},at('2026-11-01'));

test('a bill is cleaned: comma amounts, day range, https links only',()=>{
  const b=bill();
  assert.equal(b.amount,99.9);assert.equal(b.currency,'zł');assert.equal(b.mode,'manual');
  assert.throws(()=>bill({day:0}),/od 1 do 31/);
  assert.throws(()=>bill({title:' '}),/nazwę/);
  assert.throws(()=>bill({link:'javascript:alert(1)'}),/https/);
  assert.equal(bill({amount:''}).amount,null);
});
test('a manual bill needs you 3 days before its day, not earlier',()=>{
  assert.equal(billDue(bill(),at('2026-11-08')),null);
  assert.deepEqual(billDue(bill(),at('2026-11-09')),{cycle:'2026-11',due:'2026-11-12',daysLeft:3});
  assert.equal(billDue(bill(),at('2026-11-12')).daysLeft,0);
});
test('unpaid stays as overdue; "Zapłacone" clears that month only',()=>{
  const b=bill();
  assert.equal(billDue(b,at('2026-11-20')).daysLeft,-8);
  const paid=markPaid(b,'2026-11');
  assert.equal(billDue(paid,at('2026-11-20')),null);
  assert.equal(billDue(paid,at('2026-12-10')).cycle,'2026-12');
});
test('last month overdue still shows; months before adding the bill never do',()=>{
  assert.equal(billDue(bill({day:28}),at('2026-12-02')).cycle,'2026-11');
  assert.equal(billDue(bill({day:28,since:'2026-12-01'}),at('2026-12-02')),null);
});
test('day 31 falls on the last day of a short month; early-month bills look ahead',()=>{
  assert.equal(billDue(bill({day:31,since:'2027-02-01'}),at('2027-02-26')).due,'2027-02-28');
  assert.deepEqual(billDue(bill({day:1,since:'2026-12-01'}),at('2026-11-29')),{cycle:'2026-12',due:'2026-12-01',daysLeft:2});
});
test('card-paid bills never nag; a failed payment always comes first',()=>{
  const auto=bill({title:'Muzyka',mode:'auto',day:14});
  assert.equal(billDue(auto,at('2026-11-14')),null);
  const failed=bill({title:'Newsletter',mode:'auto',day:21,alert:{text:'Karta odrzuciła $60.',at:'2026-11-22T13:20:00Z'}});
  const list=billsNeedingYou([bill(),failed],at('2026-11-11'));
  assert.deepEqual(list.map(x=>[x.bill.title,x.kind]),[['Newsletter','alert'],['Telefon','due']]);
});
test('month view: states and what is left to pay per currency',()=>{
  const bills=[bill(),bill({title:'Internet',amount:80,day:28}),bill({title:'Muzyka',mode:'auto',day:14,amount:30}),bill({title:'Newsletter',mode:'auto',day:21,amount:60,currency:'$'})];
  const m=monthView([markPaid(bills[0],'2026-11'),...bills.slice(1)],at('2026-11-20'));
  assert.deepEqual(m.rows.map(r=>[r.title,r.state]),[['Telefon','paid'],['Muzyka','charged'],['Newsletter','upcoming'],['Internet','upcoming']]);
  assert.deepEqual(m.totals,{'zł':{all:209.9,left:80},'$':{all:60,left:60}});
  const late=monthView([bill({since:'2026-11-15'})],at('2026-11-20'));
  assert.equal(late.rows[0].state,'untracked');assert.equal(late.totals['zł'].left,0);
});
test('one reminder per bill and month, and one per failed payment',()=>{
  const failed=bill({title:'Newsletter',mode:'auto',alert:{text:'Karta odrzuciła $60.',at:'2026-11-22T13:20:00Z'}});
  const bills=[bill(),failed];
  const first=billReminders(bills,{},at('2026-11-10'));
  assert.deepEqual(first.map(r=>r.text),['Płatność nie przeszła: Newsletter. Karta odrzuciła $60.','Rachunek: Telefon · 99,90 zł · termin za 2 dni.']);
  const reminded=Object.fromEntries(first.map(r=>[r.key,true]));
  assert.deepEqual(billReminders(bills,reminded,at('2026-11-11')),[]);
  // A new failed payment (new time) is a new reminder.
  bills[1]={...failed,alert:{...failed.alert,at:'2026-12-22T13:20:00Z'}};
  assert.equal(billReminders(bills,reminded,at('2026-11-11')).length,1);
});
test('the store keeps bills and drops broken ones',()=>{
  const store=normalizeStore({bills:[{title:'Internet',day:28,amount:80},{title:'',day:3},{title:'Zły dzień',day:40}]});
  assert.deepEqual(store.bills.map(b=>b.title),['Internet']);
  assert.deepEqual(normalizeStore({}).bills,[]);
});
test('the start list is read once, without duplicates, then set aside',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rachet-bills-'));
  fs.writeFileSync(path.join(dir,'rachunki-start.json'),'﻿'+JSON.stringify([{title:'Internet',day:28,amount:80},{title:'telefon',day:12}]));
  const r=importStartList(dir,[bill()],at('2026-11-22'));
  assert.equal(r.imported,1);assert.deepEqual(r.bills.map(b=>b.title),['Telefon','Internet']);
  assert.equal(r.bills[1].since,'2026-11-22');
  assert.ok(!fs.existsSync(path.join(dir,'rachunki-start.json')));
  assert.equal(importStartList(dir,r.bills).imported,0);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('the panel shows bills in "Czeka na Ciebie" and a folded month list',()=>{
  const js=fs.readFileSync(path.join(__dirname,'..','ui','panel.js'),'utf8');
  assert.match(js,/bills\.map\(billWaitingRow\)/);
  assert.match(js,/data-action="bill-paid"[\s\S]*?data-cycle/);
  assert.match(js,/more\('bills'/);
  const bridge=fs.readFileSync(path.join(__dirname,'..','ui','browser-bridge.js'),'utf8');
  for(const a of ['bill:save','bill:remove','bill:paid','bill:resolved'])assert.ok(bridge.includes("'"+a+"'"),a);
});
