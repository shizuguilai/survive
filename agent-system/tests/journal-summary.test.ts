import test from 'node:test';import assert from 'node:assert/strict';
import {summaryInput,restoreSummaries,latestSummary} from '../apps/laya-client/src/journal-summary.ts';
import {validateSummaryContent,validateSummaryRequest,type SummaryRequest} from '../packages/contracts/src/journal-summary.ts';
import {JournalSummaryGateway} from '../services/brain-gateway/src/summary.ts';import {loadConfig} from '../services/brain-gateway/src/gateway.ts';
import {createCampWorld} from '../packages/sim-core/src/world.ts';import {buildContext} from '../packages/sim-core/src/perception.ts';import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import worker from '../services/brain-gateway/src/worker.ts';
function request():SummaryRequest{return {schemaVersion:'1.0.0',requestId:'summary-test',runId:'run',residentId:'resident-a',residentName:'阿林',entries:[{id:'plan',runId:'run',residentId:'resident-a',tick:10,category:'decision',text:'计划建房，尚未执行'},{id:'result',runId:'run',residentId:'resident-a',tick:20,category:'action',text:'采集完成，得到1份木材；房屋还未开始'}]};}
const content=()=>({headline:'获得木材，房屋仍待建',overview:'已获得1份木材，建房仍是计划。',highlights:[{title:'取得木材',detail:'采集得到1份木材',kind:'progress' as const,evidenceIds:['result']}],nextFocus:[{text:'建房目标仍待执行',evidenceIds:['plan']}]});
test('Summary scope isolates resident and run, respects replay cutoff and input bounds',()=>{
 const r=request(),rows=[...r.entries,{...r.entries[1],id:'other',residentId:'resident-b',text:'其他居民秘密'},{...r.entries[1],id:'future',tick:50,text:'未来结果'}];
 const selected=summaryInput(rows,'resident-a','阿林','run',false,20)!;assert.deepEqual(selected.entries.map(e=>e.id),['plan','result']);assert.equal(JSON.stringify(selected).includes('秘密'),false);
 const many=Array.from({length:180},(_,i)=>({...r.entries[1],id:'e'+i,tick:i,text:'字'.repeat(3000)}));const bounded=summaryInput(many,'resident-a','阿林','run',false)!;assert.ok(bounded.entries.length<120);assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).length<220000);assert.equal(bounded.entries.at(-1)!.tick,179);
 assert.equal(summaryInput(rows,'absent','无人','run',false),null);
});
test('Summary rejects foreign records, fabricated citations and plan-only progress',()=>{
 const r=request();assert.throws(()=>validateSummaryRequest({...r,entries:[{...r.entries[0],residentId:'resident-b'}]}));
 assert.throws(()=>validateSummaryContent({...content(),highlights:[{...content().highlights[0],evidenceIds:['secret']} ]},r));
 assert.throws(()=>validateSummaryContent({...content(),highlights:[{...content().highlights[0],evidenceIds:['plan']} ]},r));
 assert.throws(()=>validateSummaryRequest({...r,entries:[r.entries[0],r.entries[0]]}));
});
test('MOCK_UPSTREAM summary real-provider adapter is idempotent and does not mutate world or private context',async()=>{
 const w=createCampWorld(),before=hashCanonical(w),context=hashCanonical(buildContext(w,w.residents[0]));let calls=0;const bodies:any[]=[];
 const gateway=new JournalSummaryGateway(loadConfig({SURVIVE_MODEL_API_KEY:'MOCK_TEST_SECRET'}),async(url,options)=>{calls++;assert.equal(String(url),'https://open.bigmodel.cn/api/paas/v4/chat/completions');bodies.push(JSON.parse(String(options?.body)));return Response.json({choices:[{message:{content:JSON.stringify(content())}}]});});
 const [a,b]=await Promise.all([gateway.summarize(request()),gateway.summarize(request())]);assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(bodies[0].model,'glm-4.5-air');assert.equal(hashCanonical(w),before);assert.equal(hashCanonical(buildContext(w,w.residents[0])),context);
 await assert.rejects(()=>gateway.summarize({...request(),entries:[request().entries[0]]}),/已绑定/);
 const saved=restoreSummaries([{response:a,entries:request().entries,createdAt:new Date().toISOString()}]);assert.equal(saved.length,1);assert.equal(latestSummary(saved,'resident-a','run',19),undefined);assert.ok(latestSummary(saved,'resident-a','run',20));
 assert.equal(restoreSummaries([{response:{...a,source:'MOCK_TEST'},entries:request().entries}]).length,0);
});
test('MOCK_UPSTREAM malformed result is repaired once; failure never becomes a rule summary',async()=>{
 let calls=0;const config=loadConfig({SURVIVE_MODEL_API_KEY:'MOCK_TEST_SECRET'});
 const gateway=new JournalSummaryGateway(config,async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({...content(),highlights:[{...content().highlights[0],evidenceIds:['invented']} ]})}}]});});
 await assert.rejects(()=>gateway.summarize(request()),/证据引用/);assert.equal(calls,2);
 const unauthorized=new JournalSummaryGateway(config,async()=>new Response('secret upstream details',{status:401}));await assert.rejects(()=>unauthorized.summarize(request()),e=>!String(e).includes('secret upstream')&&String(e).includes('401'));
 await assert.rejects(()=>new JournalSummaryGateway(loadConfig({})).summarize(request()),/尚未配置/);
});
test('Hosted summary endpoint shares authentication, origin and bounded JSON gates',async()=>{
 const origin='https://survive.example',env={SURVIVE_MODEL_API_KEY:'',SURVIVE_PUBLIC_PLAY:'true',ASSETS:{fetch:async()=>new Response('static')}};
 const post=(o=origin,body=JSON.stringify(request()))=>new Request(origin+'/api/summarize',{method:'POST',headers:{origin:o,'content-type':'application/json'},body});
 assert.equal((await worker.fetch(post('https://foreign.example'),env)).status,403);
 assert.equal((await worker.fetch(post(),{...env,SURVIVE_PUBLIC_PLAY:'false'})).status,401);
 assert.equal((await worker.fetch(post(origin,'{}'),env)).status,400);
 assert.equal((await worker.fetch(post(),env)).status,503);
});

test('Repetitive sensory records do not push actual progress out of a bounded summary',()=>{
 const r=request();const noisy=[...r.entries,...Array.from({length:400},(_,i)=>({...r.entries[0],id:'sight-'+i,tick:30+i,category:'memory' as const,text:'看到方向变化'}))];
 const input=summaryInput(noisy,'resident-a','阿林','run',false)!;assert.equal(input.entries.length,120);assert.ok(input.entries.some(e=>e.id==='result'));assert.ok(input.entries.some(e=>e.id==='plan'));
});
