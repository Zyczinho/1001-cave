'use strict';
/**
 * Optional Ratchet↔ChatGPT MCP signal plugin.
 * ChatGPT MUST actually invoke one of these tools. This is not a universal chat-end hook.
 * Exposed only on 127.0.0.1, intended for OpenAI Secure MCP Tunnel with user approval.
 */
import {createServer} from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';

const base=String(process.env.RATCHET_API_BASE||'').replace(/\/$/,'');
const port=Number(process.env.RATCHET_MCP_PORT||47891);
if(!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(base)||!Number.isInteger(port)||port<1024||port>65535)
  throw Error('Ustaw RATCHET_API_BASE=http://127.0.0.1:<port_testowej_kopii> i poprawny RATCHET_MCP_PORT. Brak domyślnej produkcyjnej instalacji.');
function safeChatUrl(value){
  if(!value)return '';
  try{
    const u=new URL(value);
    return u.protocol==='https:'&&u.hostname==='chatgpt.com'&&
      /^\/c\/[\w-]{3,160}\/?$/.test(u.pathname)&&!u.search&&!u.hash?u.href:'';
  }catch{return '';}
}
async function ratchetAction(name,data){
  const res=await fetch(base+'/api/action',{
    method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1'},
    body:JSON.stringify({action:name,data}),signal:AbortSignal.timeout(6000)
  });
  const json=await res.json();
  if(!res.ok||!json.ok)throw Error('Ratchet odmówił wykonania sygnału: '+String(json.error||res.status).slice(0,180));
  return json.result;
}
const output=result=>({content:[{type:'text',text:JSON.stringify(result)}]});
function createMcpServer(){
  const server=new McpServer({name:'Ratchet ChatGPT Signals',version:'0.1.0'});
  server.registerTool('ratchet_task_started',{
    title:'Ratchet — rozpoczęcie zadania',
    description:'Explicitly tell Ratchet that an AI task has genuinely begun. Use only when the user requests Ratchet tracking. This is not an automatic chat lifecycle event. Return the id for subsequent completion.',
    inputSchema:{
      title:z.string().min(3).max(160),
      client_key:z.string().min(8).max(100),
      conversation_url:z.string().optional()
    }
  },async({title,client_key,conversation_url})=>{
    try{return output(await ratchetAction('chatgpt:signal-start',{
      title,clientKey:client_key,conversationUrl:safeChatUrl(conversation_url)
    }));}
    catch(e){return {isError:true,...output({error:String(e.message).slice(0,180)})};}
  });
  server.registerTool('ratchet_task_completed',{
    title:'Ratchet — zgłoszenie zakończenia',
    description:'Send a user-facing notification to Ratchet only after you actually completed the tracked work. Not a host-verified completion event. Never send while still processing or if the work failed.',
    inputSchema:{
      id:z.string().min(6).max(90),
      summary:z.string().max(350).optional(),
      conversation_url:z.string().optional()
    }
  },async({id,summary,conversation_url})=>{
    try{return output(await ratchetAction('chatgpt:signal-complete',{
      id,note:summary||'',conversationUrl:safeChatUrl(conversation_url)
    }));}
    catch(e){return {isError:true,...output({error:String(e.message).slice(0,180)})};}
  });
  server.registerTool('ratchet_task_needs_attention',{
    title:'Ratchet — zadanie zablokowane',
    description:'Notify Ratchet that the tracked task genuinely cannot continue without user input. Do not pretend that the task has finished.',
    inputSchema:{
      id:z.string().min(6).max(90),
      reason:z.string().min(3).max(350),
      conversation_url:z.string().optional()
    }
  },async({id,reason,conversation_url})=>{
    try{return output(await ratchetAction('chatgpt:signal-attention',{
      id,note:reason,conversationUrl:safeChatUrl(conversation_url)
    }));}
    catch(e){return {isError:true,...output({error:String(e.message).slice(0,180)})};}
  });
  return server;
}
const httpServer=createServer(async(req,res)=>{
  if(req.socket.remoteAddress!=='127.0.0.1'&&req.socket.remoteAddress!=='::ffff:127.0.0.1'){
    res.writeHead(403).end('Loopback only');return;
  }
  if(req.headers.origin){res.writeHead(403).end('Browser origins not accepted');return;}
  if(req.url!=='/mcp'||!['POST','GET','DELETE'].includes(req.method)){
    res.writeHead(404).end('Not found');return;
  }
  const server=createMcpServer();
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{transport.close();server.close();});
  try{await server.connect(transport);await transport.handleRequest(req,res);}
  catch(e){if(!res.headersSent)res.writeHead(500).end('MCP error');}
});
httpServer.listen(port,'127.0.0.1',()=>console.log('Ratchet MCP signals ready on loopback port '+port+' /mcp'));
