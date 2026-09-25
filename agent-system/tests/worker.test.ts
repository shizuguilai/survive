import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{type WorkerEnv} from '../services/brain-gateway/src/worker.ts';
import {RealModelGateway,loadConfig} from '../services/brain-gateway/src/gateway.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';

const origin='https://survive.example';
const identity={'oai-authenticated-user-id':'mock-dispatch-owner','oai-authenticated-user-email':'owner@example.test'};
function env(key=''):WorkerEnv{return {SURVIVE_MODEL_API_KEY:key,ASSETS:{fetch:async()=>new Response('static laya asset')}};}
function post(body:string,headers:Record<string,string>={}):Request{return new Request(origin+'/api/decide',{method:'POST',headers:{...identity,origin,'content-type':'application/json',...headers},body});}

test('Worker rejects missing identity and cross-origin requests before upstream',async()=>{
  const e=env('MOCK_TEST_SECRET');
  const health=await (await worker.fetch(new Request(origin+'/api/health'),e)).json();
  assert.equal(health.accessMode,'hosted');assert.equal(health.configured,true);assert.equal(health.authenticated,false);
  assert.equal(JSON.stringify(health).includes('MOCK_TEST_SECRET'),false);
  const own=await (await worker.fetch(new Request(origin+'/api/health',{headers:identity}),e)).json();assert.equal(own.authenticated,true);
  assert.equal((await worker.fetch(new Request(origin+'/api/decide',{method:'POST',body:'{}'}),e)).status,401);
  assert.equal((await worker.fetch(post('{}',{origin:'https://other.example'}),e)).status,403);
  assert.equal((await worker.fetch(post('{}',{'content-type':'text/plain'}),e)).status,415);
  assert.equal((await worker.fetch(post('invalid'),e)).status,400);
  assert.equal((await worker.fetch(post('x'.repeat(256001)),e)).status,413);
  assert.equal((await worker.fetch(post('{}'),e)).status,400);
  assert.equal(await (await worker.fetch(new Request(origin+'/'),e)).text(),'static laya asset');
});

test('MOCK_UPSTREAM: provider 401 is not retried or exposed and freezes both residents',async()=>{
  let calls=0;const gateway=new RealModelGateway(loadConfig({SURVIVE_MODEL_API_KEY:'MOCK_TEST_SECRET'}),{fetch:async()=>{calls++;return new Response('private provider details MOCK_TEST_SECRET',{status:401});}});
  const sim=new Simulation(gateway,{maxRetries:0});const pending=sim.bootstrap();const before=structuredClone(sim.world);
  await pending;assert.equal(calls,2);assert.equal(sim.status,'ERROR_PAUSED');
  assert.deepEqual(sim.world,before);assert.equal(sim.step(),false);
  const errors=JSON.stringify(sim.barrier?.errors);assert.ok(errors.includes('HTTP 401'));assert.ok(!errors.includes('MOCK_TEST_SECRET'));assert.ok(!errors.includes('private provider details'));
  sim.stop();
});


test('PUBLIC_PLAY: anonymous visitors can start only with explicit server opt-in; origin and contract checks remain',async()=>{
  const e={...env('MOCK_TEST_SECRET'),SURVIVE_PUBLIC_PLAY:'true'};
  const health=await (await worker.fetch(new Request(origin+'/api/health'),e)).json();
  assert.equal(health.authenticated,false);assert.equal(health.canStart,true);assert.equal(health.publicPlay,true);
  assert.equal(JSON.stringify(health).includes('MOCK_TEST_SECRET'),false);
  const anonymous=(source:string)=>new Request(origin+'/api/decide',{method:'POST',headers:{origin:source,'content-type':'application/json'},body:'{}'});
  assert.equal((await worker.fetch(anonymous('https://other.example'),e)).status,403);
  // Reaches strict contract validation rather than failing identity (no upstream call).
  assert.equal((await worker.fetch(anonymous(origin),e)).status,400);
  const closed={...e,SURVIVE_PUBLIC_PLAY:'false'};
  assert.equal((await (await worker.fetch(new Request(origin+'/api/health'),closed)).json()).canStart,false);
  assert.equal((await worker.fetch(anonymous(origin),closed)).status,401);
});

test('Commander route enforces the same authorization, origin and input bounds as resident route',async()=>{
 const e=env('');
 assert.equal((await worker.fetch(new Request(origin+'/api/command',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}),e)).status,401);
 assert.equal((await worker.fetch(new Request(origin+'/api/command',{method:'POST',headers:{...identity,origin:'https://elsewhere.example','content-type':'application/json'},body:'{}'}),e)).status,403);
 assert.equal((await worker.fetch(new Request(origin+'/api/command',{method:'POST',headers:{...identity,origin,'content-type':'application/json'},body:'{}'}),e)).status,400);
});
