import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SimulationClock} from '../packages/sim-core/src/clock.ts';
import {createWorld} from '../packages/sim-core/src/world.ts';
import {samplePerception,buildContext,getOverlay} from '../packages/sim-core/src/perception.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {validateCharacterContext} from '../packages/contracts/src/validation.ts';
import {validateBrainRequest} from '../packages/contracts/src/validation.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import type {Action,Decision,BrainProvider,BrainResponse} from '../packages/contracts/src/types.ts';

const decision=(actions:Action[]):Decision=>({schemaVersion:'1.0.0',decisionKind:'replace',goal:'完成已经决定的行动',reasonBrief:'根据自己已知的信息',actions,nextReviewAfterSimMs:5000,watch:[],memorySuggestions:[]});

test('integration: nested pause tokens survive release and runtime waiting is never caught up',()=>{
  const clock=new SimulationClock();let ticks=0;
  const step=()=>{ticks++;return true;};
  clock.frame(0,step);clock.frame(50,step);assert.equal(ticks,1);
  clock.acquire('COGNITION:b1');clock.acquire('USER_PAUSE');
  clock.frame(120000,step);clock.release('COGNITION:b1');
  clock.frame(180000,step);assert.equal(ticks,1);assert.equal(clock.paused,true);
  clock.release('USER_PAUSE');clock.frame(240000,step);assert.equal(ticks,1);
  clock.frame(240050,step);assert.equal(ticks,2);
});

test('integration: barrier acquired during a tick prevents the same frame remainder advancing',()=>{
  const clock=new SimulationClock();let ticks=0;
  clock.frame(0,()=>true);
  assert.equal(clock.frame(250,()=>{ticks++;clock.acquire('COGNITION:new');return true;}),1);
  assert.equal(ticks,1);clock.release('COGNITION:new');
  clock.frame(100000,()=>{ticks++;return true;});assert.equal(ticks,1);
});

test('integration: model DTO stays closed, preserves its own current action fields and leaks no global entity ids',()=>{
  const world=createWorld({runId:'qa-private-context'});samplePerception(world);
  const resident=world.residents[0];const target=Object.values(resident.known).find(k=>k.entityId===world.residents[1].id)!;
  applyDecision(resident,decision([{op:'walk',stage:0,params:{targetRef:target.ref,gait:'walk'}},{op:'wait',stage:1,params:{scope:'locomotion',durationSimMs:500}}]),0);
  const context=buildContext(world,resident);validateCharacterContext(context);
  assert.deepEqual(context.currentPlan.actions,resident.plan.map(p=>p.action));
  const payload=JSON.stringify(context);
  for(const id of [...world.residents.map(r=>r.id),...world.objects.map(o=>o.id)])assert.equal(payload.includes(id),false,`global id leaked: ${id}`);
  for(const forbidden of ['snapshotHash','worldRevision','requestId','barrierId','rngState','lastPosition','ownerId'])assert.equal(payload.includes(`"${forbidden}"`),false,forbidden);
});

test('integration: changing unobserved identity, position and private memory cannot change another resident input',()=>{
  const world=createWorld({runId:'qa-hidden-context'});const a=world.residents[0],b=world.residents[1];
  b.position={x:0,y:0,z:-8};world.tick=4;samplePerception(world);
  const before=JSON.stringify(buildContext(world,a));
  b.position={x:1,y:0,z:-12};b.name='隐藏身份';b.personalGoal='隐藏打算';b.memories.push({ref:'hidden_secret',kind:'direct',text:'隐藏私人经历',evidenceRefs:[],experiencedWhen:'以前'});
  if(b.character)b.character.inventory.items=[];
  samplePerception(world);assert.equal(JSON.stringify(buildContext(world,a)),before);
});

test('integration: a last-known walk target cannot track the hidden entity behind the wall',()=>{
  const world=createWorld({runId:'qa-last-known'});samplePerception(world);
  const a=world.residents[0],b=world.residents[1];const known=Object.values(a.known).find(k=>k.entityId===b.id)!;
  const lastObserved={...known.lastPosition};b.position={x:0,y:0,z:-8};world.tick=4;samplePerception(world);
  assert.equal(known.visible,false);
  applyDecision(a,decision([{op:'walk',stage:0,params:{targetRef:known.ref,gait:'walk'}}]),world.tick);
  stepActions(world,5);assert.deepEqual(a.plan[0].targetPosition,lastObserved);
  b.position={x:10,y:0,z:-10};stepActions(world,6);assert.deepEqual(a.plan[0].targetPosition,lastObserved);assert.equal(a.position.z,0);
});

test('integration: observers are read-only and speech starts after commit with only emitted fragments audible',()=>{
  const world=createWorld({runId:'qa-speech'});samplePerception(world);
  const [a,b]=world.residents;const text='早上好，最后四字';
  applyDecision(a,decision([{op:'speak',stage:0,params:{text,volume:'normal'}}]),0);
  assert.equal(world.sounds.length,0);
  const before=JSON.stringify(world);for(let n=0;n<10;n++)getOverlay(world,a);assert.equal(JSON.stringify(world),before);
  for(let tick=1;tick<=20;tick++){stepActions(world,tick);world.tick=tick;samplePerception(world);}
  const emitted=world.sounds.map(s=>s.text).join('');assert.equal(emitted,'早上好，');
  const heardBefore=b.observations.filter(o=>o.modality==='auditory').map(o=>o.detail.heardText??'').join('');assert.equal(heardBefore,'');
  for(let tick=21;tick<=24;tick++){stepActions(world,tick);world.tick=tick;samplePerception(world);}
  const heard=b.observations.filter(o=>o.modality==='auditory').map(o=>o.detail.heardText??'').join('');
  assert.equal(heard,'早上好，');assert.equal(heard.includes('最后'),false);
});

test('integration: full gateway DTO validates for each independent resident and persistence gates atomic model intents',async()=>{
  let release!:()=>void;const persisted=new Promise<void>(resolve=>{release=resolve;});
  const calls:string[]=[];
  const provider:BrainProvider={async decide(request){
    validateBrainRequest(request);calls.push(request.metadata.agentId);
    return {metadata:request.metadata,decision:decision([{op:'wait',stage:0,params:{scope:'locomotion',durationSimMs:5000}}]),source:'MOCK_TEST',model:'explicit-integration-fixture'};
  }};
  const sim=new Simulation(provider,{runId:'qa-atomic',allowMock:true,maxRetries:0,onCommit:()=>persisted});
  const work=sim.bootstrap();const frozen=JSON.stringify(sim.world);
  for(let n=0;n<8&&sim.status==='THINKING';n++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(sim.status,'COMMITTING');assert.equal(calls.length,2);assert.equal(new Set(calls).size,2);
  sim.frame(0);sim.frame(600000);assert.equal(JSON.stringify(sim.world),frozen);assert.ok(sim.world.residents.every(r=>r.plan.length===0));
  sim.pause('USER_PAUSE');release();await work;
  assert.equal(sim.world.tick,0);assert.ok(sim.world.residents.every(r=>r.plan.length===1));assert.equal(sim.paused,true);
  sim.resume('USER_PAUSE');sim.frame(700000);assert.equal(sim.world.tick,0);sim.frame(700050);assert.equal(sim.world.tick,1);
});

test('integration: cancellation rejects even a provider that ignores AbortSignal and replies late',async()=>{
  const responses:(()=>void)[]=[];let commits=0;
  const provider:BrainProvider={decide(request){return new Promise<BrainResponse>(resolve=>responses.push(()=>resolve({metadata:request.metadata,decision:decision([{op:'wait',stage:0,params:{scope:'locomotion',durationSimMs:5000}}]),source:'MOCK_TEST',model:'explicit-late-fixture'})));}};
  const sim=new Simulation(provider,{runId:'qa-cancel',allowMock:true,maxRetries:0,onCommit:()=>{commits++;}});
  const work=sim.bootstrap();const frozen=JSON.stringify(sim.world);assert.equal(responses.length,2);
  sim.stop();for(const respond of responses)respond();await work;
  assert.equal(sim.status,'STOPPED');assert.equal(commits,0);assert.equal(JSON.stringify(sim.world),frozen);sim.frame(900000);assert.equal(sim.world.tick,0);
});
