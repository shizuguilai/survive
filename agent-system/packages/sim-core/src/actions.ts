import type { Action, Decision, Vec3 } from '../../contracts/src/types.ts';
import type { ActionProgress, Resident, World } from './domain.ts';
import { FIXED_DT_MS } from './clock.ts';
import { applyEquipmentAction } from './character.ts';
export const IMPLEMENTED_ACTIONS = ['continue','walk','look','listen','gather','rest','speak','wait','equip_item','unequip_item'];
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.z-b.z);
const angleDelta=(from:number,to:number)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
function channels(action:Action):string[] {
  switch(action.op){
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
    const pending=resident.plan.filter(p=>!p.done);if(!pending.length)continue;
    const stage=Math.min(...pending.map(p=>p.action.stage));
    for(const progress of pending.filter(p=>p.action.stage===stage)){
      const first=progress.startedTick===null;
      if(first)progress.startedTick=nextTick;
      progress.elapsedTicks++;
      const params=progress.action.params;const feedbackBefore=resident.actionFeedback.length;
      const targetRef=params.targetRef??params.placeRef??params.towardRef;
      const knowledge=targetRef?resident.known[targetRef]:undefined;
      if(targetRef&&!knowledge){fail(world,resident,progress,nextTick,'我无法确认这个目标。');due.add(resident.id);continue;}
      // Freeze navigation destination at start to a personally observed location, never a hidden live position.
      if(first&&knowledge)progress.targetPosition={...knowledge.lastPosition};
      switch(progress.action.op){
        case 'walk':{
          const target=progress.targetPosition!;const remaining=distance(resident.position,target);
          if(remaining<=0.8){progress.done=true;break;}
          const speed=params.gait==='run'?2.6:1.4;
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
          }
          if(progress.elapsedTicks*FIXED_DT_MS>=Math.max(600,letters.length*250))progress.done=true;
          break;
        }
        case 'gather':{
          const object=world.objects.find(o=>o.id===knowledge!.entityId);
          if(!object||object.kind!=='tree'||distance(resident.position,object.position)>1.8){fail(world,resident,progress,nextTick,'无法在这里采集到目标，可能需要先走近。');due.add(resident.id);break;}
          if(progress.elapsedTicks%20===0){
            if(object.resources<=0){fail(world,resident,progress,nextTick,'眼前已没有可取的资源。');due.add(resident.id);break;}
            object.resources--;resident.inventory++;resident.fatigue=Math.min(1,resident.fatigue+0.005);
            if(Math.floor(progress.elapsedTicks/20)>=params.amount)progress.done=true;
          }
          break;
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
      if(progress.done&&resident.actionFeedback.length===feedbackBefore){world.events.push({tick:nextTick,kind:'action_completed',agentId:resident.id,text:progress.action.op});}
    }
    if(!resident.plan.some(p=>!p.done))due.add(resident.id);
  }
  return [...due];
}
function fail(world:World,resident:Resident,progress:ActionProgress,tick:number,message:string):void {
  progress.done=true;resident.actionFeedback.push(message);
  world.events.push({tick,kind:'action_failed',agentId:resident.id,text:message});
}
