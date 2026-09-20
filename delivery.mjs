import {randomUUID} from 'node:crypto';

export class SpeechDelivery {
  constructor({send,onUpdate=()=>{},canNudge=()=>true,language='zh-CN',schedule=setTimeout,cancel=clearTimeout}) {
    Object.assign(this,{send,onUpdate,canNudge,language,schedule,cancel});
    this.items=[];this.pending=new Map();this.disposed=false;
  }
  snapshot(){return this.items.map(({id,text,createdAt,state,message})=>({id,text,createdAt,state,message}));}
  update(answer,state,message){
    if(this.disposed)return;
    answer.state=state;answer.message=message;this.onUpdate(answer);
  }
  clearTimer(answer){if(answer.timer){this.cancel(answer.timer);answer.timer=null;}}
  enqueue(text,delegationId,contextVersion,{immediateSpeak=false}={}){
    for(const previous of this.items)this.clearTimer(previous);
    const answer={id:`answer_${randomUUID()}`,text,createdAt:new Date().toISOString(),state:'queued',delegationId,contextVersion,attempt:0,nudged:false,timer:null};
    this.items.push(answer);
    if(this.items.length>8){const removed=this.items.shift();for(const [id,p]of this.pending)if(p.answer===removed)this.pending.delete(id);}
    this.transmit(answer,false);answer.forceSpeak=immediateSpeak;return answer;
  }
  transmit(answer,replay){
    this.clearTimer(answer);
    for(const [id,p]of this.pending)if(p.answer===answer)this.pending.delete(id);
    answer.attempt++;answer.nudged=false;answer.acks=new Set();answer.eventIds=[];
    answer.sentAt=Date.now();answer.forceSpeak=replay;
    this.update(answer,'sent','答案已生成，等待语音服务确认');
    const chars=Array.from(answer.text);
    for(let offset=0;offset<Math.min(chars.length,1320);offset+=220){
      const eventId=`${answer.id}_${answer.attempt}_${offset}`;
      answer.eventIds.push(eventId);this.pending.set(eventId,{answer,kind:'commentary'});
      const sent=this.send({type:'session.commentary.append',event_id:eventId,delegation_id:replay?null:answer.delegationId,content:chars.slice(offset,offset+220).join('')});
      if(!sent){this.update(answer,'failed','语音连接不可用，文字答案仍可查看');return;}
    }
    answer.timer=this.schedule(()=>{
      if(answer.state==='sent')this.update(answer,'voice_pending','尚未收到语音服务确认；请查看文字答案或重试播报');
    },8000);
  }
  nudge(answer){
    if(this.disposed||answer.nudged||answer.state==='speaking'||!this.canNudge(answer))return;
    answer.nudged=true;
    const language=this.language==='zh-CN'?'用中文':this.language==='en-US'?'in English':'使用当前对话语言';
    const id=`speak_${answer.id}_${answer.attempt}`;
    this.pending.set(id,{answer,kind:'instruction'});
    this.send({type:'session.instructions.append',event_id:id,delegation_id:null,
      content:`后端已经返回了本次请求的实际结果。请现在${language}直接说出刚收到的 commentary 结果，然后等待用户。不要再次查询或委派同一个请求，也不要只说正在查询。`});
    this.update(answer,'accepted','语音服务已接收；已提醒开始播报');
    this.clearTimer(answer);
    answer.timer=this.schedule(()=>{
      if(answer.state!=='speaking'&&answer.state!=='failed')this.update(answer,'voice_pending','语音暂未响应，文字答案已显示；可点击重新播报');
    },8000);
  }
  process(event){
    if(this.disposed)return;
    if(event.type==='session.output_transcript.delta'&&event.delta){
      const answer=this.items.at(-1);
      if(answer&&['sent','accepted','voice_pending'].includes(answer.state)){
        this.clearTimer(answer);this.update(answer,'speaking','已收到语音回复转写');
      }
      return;
    }
    const clientId=event.client_event_id||event.error?.client_event_id;
    const pending=this.pending.get(clientId);
    if(!pending)return;
    const {answer,kind}=pending;
    if(event.type==='error'){
      this.clearTimer(answer);this.update(answer,'failed',`语音回传失败：${String(event.error?.message||'服务拒绝事件').slice(0,160)}`);return;
    }
    if(event.type==='session.commentary.appended'&&kind==='commentary'){
      answer.acks.add(clientId);
      if(answer.acks.size===answer.eventIds.length&&answer.state!=='speaking'){
        this.clearTimer(answer);this.update(answer,'accepted','语音服务已接收，等待播报');
        if(answer.forceSpeak)this.nudge(answer);
        else answer.timer=this.schedule(()=>{
          if(answer.state==='accepted'){
            if(this.canNudge(answer))this.nudge(answer);
            else this.update(answer,'voice_pending','对话已有新输入，未自动打断；文字答案可查看');
          }
        },8000);
      }
    }
  }
  replay(id){
    const answer=this.items.find(x=>x.id===id);
    if(!answer)throw new Error('没有找到这条答案');
    this.transmit(answer,true);
  }
  dispose(){this.disposed=true;for(const answer of this.items)this.clearTimer(answer);this.pending.clear();}
}
