import test from 'node:test';import assert from 'node:assert/strict';
import {Simulation} from '../packages/sim-core/src/cognition.ts';import {createCampWorld} from '../packages/sim-core/src/world.ts';
import {grantKnown} from '../packages/sim-core/src/camp.ts';import {samplePerception} from '../packages/sim-core/src/perception.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
test('Ordinary background parallax stays perceived without interrupting a model-authored walk',async()=>{
 const w=createCampWorld();w.residents=w.residents.slice(0,1);const r=w.residents[0],tree=w.objects.find(o=>o.id==='tree-west')!,target=grantKnown(r,tree.id,tree.appearance,tree.position,0);let calls=0;
 const sim=new Simulation({async decide(req){calls++;return {metadata:req.metadata,source:'MOCK_TEST',model:'cadence-regression-only',decision:{schemaVersion:'1.0.0',decisionKind:req.context.currentPlan.actions.length?'continue':'replace',goal:'walk fixture',reasonBrief:'explicit regression',actions:req.context.currentPlan.actions.length?[{op:'continue',stage:0,params:{}}]:[{op:'walk',stage:0,params:{targetRef:target.ref,gait:'walk'}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]}};}},{world:w,allowMock:true});
 await sim.bootstrap();const initialObservations=sim.world.residents[0].observations.length;
 for(let i=0;i<65;i++){sim.step();await sim.settled();}
 assert.ok(calls<=2,`expected at most startup and meaningful target change, got ${calls}`);assert.ok(sim.world.residents[0].observations.length>initialObservations);assert.ok(Math.hypot(sim.world.residents[0].position.x-r.position.x,sim.world.residents[0].position.z-r.position.z)>4);sim.stop();
});
test('New people, actual speech and pain still request cognition during work',()=>{
 const w=createCampWorld(),a=w.residents[0],b=w.residents[1];b.position.x=40;samplePerception(w);a.plan=[{action:{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}},elapsedTicks:0,startedTick:0,emittedChars:0,done:false}];
 b.position={x:1,y:0,z:0};w.tick=4;assert.ok(samplePerception(w).includes(a.id));a.pain=.2;w.tick=5;assert.ok(samplePerception(w).includes(a.id));
 w.sounds.push({id:'actual-speech',sourceId:b.id,position:{...b.position},heading:0,text:'你好',volume:'normal',emittedTick:5,deliveredTo:[]});w.tick=6;assert.ok(samplePerception(w).includes(a.id));
});
test('Waiting progress is observer-only, full batch still freezes and drops elapsed wall time',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r);const sim=new Simulation({async decide(req){await waiting;return {metadata:req.metadata,source:'MOCK_TEST',model:'delayed-cadence-fixture',decision:{schemaVersion:'1.0.0',decisionKind:'replace',goal:'wait',reasonBrief:'fixture',actions:[{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]}};}},{world:createCampWorld(),allowMock:true});
 const pending=sim.bootstrap(),before=hashCanonical(sim.world);assert.deepEqual(Object.values(sim.barrier!.requestAttempts),[1,1]);sim.frame(0);sim.frame(60000);assert.equal(hashCanonical(sim.world),before);release();await pending;sim.frame(60001);assert.equal(sim.world.tick,0);sim.frame(60051);assert.equal(sim.world.tick,1);sim.stop();
});
test('Ongoing speech keeps all delivered fragments but wakes only once per utterance',()=>{
 const w=createCampWorld(),[a,b]=w.residents;samplePerception(w);a.plan=[{action:{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}},elapsedTicks:0,startedTick:0,emittedChars:0,done:false}];
 for(let i=0;i<3;i++){w.sounds.push({id:'part-'+i,utteranceId:'one-sentence',final:i===2,sourceId:b.id,position:{...b.position},heading:b.heading,text:['你好阿林','我们今天','去采木材'][i],volume:'normal',emittedTick:i,deliveredTo:[]});w.tick=i+1;const wake=samplePerception(w).includes(a.id);assert.equal(wake,i===0);}
 assert.equal(a.observations.filter(o=>o.modality==='auditory').map(o=>o.detail.heardText).join(''),'你好阿林我们今天去采木材');
});
test('An encounter wakes once across recognition, movement, loss and brief re-entry; later encounter wakes again',()=>{
 const w=createCampWorld();w.objects=[];const[a,b]=w.residents;a.position={x:0,y:0,z:0};a.heading=0;b.position={x:10,y:0,z:0};
 assert.ok(samplePerception(w).includes(a.id));const initial=a.observations.length;
 // No active plan: idle status must not bypass encounter de-duplication either.
 for(const [tick,x] of [[4,7],[8,2],[12,-2],[16,2],[20,-2],[24,-3]] as const){w.tick=tick;b.position.x=x;assert.ok(!samplePerception(w).includes(a.id),`tick ${tick}`);}
 assert.ok(a.observations.length>initial);assert.ok(a.observations.some(o=>o.detail.appearance?.some((s:string)=>s.includes('已离开视野'))));
 w.tick=60;b.position.x=2;assert.ok(samplePerception(w).includes(a.id));
 w.tick=64;assert.ok(!samplePerception(w).includes(a.id));
});
test('Speech de-duplicates through unclear-to-clear, name watch, final fragment and idle; a new utterance wakes',()=>{
 const w=createCampWorld();w.objects=[];const[a,b]=w.residents;samplePerception(w);
 a.lastDecision={schemaVersion:'1.0.0',decisionKind:'replace',goal:'fixture',reasonBrief:'fixture',actions:[],nextReviewAfterSimMs:10000,watch:[{kind:'heard_name',knownRef:null}],memorySuggestions:[]};
 for(let i=0;i<3;i++){
  w.sounds=[];w.sounds.push({id:'chunk-'+i,utteranceId:'same-speech',final:i===2,sourceId:b.id,position:{x:i===0?5:1,y:0,z:0},heading:0,text:i===0?'不能听清的秘密':a.name,volume:'normal',emittedTick:i,deliveredTo:[]});
  w.tick=i+1;assert.equal(samplePerception(w).includes(a.id),i===0);
 }
 const heard=a.observations.filter(o=>o.modality==='auditory');assert.equal(heard.length,3);assert.equal(heard[0].detail.heardText,null);assert.equal(heard[2].detail.heardText,a.name);
 w.sounds=[{id:'new',utteranceId:'new-speech',final:true,sourceId:b.id,position:{x:1,y:0,z:0},heading:0,text:'新问题',volume:'normal',emittedTick:3,deliveredTo:[]}];w.tick=4;assert.ok(samplePerception(w).includes(a.id));
});
test('Choosing silence continues the existing action with progress preserved after hearing speech',async()=>{
 const w=createCampWorld();w.objects=[];w.residents[1].position.x=40;let calls=0;
 const sim=new Simulation({async decide(req){calls++;const ongoing=req.context.currentPlan.actions.length>0;return {metadata:req.metadata,source:'MOCK_TEST',model:'explicit-silent-continuation-fixture',decision:{schemaVersion:'1.0.0',decisionKind:ongoing?'continue':'replace',goal:'keep working silently',reasonBrief:'fixture chooses no reply',actions:ongoing?[{op:'continue',stage:0,params:{}}]:[{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]}};}},{world:w,allowMock:true});
 await sim.bootstrap();for(let i=0;i<8;i++){sim.step();await sim.settled();}
 const before=sim.world.residents[0].plan[0].elapsedTicks,baseline=calls;
 const utterance='external-realistic-fragments';for(let i=0;i<3;i++){
  sim.world.sounds.push({id:'silent-chunk-'+i,utteranceId:utterance,final:i===2,sourceId:w.residents[1].id,position:{x:1,y:0,z:0},heading:0,text:['你好','阿林','去工作'][i],volume:'normal',emittedTick:sim.world.tick,deliveredTo:[]});sim.step();await sim.settled();
 }
 assert.equal(calls-baseline,1);assert.equal(sim.world.residents[0].plan[0].elapsedTicks,before+3);assert.ok(!sim.world.sounds.some(s=>s.sourceId===w.residents[0].id));sim.stop();
});
