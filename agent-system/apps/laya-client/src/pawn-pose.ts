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
