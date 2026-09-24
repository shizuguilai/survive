import test from 'node:test';
import assert from 'node:assert/strict';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {validateDecision,validateCharacterContext,validateBrainRequest} from '../packages/contracts/src/validation.ts';
import type {BrainRequest,CharacterContext,Decision} from '../packages/contracts/src/types.ts';
import {loadConfig,RealModelGateway} from '../services/brain-gateway/src/gateway.ts';
import {createGatewayServer} from '../services/brain-gateway/src/server.ts';

function context(name='阿林'):CharacterContext{return {schemaVersion:'1.0.0',identity:{name,background:'住在营地',personality:'友善',personalGoal:'和熟人见面'},experiencedWhen:'清晨',body:{hunger:'不饿',fatigue:'精神良好',pain:'无疼痛'},currentPlan:{goal:'',actions:[],progress:''},observations:[{obsRef:'obs_1',experiencedWhen:'清晨',certainty:'clear',modality:'visual',detail:{level:'recognized',relativeDirection:'front',distanceBand:'near',appearance:['穿着衣服'],recognizedName:'熟人',knownRef:'known_1'}}],memories:[],knownTargets:[{ref:'known_1',description:'熟人',lastObservedWhen:'清晨'},{ref:'item_1',description:'本人持有的帽子，可装备head',lastObservedWhen:'现在'}],allowedActions:['walk','speak','wait','continue','equip_item','unequip_item']};}
function request(name='阿林',id='r1'):BrainRequest{const ctx=context(name);return {metadata:{runId:'test-run',barrierId:'barrier_1',agentId:name==='阿林'?'resident_1':'resident_2',requestId:id,generation:1,tick:0,snapshotHash:'test-snapshot',contextHash:hashCanonical(ctx),schemaVersion:'1.0.0'},context:ctx};}
function decision():Decision{return {schemaVersion:'1.0.0',decisionKind:'replace',goal:'问好',reasonBrief:'看见熟人',actions:[{op:'speak',stage:0,params:{text:'早上好',volume:'normal',towardRef:'known_1'}}],nextReviewAfterSimMs:2000,watch:[],memorySuggestions:[{kind:'belief',text:'熟人在附近',evidenceRefs:['obs_1']}]};}
const config=()=>({...loadConfig({SURVIVE_MODEL_API_KEY:'MOCK_TEST_SECRET'}),timeoutMs:2000});
const response=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status:200});

test('T03 strict schemas reject world DTO leaks, unknown refs, fabricated evidence and conflicts',()=>{
  assert.ok(validateCharacterContext(context()));assert.ok(validateDecision(decision(),context()));
  assert.throws(()=>validateCharacterContext({...context(),world:{secret:true}}),/unexpected property/);
  const leak=context();leak.observations[0].detail.worldId='resident_secret';assert.throws(()=>validateCharacterContext(leak),/allowed shape/);
  const unknown=decision();unknown.actions[0].params.towardRef='secret_global';assert.throws(()=>validateDecision(unknown,context()),/personal known targets/);
  const memory=decision();memory.memorySuggestions[0].evidenceRefs=['never_observed'];assert.throws(()=>validateDecision(memory,context()),/personal evidence/);
  const conflict=decision();conflict.actions.push(structuredClone(conflict.actions[0]));assert.throws(()=>validateDecision(conflict,context()),/channel conflict/);
  const valid=decision();valid.actions.push({op:'walk',stage:0,params:{targetRef:'known_1',gait:'walk'}});assert.ok(validateDecision(valid,context()));
  const equip=decision();equip.actions=[{op:'equip_item',stage:0,params:{itemRef:'item_1',slot:'head'}}];assert.ok(validateDecision(equip,context()));equip.actions[0].params.itemRef='global_item_1';assert.throws(()=>validateDecision(equip,context()));
  const tampered=request();tampered.context.identity.name='另一个人';assert.throws(()=>validateBrainRequest(tampered),/fingerprint/);
});
test('T09 unconfigured real gateway fails closed without any network or synthetic decision',async()=>{
  let calls=0;const gateway=new RealModelGateway(loadConfig({}),{fetch:async()=>{calls++;return response(decision());}});
  await assert.rejects(gateway.decide(request()),/尚未配置真实模型密钥/);assert.equal(calls,0);
  assert.throws(()=>loadConfig({SURVIVE_MODEL_BASE_URL:'http://127.0.0.1:9999'}),/允许清单/);
  assert.throws(()=>loadConfig({SURVIVE_MODEL_NAME:'glm-4.5'}),/允许清单/);
});
test('MOCK_UPSTREAM: individual prompts exclude metadata and other resident, request IDs deduplicate',async()=>{
  const prompts:any[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  let bothStarted!:()=>void;const ready=new Promise<void>(r=>bothStarted=r);
  const gateway=new RealModelGateway(config(),{fetch:async(_url,init)=>{prompts.push(JSON.parse(String(init.body)));if(prompts.length===2)bothStarted();await gate;return response(decision());}});
  const a=request(),b=request('小禾','r2');const pending=[gateway.decide(a),gateway.decide(a),gateway.decide(b)];
  await ready;
  for(const prompt of prompts){assert.equal(prompt.model,'glm-4.5-air');assert.deepEqual(prompt.thinking,{type:'disabled'});assert.equal(prompt.max_tokens,4096);}
  assert.equal(prompts.length,2);assert.equal(JSON.stringify(prompts[0]).includes('requestId'),false);const promptA=prompts.find(p=>JSON.parse(p.messages[1].content).identity.name==='阿林'),promptB=prompts.find(p=>JSON.parse(p.messages[1].content).identity.name==='小禾');assert.ok(promptA&&promptB);assert.equal(promptA.messages[1].content.includes('小禾'),false);assert.equal(promptB.messages[1].content.includes('阿林'),false);
  await assert.rejects(gateway.decide({...a,metadata:{...a.metadata,requestId:'r3'}}),/已有独立模型请求/);
  const mismatch=structuredClone(a);mismatch.metadata.tick++;await assert.rejects(gateway.decide(mismatch),/绑定其他冻结上下文/);
  release();const results=await Promise.all(pending);assert.deepEqual(results[0],results[1]);assert.equal(results[0].source,'REAL_MODEL');
  // Test injection fakes HTTP, so this does NOT count as real-model acceptance.
  assert.equal(prompts.length,2);
});
test('MOCK_UPSTREAM: bounded format repair, sanitized errors and same-snapshot retry',async()=>{
  let calls=0;const audit:any[]=[];let valid=false;
  const gateway=new RealModelGateway({...config(),retries:0},{fetch:async()=>{calls++;return response(valid?decision():{secret:'sensitive_provider_content'});},audit:r=>audit.push(r)});
  await assert.rejects(gateway.decide(request()),/修复次数已耗尽/);assert.equal(calls,3);assert.equal(audit[0].accepted,false);assert.equal(JSON.stringify(audit).includes('sensitive_provider_content'),false);
  valid=true;await gateway.decide(request());assert.equal(calls,4);assert.equal(audit[1].accepted,true);
  let errors=0;const httpGateway=new RealModelGateway(config(),{fetch:async()=>{errors++;return new Response('MOCK_TEST_SECRET private body',{status:503});}});
  await assert.rejects(httpGateway.decide(request()),error=>error instanceof Error&&!error.message.includes('SECRET')&&!error.message.includes('private'));assert.equal(errors,3);
});
test('MOCK_UPSTREAM: deadline cancels pending I/O and never emits accepted intent',async()=>{
  const gateway=new RealModelGateway({...config(),timeoutMs:20},{fetch:async(_url,init)=>new Promise((_resolve,reject)=>{init.signal?.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});})});
  // Keep event loop alive: AbortSignal.timeout intentionally uses an unref timer.
  const keep=setTimeout(()=>{},1000);try{await assert.rejects(gateway.decide(request()),/超时/);}finally{clearTimeout(keep);}
});
test('MOCK_UPSTREAM: continue repair explains the protocol and never rewrites model output',async()=>{
  const ctx=request();ctx.context.currentPlan.actions=[{op:'walk',stage:0,params:{targetRef:'known_1',gait:'walk'}}];ctx.metadata.contextHash=hashCanonical(ctx.context);
  const invalid=decision();invalid.decisionKind='continue';
  const corrected=decision();corrected.decisionKind='continue';corrected.actions=[{op:'continue',stage:0,params:{}}];
  const prompts:any[]=[];const audits:any[]=[];
  const gateway=new RealModelGateway(config(),{fetch:async(_url,init)=>{prompts.push(JSON.parse(String(init.body)));return response(prompts.length===1?invalid:corrected);},audit:r=>audits.push(r)});
  const result=await gateway.decide(ctx);
  assert.equal(prompts.length,2);assert.deepEqual(result.decision,corrected);
  assert.ok(prompts[1].messages.at(-1).content.includes('exactly one action'));
  assert.equal(audits[0].validationIssues.length,1);assert.equal(audits[0].repairs,1);
});
test('T09 HTTP local one-time session, hostile origin and unauthenticated decide rejected',async()=>{
  const gateway=new RealModelGateway(loadConfig({}));const {server}=createGatewayServer({gateway,loginToken:'test-session-token'});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
  try{
    const health=await (await fetch(base+'/api/health')).json();assert.equal(health.configured,false);assert.equal(health.authenticated,false);assert.equal(JSON.stringify(health).includes('apiKey'),false);
    assert.equal((await fetch(base+'/api/decide',{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{origin:'https://evil.example'},body:JSON.stringify({token:'test-session-token'})})).status,403);
    const login=await fetch(base+'/api/session',{method:'POST',body:JSON.stringify({token:'test-session-token'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);
    assert.equal((await fetch(base+'/api/session',{method:'POST',body:JSON.stringify({token:'test-session-token'})})).status,401);
    const local=await (await fetch(base+'/api/health',{headers:{cookie:cookie.split(';')[0]}})).json();assert.equal(local.authenticated,true);
    assert.equal((await fetch(base+'/api/decide',{method:'POST',headers:{cookie:cookie.split(';')[0]},body:JSON.stringify(request())})).status,503);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('Network diagnostics classify runtime failures without logging private errors',async()=>{
  const audits:any[]=[];
  const gateway=new RealModelGateway({...config(),retries:0},{fetch:async()=>{throw new TypeError('Illegal invocation: incorrect this reference MOCK_TEST_SECRET private details');},audit:r=>audits.push(r)});
  await assert.rejects(gateway.decide(request()),/网络请求失败/);
  assert.deepEqual(audits[0].networkIssues,['FETCH_INVALID_RECEIVER']);
  assert.equal(JSON.stringify(audits).includes('MOCK_TEST_SECRET'),false);
  assert.equal(JSON.stringify(audits).includes('private details'),false);
});

test('Default upstream fetch keeps the global receiver required by Workers',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async function(this:unknown){assert.equal(this,globalThis);calls++;return response(decision());};
  try{const gateway=new RealModelGateway(config());assert.equal((await gateway.decide(request())).source,'REAL_MODEL');assert.equal(calls,1);}
  finally{globalThis.fetch=original;}
});

test('Workers-compatible manual redirect mode never forwards model credentials',async()=>{
  let calls=0;
  const gateway=new RealModelGateway(config(),{fetch:async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://untrusted.example'}});}});
  await assert.rejects(gateway.decide(request()),/重定向/);assert.equal(calls,1);
});
