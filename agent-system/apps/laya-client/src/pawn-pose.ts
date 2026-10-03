import type {Resident} from '../../../packages/sim-core/src/domain.ts';
import {FIXED_DT_MS} from '../../../packages/sim-core/src/clock.ts';

/** A replayable pose, derived only from the active simulation action. No wall clock. */
export function pawnPose(resident:Resident):{stride:number;bob:number;moving:boolean}{
  const pending=resident.plan?.filter(p=>!p.done)??[];
  const stage=Math.min(...pending.map(p=>p.action.stage));
  const walk=pending.find(p=>p.action.stage===stage&&p.action.op==='walk'&&p.startedTick!==null&&p.elapsedTicks>0);
  if(!walk||(resident.health??100)<=0)return {stride:0,bob:0,moving:false};
  const phase=walk.elapsedTicks*FIXED_DT_MS/1000*Math.PI*2*(walk.action.params.gait==='run'?2.8:1.8);
  return {stride:Math.sin(phase),bob:(1-Math.cos(phase*2))*.018,moving:true};
}

/** Work motion stops with simulation time, including during every model wait. */
export function workPose(resident:Resident):{active:boolean;left:number;right:number;lean:number}{
  const pending=resident.plan?.filter(p=>!p.done)??[],stage=Math.min(...pending.map(p=>p.action.stage));
  const work=pending.find(p=>p.action.stage===stage&&['build','gather','craft','home_care'].includes(p.action.op)&&p.startedTick!==null&&p.elapsedTicks>0);
  if(!work||(resident.health??100)<=0)return {active:false,left:0,right:0,lean:0};
  const phase=work.elapsedTicks*FIXED_DT_MS/1000*Math.PI*2*1.35;
 return {active:true,left:Math.sin(phase+.9)*.18,right:(Math.sin(phase)+1)*.23,lean:Math.sin(phase)*3};
}

/** Tools reflect real, started work only; elapsed simulation ticks also drive every droplet. */
export function farmingPose(resident:Resident){
 const pending=resident.plan?.filter(p=>!p.done)??[],stage=Math.min(...pending.map(p=>p.action.stage));
 const progress=pending.find(p=>p.action.stage===stage&&['farm','fetch_water'].includes(p.action.op)&&p.startedTick!==null&&p.elapsedTicks>0);
 const alive=(resident.health??100)>0,sleeping=pending.some(p=>p.action.op==='rest'&&p.bedSettled);
 const requested=progress?.action.op==='fetch_water'?'fetch':progress?.action.params.work;
 const work: 'till'|'sow'|'water'|'fetch'|null=alive&&['till','sow','water','fetch'].includes(requested)?requested:null;
 const elapsed=progress?.elapsedTicks??0,phase=elapsed*FIXED_DT_MS/1000*Math.PI*2;
 return {work,active:work!==null,carrying:alive&&!sleeping&&(resident.water??0)>0,
  time:elapsed*FIXED_DT_MS/1000,stroke:(Math.sin(phase*.95)+1)/2,
  scoop:Math.sin(Math.min(1,elapsed/60)*Math.PI),seed:Math.sin(phase*1.25),
  waterLevel:Math.max(0,Math.min(1,(resident.water??0)/6))};
}
