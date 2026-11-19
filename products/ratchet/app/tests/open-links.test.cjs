'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../core.cjs');
// 2026-11-19: every job-search shortcut was dead. explorer.exe silently drops an
// http(s) address whose query has "=" or "," (LinkedIn, Pracuj, RocketJobs),
// while a bare https://www.linkedin.com/ still opened. The owner's real links:
const LINKEDIN='https://www.linkedin.com/jobs/search/?keywords=e-commerce%20OR%20growth%20OR%20marketplace%20OR%20performance&location=Warszawa&f_TPR=r86400&f_E=1%2C2%2C3&sortBy=DD';
const ROCKET='https://rocketjobs.pl/oferty-pracy/warszawa/marketing?experience-level=junior,mid&orderBy=DESC&sortBy=published';
test('links open through the URL protocol handler, never explorer.exe',()=>{
  assert.equal(typeof core.launchCommand,'function');
  for(const url of [LINKEDIN,ROCKET,'https://github.com/Zyczinho/1001-cave']){
    const [exe,args]=core.launchCommand('url',core.validateTarget('url',url),'C:\\Windows');
    assert.equal(exe,'C:\\Windows\\System32\\rundll32.exe');
    assert.deepEqual(args,['url.dll,FileProtocolHandler',new URL(url).href]);
  }
});
test('folders still open in Explorer',()=>{
  assert.deepEqual(core.launchCommand('folder','C:\\Users\\x\\proj','C:\\Windows'),['C:\\Windows\\explorer.exe',['C:\\Users\\x\\proj']]);
});
