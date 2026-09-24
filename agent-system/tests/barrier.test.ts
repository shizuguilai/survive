import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {createWorld} from '../packages/sim-core/src/world.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {validateBrainRequest} from '../packages/contracts/src/validation.ts';
import {getOverlay} from '../packages/sim-core/src/perception.ts';
import type {BrainProvider,BrainRequest,BrainResponse,Decision} from '../packages/contracts/src/types.ts';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const waitDecision=():Decision=>({schemaVersion:'1.0.0',decisionKind:'replace',goal:'安静等一会儿',reasonBrief:'这是我此刻的选择',actions:[{op:'wait',stage:0,params:{scope:'locomotion',durationSimMs:10000}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
class ControlledBrain implements BrainProvider{
  pending:{request:BrainRequest;resolve:(r:BrainResponse)=>void;reject:(e:Error)=>void}[]=[];
  async decide(request:BrainRequest):Promise<BrainResponse>{validateBrainRequest(request);return new Promise((resolve,reject)=>this.pending.push({request,resolve,reject}));}
  accept(index:number,decision=waitDecision(),source:BrainResponse['source']='MOCK_TEST'):void{const p=this.pending[index];p.resolve({metadata:structuredClone(p.request.metadata),decision,source,model:'controlled-test-fixture'});}
}
const setup=(extra:Record<string,any>={})=>{const brain=new ControlledBrain();const sim=new Simulation(brain,{allowMock:true,maxRetries:0,runId:'test-run',...extra});return {brain,sim};};

test('TM01/03: one reply cannot change a frozen batch; independent validated contexts commit once',async()=>{
  let commits=0;const {brain,sim}=setup({onCommit:()=>{commits++;}});const settled=sim.bootstrap();assert.equal(brain.pending.length,2);
  const before=hashCanonical(sim.world);assert.equal(sim.status,'THINKING');
  assert.notEqual(brain.pending[0].request.context.identity.name,brain.pending[1].request.context.identity.name);
  assert.equal(brain.pending[0].request.metadata.snapshotHash,brain.pending[1].request.metadata.snapshotHash);
  brain.accept(1);await turn();sim.frame(30000);assert.equal(hashCanonical(sim.world),before);assert.equal(commits,0);
  brain.accept(0);await settled;assert.equal(commits,1);assert.equal(sim.world.tick,0);assert.equal(sim.world.sounds.length,0);assert.equal(sim.status,'RUNNING');
  brain.accept(0);await turn();assert.equal(commits,1);
});

test('TM02: resumed frame drops the entire network wait; first action requires a positive tick',async()=>{
  const {brain,sim}=setup();const done=sim.bootstrap();brain.accept(0);brain.accept(1);await done;
  assert.equal(sim.frame(30000),0);assert.equal(sim.world.tick,0);
  assert.equal(sim.frame(30050),1);assert.equal(sim.world.tick,1);assert.equal(sim.world.residents[0].plan[0].elapsedTicks,1);
});

test('TM03/07: reversing response arrival order yields identical accepted world',async()=>{
  async function run(order:number[]){const {brain,sim}=setup();const done=sim.bootstrap();for(const i of order){brain.accept(i);await turn();}await done;for(let i=0;i<3;i++)sim.step();return hashCanonical(sim.world);}
  assert.equal(await run([0,1]),await run([1,0]));
});

test('TM04: failed resident keeps entire world frozen and only that resident retries',async()=>{
  const {brain,sim}=setup();const done=sim.bootstrap();const before=hashCanonical(sim.world);brain.accept(0);brain.pending[1].reject(new Error('TEST permission denied'));await done;
  assert.equal(sim.status,'ERROR_PAUSED');assert.equal(hashCanonical(sim.world),before);assert.match(sim.barrier!.errors['resident-b'],/permission/);
  sim.resume();assert.equal(sim.step(),false);
  const retried=sim.retry();assert.equal(brain.pending.length,3);assert.equal(brain.pending[2].request.metadata.agentId,'resident-b');assert.equal(brain.pending[2].request.metadata.snapshotHash,brain.pending[1].request.metadata.snapshotHash);
  brain.accept(2);await retried;assert.equal(sim.status,'RUNNING');assert.equal(sim.world.tick,0);
});

test('TM04: runtime timeout keeps ERROR_PAUSED and never creates a fallback decision',async()=>{
  const {brain,sim}=setup({requestTimeoutMs:10});const done=sim.bootstrap();brain.accept(0);const before=hashCanonical(sim.world);await done;
  assert.equal(sim.status,'ERROR_PAUSED');assert.equal(hashCanonical(sim.world),before);assert.match(sim.barrier!.errors['resident-b'],/timed out/);
});

test('TM05: user pause and background remain after the cognition token releases',async()=>{
  const {brain,sim}=setup();const done=sim.bootstrap();sim.pause();sim.pause('APP_BACKGROUND');brain.accept(0);brain.accept(1);await done;
  assert.equal(sim.status,'READY');assert.equal(sim.step(),false);sim.resume();assert.equal(sim.step(),false);sim.resume('APP_BACKGROUND');
  assert.equal(sim.frame(99999),0);assert.equal(sim.frame(100049),1);
});

test('TM06: stopped requests settle promptly; ignored AbortSignal and late responses cannot commit',async()=>{
  let commits=0;const {brain,sim}=setup({onCommit:()=>{commits++;}});const done=sim.bootstrap();const before=hashCanonical(sim.world);sim.stop();await done;
  brain.accept(0);brain.accept(1);await turn();assert.equal(sim.status,'STOPPED');assert.equal(commits,0);assert.equal(hashCanonical(sim.world),before);assert.equal(sim.step(),false);
});

test('TM06: stale metadata is rejected and cannot become an accepted slot',async()=>{
  const {brain,sim}=setup();const done=sim.bootstrap();brain.accept(0);const p=brain.pending[1];p.resolve({metadata:{...p.request.metadata,generation:999},decision:waitDecision(),source:'MOCK_TEST',model:'fixture'});await done;
  assert.equal(sim.status,'ERROR_PAUSED');assert.deepEqual(sim.barrier!.acceptedAgentIds,['resident-a']);
});

test('TM04/S01: durable commit gate freezes world; storage failure retries same accepted batch',async()=>{
  let attempts=0;const {brain,sim}=setup({onCommit:async()=>{attempts++;if(attempts===1)throw new Error('TEST disk full');}});
  const done=sim.bootstrap();const before=hashCanonical(sim.world);brain.accept(0);brain.accept(1);await done;
  assert.equal(sim.status,'ERROR_PAUSED');assert.equal(hashCanonical(sim.world),before);assert.equal(brain.pending.length,2);
  await sim.retry();assert.equal(sim.status,'RUNNING');assert.equal(brain.pending.length,2);assert.equal(attempts,2);
});

test('TM06: stop during asynchronous durable commit prevents in-memory activation',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const {brain,sim}=setup({onCommit:()=>gate});
  const done=sim.bootstrap();const before=hashCanonical(sim.world);brain.accept(0);brain.accept(1);await turn();assert.equal(sim.status,'COMMITTING');sim.stop();release();await done;assert.equal(sim.status,'STOPPED');assert.equal(hashCanonical(sim.world),before);
});

test('L01 guard: REAL_MODEL mode rejects test decisions instead of silently accepting them',async()=>{
  const {brain,sim}=setup({allowMock:false});const done=sim.bootstrap();brain.accept(0);brain.accept(1);await done;
  assert.equal(sim.status,'ERROR_PAUSED');assert.equal(sim.world.residents.every(r=>r.lastDecision===null),true);
});

test('TM09: invalid immediate heartbeat has bounded attempts, no world advance or fallback',async()=>{
  let requests=0;const provider:BrainProvider={async decide(request){requests++;return {metadata:request.metadata,decision:{...waitDecision(),nextReviewAfterSimMs:0},source:'MOCK_TEST',model:'invalid-fixture'};}};
  const sim=new Simulation(provider,{allowMock:true,maxRetries:2,runId:'invalid-heartbeat'});await sim.bootstrap();assert.equal(requests,6);assert.equal(sim.status,'ERROR_PAUSED');assert.equal(sim.world.tick,0);
});

test('TM01 actual wall-clock 30s freeze with observer heartbeat and multiple active world systems',{skip:process.env.LONG_FREEZE_TEST!=='1',timeout:35000},async()=>{
  const world=createWorld({runId:'real-wait-fixture'});world.tick=100;world.residents[0].plan=[{action:{op:'speak',stage:0,params:{text:'已开始但尚未说完的话',volume:'normal',towardRef:null}},elapsedTicks:10,startedTick:90,emittedChars:0,done:false}];
  world.residents[1].plan=[{action:{op:'wait',stage:0,params:{durationSimMs:10000,scope:'locomotion'}},elapsedTicks:10,startedTick:90,emittedChars:0,done:false}];
  // Explicit fixture intents cover independent movement, mouth, hands and environmental state.
  world.residents[0].known.walk_target={ref:'walk_target',entityId:'tree-west',description:'记得的树',lastPosition:{x:-5,y:0,z:4},lastSeenTick:90,visible:false,recognizedName:null};
  world.residents[0].plan.unshift({action:{op:'walk',stage:0,params:{targetRef:'walk_target',gait:'walk'}},elapsedTicks:10,startedTick:90,emittedChars:0,done:false,targetPosition:{x:-5,y:0,z:4}});
  world.objects[1].position={x:1,y:0,z:1};
  world.residents[1].known.gather_target={ref:'gather_target',entityId:'tree-east',description:'眼前的树',lastPosition:{x:1,y:0,z:1},lastSeenTick:100,visible:true,recognizedName:null};
  world.residents[1].plan=[{action:{op:'gather',stage:0,params:{targetRef:'gather_target',amount:10}},elapsedTicks:10,startedTick:90,emittedChars:0,done:false,targetPosition:{x:1,y:0,z:1}}];
  world.sounds.push({id:'existing-wave',sourceId:'resident-a',position:{x:-1,y:0,z:0},heading:0,text:'之前',volume:'normal',emittedTick:99,deliveredTo:[]});
  const {brain,sim}=setup({world});const done=sim.bootstrap();const frozen=hashCanonical(sim.world);const start=performance.now();let heartbeats=0;
  const heartbeat=setInterval(()=>{heartbeats++;sim.frame(performance.now());getOverlay(sim.world,sim.world.residents[heartbeats%2]);},20);
  try{await new Promise(resolve=>setTimeout(resolve,30010));assert.ok(performance.now()-start>=30000);assert.ok(heartbeats>100);assert.equal(hashCanonical(sim.world),frozen);assert.equal(sim.world.tick,100);brain.accept(0);brain.accept(1);await done;assert.equal(sim.frame(performance.now()),0);assert.equal(sim.world.tick,100);}finally{clearInterval(heartbeat);sim.stop();}
  console.log(JSON.stringify({evidence:'TM01',mode:'MOCK_TEST',wallElapsedMs:Math.round(performance.now()-start),observerHeartbeats:heartbeats,worldTick:sim.world.tick,frozenHash:frozen}));
});

test('D01: explicit Mock greeting traverses seen → frozen decision → positive speech → actual hearing → reply',async()=>{
  const requests:BrainRequest[]=[];const replies=new Set<string>();const commits:number[]=[];
  const provider:BrainProvider={async decide(request){
    validateBrainRequest(request);requests.push(structuredClone(request));
    const id=request.metadata.agentId;let decision=waitDecision();
    const heard=request.context.observations.some(o=>o.modality==='auditory'&&typeof o.detail.heardText==='string'&&o.detail.heardText.includes('早上好'));
    if((id==='resident-a'&&request.metadata.tick===0)||(id==='resident-b'&&heard&&!replies.has(id))){replies.add(id);decision={...decision,actions:[{op:'speak',stage:0,params:{text:'早上好。',volume:'normal',towardRef:null}}]};}
    return {metadata:request.metadata,decision,source:'MOCK_TEST',model:'explicit-greeting-fixture'};
  }};
  const sim=new Simulation(provider,{allowMock:true,maxRetries:0,runId:'greeting-test',onCommit:record=>{commits.push(record.tick);}});await sim.bootstrap();
  assert.equal(sim.world.sounds.length,0);
  for(let i=0;i<50;i++){assert.equal(sim.step(),true);await sim.settled();}
  const bHeard=requests.find(r=>r.metadata.agentId==='resident-b'&&r.context.observations.some(o=>o.detail.heardText?.includes('早上好')))!;
  assert.ok(bHeard);assert.ok(bHeard.metadata.tick>20);
  const soundA=sim.world.sounds.find(s=>s.sourceId==='resident-a')!,soundB=sim.world.sounds.find(s=>s.sourceId==='resident-b')!;
  assert.equal(soundA.emittedTick,20);assert.ok(soundB.emittedTick>bHeard.metadata.tick);
  assert.ok(requests.some(r=>r.metadata.agentId==='resident-a'&&r.metadata.tick>soundB.emittedTick&&r.context.observations.some(o=>o.detail.heardText==='早上好。')));
  assert.ok(commits.includes(bHeard.metadata.tick));sim.stop();
});

test('S01 observer boundary: snapshot failure after durable commit cannot replay or roll back that commit',async()=>{
  let commits=0;let failOnce=true;const {brain,sim}=setup({onCommit:()=>{commits++;},onSnapshot:(_world:unknown,reason:string)=>{if(reason==='commit'&&failOnce){failOnce=false;throw new Error('TEST observer recorder failure');}}});
  const done=sim.bootstrap();brain.accept(0);brain.accept(1);await done;
  assert.equal(commits,1);assert.equal(sim.world.residents.every(r=>r.lastDecision!==null),true);assert.equal(sim.status,'READY');assert.ok(sim.pauseTokens.has('OBSERVER_ERROR'));assert.match(sim.observerError!,/observer recorder/);
  await sim.retry();assert.equal(commits,1);sim.resume('OBSERVER_ERROR');assert.equal(sim.step(),true);
});

test('TM06 gateway identity: new runs cannot reuse a previous run request id',async()=>{
  async function requestsFor(runId:string){const {brain,sim}=setup({runId});const done=sim.bootstrap();const ids=brain.pending.map(p=>p.request.metadata.requestId);brain.accept(0);brain.accept(1);await done;sim.stop();return ids;}
  const first=await requestsFor('run-one'),second=await requestsFor('run-two');assert.equal(new Set([...first,...second]).size,4);for(const id of [...first,...second])assert.match(id,/^[A-Za-z0-9_-]+$/);
});
