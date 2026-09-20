import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechDelivery} from './delivery.mjs';
function harness(){
  const sent=[],timers=new Set();
  const delivery=new SpeechDelivery({send:event=>{sent.push(event);return true;},schedule:fn=>{timers.add(fn);return fn;},cancel:fn=>timers.delete(fn)});
  const tick=()=>{const list=[...timers];timers.clear();for(const fn of list)fn();};
  return {sent,delivery,tick,timers};
}
test('acknowledgment does not count as speech; silent replies receive one bounded nudge',()=>{
  const h=harness(),a=h.delivery.enqueue('今天星期日。','task_1',1);
  h.delivery.process({type:'session.commentary.appended',client_event_id:h.sent[0].event_id});
  assert.equal(a.state,'accepted');h.tick();
  assert.equal(h.sent.filter(x=>x.type==='session.instructions.append').length,1);
  h.tick();assert.equal(a.state,'voice_pending');h.tick();assert.equal(h.sent.length,2);
});
test('output transcript cancels the speech watchdog',()=>{
  const h=harness(),a=h.delivery.enqueue('答案','task_2',1);
  h.delivery.process({type:'session.output_transcript.delta',delta:'答案'});
  h.tick();assert.equal(a.state,'speaking');assert.equal(h.sent.length,1);
});
test('manual replay resends the existing answer without a backend query',()=>{
  const h=harness(),a=h.delivery.enqueue('星期日','task_3',1);
  h.delivery.replay(a.id);
  assert.equal(h.sent[1].content,'星期日');assert.equal(h.sent[1].delegation_id,null);
  h.delivery.process({type:'session.commentary.appended',client_event_id:h.sent[1].event_id});
  assert.equal(h.sent.at(-1).type,'session.instructions.append');
  h.delivery.dispose();assert.equal(h.timers.size,0);
});
