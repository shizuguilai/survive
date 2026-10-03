import test from 'node:test';
import assert from 'node:assert/strict';
import type {Observation,Decision} from '../packages/contracts/src/types.ts';
import {createWorld} from '../packages/sim-core/src/world.ts';
import {buildContext,samplePerception} from '../packages/sim-core/src/perception.ts';
import {retainRecentObservations,RECENT_OBSERVATION_LIMIT} from '../packages/sim-core/src/knowledge.ts';
import {rememberFootstep} from '../packages/sim-core/src/spatial-memory.ts';

const observation=(n:number):Observation=>({obsRef:`observation_${n}`,experiencedWhen:'今天开始后0分1秒',certainty:'clear',modality:'visual',detail:{level:'described',relativeDirection:'front',distanceBand:'near',appearance:['我亲眼见过一棵树'],recognizedName:null,knownRef:'known_1'}});
const decision:Decision={schemaVersion:'1.0.0',decisionKind:'replace',goal:'按自己的记忆工作',reasonBrief:'测试',actions:[{op:'accept_task',stage:0,params:{taskRef:'known_1',evidenceRefs:['observation_5']}}],nextReviewAfterSimMs:1000,watch:[],memorySuggestions:[{kind:'belief',text:'尚未证实',evidenceRefs:['observation_4']}]};

test('Retaining sensory history preserves the exact model context and all personal evidence chains',()=>{
 const w=createWorld(),r=w.residents[0],otherBefore=structuredClone(w.residents[1]);
 r.observations=Array.from({length:800},(_,i)=>observation(i+1));r.observationSequence=800;
 r.known.known_1={ref:'known_1',entityId:'personally-seen-tree',description:'只来自自己的观察',lastPosition:{x:2,y:0,z:0},lastSeenTick:1,visible:false,recognizedName:null};
 rememberFootstep(r,1);
 r.memories.push({ref:'memory_old',kind:'direct',text:'很久以前亲眼看见的树',evidenceRefs:['observation_1'],experiencedWhen:'今天开始后0分1秒'},{ref:'memory_summary',kind:'summary',text:'保留原始来源的摘要',evidenceRefs:['memory_old'],experiencedWhen:'今天开始后0分2秒'});
 r.plan=[{action:{op:'accept_task',stage:0,params:{taskRef:'known_1',evidenceRefs:['observation_2']}},elapsedTicks:0,startedTick:0,emittedChars:0,done:false}];
 r.suspendedPlan=[{...r.plan[0],action:{op:'accept_task',stage:0,params:{taskRef:'known_1',evidenceRefs:['observation_3']}}}];r.lastDecision=structuredClone(decision);
 r.consumedObservationRefs=['observation_1','observation_100','observation_800','observation_missing'];
 const before=structuredClone(buildContext(w,r)),memories=structuredClone(r.memories),known=structuredClone(r.known),map=structuredClone(r.spatialMemory),plans=structuredClone([r.plan,r.suspendedPlan,r.lastDecision]);
 retainRecentObservations(r);
 assert.deepEqual(buildContext(w,r),before,'discarded retinal samples were absent from the model context');
 assert.equal(r.observations.length,RECENT_OBSERVATION_LIMIT+5);
 for(let i=1;i<=5;i++)assert.ok(r.observations.some(o=>o.obsRef===`observation_${i}`),'referenced observation '+i+' survives');
 assert.ok(!r.observations.some(o=>o.obsRef==='observation_100'));
 assert.deepEqual(r.consumedObservationRefs,['observation_1','observation_800']);
 assert.equal(r.observationSequence,800);assert.deepEqual(r.memories,memories);assert.deepEqual(r.known,known);assert.deepEqual(r.spatialMemory,map);assert.deepEqual([r.plan,r.suspendedPlan,r.lastDecision],plans);
 assert.deepEqual(w.residents[1],otherBefore,'retention never reads or changes another resident');
 const once=JSON.stringify(r);retainRecentObservations(r);assert.equal(JSON.stringify(r),once,'retention is idempotent');
});

test('Sensory sampling retains history only across a 256-observation boundary and never reuses an ID',()=>{
 const w=createWorld();w.objects=[];w.residents=w.residents.slice(0,1);const r=w.residents[0];
 r.visualSignature='[]';r.bodyBands={hunger:'舒适',fatigue:'舒适',pain:'舒适',health:'healthy'};
 r.observationSequence=766;r.observations=Array.from({length:766},(_,i)=>observation(i+1));
 r.hunger=.4;samplePerception(w);assert.equal(r.observationSequence,767);assert.equal(r.observations.length,767,'no scan before the boundary');
 r.hunger=.7;w.tick++;samplePerception(w);assert.equal(r.observationSequence,768);assert.equal(r.observations.length,RECENT_OBSERVATION_LIMIT);assert.equal(r.observations[0].obsRef,'observation_513');
 r.hunger=.9;w.tick++;samplePerception(w);assert.equal(r.observationSequence,769);assert.equal(r.observations.at(-1)!.obsRef,'observation_769');
 assert.ok(r.memories.some(m=>m.evidenceRefs.includes('observation_767')));assert.ok(r.memories.some(m=>m.evidenceRefs.includes('observation_768')));
 const saved=JSON.parse(JSON.stringify(w)),savedResident=saved.residents[0];savedResident.hunger=.4;saved.tick++;samplePerception(saved);
 assert.equal(savedResident.observationSequence,770);assert.equal(savedResident.observations.at(-1).obsRef,'observation_770','restored camps continue their original ID sequence');
});
