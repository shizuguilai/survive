import test from 'node:test';import assert from 'node:assert/strict';
import {ResidentJournal,selectJournal,JOURNAL_LIMIT} from '../apps/laya-client/src/journal.ts';
import {createCampWorld} from '../packages/sim-core/src/world.ts';import {ownReceipt} from '../packages/sim-core/src/camp.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';import {buildContext} from '../packages/sim-core/src/perception.ts';
test('History is observer-only, distinguishes intention/results, and survives a storage round-trip',()=>{
 const w=createCampWorld(),r=w.residents[0],j=new ResidentJournal(),before=hashCanonical(buildContext(w,r));
 w.events.push({tick:0,agentId:r.id,kind:'decision',source:'REAL_MODEL',text:'计划建房'});j.collect(w);assert.equal(hashCanonical(buildContext(w,r)),before);
 w.tick=20;ownReceipt(r,w,'我的施工行动失败：材料不足，不能当成成功');j.collect(w);const count=j.rows.length;j.collect(w);assert.equal(j.rows.length,count);
 const restored=new ResidentJournal(JSON.parse(JSON.stringify(j.rows)));assert.equal(selectJournal(restored.rows,r.id,'decision').length,1);assert.ok(selectJournal(restored.rows,r.id,'action')[0].text.includes('失败'));assert.equal(selectJournal(restored.rows,w.residents[1].id,'action').length,0);
 assert.equal(selectJournal(restored.rows,r.id,'action',w.runId,0).length,0);
});
test('Changed personal memories retain earlier versions so replay never reveals a future update',()=>{
 const w=createCampWorld(),r=w.residents[0],j=new ResidentJournal();ownReceipt(r,w,'进度1','memory_task_1');j.collect(w);w.tick=100;ownReceipt(r,w,'进度2','memory_task_1');j.collect(w);
 const earlier=selectJournal(j.rows,r.id,'action',w.runId,50);assert.equal(earlier.length,1);assert.equal(earlier[0].text,'进度1');assert.equal(selectJournal(j.rows,r.id,'action')[0].text,'进度2');
});
test('Journal ignores malformed storage and bounds retained rows',()=>{
 assert.equal(new ResidentJournal([{id:'malformed'},null,'wrong']).rows.length,0);
 const j=new ResidentJournal(),w=createCampWorld();for(let i=0;i<JOURNAL_LIMIT+40;i++)w.events.push({tick:i,agentId:'resident-a',kind:'decision',text:'bounded'});j.collect(w);assert.equal(j.rows.length,JOURNAL_LIMIT);
});
