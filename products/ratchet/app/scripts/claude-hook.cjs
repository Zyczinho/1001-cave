'use strict';
// Claude Code invokes this executable on selected lifecycle events. It never blocks Claude.
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(input.length>65536)process.exit(0);});
process.stdin.on('end',async()=>{
  try {
    const payload=JSON.parse(input);
    if(!payload.session_id||!payload.hook_event_name)return;
    await fetch('http://127.0.0.1:47822/hook',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        session_id:payload.session_id,
        hook_event_name:payload.hook_event_name,
        cwd:payload.cwd||'',
        transcript_path:payload.transcript_path||''
      }),signal:AbortSignal.timeout(1300)
    });
  } catch { /* If Ratchet is closed, Claude should continue without errors. */ }
});
