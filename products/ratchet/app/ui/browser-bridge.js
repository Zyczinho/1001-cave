'use strict';
// Only in the local Node companion, not in Electron and not in file:// preview.
if(!window.ratchet && location.protocol==='http:' && location.hostname==='127.0.0.1' && /^\d+$/.test(location.port)) {
  async function request(url,init) {
    let res;
    try {res=await fetch(url,init);}
    catch(e){
      window.dispatchEvent(new CustomEvent('ratchet:connection',{detail:{online:false}}));
      throw Error('Rachet utracił połączenie z serwerem. Kuleczka spróbuje je przywrócić.');
    }
    window.dispatchEvent(new CustomEvent('ratchet:connection',{detail:{online:true}}));
    let data;
    try {data=await res.json();}catch{throw Error('Serwer Racheta zwrócił nieprawidłową odpowiedź');}
    if(!res.ok)throw Error(data.error||'Błąd Racheta');
    return data;
  }
  const action=async (name,data={})=> (await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1'},body:JSON.stringify({action:name,data})})).result;
  let lastSnapshot='';
  window.ratchet={
    snapshot:()=>request('/api/snapshot'),
    onSnapshot:cb=>{let mounted=true;const poll=async()=>{if(!mounted)return;try{const snap=await request('/api/snapshot');const json=JSON.stringify(snap);if(json!==lastSnapshot){lastSnapshot=json;cb(snap);}}catch{}};const id=setInterval(poll,3500);return()=>{mounted=false;clearInterval(id);};},
    save:(collection,item)=>action('item:save',{collection,item}),
    remove:(collection,id)=>action('item:remove',{collection,id}),
    clearActivity:()=>action('activity:clear'),
    removeActivity:id=>action('activity:remove',{id}),
    saveSettings:settings=>action('settings:save',{settings}),
    scheduleAction:(id,actionName)=>action('schedule:action',{id,action:actionName}),
    open:(kind,target)=>action('open-target',{kind,target}),
    focusAgent:id=>action('agent:focus',{id}),
    chatgptSignalRemove:id=>action('chatgpt:signal-remove',{id}),
    chatgptCreate:data=>action('chatgpt:create',data),
    chatgptRefresh:()=>action('chatgpt:refresh'),
    chatgptResume:id=>action('chatgpt:resume',{id}),
    chatgptRemove:id=>action('chatgpt:remove',{id}),
    coordinatorCreate:data=>action('coordinator:create',data),
    coordinatorCheck:id=>action('coordinator:check',{id}),
    coordinatorEnable:enabled=>action('coordinator:enable',{enabled}),
    coordinatorRetry:id=>action('coordinator:retry',{id}),
    coordinatorRemove:id=>action('coordinator:remove',{id}),
    handoff:async()=>{const value=await action('handoff');await navigator.clipboard.writeText(value);return value;},
    refreshGithub:()=>action('github:refresh'),
    hidePanel:async()=>{await action('panel:hide');window.close();return true;},
    checkUpdate:()=>action('update:check'),
    installUpdate:()=>action('update:install'),
    diagnose:()=>action('diagnostics:run'),
    testNotification:()=>action('notification:test'),
    notificationStatus:id=>action('notification:status',{id}),
    quit:()=>action('quit'),
    resetOrb:()=>action('orb:reset')
  };
}
