import test from 'node:test';
import assert from 'node:assert/strict';
import {runBackend} from '../backend.mjs';
import {probeSearch,backendConnection} from '../connections.mjs';
import {emptySettings,publicSettings} from '../settings-store.mjs';
import {publicConfig} from '../config.mjs';
const backend={model:'test-model',key:'synthetic-backend-key'};
const config={webSearch:true,language:'en-US',timeZone:'UTC',maxOutputTokens:512,reasoningEffort:'none'};
const history=[{role:'user',text:'Find the latest news'}];
const message=text=>({type:'message',content:[{type:'output_text',text}]});
const settings=()=>({backend:{enabled:true,model:'test',apiKey:'synthetic-backend-key'},preferences:{reasoningEffort:'none'}});

test('native search uses the existing reasoning connection and returns source evidence',async()=>{
 const events=[],sources=[];
 const answer=await runBackend({backend,config,history,onTool:e=>events.push(e),onSources:s=>sources.push(...s),request:async(b,p)=>{
  assert.equal(b,backend);assert.ok(!JSON.stringify(p).includes(backend.key));
  assert.ok(p.tools.some(t=>t.type==='web_search'));assert.ok(!p.tools.some(t=>t.name==='web_search'));
  assert.ok(p.include.includes('web_search_call.action.sources'));
  assert.equal(p.tool_choice,undefined);
  return {output:[{type:'web_search_call',status:'completed',action:{sources:[{title:'News',url:'https://example.com'}]}},message('Sourced answer')]};
 }});
 assert.equal(answer,'Sourced answer');assert.equal(sources.length,1);assert.equal(events.at(-1).status,'completed');
});
test('disabled search does not advertise a search tool',async()=>{
 await runBackend({backend,config:{...config,webSearch:false},history,request:async(b,p)=>{
  assert.ok(!p.tools.some(t=>t.type==='web_search'||t.name==='web_search'));assert.equal(p.include,undefined);
  return {output:[message('Search disabled')]};
 }});
});
test('failed hosted search is not reported as a completed search',async()=>{
 const events=[];
 await assert.rejects(runBackend({backend,config,history,onTool:e=>events.push(e),request:async()=>({output:[{type:'web_search_call',status:'failed'},message('unverified')]})}),/搜索未完成/);
 assert.equal(events[0].status,'failed');
});
test('native search probe requires real completed search plus source evidence',async()=>{
 await assert.rejects(probeSearch(settings(),{request:async()=>({output:[message('I searched')]})}),/没有执行联网搜索/);
 await assert.rejects(probeSearch(settings(),{request:async()=>({output:[{type:'web_search_call',status:'completed'}]})}),/未返回可用来源/);
 const result=await probeSearch(settings(),{request:async(b,p)=>{
  assert.deepEqual(p.tool_choice,{type:'web_search'});assert.deepEqual(p.tools[0],{type:'web_search'});
  return {output:[{type:'web_search_call',status:'completed',action:{sources:[{title:'Source',url:'https://example.com'}]}}]};
 }});
 assert.equal(result.ok,true);assert.equal(result.sources.length,1);
 await assert.rejects(probeSearch({backend:{enabled:false}}),/先配置推理后端/);
});
test('new configurations allow native search without extra search credentials',()=>{
 const s=emptySettings();s.backend.enabled=true;
 assert.equal(s.preferences.webSearch,true);assert.equal(publicConfig(s,true).defaults.webSearch,true);
 assert.equal(publicSettings(s).search,undefined);
 s.preferences.webSearch=false;assert.equal(publicConfig(s,true).defaults.webSearch,false);
 s.search={provider:'retired',apiKey:'synthetic-retired-search-key'};
 assert.ok(!JSON.stringify(publicSettings(s)).includes('synthetic-retired-search-key'));
 assert.equal(backendConnection(s).search,undefined);
});
