import type { Action, Decision, Vec3 } from '../../contracts/src/types.ts';
import type { ActionProgress, Resident, World } from './domain.ts';
import { FIXED_DT_MS } from './clock.ts';
import {readBoard,ownReceipt,creditGather,RESOURCE_LABELS} from './camp.ts';
import { applyEquipmentAction } from './character.ts';
export const IMPLEMENTED_ACTIONS = ['haul','read_notice','accept_task','decline_task','eat','continue','walk','look','listen','gather','rest','speak','wait','equip_item','unequip_item'];
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.z-b.z);
const angleDelta=(from:number,to:number)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
function channels(action:Action):string[] {
  switch(action.op){
    case 'haul':return ['hands','locomotion'];
    case 'read_notice':return ['head'];case 'eat':return ['hands','mouth'];
    case 'equip_item':case 'unequip_item':return ['hands'];
    case 'walk':return ['locomotion'];case 'gather':return ['hands','locomotion'];case 'rest':return ['hands','locomotion'];
    case 'look':return ['head'];case 'speak':return ['mouth'];case 'listen':return ['hearing'];case 'wait':return [action.params.scope];default:return [];
  }
}
export function validateActionConcurrency(actions:Action[]):void {
  const used=new Set<string>();
  for(const action of actions){
    if(!IMPLEMENTED_ACTIONS.includes(action.op))throw new Error('Action is not implemented in this milestone');
    for(const channel of channels(action)){
      const key=`${action.stage}:${channel}`;if(used.has(key))throw new Error('Simultaneous actions require the same body channel');used.add(key);
    }
  }
}
export function applyDecision(resident:Resident,decision:Decision,tick:number):void {
  validateActionConcurrency(decision.actions);
  resident.goal=decision.goal;resident.lastDecision=structuredClone(decision);
  resident.nextReviewTick=tick+Math.max(1,Math.ceil(decision.nextReviewAfterSimMs/FIXED_DT_MS));
  const incoming=decision.actions.filter(a=>a.op!=='continue');
  if(decision.decisionKind==='continue'){
    if(!resident.plan.some(p=>!p.done)&&resident.suspendedPlan.some(p=>!p.done)){
      resident.plan=resident.suspendedPlan;resident.suspendedPlan=[];
    }
    return;
  }
  if(decision.decisionKind==='suspend'||decision.decisionKind==='adjust'){
    if(resident.plan.some(p=>!p.done)) resident.suspendedPlan=structuredClone(resident.plan);
  }else resident.suspendedPlan=[];
  resident.plan=incoming.map(action=>({action:structuredClone(action),elapsedTicks:0,startedTick:null,emittedChars:0,done:false}));
}
/** Executes only model-authored intents, one positive simulation tick at a time. */
export function stepActions(world:World,nextTick:number):string[] {
  const due=new Set<string>();
  // Stable round-robin starting rank avoids response-arrival priority in finite resource contention.
  const ordered=[...world.residents].sort((a,b)=>a.id.localeCompare(b.id));
  const offset=ordered.length?nextTick%ordered.length:0;
  for(let n=0;n<ordered.length;n++){
    const resident=ordered[(offset+n)%ordered.length];
    if((resident.health??100)<=0)continue;
    const pending=resident.plan.filter(p=>!p.done);if(!pending.length)continue;
    const stage=Math.min(...pending.map(p=>p.action.stage));
    for(const progress of pending.filter(p=>p.action.stage===stage)){
      const first=progress.startedTick===null;
      if(first)progress.startedTick=nextTick;
      progress.elapsedTicks++;
      const params=progress.action.params;const feedbackBefore=resident.actionFeedback.length;
      const targetRef=params.targetRef??params.placeRef??params.towardRef??params.noticeRef??params.taskRef??params.foodRef;
      const knowledge=targetRef?resident.known[targetRef]:undefined;
      if(targetRef&&!knowledge){fail(world,resident,progress,nextTick,'我无法确认这个目标。');due.add(resident.id);continue;}
      // Freeze navigation destination at start to a personally observed location, never a hidden live position.
      if(first&&knowledge)progress.targetPosition={...knowledge.lastPosition};
      switch(progress.action.op){
        case 'walk':{
          const target=progress.targetPosition!;const remaining=distance(resident.position,target);
          if(remaining<=0.8){progress.done=true;break;}
          const speed=(params.gait==='run'?2.6:1.4)*((resident.health??100)<30?.5:1);
          const step=Math.min(speed*FIXED_DT_MS/1000,remaining-0.8);
          const heading=Math.atan2(target.z-resident.position.z,target.x-resident.position.x);
          const next={...resident.position,x:resident.position.x+Math.cos(heading)*step,z:resident.position.z+Math.sin(heading)*step};
          const blocked=world.objects.some(o=>o.kind==='wall'&&Math.abs(next.x-o.position.x)<o.width/2+0.22&&Math.abs(next.z-o.position.z)<o.depth/2+0.22);
          resident.heading=heading;
          if(blocked){resident.pain=Math.min(1,resident.pain+0.02);fail(world,resident,progress,nextTick,'前方受阻，身体感到轻微碰撞。');due.add(resident.id);break;}
          resident.position=next;resident.fatigue=Math.min(1,resident.fatigue+0.00003);
          if(distance(resident.position,target)<=0.80001)progress.done=true;
          break;
        }
        case 'look':{
          const target=progress.targetPosition!;
          const desired=Math.atan2(target.z-resident.position.z,target.x-resident.position.x);
          const delta=angleDelta(resident.heading,desired);const step=Math.PI*FIXED_DT_MS/1000;
          resident.heading+=Math.max(-step,Math.min(step,delta));
          if(Math.abs(delta)<=step)progress.done=true;
          break;
        }
        case 'speak':{
          const letters=Array.from(params.text as string);
          const spoken=Math.min(letters.length,Math.floor(progress.elapsedTicks*FIXED_DT_MS/250));
          // At most four characters per delivered fragment; no future sentence suffix enters sound queues.
          if(spoken-progress.emittedChars>=4||(spoken===letters.length&&spoken>progress.emittedChars)){
            const text=letters.slice(progress.emittedChars,spoken).join('');
            world.sounds.push({id:`sound-${resident.id}-${progress.startedTick}-${progress.emittedChars}`,sourceId:resident.id,position:{...resident.position},heading:resident.heading,text,volume:params.volume,emittedTick:nextTick,deliveredTo:[]});
            world.events.push({tick:nextTick,kind:'speech_fragment',agentId:resident.id,text});progress.emittedChars=spoken;
            ownReceipt(resident,world,`我已经实际说出：${letters.slice(0,spoken).join('')}。${spoken<letters.length?'这句话尚未说完。':'这句话已说完，不要当作还没说过。'}`,`memory_spoken_${progress.startedTick}`);
          }
          if(progress.elapsedTicks*FIXED_DT_MS>=Math.max(600,letters.length*250))progress.done=true;
          break;
        }
        case 'gather':{
          const object=world.objects.find(o=>o.id===knowledge!.entityId);
          if(!object||!['tree','rock','berry'].includes(object.kind)){fail(world,resident,progress,nextTick,'这个目标不是可采集资源，不能对它执行gather。');due.add(resident.id);break;}
          if(distance(resident.position,object.position)>1.8){fail(world,resident,progress,nextTick,'我距离这个采集目标太远，需要先实际走到它附近。');due.add(resident.id);break;}
          if(progress.elapsedTicks%20===0){
            if(object.resources<=0){fail(world,resident,progress,nextTick,'眼前已没有可取的资源。');due.add(resident.id);break;}
            if(resident.supplies&&resident.inventory>=30){fail(world,resident,progress,nextTick,'采集袋已满（30份），需要先消耗食物或停止采集。');due.add(resident.id);break;}
            object.resources--;resident.inventory++;
            const kind=object.resourceKind??'wood';if(resident.supplies){resident.supplies[kind]=(resident.supplies[kind]??0)+1;creditGather(world,resident,kind);}resident.fatigue=Math.min(1,resident.fatigue+0.005);
            if(Math.floor(progress.elapsedTicks/20)>=params.amount)progress.done=true;
          }
          break;
        }
        case 'haul':{
          const source=resident.known[params.sourceRef],destination=resident.known[params.destinationRef];
          const kind=(['wood','stone','food'] as const).find(k=>source?.entityId===`supply-${k}-${resident.id}`);
          const board=world.objects.find(o=>o.id===destination?.entityId&&o.kind==='board');
          if(!kind||!resident.supplies?.[kind]||!board||distance(resident.position,board.position)>2.5||!world.camp){fail(world,resident,progress,nextTick,'需带着本人资源走到公告板旁仓储，才能存放。');due.add(resident.id);break;}
          if(progress.elapsedTicks%10===0){resident.supplies[kind]!--;resident.inventory--;world.camp.stock??={};world.camp.stock[kind]=(world.camp.stock[kind]??0)+1;if(Math.floor(progress.elapsedTicks/10)>=params.amount||!resident.supplies[kind])progress.done=true;}break;
        }
        case 'read_notice':{
          const board=world.objects.find(o=>o.id===knowledge!.entityId&&o.kind==='board');
          if(!board||distance(resident.position,board.position)>2.5){fail(world,resident,progress,nextTick,'离公告板太远，无法读清；需要走近。');due.add(resident.id);break;}
          if(progress.elapsedTicks*FIXED_DT_MS>=1000){readBoard(world,resident,board);progress.done=true;due.add(resident.id);}break;
        }
        case 'accept_task':case 'decline_task':{
          const task=world.camp?.tasks.find(t=>t.id===knowledge!.entityId);
          if(!task||task.status!=='open'){fail(world,resident,progress,nextTick,'这项已读目标当前不可接取或已经完成。');due.add(resident.id);break;}
          if(progress.action.op==='accept_task'){if(!task.acceptedBy.includes(resident.id))task.acceptedBy.push(resident.id);ownReceipt(resident,world,`我已自愿接受采集${RESOURCE_LABELS[task.resource]}${task.amount}份的公告目标，接下来要实际采集，空口问候不推进目标。`);}
          else{task.acceptedBy=task.acceptedBy.filter(id=>id!==resident.id);ownReceipt(resident,world,`我拒绝了这项公告目标，理由：${params.reason}`);}
          progress.done=true;break;
        }
        case 'eat':{
          if(knowledge!.entityId!==`supply-food-${resident.id}`||!(resident.supplies?.food)){fail(world,resident,progress,nextTick,'我没有可食用的自有浆果。');due.add(resident.id);break;}
          if(progress.elapsedTicks%20===0){resident.supplies.food--;resident.inventory--;resident.hunger=Math.max(0,resident.hunger-.16);if(Math.floor(progress.elapsedTicks/20)>=params.amount||!resident.supplies.food)progress.done=true;}break;
        }
        case 'rest':
          if(progress.targetPosition&&distance(resident.position,progress.targetPosition)>1.8){fail(world,resident,progress,nextTick,'我还没有到达想休息的地方。');due.add(resident.id);break;}
          resident.fatigue=Math.max(0,resident.fatigue-0.0002);
          progress.done=progress.elapsedTicks*FIXED_DT_MS>=params.durationSimMs;break;
        case 'equip_item':case 'unequip_item':{
          if(progress.elapsedTicks*FIXED_DT_MS<1000)break;
          const result=applyEquipmentAction(resident,{type:progress.action.op,itemRef:params.itemRef,...(params.slot?{slot:params.slot}:{})} as any);
          if(result.ok)resident.character=result.resident.character;else{fail(world,resident,progress,nextTick,result.error);due.add(resident.id);}
          progress.done=true;break;
        }
        case 'listen':case 'wait':progress.done=progress.elapsedTicks*FIXED_DT_MS>=params.durationSimMs;break;
        case 'continue':progress.done=true;break;
        default:fail(world,resident,progress,nextTick,'当前动作无法执行。');due.add(resident.id);
      }
      if(progress.done&&resident.actionFeedback.length===feedbackBefore){ownReceipt(resident,world,`我实际完成了${progress.action.op}${targetRef?`，目标${targetRef}（${knowledge?.description??'本人已知目标'}）`:''}${progress.action.op==='walk'?'，我已到达该目标最后已知位置附近，不需要重复走到同一个位置':''}${progress.action.op==='gather'?`，本次采集${Math.floor(progress.elapsedTicks/20)}份`:''}。目前携带${resident.inventory}份资源。`);world.events.push({tick:nextTick,kind:'action_completed',agentId:resident.id,text:progress.action.op});}
    }
    if(!resident.plan.some(p=>!p.done))due.add(resident.id);
  }
  return [...due];
}
function fail(world:World,resident:Resident,progress:ActionProgress,tick:number,message:string):void {
  progress.done=true;resident.actionFeedback.push(message);
  ownReceipt(resident,world,`我的${progress.action.op}行动失败：${message}，不能把它当成已成功。`);
  world.events.push({tick,kind:'action_failed',agentId:resident.id,text:message});
}
