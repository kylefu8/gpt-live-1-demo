import WebSocket from 'ws';
import {requestResponse} from './backend.mjs';
export function voiceHeaders(voice){return voice.provider==='azure'?{'api-key':voice.apiKey}:{Authorization:`Bearer ${voice.apiKey}`};}
export function backendConnection(settings){const b=settings.backend;return b.enabled?{baseUrl:b.baseUrl,auth:b.auth,key:b.apiKey,model:b.model}:null;}
export function friendlyApiError(error,{kind='voice'}={}){
 const text=String(error?.message||error||'');
 const status=Number(error?.status);
 if(status===401||status===403||/401|403|unauthoriz|authenticat|invalid.*key/i.test(text))return '密钥未通过验证，请检查 Key 是否与服务地址匹配、是否仍然有效。';
 if(status===404||/404|deployment.*not.*exist|model.*not.*found/i.test(text))return '未找到这个模型或部署。请填写服务商控制台中的实际部署名称。';
 if(status===429||/429|quota|rate.limit/i.test(text))return '服务当前额度不足或请求过多，请检查额度并稍后重试。';
 if(/timeout|timed out|abort/i.test(text))return '连接超时，请检查网络和资源地址后重试。';
 if(/fetch failed|ENOTFOUND|ECONN|certificate/i.test(text))return '无法连接服务，请检查地址、网络和 HTTPS 证书。';
 return `${kind==='voice'?'语音服务':'推理后端'}测试失败，请检查接口兼容性和模型配置。`;
}
export async function probeVoice(voice){
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(voice.baseUrl.replace(/^https:/,'wss:')+'/live/sessions',{headers:voiceHeaders(voice),handshakeTimeout:12000,followRedirects:false});
  let started=false,settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(ws.readyState!==WebSocket.CLOSED)ws.terminate();if(error)reject(error);else resolve({ok:true,message:'语音部署可用'});};
  const timer=setTimeout(()=>finish(started?null:new Error('timeout')),15000);
  ws.on('open',()=>ws.send(JSON.stringify({type:'session.start',session:{model:voice.model,instructions:'This is a connection check. Stay silent.',delegation:{type:'client'}}})));
  ws.on('message',raw=>{let e;try{e=JSON.parse(raw);}catch{return;}if(e.type==='session.started'){started=true;ws.send(JSON.stringify({type:'session.close'}));}if(e.type==='session.closed')finish();if(e.type==='error')finish(new Error(e.error?.message||'API error'));});
  ws.on('unexpected-response',(_,response)=>{const error=new Error('HTTP '+response.statusCode);error.status=response.statusCode;finish(error);});
  ws.on('error',error=>finish(started?null:error));ws.on('close',()=>finish(started?null:new Error('connection closed before session startup')));
 });
}
export async function probeBackend(settings){
 const connection=backendConnection(settings);if(!connection)return {ok:true,message:'已跳过推理后端，可先体验语音'};
 const result=await requestResponse(connection,{model:connection.model,input:'Reply only OK',max_output_tokens:128,...(settings.preferences.reasoningEffort==='none'?{}:{reasoning:{effort:'low'}})},AbortSignal.timeout(25000));
 const text=(result.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('');if(!text)throw new Error('Backend returned no text');
 return {ok:true,message:'推理后端可用'};
}
