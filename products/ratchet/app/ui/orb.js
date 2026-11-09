'use strict';
const orb=document.getElementById('orb');
const bridge=window.ratchet;
let pointer=null;
orb.addEventListener('pointerdown',e=>{if(e.button!==0)return;pointer={x:e.screenX,y:e.screenY,lastX:e.screenX,lastY:e.screenY,moved:false};orb.setPointerCapture(e.pointerId);});
orb.addEventListener('pointermove',e=>{
  if(!pointer)return;
  const dx=Math.round(e.screenX-pointer.lastX),dy=Math.round(e.screenY-pointer.lastY);
  if(Math.abs(e.screenX-pointer.x)+Math.abs(e.screenY-pointer.y)>7)pointer.moved=true;
  if(pointer.moved&&(dx||dy))bridge?.moveOrb(dx,dy);
  pointer.lastX=e.screenX;pointer.lastY=e.screenY;
});
orb.addEventListener('pointerup',()=>{if(pointer&&!pointer.moved)bridge?.togglePanel();pointer=null;});
orb.addEventListener('pointercancel',()=>{pointer=null;});
function show(snapshot) {
  const a=snapshot?.state?.agents||[];
  const runs=snapshot?.github?.runs||[];
  let status='idle';
  if(runs.some(r=>r.status==='completed'&&['failure','timed_out','action_required'].includes(r.conclusion)) || a.some(x=>x.status==='blocked'))status='blocked';
  else if(a.some(x=>x.status==='needs_attention')||(snapshot?.github?.overlapping||[]).length)status='needs_attention';
  else if(a.some(x=>x.status==='working')||runs.some(r=>r.status!=='completed'))status='working';
  else if(runs.some(r=>r.status==='completed'&&r.conclusion==='success'))status='ready';
  orb.dataset.status=status;
  document.getElementById('badge').title=status;
}
bridge?.onSnapshot(show);
bridge?.snapshot().then(show);
