import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,type SimulationStatus} from '../packages/sim-core/src/cognition.ts';
import {ColonyProvider,type LocalPlanningContext} from '../packages/sim-core/src/colony.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {controlSettings} from '../packages/contracts/src/command.ts';
import {postTask,grantKnown} from '../packages/sim-core/src/camp.ts';
import {samplePerception,buildContext} from '../packages/sim-core/src/perception.ts';
import {FARM_WORK_TICKS,finishFarm} from '../packages/sim-core/src/agriculture.ts';
import {validateDecision} from '../packages/contracts/src/validation.ts';
import type {Decision} from '../packages/contracts/src/types.ts';

const forbidden={async plan():Promise<never>{throw Error('No remote call allowed');}};
const settings=controlSettings({mode:'local',residents:2});
const waiting=(goal:string):Decision=>({schemaVersion:'1.0.0',decisionKind:'replace',goal,reasonBrief:'Local test decision',actions:[{op:'wait',stage:0,params:{scope:'locomotion',durationSimMs:1000}}],nextReviewAfterSimMs:1000,watch:[],memorySuggestions:[]});

test('Offline planning uses no whole-world clones, async provider or cognition clock reset',async()=>{
 const states:SimulationStatus[]=[],p=new ColonyProvider(settings,forbidden);
 p.decideBatch=async()=>{throw Error('Local planning must not enter the asynchronous grouped pipeline');};
 let commits=0;const sim=new Simulation(p,{world:createCrewWorld(2),controlMode:'local',onStatus:s=>states.push(s),onLocalCommit:()=>{commits++;}});
 const originalClone=globalThis.structuredClone;let wholeWorldCopies=0;
 globalThis.structuredClone=((value:any,options?:any)=>{if(value?.residents&&value?.objects&&value?.runId)wholeWorldCopies++;return originalClone(value,options);}) as typeof structuredClone;
 try{
  await sim.bootstrap();assert.equal(sim.status,'RUNNING');assert.equal(sim.paused,false);
  sim.frame(0);sim.frame(50);assert.equal(sim.world.tick,1);
  for(const r of sim.world.residents){r.plan=[];r.nextReviewTick=0;}
  sim.frame(100);assert.equal(sim.world.tick,2);sim.frame(150);assert.equal(sim.world.tick,3);
  assert.equal(wholeWorldCopies,0);assert.ok(commits>=2);assert.equal(p.remoteCalls,0);
  assert.equal(states.includes('THINKING'),false);assert.equal(states.includes('COMMITTING'),false);assert.equal(sim.barrier,null);
 }finally{globalThis.structuredClone=originalClone;sim.stop();}
});

test('Local intent batches validate every resident before publishing and retry without remote connection',async()=>{
 const p=new ColonyProvider(settings,forbidden);let invalid=true;
 p.decideLocalBatch=(contexts:LocalPlanningContext[])=>contexts.map((entry,i)=>({agentId:entry.agentId,decision:invalid&&i===1?{...waiting('invalid'),actions:[{op:'walk',stage:0,params:{targetRef:'hidden-ref',gait:'walk'}}]}:waiting('planned together')}));
 const sim=new Simulation(p,{world:createCrewWorld(2),controlMode:'local'}),before=sim.world.residents.map(r=>({goal:r.goal,plan:r.plan}));
 await sim.bootstrap();assert.equal(sim.status,'ERROR_PAUSED');assert.match(sim.observerError??'',/本地规划失败/);
 assert.deepEqual(sim.world.residents.map(r=>({goal:r.goal,plan:r.plan})),before);assert.equal(sim.world.events.some(e=>e.kind==='decision'),false);
 sim.resume('LOCAL_PLAN_ERROR');assert.equal(sim.paused,true);invalid=false;await sim.retry();
 assert.equal(sim.status,'RUNNING');assert.equal(sim.paused,false);assert.ok(sim.world.residents.every(r=>r.goal==='planned together'));
 assert.equal(sim.world.events.filter(e=>e.kind==='decision').length,2);sim.stop();
});

function farmingFixture(){
 const w=createCrewWorld(1),r=w.residents[0];w.residents=[r];w.camp!.tasks=[];r.hunger=.1;r.fatigue=.1;r.water=2;
 postTask(w,{kind:'planting',cropKind:'rice',bounds:{minX:5,maxX:9,minZ:7,maxZ:11},resource:'food',amount:1,note:''});
 const task=w.camp!.tasks[0];task.acceptedBy=[r.id];const crop=w.objects.find(o=>o.kind==='crop')!;
 r.position={...crop.position,x:crop.position.x-1};r.heading=0;
 const target=grantKnown(r,crop.id,crop.appearance,crop.position,w.tick);grantKnown(r,task.id,'种植区工作',crop.position,w.tick);samplePerception(w);
 return {w,r,crop,target};
}

test('Offline farming plans till, sow and water ahead while every stage still requires actual work',async()=>{
 const {w,crop,target}=farmingFixture(),p=new ColonyProvider(controlSettings({mode:'local',residents:1}),forbidden),sim=new Simulation(p,{world:w,controlMode:'local'});
 await sim.bootstrap();const resident=sim.world.residents[0],actual=sim.world.objects.find(o=>o.id===crop.id)!;
 assert.deepEqual(resident.plan.map(p=>[p.action.op,p.action.params.work]),[['farm','till'],['farm','sow'],['farm','water']]);
 assert.equal(actual.crop!.stage,'fallow');assert.equal(resident.water,2);const batches=p.localBatches;
 for(let i=0;i<FARM_WORK_TICKS.till-1;i++)sim.step();assert.equal(actual.crop!.stage,'fallow');
 sim.step();assert.equal(actual.crop!.stage,'tilled');assert.equal(p.localBatches,batches);
 for(let i=0;i<FARM_WORK_TICKS.sow;i++)sim.step();assert.equal(actual.crop!.stage,'sown');assert.equal(p.localBatches,batches);
 for(let i=0;i<FARM_WORK_TICKS.water;i++)sim.step();assert.ok(['seedling','growing'].includes(actual.crop!.stage));assert.equal(sim.world.residents[0].water,1);
 assert.equal(sim.status,'RUNNING');assert.equal(sim.world.residents[0].known[target.ref].entityId,crop.id);sim.stop();
});

test('Queued farm actions do not consume water or sow when another worker changes their prerequisites',async()=>{
 const {w,crop}=farmingFixture(),p=new ColonyProvider(controlSettings({mode:'local',residents:1}),forbidden),sim=new Simulation(p,{world:w,controlMode:'local'});
 await sim.bootstrap();const actual=sim.world.objects.find(o=>o.id===crop.id)!;
 finishFarm(actual,sim.world.residents[0],'till',sim.world.tick);finishFarm(actual,sim.world.residents[0],'sow',sim.world.tick);
 sim.step();assert.equal(actual.crop!.stage,'sown');assert.equal(sim.world.residents[0].water,2);
 assert.ok(sim.world.events.some(e=>e.kind==='action_failed'));
 assert.equal(sim.world.residents[0].plan[0].action.params.work,'water');assert.equal(sim.status,'RUNNING');sim.stop();
});

test('Local execution only chooses targets offered in that resident bounded context',()=>{
 const {w,r}=farmingFixture(),p=new ColonyProvider(controlSettings({mode:'local',residents:1}),forbidden);
 const context=buildContext(w,r);context.knownTargets=[];context.spatialMemory=undefined;context.observations=[];
 const decisions=p.decideLocalBatch([{agentId:r.id,context}],w);
 assert.equal(decisions[0].decision.actions[0].op,'survey');validateDecision(decisions[0].decision,context);
});
