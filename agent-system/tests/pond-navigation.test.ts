import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {WorldObject} from '../packages/sim-core/src/domain.ts';
import type {Vec3} from '../packages/contracts/src/types.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {grantKnown} from '../packages/sim-core/src/camp.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {samplePerception} from '../packages/sim-core/src/perception.ts';
import {crossesPond,insidePond,movementBlocked,navigationPath,navigationKey,pondApproachPoint,pondCollisionRadius,solidWalls,walkDestination} from '../packages/sim-core/src/navigation.ts';

const p=(x:number,z:number):Vec3=>({x,y:0,z});
const pond=():WorldObject=>({id:'water',kind:'pond',position:p(0,0),width:5,height:.2,depth:4,resources:0,appearance:'有石岸的池塘'});
const decision=(ref:string)=>({schemaVersion:'1.0.0' as const,decisionKind:'replace' as const,goal:'测试实际走路',reasonBrief:'绕岸',actions:[{op:'walk',stage:0,params:{targetRef:ref,gait:'walk'}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
function fixture(start:Vec3){const w=createCrewWorld(2),r=w.residents[0];w.objects=[pond()];r.position={...start};return {w,r,water:w.objects[0]};}

test('Water has swept circular body collision in every direction, with accessible dry banks',()=>{
 const {w,water}=fixture(p(0,-8)),radius=pondCollisionRadius(water);
 assert.equal(radius,3.1);
 for(const [start,end]of [[p(-8,0),p(8,0)],[p(8,0),p(-8,0)],[p(0,-8),p(0,8)],[p(0,8),p(0,-8)],[p(-8,-8),p(8,8)],[p(-8,8),p(8,-8)]])assert.equal(movementBlocked(w,start,end),true);
 assert.equal(movementBlocked(w,p(-8,radius+.05),p(8,radius+.05)),false);
 assert.equal(movementBlocked(w,p(-8,-radius-.05),p(8,-radius-.05)),false);
 assert.equal(movementBlocked(w,p(0,0),p(0,0)),true);
 assert.equal(solidWalls(water).length,0,'Water blocks feet but never becomes an opaque sight wall');
});

test('Personally observed ponds produce clear routes around every side; route input remains untouched',()=>{
 for(const start of [p(-8,0),p(8,0),p(0,-8),p(0,8),p(-8,-8),p(8,-8),p(-8,8),p(8,8)]){
  const {w,r,water}=fixture(start),target=p(-start.x,-start.z);grantKnown(r,water.id,water.appearance,water.position,0);
  const before=JSON.stringify(w),path=navigationPath(w,r,target);assert.ok(path.length>1);assert.deepEqual(path.at(-1),target);
  let at=start;for(const point of path){assert.equal(crossesPond(at,point,water),false,`${JSON.stringify(start)} -> ${JSON.stringify(point)}`);assert.equal(insidePond(point,water),false);at=point;}
  assert.equal(JSON.stringify(w),before);
 }
});

test('Unknown water gives no advance route knowledge, blocks actual feet and records only private contact',()=>{
 const {w,r,water}=fixture(p(-8,0)),other=w.residents[1],otherBefore=JSON.stringify(other),target=p(8,0),ref=grantKnown(r,'remembered-place','去过的空地',target,0).ref;
 assert.deepEqual(navigationPath(w,r,target),[target]);assert.equal(navigationKey(w,r),'');
 applyDecision(r,decision(ref),0);
 for(let tick=1;tick<300&&!r.plan[0].done;tick++){const before={...r.position};stepActions(w,tick);assert.equal(crossesPond(before,r.position,water),false);}
 assert.ok(r.plan[0].done);assert.ok(r.actionFeedback.some(s=>s.includes('受阻')));assert.ok(Object.values(r.spatialMemory?.cells??{}).some(c=>c.blocked));
 assert.equal(Object.values(r.known).some(k=>k.entityId===water.id),false);assert.equal(JSON.stringify(other),otherBefore);
 grantKnown(r,water.id,water.appearance,water.position,300);assert.notEqual(navigationKey(w,r),'');assert.ok(navigationPath(w,r,target).length>1);
});

test('Pond-centre goals resolve to a dry nearest bank, including safe radius for collecting water',()=>{
 for(const start of [p(-8,0),p(8,0),p(0,-8),p(0,8)]){
  const {w,r,water}=fixture(start);assert.deepEqual(walkDestination(w,r,water.position),water.position,'Unknown pond centre is not secretly exposed');
  grantKnown(r,water.id,water.appearance,water.position,0);
  const shore=walkDestination(w,r,water.position);assert.deepEqual(shore,pondApproachPoint(water,start));assert.equal(insidePond(shore,water),false);
  assert.ok(Math.abs(Math.hypot(shore.x,shore.z)-3.22)<1e-9);assert.deepEqual(navigationPath(w,r,water.position).at(-1),shore);
 }
});

test('Real walk actions finish at the known pond bank and go around water without collision',()=>{
 for(const start of [p(-8,0),p(8,0),p(0,-8),p(0,8)])for(const visitWater of [false,true]){
  const {w,r,water}=fixture(start),waterRef=grantKnown(r,water.id,water.appearance,water.position,0).ref;
  const target=visitWater?water.position:p(-start.x,-start.z),ref=visitWater?waterRef:grantKnown(r,'far-bank','彼岸空地',target,0).ref;
  applyDecision(r,decision(ref),0);
  for(let tick=1;tick<650&&!r.plan[0].done;tick++){const before={...r.position};stepActions(w,tick);assert.equal(crossesPond(before,r.position,water),false);}
  assert.ok(r.plan[0].done,`walk complete ${JSON.stringify({start,visitWater})}`);assert.equal(r.actionFeedback.length,0);
  const resolved=visitWater?pondApproachPoint(water,start):target;assert.ok(Math.hypot(r.position.x-resolved.x,r.position.z-resolved.z)<=.80001);
 }
});

test('Discovering water during an active walk invalidates its centre destination and still completes',()=>{
 const {w,r,water}=fixture(p(-8,0)),ref=grantKnown(r,'old-spot','先前记得的位置',water.position,0).ref;
 applyDecision(r,decision(ref),0);for(let tick=1;tick<=10;tick++)stepActions(w,tick);
 assert.deepEqual(r.plan[0].targetPosition,water.position);grantKnown(r,water.id,water.appearance,water.position,10);
 for(let tick=11;tick<300&&!r.plan[0].done;tick++){const before={...r.position};stepActions(w,tick);assert.equal(crossesPond(before,r.position,water),false);}
 assert.ok(r.plan[0].done);assert.equal(r.actionFeedback.length,0);assert.equal(insidePond(r.plan[0].targetPosition!,water),false);
});

test('Old water positions can escape gradually but cannot move deeper or tunnel across the pond',()=>{
 const {w,r,water}=fixture(p(-1,0));
 assert.equal(movementBlocked(w,r.position,p(-1.07,0)),false);assert.equal(movementBlocked(w,r.position,p(-.93,0)),true);
 assert.equal(movementBlocked(w,r.position,p(8,0)),true);
 const path=navigationPath(w,r,p(8,0));let at={...r.position},lastDistance=Math.hypot(at.x,at.z);
 for(const goal of path){for(let i=0;i<400;i++){
  const distance=Math.hypot(goal.x-at.x,goal.z-at.z);if(distance<1e-8)break;
  const amount=Math.min(.07,distance),next=p(at.x+(goal.x-at.x)/distance*amount,at.z+(goal.z-at.z)/distance*amount);
  assert.equal(movementBlocked(w,at,next),false);
  const nextDistance=Math.hypot(next.x,next.z);if(insidePond(at,water))assert.ok(nextDistance>=lastDistance);
  lastDistance=nextDistance;at=next;
 }}
 assert.equal(insidePond(at,water),false);assert.deepEqual(at,p(8,0));
});

test('Residents restored inside water finish a real pond walk on dry land despite the usual stop distance',()=>{
 for(const start of [p(0,0),p(-1,0),p(3.09,0)]){
  const {w,r,water}=fixture(start),ref=grantKnown(r,water.id,water.appearance,water.position,0).ref;
  applyDecision(r,decision(ref),0);
  for(let tick=1;tick<150&&!r.plan[0].done;tick++){
   const before={...r.position};stepActions(w,tick);assert.equal(movementBlocked(w,before,r.position),false);
   assert.ok(Math.hypot(r.position.x-before.x,r.position.z-before.z)<=.0700001,'Recovery takes real movement ticks');
  }
  assert.ok(r.plan[0].done);assert.equal(r.actionFeedback.length,0);assert.equal(insidePond(r.position,water),false);
 }
});

test('Ponds do not hide people across the water and known standalone walls are routed around',()=>{
 const {w,r}=fixture(p(-4,0)),other=w.residents[1];other.position=p(4,0);r.heading=0;w.daylight=1;samplePerception(w);
 assert.ok(Object.values(r.known).some(k=>k.entityId===other.id&&k.visible));
 const wall:WorldObject={id:'wall',kind:'wall',position:p(0,0),width:.2,height:3,depth:4,resources:0,appearance:'石墙'};w.objects=[wall];r.known={};grantKnown(r,wall.id,wall.appearance,wall.position,0);
 const path=navigationPath(w,r,p(4,0));assert.ok(path.length>1);let from=r.position;for(const to of path){assert.equal(movementBlocked(w,from,to),false);from=to;}
});
