import test from 'node:test';import assert from 'node:assert/strict';
import {createCampWorld} from '../packages/sim-core/src/world.ts';
import {readWorkbench,finishRecipe,finishBuild,withdraw,gatherPeriod} from '../packages/sim-core/src/workshop.ts';
import {postTask,readBoard,grantKnown} from '../packages/sim-core/src/camp.ts';
import {samplePerception,buildContext} from '../packages/sim-core/src/perception.ts';
import {applyEquipmentAction} from '../packages/sim-core/src/character.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {validateCharacterContext,validateDecision} from '../packages/contracts/src/validation.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
const decision=(actions:any[])=>({schemaVersion:'1.0.0' as const,decisionKind:'replace' as const,goal:'test fixture',reasonBrief:'explicit unit test',actions,nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
const ref=(r:any,id:string)=>Object.values(r.known).find((k:any)=>k.entityId===id) as any;
function setup(){const w=createCampWorld(),r=w.residents[0],bench=w.objects.find(o=>o.kind==='workbench')!;r.position={...bench.position};grantKnown(r,bench.id,bench.appearance,bench.position,0);return {w,r,bench,station:ref(r,bench.id).ref};}
test('Recipes are learned privately by reading, never provided as free starter tools',()=>{
 const {w,r,bench}=setup(),other=w.residents[1];other.position={x:40,y:0,z:40};samplePerception(w);const before=hashCanonical(buildContext(w,other));
 assert.equal(r.character!.inventory.items.some(i=>i.catalogId==='stone_axe'),false);assert.ok(!buildContext(w,r).allowedActions.includes('craft'));
 readWorkbench(w,r,bench);const c=buildContext(w,r);validateCharacterContext(c);assert.ok(c.allowedActions.includes('craft'));assert.equal(c.knownTargets.filter(t=>t.description.includes('stationRef为本人已知工作台')).length,5);assert.equal(hashCanonical(buildContext(w,other)),before);
 const recipe=ref(r,'recipe:stone_axe').ref;assert.throws(()=>validateDecision(decision([{op:'craft',stage:0,params:{stationRef:'foreign',recipeRef:recipe}}]),c));
});
test('Craft preflights distance, ingredients and item capacity; no payment on failure',()=>{
 const {w,r,bench,station}=setup();readWorkbench(w,r,bench);const recipe=ref(r,'recipe:stone_axe').ref;r.supplies={wood:2,stone:2};r.inventory=4;
 let hash=hashCanonical(r);assert.ok(finishRecipe(w,r,station,recipe,'craft'));assert.equal(hashCanonical(r),hash);
 r.supplies.stone=3;r.inventory=5;r.position.x+=20;hash=hashCanonical(r);assert.ok(finishRecipe(w,r,station,recipe,'craft'));assert.equal(hashCanonical(r),hash);
 r.position={...bench.position};r.character!.inventory.baseCapacity=1;hash=hashCanonical(r);assert.ok(finishRecipe(w,r,station,recipe,'craft'));assert.equal(hashCanonical(r),hash);
 r.character!.inventory.baseCapacity=6;assert.equal(finishRecipe(w,r,station,recipe,'craft'),null);assert.equal(r.inventory,0);assert.equal(r.character!.inventory.items.filter(i=>i.catalogId==='stone_axe').length,1);
});
test('Only an actually equipped, owned tool speeds gathering and receipts report actual units',()=>{
 const {w,r,bench,station}=setup();readWorkbench(w,r,bench);r.supplies={wood:2,stone:3};r.inventory=5;finishRecipe(w,r,station,ref(r,'recipe:stone_axe').ref,'craft');
 assert.equal(gatherPeriod(r,'wood'),20);const tool=r.character!.inventory.items.find(i=>i.catalogId==='stone_axe')!,equipped=applyEquipmentAction(r,{type:'equip_item',itemRef:tool.itemRef});assert.ok(equipped.ok);r.character=equipped.resident.character;
 assert.equal(gatherPeriod(r,'wood'),12);assert.equal(gatherPeriod(w.residents[1],'wood'),20);
 const tree=w.objects.find(o=>o.kind==='tree')!;r.position={...tree.position};const target=grantKnown(r,tree.id,tree.appearance,tree.position,w.tick);
 applyDecision(r,decision([{op:'gather',stage:0,params:{targetRef:target.ref,amount:2}}]),0);for(let t=1;t<=24;t++){w.tick=t;stepActions(w,t);}
 assert.equal(r.supplies.wood,2);assert.equal(r.plan[0].producedUnits,2);assert.ok(r.memories.some(m=>m.text.includes('本次采集2份')));
});
test('Exchange and withdrawals conserve materials and cannot multiply stock',()=>{
 const {w,r,bench,station}=setup();readWorkbench(w,r,bench);r.supplies={wood:3};r.inventory=3;assert.equal(finishRecipe(w,r,station,ref(r,'recipe:wood_to_stone').ref,'exchange'),null);assert.deepEqual(r.supplies,{wood:0,stone:2});assert.equal(r.inventory,2);
 const before=hashCanonical(r);assert.ok(finishRecipe(w,r,station,ref(r,'recipe:wood_to_stone').ref,'exchange'));assert.equal(hashCanonical(r),before);
 const board=w.objects.find(o=>o.kind==='board')!;r.position={...board.position};readBoard(w,r,board);w.camp!.stock={wood:2};assert.equal(withdraw(w,r,ref(r,board.id).ref,'wood',2),null);assert.equal(w.camp!.stock.wood,0);assert.equal(r.supplies.wood,2);assert.ok(withdraw(w,r,ref(r,board.id).ref,'wood',1));
});
test('Personally read stock survives a new visual scan; task references are not notice entities',()=>{
 const w=createCampWorld(),r=w.residents[0],board=w.objects.find(o=>o.kind==='board')!;w.camp!.stock={food:19};readBoard(w,r,board);samplePerception(w);
 assert.ok(buildContext(w,r).memories.some(m=>m.text.includes('公共仓储库存：19浆果')));assert.ok(!buildContext(w,w.residents[1]).memories.some(m=>m.text.includes('19浆果')));
 const taskRef=ref(r,w.camp!.tasks[0].id).ref;applyDecision(r,decision([{op:'read_notice',stage:0,params:{noticeRef:taskRef}}]),0);stepActions(w,1);assert.ok(r.actionFeedback.some(f=>f.includes('这个引用不是公告板')));
});
test('House phase order, shared stock and concurrent builders cannot duplicate construction',()=>{
 const w=createCampWorld();postTask(w,{kind:'house',resource:'wood',amount:3,siteId:'east',note:'test'});const task=w.camp!.tasks.at(-1)!,plot=w.objects.find(o=>o.projectId===task.id)!;w.camp!.stock={wood:12,stone:8};
 for(const r of w.residents){readBoard(w,r,w.objects.find(o=>o.kind==='board')!);task.acceptedBy.push(r.id);r.position={...plot.position};validateCharacterContext(buildContext(w,r));}
 const [a,b]=w.residents;let before=hashCanonical(w);assert.ok(finishBuild(w,a,ref(a,task.id).ref,ref(a,task.id+':roof').ref));assert.equal(hashCanonical(w),before);
 assert.equal(finishBuild(w,a,ref(a,task.id).ref,ref(a,task.id+':foundation').ref),null);before=hashCanonical(w);assert.ok(finishBuild(w,b,ref(b,task.id).ref,ref(b,task.id+':foundation').ref));assert.equal(hashCanonical(w),before);
 assert.equal(finishBuild(w,b,ref(b,task.id).ref,ref(b,task.id+':walls').ref),null);assert.equal(finishBuild(w,a,ref(a,task.id).ref,ref(a,task.id+':roof').ref),null);
 assert.equal(task.status,'done');assert.equal(plot.kind,'house');assert.deepEqual(w.camp!.stock,{wood:0,stone:0});assert.equal(w.events.filter(e=>e.kind==='construction').length,3);
 assert.throws(()=>postTask(w,{kind:'house',resource:'wood',amount:3,siteId:'east',note:''}),/尚未占用/);
});
test('House posting during model wait cannot mutate time, vitals, stock or construction',async()=>{
 let release!:()=>void;const ready=new Promise<void>(r=>release=r);const sim=new Simulation({async decide(request){await ready;return {metadata:request.metadata,decision:decision([{op:'wait',stage:0,params:{durationSimMs:10000,scope:'hands'}}]),source:'MOCK_TEST',model:'explicit test'};}},{world:createCampWorld(),allowMock:true});
 const pending=sim.bootstrap(),before=hashCanonical(sim.world);sim.queueTask({kind:'house',resource:'wood',amount:3,siteId:'north',note:''});sim.frame(0);sim.frame(60000);assert.equal(hashCanonical(sim.world),before);release();await pending;assert.equal(sim.world.tick,0);assert.equal(sim.world.objects.some(o=>o.kind==='plot'),false);sim.frame(60001);assert.equal(sim.world.tick,0);sim.frame(60051);assert.equal(sim.world.objects.some(o=>o.kind==='plot'),true);sim.stop();
});
