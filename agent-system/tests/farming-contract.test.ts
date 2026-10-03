import {test} from 'node:test';
import assert from 'node:assert/strict';
import decisionSchema from '../packages/contracts/schemas/agent-decision.schema.json' with {type:'json'};
import {validateCharacterContext,validateDecision} from '../packages/contracts/src/validation.ts';
import type {Action,BrainRequest,CharacterContext,Decision} from '../packages/contracts/src/types.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {privateAction} from '../packages/sim-core/src/knowledge.ts';
import {loadConfig,RealModelGateway} from '../services/brain-gateway/src/gateway.ts';

function context():CharacterContext{return {
 schemaVersion:'1.0.0',identity:{name:'阿林',background:'营地居民',personality:'勤劳',personalGoal:'照料田地'},experiencedWhen:'白天',body:{hunger:'不饿',fatigue:'精神充足',pain:'无疼痛'},
 currentPlan:{goal:'',actions:[],progress:''},observations:[],memories:[],
 knownTargets:[{ref:'known_field',description:'亲眼看见的待开垦地块',lastObservedWhen:'刚才'},{ref:'known_pond',description:'亲眼看见的池塘',lastObservedWhen:'刚才'}],
 allowedActions:decisionSchema.properties.actions.items.oneOf.map(a=>a.properties.op.const),
};}
const action=(op:string,params:Action['params'],stage=0):Action=>({op,params,stage});
const decision=(...actions:Action[]):Decision=>({schemaVersion:'1.0.0',decisionKind:'replace',goal:'照料田地',reasonBrief:'已观察到地块状态',actions,nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});

test('Farm contracts accept each explicit work phase and bank-side water collection; private plans keep only allowed fields',()=>{
 const c=context();assert.ok(c.allowedActions.length>24);validateCharacterContext(c);
 for(const work of ['till','sow','water']){
  const a=action('farm',{targetRef:'known_field',work});
  assert.deepEqual(validateDecision(decision(a),c).actions,[a]);
  assert.deepEqual(privateAction({...a,params:{...a.params,world:'private global state',moisture:1}}),a);
 }
 const fetch=action('fetch_water',{sourceRef:'known_pond'});
 assert.deepEqual(validateDecision(decision(fetch),c).actions,[fetch]);
 assert.deepEqual(privateAction({...fetch,params:{...fetch.params,amount:100,water:6}}),fetch);
});

test('Farm contracts reject illegal work, invented field or water references and caller-controlled amounts',()=>{
 const c=context();
 for(const work of ['harvest','spawn','water;fill',null,1])assert.throws(()=>validateDecision(decision(action('farm',{targetRef:'known_field',work})),c));
 for(const invalid of [action('farm',{targetRef:'global_unseen_field',work:'till'}),action('fetch_water',{sourceRef:'global_unseen_pond'})])assert.throws(()=>validateDecision(decision(invalid),c),/personal known targets/);
 assert.throws(()=>validateDecision(decision(action('farm',{targetRef:'known_field',work:'water',amount:6})),c),/unexpected property/);
 assert.throws(()=>validateDecision(decision(action('fetch_water',{sourceRef:'known_pond',amount:999})),c),/unexpected property/);
 assert.throws(()=>validateDecision(decision(action('fetch_water',{targetRef:'known_pond'})),c),/sourceRef/);
 c.allowedActions=c.allowedActions.filter(op=>op!=='farm');assert.throws(()=>validateDecision(decision(action('farm',{targetRef:'known_field',work:'sow'})),c),/not available/);
});

test('Farm and fetch_water reserve hands and locomotion within a stage; sequential work and simultaneous speech are valid',()=>{
 const c=context();
 for(const work of [action('farm',{targetRef:'known_field',work:'till'}),action('fetch_water',{sourceRef:'known_pond'})]){
  assert.throws(()=>validateDecision(decision(work,action('walk',{targetRef:'known_field',gait:'walk'})),c),/channel conflict/);
  assert.throws(()=>validateDecision(decision(work,action('farm',{targetRef:'known_field',work:'water'})),c),/channel conflict/);
  assert.doesNotThrow(()=>validateDecision(decision(work,action('speak',{text:'我来照看田地。',volume:'normal',towardRef:null})),c));
 }
 assert.doesNotThrow(()=>validateDecision(decision(action('farm',{targetRef:'known_field',work:'till'}),action('farm',{targetRef:'known_field',work:'sow'},1),action('fetch_water',{sourceRef:'known_pond'},2)),c));
});

test('MOCK_UPSTREAM: farming actions reach the real-provider contract and retain personal-reference boundaries',async()=>{
 const c=context(),d=decision(action('farm',{targetRef:'known_field',work:'till'}));
 const request:BrainRequest={metadata:{runId:'farm-contract',barrierId:'barrier_1',agentId:'resident_1',requestId:'farm_request',generation:1,tick:0,snapshotHash:'frozen_world',contextHash:hashCanonical(c),schemaVersion:'1.0.0'},context:c};
 let captured:any;
 const gateway=new RealModelGateway({...loadConfig({SURVIVE_MODEL_API_KEY:'MOCK_TEST_SECRET'}),retries:0,repairs:0},{fetch:async(_url,init)=>{captured=JSON.parse(String(init.body));return Response.json({choices:[{message:{content:JSON.stringify(d)}}]});}});
 assert.deepEqual((await gateway.decide(request)).decision,d);
 const prompt=captured.messages[0].content as string;
 assert.match(prompt,/圈定种植区只留下待开垦荒地/);assert.match(prompt,/fetch_water\(sourceRef\)/);assert.match(prompt,/缺水时作物停止生长/);
 const shipped=JSON.parse(prompt.split('\n').at(-1)!);
 assert.ok(shipped.properties.actions.items.oneOf.some((a:any)=>a.properties.op.const==='farm'));
 assert.ok(shipped.properties.actions.items.oneOf.some((a:any)=>a.properties.op.const==='fetch_water'));
 assert.equal(captured.messages[1].content.includes('frozen_world'),false);
});
