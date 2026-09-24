import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampWorld,advanceEnvironment} from '../packages/sim-core/src/world.ts';
import {samplePerception,buildContext} from '../packages/sim-core/src/perception.ts';
import {readBoard,postTask} from '../packages/sim-core/src/camp.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {validateCharacterContext} from '../packages/contracts/src/validation.ts';
const decision=(actions:any[])=>({schemaVersion:'1.0.0' as const,decisionKind:'replace' as const,goal:'test',reasonBrief:'test',actions,nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
const act=(op:string,params:any)=>({op,params,stage:0});
test('Camp notices stay out of distant minds; reading creates personal task evidence',()=>{
 const w=createCampWorld(),a=w.residents[0],b=w.residents[1];b.position.x=50;samplePerception(w);
 assert.equal(buildContext(w,a).knownTargets.some(k=>k.description.includes('公告任务：')),false);
 const before=hashCanonical(buildContext(w,b));readBoard(w,a,w.objects.find(o=>o.kind==='board')!);
 assert.ok(buildContext(w,a).knownTargets.some(k=>k.description.includes('公告任务：')));
 assert.equal(hashCanonical(buildContext(w,b)),before);validateCharacterContext(buildContext(w,a));
});
test('Player commands during cognition queue outside the frozen world; vitals do not advance',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const sim=new Simulation({async decide(req){await gate;return {metadata:req.metadata,source:'MOCK_TEST',model:'test',decision:decision([act('wait',{durationSimMs:10000,scope:'hands'})])};}},{world:createCampWorld(),allowMock:true});
 const p=sim.bootstrap();const hash=hashCanonical(sim.world);sim.queueTask({resource:'food',amount:4,note:'test'});
 for(let i=0;i<20;i++)sim.frame(i*1000);assert.equal(hashCanonical(sim.world),hash);assert.equal(sim.pendingTaskCount,1);
 release();await p;assert.equal(sim.world.tick,0);assert.equal(sim.world.camp!.tasks.length,1);sim.step();assert.equal(sim.world.camp!.tasks.length,2);sim.stop();
});
test('Gather counts only accepted tasks, produces own supplies, and eating consumes real food',()=>{
 const w=createCampWorld(),r=w.residents[0],board=w.objects.find(o=>o.kind==='board')!;
 postTask(w,{resource:'food',amount:1,note:'test'});readBoard(w,r,board);
 const task=w.camp!.tasks[1],taskRef=Object.values(r.known).find(k=>k.entityId===task.id)!.ref;
 applyDecision(r,decision([act('accept_task',{taskRef,evidenceRefs:[r.observations.at(-1)!.obsRef]})]),0);stepActions(w,1);assert.ok(task.acceptedBy.includes(r.id));
 const bush=w.objects.find(o=>o.kind==='berry')!;r.position={...bush.position,x:bush.position.x-1.6};r.heading=0;samplePerception(w);
 const targetRef=Object.values(r.known).find(k=>k.entityId===bush.id)!.ref;const amount=bush.resources;
 applyDecision(r,decision([act('gather',{targetRef,amount:1})]),1);for(let tick=2;tick<=21;tick++){w.tick=tick;stepActions(w,tick);}
 assert.equal(task.progress,1);assert.equal(task.status,'done');assert.equal(bush.resources,amount-1);assert.equal(r.supplies!.food,1);
 samplePerception(w);const foodRef=Object.values(r.known).find(k=>k.entityId===`supply-food-${r.id}`)!.ref;r.hunger=.8;
 applyDecision(r,decision([act('eat',{foodRef,amount:1})]),21);for(let tick=22;tick<=41;tick++){w.tick=tick;stepActions(w,tick);}
 assert.equal(r.supplies!.food,0);assert.equal(r.inventory,0);assert.ok(r.hunger<.8);assert.deepEqual(buildContext(w,r).currentPlan.actions,[]);
});
test('Actual spoken fragments are remembered, never an unsaid suffix; starvation reduces health',()=>{
 const w=createCampWorld(),r=w.residents[0];applyDecision(r,decision([act('speak',{text:'你好今天去采果子',volume:'normal',towardRef:null})]),0);
 for(let t=1;t<=20;t++){w.tick=t;stepActions(w,t);}const text=buildContext(w,r).memories.map(m=>m.text).join(' ');assert.ok(text.includes('我已经实际说出：你好今天'));assert.ok(!text.includes('去采果子'));
 r.hunger=.95;const hp=r.health!;advanceEnvironment(w);assert.ok(r.health!<hp);r.hunger=.1;r.fatigue=.1;const injured=r.health!;advanceEnvironment(w);assert.ok(r.health!>injured);
});
test('Hauling transfers owned resources to camp stock without creating or duplicating them',()=>{
 const w=createCampWorld(),r=w.residents[0];r.supplies={wood:2};r.inventory=2;samplePerception(w);
 const sourceRef=Object.values(r.known).find(k=>k.entityId===`supply-wood-${r.id}`)!.ref;
 const destinationRef=Object.values(r.known).find(k=>k.entityId==='camp-board')!.ref;
 applyDecision(r,decision([act('haul',{sourceRef,destinationRef,amount:2})]),0);
 for(let t=1;t<=20;t++){w.tick=t;stepActions(w,t);}assert.equal(r.inventory,0);assert.equal(r.supplies.wood,0);assert.equal(w.camp!.stock!.wood,2);
});
test('Full-length player notices stay within the closed perception contract',()=>{
 const w=createCampWorld(),r=w.residents[0];postTask(w,{resource:'stone',amount:50,note:'需'.repeat(120)});samplePerception(w);readBoard(w,r,w.objects.find(o=>o.kind==='board')!);validateCharacterContext(buildContext(w,r));
});
