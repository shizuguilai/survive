import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCrewWorld,advanceEnvironment} from '../packages/sim-core/src/world.ts';
import {postTask,readBoard,claimHome,grantKnown} from '../packages/sim-core/src/camp.ts';
import {zoneBounds,homeSites} from '../packages/sim-core/src/housing.ts';
import {finishBuild} from '../packages/sim-core/src/workshop.ts';
import {houseSteps,houseCost} from '../packages/sim-core/src/recipes.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {movementBlocked,floorHeight,solidWalls} from '../packages/sim-core/src/navigation.ts';
import {samplePerception,buildContext} from '../packages/sim-core/src/perception.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {workPose} from '../apps/laya-client/src/pawn-pose.ts';
import {cycleHit,pinchZoom} from '../apps/laya-client/src/interaction.ts';
import {resourceStage,resourceCapacity} from '../packages/sim-core/src/resources.ts';
const decision=(actions:any[])=>({schemaVersion:'1.0.0' as const,decisionKind:'replace' as const,goal:'explicit regression fixture',reasonBrief:'test',actions,nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
const ref=(r:any,id:string)=>(Object.values(r.known).find((k:any)=>k.entityId===id) as any).ref;
function setup(count=4){const w=createCrewWorld(count);postTask(w,{kind:'residential',resource:'wood',amount:1,note:'test',bounds:{minX:-24,maxX:-5,minZ:-24,maxZ:-15}});return {w,zone:w.camp!.tasks.at(-1)!,board:w.objects.find(o=>o.kind==='board')!};}
test('Player rectangles accept reverse drags, reject too-small/overlapping areas without mutation',()=>{
 assert.deepEqual(zoneBounds({x:4.6,z:5.2},{x:-3.4,z:-2.8}),{minX:-4,maxX:5,minZ:-3,maxZ:6});
 const {w}=setup(),before=hashCanonical(w);
 assert.throws(()=>postTask(w,{kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:1,maxX:2,minZ:1,maxZ:2}}),/6×6/);
 assert.throws(()=>postTask(w,{kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:-24,maxX:-5,minZ:-24,maxZ:-15}}),/重叠/);
 assert.equal(hashCanonical(w),before);
});
test('One residential zone supports distinct voluntary homes, avoids occupied lots and remains available',()=>{
 const {w,zone,board}=setup();assert.ok(homeSites(w,w.camp!.zones![0].bounds).length>=3);
 for(const r of w.residents.slice(0,3)){readBoard(w,r,board);assert.equal(claimHome(w,r,zone),null);}
 const projects=w.camp!.tasks.filter(t=>t.kind==='house');assert.equal(projects.length,3);assert.equal(new Set(projects.map(t=>t.ownerId)).size,3);
 assert.equal(new Set(w.objects.filter(o=>o.ownerId).map(o=>`${o.position.x},${o.position.z}`)).size,3);
 const before=hashCanonical(w);assert.ok(claimHome(w,w.residents[0],zone));assert.equal(hashCanonical(w),before);
 w.camp!.stock=projects.reduce((n,t)=>{const cost=houseCost(t.homeLevel,t.homeDesign);return {wood:n.wood+cost.wood,stone:n.stone+cost.stone};},{wood:0,stone:0});
 for(const task of projects){const r=w.residents.find(r=>r.id===task.ownerId)!,plot=w.objects.find(o=>o.projectId===task.id)!;r.position={...plot.position};for(const step of houseSteps(task))assert.equal(finishBuild(w,r,ref(r,task.id),ref(r,task.id+':'+step.id)),null);assert.equal(r.homeId,plot.id);}
 assert.deepEqual(w.camp!.stock,{wood:0,stone:0});assert.equal(zone.progress,3);assert.equal(zone.status,'open');
});
test('Housing plans stay private until read; observer zoning adds no free private knowledge',()=>{
 const w=createCrewWorld(2),b=hashCanonical(buildContext(w,w.residents[1]));postTask(w,{kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:10,maxX:24,minZ:-24,maxZ:-16}});
 assert.equal(hashCanonical(buildContext(w,w.residents[1])),b);readBoard(w,w.residents[0],w.objects.find(o=>o.kind==='board')!);
 assert.ok(Object.values(w.residents[0].known).some(k=>k.description.includes('长期居住区')));assert.equal(hashCanonical(buildContext(w,w.residents[1])),b);
});
test('Walks from all four sides enter the doorway and never cross a completed house wall',()=>{
 for(const start of [{x:0,z:-6},{x:6,z:0},{x:-6,z:0},{x:0,z:6}]){
  const w=createCrewWorld(2),r=w.residents[0];w.objects=[{id:'home',kind:'house',buildStage:3,position:{x:0,y:0,z:0},width:4,height:3.5,depth:3,resources:0,appearance:'home'}];r.position={...start,y:0};const k=grantKnown(r,'home','home',{x:0,y:0,z:0},0);
  applyDecision(r,decision([{op:'walk',stage:0,params:{targetRef:k.ref,gait:'walk'}}]),0);let crossedDoor=false;
  for(let tick=1;tick<500&&!r.plan[0].done;tick++){const before={...r.position};stepActions(w,tick);assert.equal(movementBlocked(w,before,r.position),false,JSON.stringify(start));if(before.z>=1.45&&r.position.z<1.45&&Math.abs(r.position.x)<.5)crossedDoor=true;}
  assert.ok(r.plan[0].done);assert.equal(r.actionFeedback.length,0);assert.ok(crossedDoor);assert.ok(Math.hypot(r.position.x,r.position.z)<=.801);assert.equal(r.position.y,.405);
  r.known[k.ref].lastPosition={x:0,y:0,z:-6};applyDecision(r,decision([{op:'walk',stage:0,params:{targetRef:k.ref,gait:'walk'}}]),501);
  for(let tick=502;tick<1000&&!r.plan[0].done;tick++){const before={...r.position};stepActions(w,tick);assert.equal(movementBlocked(w,before,r.position),false);}
  assert.equal(r.actionFeedback.length,0);assert.ok(r.position.z<-5);assert.equal(r.position.y,0);
 }
});
test('Unknown buildings block bodies without providing an omniscient route; roof hiding cannot remove walls',()=>{
 const w=createCrewWorld(2),r=w.residents[0];w.objects=[{id:'home',kind:'house',buildStage:3,position:{x:0,y:0,z:0},width:4,height:3.5,depth:3,resources:0,appearance:'home'}];r.position={x:0,y:0,z:-5};const k=grantKnown(r,'old-location','last seen',{x:0,y:0,z:0},0);
 applyDecision(r,decision([{op:'walk',stage:0,params:{targetRef:k.ref,gait:'walk'}}]),0);for(let t=1;t<200&&!r.plan[0].done;t++)stepActions(w,t);
 assert.ok(r.actionFeedback.some(s=>s.includes('受阻')));assert.equal(solidWalls(w.objects[0]).length,5);assert.equal(floorHeight(w,{x:0,y:0,z:0}),.405);
});
test('House walls block private sight while the physical open doorway permits it',()=>{
 const w=createCrewWorld(2),[a,b]=w.residents;w.objects=[{id:'home',kind:'house',buildStage:3,position:{x:0,y:0,z:0},width:4,height:3.5,depth:3,resources:0,appearance:'home'}];a.position={x:0,y:.405,z:0};b.position={x:0,y:0,z:-3};a.heading=-Math.PI/2;samplePerception(w);assert.ok(!Object.values(a.known).some(k=>k.entityId===b.id&&k.visible));
 b.position={x:0,y:0,z:3};a.heading=Math.PI/2;w.tick+=20;samplePerception(w);assert.ok(Object.values(a.known).some(k=>k.entityId===b.id&&k.visible));
});
test('Construction hands animate from action ticks only, and restore idle when finished',()=>{
 const r=createCrewWorld(2).residents[0];r.plan=[{action:{op:'build',params:{},stage:0},startedTick:1,elapsedTicks:4,emittedChars:0,done:false}];const pose=workPose(r),before=hashCanonical(r);assert.ok(pose.active);for(let i=0;i<100;i++)assert.deepEqual(workPose(r),pose);assert.equal(hashCanonical(r),before);r.plan[0].elapsedTicks=9;assert.notDeepEqual(workPose(r),pose);r.plan[0].done=true;assert.equal(workPose(r).active,false);
});
test('Pinch spread zooms in with bounded limits and taps cycle all stacked candidates',()=>{
 assert.equal(pinchZoom(18,100,200),9);assert.equal(pinchZoom(18,100,50),36);assert.equal(pinchZoom(18,100,1),48);
 const hits=[{id:'a',distance:0},{id:'b',distance:0},{id:'c',distance:2}];assert.equal(cycleHit(hits,'a'),'b');assert.equal(cycleHit(hits,'b'),'c');assert.equal(cycleHit(hits,'c'),'a');assert.equal(cycleHit([],''),null);
});
test('Resource display retains original capacity and crosses half-depleted and empty stages',()=>{
 const o=createCrewWorld(2).objects.find(o=>o.kind==='rock')!;assert.equal(resourceCapacity(o),24);o.resources=12;assert.equal(resourceStage(o),2);o.resources=0;assert.equal(resourceStage(o),0);
 const r=createCrewWorld(2).residents[0],w=createCrewWorld(2);w.residents=[r];r.hunger=.95;r.fatigue=.85;const before=r.mood!;for(let i=0;i<100;i++)advanceEnvironment(w);assert.ok(r.mood!<before);
});
test('Zoning queued during model wait cannot mutate the frozen world',async()=>{
 let release!:()=>void;const ready=new Promise<void>(r=>release=r);const sim=new Simulation({async decide(request){await ready;return {metadata:request.metadata,decision:decision([{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}}]),source:'MOCK_TEST',model:'explicit test'};}},{world:createCrewWorld(2),allowMock:true});
 const pending=sim.bootstrap(),before=hashCanonical(sim.world);sim.queueTask({kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:8,maxX:24,minZ:-24,maxZ:-16}});sim.frame(0);sim.frame(90000);assert.equal(hashCanonical(sim.world),before);release();await pending;sim.frame(90001);sim.frame(90051);assert.equal(sim.world.camp!.zones!.length,1);sim.stop();
});
