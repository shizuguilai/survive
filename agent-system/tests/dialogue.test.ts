import {test} from 'node:test';import assert from 'node:assert/strict';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {getOverlay} from '../packages/sim-core/src/perception.ts';
import {ReplayRecorder,ReplayPlayer} from '../packages/sim-core/src/replay.ts';
import type {Decision,BrainProvider,BrainRequest} from '../packages/contracts/src/types.ts';

test('D01/R01: explicitly MOCK greeting travels through perception, two barriers, positive speech, and network-free replay',async()=>{
  const spoken=new Set<string>();const requests:BrainRequest[]=[];const recording=new ReplayRecorder();
  const provider:BrainProvider={async decide(request){
    requests.push(structuredClone(request));const c=request.context;const id=request.metadata.agentId;
    const heard=c.observations.some(o=>o.modality==='auditory'&&o.detail.heardText?.includes('你好'));
    const shouldSpeak=!spoken.has(id)&&(c.identity.name==='阿林'||heard);
    const decision:Decision={schemaVersion:'1.0.0',decisionKind:'replace',goal:'测试声学链路',reasonBrief:'这是明确标记的测试夹具，不是真实自治。',
      actions:[shouldSpeak?{op:'speak',stage:0,params:{text:c.identity.name==='阿林'?'你好小禾。':'阿林你好。',volume:'normal',towardRef:null}}:{op:'wait',stage:0,params:{durationSimMs:10000,scope:'locomotion'}}],
      nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]};
    if(shouldSpeak)spoken.add(id);
    else if(c.currentPlan.actions[0]?.op==='speak'&&c.currentPlan.progress.startsWith('0/')){decision.decisionKind='continue';decision.actions=[{op:'continue',stage:0,params:{}}];}
    return {metadata:request.metadata,decision,source:'MOCK_TEST',model:'test-fixture-only'};
  }};
  const sim=new Simulation(provider,{runId:'mock-dialogue',allowMock:true,maxRetries:0,
    onCommit:r=>recording.commit(r),onSnapshot:w=>recording.capture(w,Object.fromEntries(w.residents.map(r=>[r.id,getOverlay(w,r)])))});
  await sim.bootstrap();assert.equal(sim.world.tick,0);assert.equal(sim.world.events.length,0);
  for(let i=0;i<100;i++){assert.equal(sim.step(),true);await sim.settled();assert.notEqual(sim.status,'ERROR_PAUSED');}
  const utterances=sim.world.events.filter(e=>e.kind==='speech_fragment');
  assert.ok(utterances.some(e=>e.agentId==='resident-a'));assert.ok(utterances.some(e=>e.agentId==='resident-b'));
  const firstA=utterances.find(e=>e.agentId==='resident-a')!,firstB=utterances.find(e=>e.agentId==='resident-b')!;
  assert.ok(firstA.tick>0);assert.ok(firstB.tick>firstA.tick);
  const firstBReply=requests.find(r=>r.metadata.agentId==='resident-b'&&r.context.observations.some(o=>o.modality==='auditory'&&o.detail.heardText?.includes('你好')))!
  assert.ok(firstBReply.metadata.tick>firstA.tick);assert.ok(firstBReply.metadata.tick<firstB.tick);
  const before=requests.length;const data=recording.export(true),player=new ReplayPlayer(data);
  assert.equal(data.manifest.decisionMode,'mock');assert.equal(data.manifest.decisionCounts.real,0);
  for(let tick=0;tick<=100;tick++)assert.equal(player.seek(tick).world.tick,tick);
  assert.equal(requests.length,before);assert.equal(player.seek(100).hash,data.frames.at(-1)!.hash);
});
