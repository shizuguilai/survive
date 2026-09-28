import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pawnPose} from '../apps/laya-client/src/pawn-pose.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';

const walker=()=>{
  const r=createCrewWorld(2).residents[0];
  r.plan=[{action:{op:'walk',stage:1,params:{targetRef:'private-landmark',gait:'walk'}},elapsedTicks:3,startedTick:1,emittedChars:0,done:false}];
  return r;
};
test('pose changes with simulated walk progress, stays frozen across render calls, and seeks identically',()=>{
  const r=walker(),snapshot=structuredClone(r),before=JSON.stringify(r),a=pawnPose(r);
  for(let i=0;i<200;i++)assert.deepEqual(pawnPose(r),a);
  assert.equal(JSON.stringify(r),before);r.plan[0].elapsedTicks=8;const b=pawnPose(r);assert.notDeepEqual(a,b);assert.ok(a.stride*b.stride<0);
  assert.deepEqual(pawnPose(snapshot),a);r.plan[0].done=true;assert.deepEqual(pawnPose(r),{stride:0,bob:0,moving:false});
});
test('queued, unstarted, stationary and dead residents do not walk in place',()=>{
  const r=walker();r.plan[0].startedTick=null;assert.equal(pawnPose(r).moving,false);
  r.plan[0].startedTick=1;r.health=0;assert.equal(pawnPose(r).moving,false);r.health=100;
  r.plan.unshift({action:{op:'wait',stage:0,params:{durationSimMs:500}},elapsedTicks:3,startedTick:1,emittedChars:0,done:false});assert.equal(pawnPose(r).moving,false);
  r.plan=[];assert.equal(pawnPose(r).moving,false);
});
