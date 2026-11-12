'use strict';
// Claude Code invokes this executable on selected lifecycle events. It never blocks Claude,
// with one exception: on Stop, when a Rachet guard is on for this session and the task's
// proof failed, Rachet answers {decision:"block", reason} and this script prints it, so
// Claude keeps working (Claude Code hooks: Stop decision control).
let input='';
process.stdin.setEncoding('utf8');
// Stop carries Claude's whole last message, so the limit is generous; only ids are sent on.
process.stdin.on('data',chunk=>{input+=chunk;if(input.length>4*1024*1024)process.exit(0);});
process.stdin.on('end',async()=>{
  try {
    const payload=JSON.parse(input);
    if(!payload.session_id||!payload.hook_event_name)return;
    const stop=payload.hook_event_name==='Stop';
    const port=Number(process.env.RATCHET_HOOK_PORT)||47822; // tests use their own port
    const res=await fetch('http://127.0.0.1:'+port+'/hook',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        session_id:payload.session_id,
        coordinator_job_id:process.env.RATCHET_COORDINATOR_JOB||'',
        hook_event_name:payload.hook_event_name,
        // Notification only: tells a permission prompt apart from "waiting for your input".
        notification_type:payload.notification_type||'',
        message:String(payload.message||'').slice(0,200),
        cwd:payload.cwd||'',
        transcript_path:payload.transcript_path||''
      }),
      // A guard runs the task's proof on Stop; everything else answers at once.
      signal:AbortSignal.timeout(stop?120000:1300)
    });
    if(stop&&res.status===200){
      const reply=await res.json();
      if(reply?.decision==='block'&&typeof reply.reason==='string'&&reply.reason)
        process.stdout.write(JSON.stringify({decision:'block',reason:reply.reason.slice(0,8000)}));
    }
  } catch { /* If Ratchet is closed or slow, Claude continues without errors. */ }
});
