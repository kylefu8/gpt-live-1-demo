import test from 'node:test';
import assert from 'node:assert/strict';
import {runBackend} from '../backend.mjs';
import {probeSearch} from '../connections.mjs';
import {emptySettings,mergeSettings,publicSettings} from '../settings-store.mjs';
import {publicConfig,validateConfig} from '../config.mjs';
const backend={model:'test-model',key:'synthetic-backend-key',search:{provider:'tavily',apiKey:'synthetic-search-key'}};
const config={webSearch:true,language:'en-US',timeZone:'UTC',maxOutputTokens:512,reasoningEffort:'none'};
const history=[{role:'user',text:'Find the latest news'}];
const message=text=>({type:'message',content:[{type:'output_text',text}]});
const settings=()=>({backend:{enabled:true,model:'test',apiKey:'synthetic-backend-key'},search:{provider:'native',apiKey:''},preferences:{reasoningEffort:'none'}});

test('independent search executes server-side and feeds sources to the reasoning model',async()=>{
 let round=0,searchCalls=0;const events=[],sources=[];
 const answer=await runBackend({backend,config,history,onTool:e=>events.push(e),onSources:s=>sources.push(...s),request:async(b,p)=>{
  assert.ok(!JSON.stringify(p).includes(backend.search.apiKey));
  assert.ok(p.tools.some(t=>t.name==='web_search'&&t.type==='function'));assert.ok(!p.tools.some(t=>t.type==='web_search'));
  if(round++===0)return {output:[{type:'function_call',name:'web_search',call_id:'s1',arguments:JSON.stringify({query:'latest news',time_range:'day'})}]};
  assert.match(p.input.at(-1).output,/https:\/\/example.com/);return {output:[message('Sourced answer')]};
 },search:async(args,ctx)=>{searchCalls++;assert.equal(ctx.apiKey,backend.search.apiKey);assert.equal(args.time_range,'day');return {results:[{content:'Current event'}],sources:[{title:'News',url:'https://example.com'}]};}});
 assert.equal(answer,'Sourced answer');assert.equal(searchCalls,1);assert.equal(sources.length,1);assert.equal(events.at(-1).status,'completed');
});
test('disabled search never executes even if a backend invents the function call',async()=>{
 let round=0;
 await runBackend({backend,config:{...config,webSearch:false},history,search:async()=>assert.fail('Search must be disabled'),request:async(b,p)=>{
  assert.ok(!p.tools.some(t=>t.type==='web_search'||t.name==='web_search'));
  return {output:round++===0?[{type:'function_call',name:'web_search',call_id:'s1',arguments:'{}'}]:[message('Unavailable')]};
 }});
});
test('failed hosted search is not reported as a completed search',async()=>{
 const events=[];
 await assert.rejects(runBackend({backend:{...backend,search:{provider:'native'}},config,history,onTool:e=>events.push(e),request:async()=>({output:[{type:'web_search_call',status:'failed'},message('unverified') ]})}),/搜索未完成/);
 assert.equal(events[0].status,'failed');
});
test('native search probe requires real completed search plus source evidence',async()=>{
 await assert.rejects(probeSearch(settings(),{request:async()=>({output:[message('I searched')]})}),/没有执行联网搜索/);
 await assert.rejects(probeSearch(settings(),{request:async()=>({output:[{type:'web_search_call',status:'completed'}]})}),/未返回可用来源/);
 const result=await probeSearch(settings(),{request:async(b,p)=>{
  assert.deepEqual(p.tool_choice,{type:'web_search'});assert.equal(p.tools[0].external_web_access,true);
  return {output:[{type:'web_search_call',status:'completed',action:{sources:[{title:'Source',url:'https://example.com'}]}}]};
 }});
 assert.equal(result.ok,true);assert.equal(result.sources.length,1);
});
test('independent search probe reports errors and empty results honestly',async()=>{
 const s={...settings(),search:backend.search};
 await assert.rejects(probeSearch(s,{search:async()=>({error:{code:'search_unauthorized',message:'Search key rejected'}})}),/Search key rejected/);
 await assert.rejects(probeSearch(s,{search:async()=>({sources:[]})}),/未返回可用来源/);
 await assert.rejects(probeSearch({...s,backend:{enabled:false}}),/先配置推理后端/);
});
test('search credentials stay private, survive blank edits, and do not alter legacy defaults',()=>{
 const input={voice:{provider:'azure',baseUrl:'https://speech.example',model:'live',apiKey:'synthetic-voice-key'},backend:{enabled:true,mode:'same',model:'reasoning'},search:backend.search,preferences:{webSearch:true}};
 const s=mergeSettings(input);assert.equal(validateConfig({},s).webSearch,true);
 assert.equal(mergeSettings({...input,search:{provider:'tavily',apiKey:''}},s).search.apiKey,backend.search.apiKey);
 assert.ok(!JSON.stringify(publicSettings(s)).includes(backend.search.apiKey));assert.ok(!JSON.stringify(publicConfig(s,true)).includes(backend.search.apiKey));
 const native=mergeSettings({...input,search:{provider:'native'}},s);assert.equal(native.search.apiKey,'');
 assert.throws(()=>mergeSettings({...input,search:{provider:'unknown'}},s),/搜索服务/);
 assert.throws(()=>validateConfig({}, {...s,search:{provider:'tavily',apiKey:''}}),/搜索 API Key/);
 assert.equal(publicSettings({...s,search:undefined}).search.provider,'native');
 assert.equal(emptySettings().preferences.webSearch,false);
});
