import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTEXT_LIMITS} from '../packages/contracts/src/context-limits.ts';
import {validateBrainRequest,validateCharacterContext} from '../packages/contracts/src/validation.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {DEFAULT_CONTROL} from '../packages/contracts/src/command.ts';
import {buildContext} from '../packages/sim-core/src/perception.ts';
import {createCrewWorld,createWorld} from '../packages/sim-core/src/world.ts';
import {grantKnown,postTask,readBoard} from '../packages/sim-core/src/camp.ts';
import {rememberLandmark} from '../packages/sim-core/src/spatial-memory.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import type {Observation} from '../packages/contracts/src/types.ts';

const observed=(n:number,knownRef:string):Observation=>({obsRef:`observation_${n}`,experiencedWhen:'此前',certainty:'clear',modality:'visual',detail:{level:'described',relativeDirection:'front',distanceBand:'far',appearance:['亲眼看见的树木'],recognizedName:null,knownRef}});

test('Hundreds of saved targets produce bounded, referentially complete requests without deleting private history',()=>{
 const w=createWorld(),r=w.residents[0];w.tick=11761;
 for(let n=0;n<500;n++){
  const k=grantKnown(r,`seen-${n}`,'只来自本人观察的树木',{x:20+n/10,y:0,z:10},n);
  if(n<64)rememberLandmark(r,k.ref,'tree',k.lastPosition,n);
  r.observations.push(observed(n+1,k.ref));
  r.memories.push({ref:`memory_seen_${n}`,kind:'direct',text:`亲眼看过第${n}棵树`,evidenceRefs:[`observation_${n+1}`],experiencedWhen:'此前'});
 }
 const active=Object.values(r.known)[250].ref,suspended=Object.values(r.known)[251].ref;
 const progress=(ref:string)=>({action:{op:'walk',stage:0,params:{targetRef:ref,gait:'walk'}},elapsedTicks:0,startedTick:0,emittedChars:0,done:false});
 r.plan=[progress(active)];r.suspendedPlan=[progress(suspended)];
 r.memories.push({ref:'memory_summary',kind:'summary',text:'有来源的旧地点摘要',evidenceRefs:['memory_seen_1','memory_seen_2'],experiencedWhen:'此前'});
 const before=hashCanonical(w),context=buildContext(w,r);validateCharacterContext(context);
 const known=new Set(context.knownTargets.map(t=>t.ref));
 assert.equal(context.knownTargets.length,CONTEXT_LIMITS.knownTargets);
 assert.ok(known.has(active));assert.ok(known.has(suspended));
 assert.ok(context.memories.some(m=>m.ref==='memory_summary'));
 assert.ok(context.memories.some(m=>m.ref==='memory_seen_1'));
 assert.ok(context.observations.some(o=>o.obsRef==='observation_2'));
 assert.ok(context.spatialMemory!.landmarks.every(l=>known.has(l.knownRef)));
 const metadata={runId:'test',barrierId:'budget',agentId:r.id,requestId:'old_save',generation:0,tick:w.tick,snapshotHash:before,contextHash:hashCanonical(context),schemaVersion:'1.0.0' as const};
 validateBrainRequest({metadata,context});
 assert.equal(hashCanonical(w),before,'request assembly leaves all residents, maps and private histories intact');
 assert.deepEqual(buildContext(w,r),context,'selection is deterministic');
 const oversized=structuredClone(context);oversized.knownTargets.push({ref:'extra',description:'超额测试',lastObservedWhen:'此前'});
 assert.throws(()=>validateCharacterContext(oversized),/knownTargets: array length outside range/);
});

test('Oversized summary source chains stay private instead of overflowing or exposing dangling evidence',()=>{
 const w=createWorld(),r=w.residents[0];
 for(let n=0;n<200;n++){
  const k=grantKnown(r,`seen-${n}`,'本人曾观察的地点',{x:n,y:0,z:5},n);
  r.observations.push(observed(n+1,k.ref));
  r.memories.push({ref:`chain_${n}`,kind:n?'summary':'direct',text:'原始来源完整保留',evidenceRefs:n?[`chain_${n-1}`,`observation_${n+1}`]:['observation_1'],experiencedWhen:'此前'});
 }
 const before=hashCanonical(r),context=buildContext(w,r);validateCharacterContext(context);
 assert.ok(context.knownTargets.length<=CONTEXT_LIMITS.knownTargets);
 assert.ok(context.memories.length<=CONTEXT_LIMITS.memories);
 assert.ok(context.observations.length<=CONTEXT_LIMITS.observations);
 const evidence=new Set([...context.memories.map(m=>m.ref),...context.observations.map(o=>o.obsRef)]);
 assert.ok(context.memories.every(m=>m.evidenceRefs.every(ref=>evidence.has(ref))));
 assert.equal(hashCanonical(r),before);assert.ok(r.memories.some(m=>m.ref==='chain_199'));
});

test('A spent personal supply remains a truthful reference for old plans; missing summary evidence is never invented',()=>{
 const w=createCrewWorld(2),r=w.residents[0];r.supplies={wood:0};
 const source=grantKnown(r,`supply-wood-${r.id}`,'自己携带的木材8份',r.position,0);
 r.plan=[{action:{op:'walk',stage:0,params:{targetRef:source.ref,gait:'walk'}},elapsedTicks:0,startedTick:0,emittedChars:0,done:false}];
 r.observations.push(observed(1,source.ref));
 r.memories.push({ref:'missing_summary',kind:'summary',text:'来源缺失的旧摘要仍保留在私有历史',evidenceRefs:['observation_missing'],experiencedWhen:'此前'});
 const before=hashCanonical(r),context=buildContext(w,r);validateCharacterContext(context);
 assert.match(context.knownTargets.find(t=>t.ref===source.ref)!.description,/剩余0份/);
 assert.ok(!context.memories.some(m=>m.ref==='missing_summary'));assert.equal(hashCanonical(r),before);
});

test('A restored four-resident camp with hundreds of learned targets advances with the real local planner',async()=>{
 const w=createCrewWorld(4);w.tick=11761;
 postTask(w,{kind:'planting',cropKind:'rice',bounds:{minX:-30,maxX:-8,minZ:5,maxZ:23},resource:'food',amount:1,note:'large farm regression'});
 for(const r of w.residents){
  // Explicit fixture: the saved resident previously inspected these locations.
  for(const object of w.objects){const k=grantKnown(r,object.id,object.appearance,object.position,10000);rememberLandmark(r,k.ref,object.kind,object.position,10000);}
  for(let n=0;n<300;n++)grantKnown(r,`old-private-place-${n}`,'旧的个人路线线索',{x:35+n/100,y:0,z:-30},n);
  readBoard(w,r,w.objects.find(o=>o.kind==='board')!);
  assert.ok(Object.keys(r.known).length>128);
  validateCharacterContext(buildContext(w,r));
 }
 const restored=JSON.parse(JSON.stringify(w));
 const provider=new ColonyProvider({...DEFAULT_CONTROL,mode:'local'},{async plan(){throw Error('Local mode must never call a remote provider');}});
 const sim=new Simulation(provider,{world:restored,controlMode:'local'});await sim.bootstrap(true);
 for(let n=0;n<80&&sim.status!=='ERROR_PAUSED';n++){if(sim.paused)await sim.settled();else sim.step();}
 assert.notEqual(sim.status,'ERROR_PAUSED',JSON.stringify(sim.barrier?.errors??sim.observerError));
 assert.ok(sim.world.tick>w.tick+60);assert.equal(provider.remoteCalls,0);
 assert.ok(sim.world.residents.every(r=>Object.keys(r.known).length>300));sim.stop();
});
