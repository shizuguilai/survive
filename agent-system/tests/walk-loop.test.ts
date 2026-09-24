import test from 'node:test';import assert from 'node:assert/strict';
import {createWorld} from '../packages/sim-core/src/world.ts';import {samplePerception,buildContext} from '../packages/sim-core/src/perception.ts';import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';import {validateDecision} from '../packages/contracts/src/validation.ts';import {RealModelGateway,loadConfig} from '../services/brain-gateway/src/gateway.ts';import {hashCanonical} from '../packages/contracts/src/canonical.ts';import type {Action,Decision} from '../packages/contracts/src/types.ts';
const decision=(actions:Action[]):Decision=>({schemaVersion:'1.0.0',decisionKind:'replace',goal:'explicit test fixture',reasonBrief:'regression only',actions,nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
function closeTree(){const w=createWorld(),r=w.residents[0];w.residents=[r];w.objects=[w.objects[0]];w.objects[0].position={x:0,y:0,z:0};r.position={x:-2,y:0,z:0};r.heading=0;samplePerception(w);const k=Object.values(r.known)[0];r.position.x=-.8;w.tick=4;samplePerception(w);return {w,r,k};}
test('Approaching a previously identified tree keeps its identity while current sight remains uncertain',()=>{
 const {w,r,k}=closeTree();assert.equal(k.description,'枝叶茂盛的树');assert.equal(k.visualLevel,'detected');assert.equal(k.descriptionSeenTick,0);
 const context=buildContext(w,r),target=context.knownTargets.find(t=>t.ref===k.ref)!;assert.equal(target.atLastKnownPosition,true);assert.ok(target.description.includes('当前仅见模糊轮廓'));assert.ok(target.description.includes('枝叶茂盛的树'));
 const clone=structuredClone(w);clone.objects[0].appearance='隐藏变化不能读取';clone.objects[0].resources=0;assert.equal(JSON.stringify(buildContext(clone,clone.residents[0])),JSON.stringify(context));
});
test('An unidentified nearby outline is not magically identified using engine object type',()=>{
 const w=createWorld();w.residents=w.residents.slice(0,1);w.objects=w.objects.slice(0,1);const r=w.residents[0];w.objects[0].position={x:0,y:0,z:0};r.position={x:-.8,y:0,z:0};samplePerception(w);const k=Object.values(r.known)[0];assert.equal(k.description,'一个不太清晰的轮廓');assert.equal(k.descriptionSeenTick,undefined);
});
test('Zero-distance walk yields truthful failure feedback, never another successful movement receipt',()=>{
 const {w,r,k}=closeTree(),start={...r.position};applyDecision(r,decision([{op:'walk',stage:0,params:{targetRef:k.ref,gait:'walk'}}]),w.tick);stepActions(w,5);assert.deepEqual(r.position,start);assert.ok(r.actionFeedback.at(-1)!.includes('本次没有移动'));assert.equal(w.events.filter(e=>e.kind==='action_completed').length,0);assert.equal(w.events.filter(e=>e.kind==='action_failed').length,1);assert.ok(!r.memories.some(m=>m.text.includes('我实际完成了walk')));
});
test('Decision guard rejects no-op navigation without substituting an action; genuine return journeys remain legal',()=>{
 const {w,r,k}=closeTree(),context=buildContext(w,r);const walk=(ref:string,stage=0)=>({op:'walk',stage,params:{targetRef:ref,gait:'walk'}});
 assert.throws(()=>validateDecision(decision([walk(k.ref)]),context),/already at/);
 assert.doesNotThrow(()=>validateDecision(decision([{op:'gather',stage:0,params:{targetRef:k.ref,amount:1}}]),context));
 context.knownTargets.push({ref:'distant',description:'之前看见的另一地点',lastObservedWhen:'此前',atLastKnownPosition:false});assert.doesNotThrow(()=>validateDecision(decision([walk('distant'),walk(k.ref,1)]),context));
});
test('MOCK_UPSTREAM: invalid arrival walk is repaired by a model response inside the same request',async()=>{
 const {w,r,k}=closeTree(),context=buildContext(w,r);let calls=0;const before=hashCanonical(w);
 const gateway=new RealModelGateway(loadConfig({SURVIVE_MODEL_API_KEY:'MOCK_TEST_SECRET'}),{fetch:async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(decision(calls===1?[{op:'walk',stage:0,params:{targetRef:k.ref,gait:'walk'}}]:[{op:'gather',stage:0,params:{targetRef:k.ref,amount:1}}]))}}]});}});
 const response=await gateway.decide({metadata:{runId:w.runId,barrierId:'test',agentId:r.id,requestId:'repair-no-op',generation:0,tick:w.tick,snapshotHash:hashCanonical(w),contextHash:hashCanonical(context),schemaVersion:'1.0.0'},context});assert.equal(calls,2);assert.equal(response.decision.actions[0].op,'gather');assert.equal(hashCanonical(w),before);
});
test('Malformed recognized actions report the precise safe schema field for model repair',()=>{
 const {w,r,k}=closeTree(),context=buildContext(w,r);
 assert.throws(()=>validateDecision(decision([{op:'gather',stage:0,params:{targetRef:k.ref,amount:'PRIVATE_INVALID_VALUE'}}] as any),context),error=>{
  assert.equal((error as Error).message,'$.actions[0].params.amount: expected integer');return true;
 });
 assert.throws(()=>validateDecision(decision([{op:'rest',stage:0,params:{durationSimMs:1000}}] as any),context),/\$\.actions\[0\]\.params\.placeRef: required/);
});
