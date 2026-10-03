import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampWorld,createCrewWorld,advanceEnvironment} from '../packages/sim-core/src/world.ts';
import {postTask,grantKnown} from '../packages/sim-core/src/camp.ts';
import {advanceAgriculture,CROP_GROWTH_TICKS,CROP_DRY_TICKS,CROP_YIELD,FARM_WORK_TICKS,FETCH_WATER_TICKS} from '../packages/sim-core/src/agriculture.ts';
import {samplePerception,buildContext} from '../packages/sim-core/src/perception.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {controlSettings} from '../packages/contracts/src/command.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {validateCharacterContext} from '../packages/contracts/src/validation.ts';
import {homeSites,zoneBounds} from '../packages/sim-core/src/housing.ts';
import type {CropKind} from '../packages/sim-core/src/domain.ts';
import type {Decision} from '../packages/contracts/src/types.ts';

const emptyCamp=()=>{const w=createCampWorld();w.objects=w.objects.filter(o=>o.kind==='board');w.camp!.tasks=[];w.residents=w.residents.slice(0,1);w.residents[0].hunger=.1;return w;};
const field={minX:4,maxX:12,minZ:-4,maxZ:4};
const act=(op:string,params:Record<string,unknown>):Decision=>({schemaVersion:'1.0.0',decisionKind:'replace',goal:'农业测试',reasonBrief:'explicit test fixture',actions:[{op,params,stage:0}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});

function runAction(w:ReturnType<typeof emptyCamp>,op:string,params:Record<string,unknown>,limit=300){
 const r=w.residents[0];r.actionFeedback=[];applyDecision(r,act(op,params),w.tick);
 for(let i=0;i<limit&&!r.plan[0].done;i++){w.tick++;stepActions(w,w.tick);}
 return r;
}
function irrigatedGrowth(w:ReturnType<typeof emptyCamp>,crop:ReturnType<typeof emptyCamp>['objects'][number],targetRef:string){
 const r=w.residents[0];
 for(let i=0;i<4000&&crop.crop!.stage!=='mature';i++){
  if((crop.crop!.moisture??0)<=.35){r.water=6;runAction(w,'farm',{targetRef,work:'water'});}
  w.tick++;advanceAgriculture(w);
 }
}
test('Four crop species require actual tilling, sowing and watering before growing; harvested land never auto-replants',()=>{
 for(const kind of ['rice','wheat','corn','carrot'] as CropKind[]){
  const w=emptyCamp(),r=w.residents[0];postTask(w,{kind:'planting',cropKind:kind,bounds:field,resource:'food',amount:1,note:''});
  const crop=w.objects.find(o=>o.kind==='crop')!;
  assert.equal(crop.crop!.stage,'fallow');assert.equal(crop.resources,0);assert.equal(w.camp!.stock!.food,undefined);
  for(let i=0;i<4000;i++){w.tick++;advanceAgriculture(w);}
  assert.equal(crop.crop!.stage,'fallow');assert.equal(crop.crop!.growth,0);assert.equal(crop.resources,0);
  r.position={...crop.position,x:crop.position.x-3};r.heading=0;samplePerception(w);
  const targetRef=Object.values(r.known).find(k=>k.entityId===crop.id)!.ref;
  runAction(w,'farm',{targetRef,work:'till'});assert.match(r.actionFeedback.at(-1)!,/太远/);assert.equal(crop.crop!.stage,'fallow');
  r.position.x=crop.position.x-1.5;
  runAction(w,'farm',{targetRef,work:'sow'});assert.match(r.actionFeedback.at(-1)!,/尚未开垦/);
  runAction(w,'farm',{targetRef,work:'till'},FARM_WORK_TICKS.till-1);assert.equal(crop.crop!.stage,'fallow');w.tick++;stepActions(w,w.tick);assert.equal(crop.crop!.stage,'tilled');
  runAction(w,'farm',{targetRef,work:'sow'});assert.equal(crop.crop!.stage,'sown');assert.equal(crop.crop!.growth,0);
  for(let i=0;i<4000;i++){w.tick++;advanceAgriculture(w);}assert.equal(crop.crop!.stage,'sown');assert.equal(crop.resources,0);
  runAction(w,'farm',{targetRef,work:'water'});assert.match(r.actionFeedback.at(-1)!,/没有携带水/);assert.equal(crop.crop!.stage,'sown');
  r.water=1;runAction(w,'farm',{targetRef,work:'water'},FARM_WORK_TICKS.water-1);assert.equal(crop.crop!.stage,'sown');assert.equal(r.water,1);w.tick++;stepActions(w,w.tick);assert.equal(crop.crop!.stage,'seedling');assert.equal(r.water,0);
  for(let i=0;i<CROP_DRY_TICKS;i++){w.tick++;advanceAgriculture(w);}
  assert.equal(crop.crop!.moisture,0);assert.equal(crop.crop!.stage,'growing');const dryGrowth=crop.crop!.growth;
  for(let i=0;i<5000;i++){w.tick++;advanceAgriculture(w);}assert.equal(crop.crop!.growth,dryGrowth);assert.equal(crop.resources,0);assert.match(crop.appearance,/缺水/);
  irrigatedGrowth(w,crop,targetRef);assert.equal(crop.crop!.stage,'mature');assert.equal(crop.resources,CROP_YIELD[kind]);assert.equal(w.camp!.stock!.food,undefined);
  r.position.x=crop.position.x-3;r.visualSignature='';samplePerception(w);assert.match(r.known[targetRef].description,/已成熟/);validateCharacterContext(buildContext(w,r));
  r.position.x=crop.position.x-1.5;runAction(w,'gather',{targetRef,amount:8});
  assert.equal(r.supplies!.food,CROP_YIELD[kind]);assert.equal(crop.resources,0);assert.equal(crop.crop!.stage,'harvested');assert.equal(crop.crop!.cycles,1);
  for(let i=0;i<8000;i++){w.tick++;advanceAgriculture(w);}assert.equal(crop.crop!.stage,'harvested');assert.equal(crop.crop!.growth,0);assert.equal(crop.resources,0);
  runAction(w,'farm',{targetRef,work:'till'});assert.equal(crop.crop!.stage,'tilled');
  const board=w.objects.find(o=>o.kind==='board')!;r.position={...board.position};samplePerception(w);
  const sourceRef=Object.values(r.known).find(k=>k.entityId===`supply-food-${r.id}`)!.ref,destinationRef=grantKnown(r,board.id,board.appearance,board.position,w.tick).ref;
  runAction(w,'haul',{sourceRef,destinationRef,amount:CROP_YIELD[kind]});assert.equal(w.camp!.stock!.food,CROP_YIELD[kind]);assert.equal(r.inventory,0);
 }
});

test('Water must be fetched from a personally known pond shore over actual simulation time',()=>{
 const w=createCampWorld();w.residents=w.residents.slice(0,1);const r=w.residents[0],pond=w.objects.find(o=>o.kind==='pond')!;
 const sourceRef=grantKnown(r,pond.id,pond.appearance,pond.position,w.tick).ref;
 r.position={...pond.position,x:pond.position.x+10};runAction(w,'fetch_water',{sourceRef});assert.match(r.actionFeedback.at(-1)!,/太远/);assert.equal(r.water,undefined);
 runAction(w,'fetch_water',{sourceRef:'unseen-pond'});assert.match(r.actionFeedback.at(-1)!,/无法确认/);
 r.position={...pond.position,x:pond.position.x+4};runAction(w,'fetch_water',{sourceRef},FETCH_WATER_TICKS-1);assert.equal(r.water,undefined);w.tick++;stepActions(w,w.tick);assert.equal(r.water,6);
 r.position={...pond.position};r.water=0;runAction(w,'fetch_water',{sourceRef});assert.equal(r.water,0);assert.match(r.actionFeedback.at(-1)!,/安全岸边/);
});

test('Typed zones preserve old residential land, reject mixed-use overlaps and do not duplicate sowing',()=>{
 const w=emptyCamp();postTask(w,{kind:'planting',bounds:field,resource:'food',amount:1,note:''});
 const before=hashCanonical(w);postTask(w,{kind:'planting',cropKind:'corn',bounds:field,resource:'food',amount:1,note:''});assert.equal(hashCanonical(w),before);
 for(const kind of ['pasture','residential'] as const)assert.throws(()=>postTask(w,{kind,bounds:field,resource:'food',amount:1,note:''}),/不能重叠/);
 const initial=w.objects.filter(o=>o.kind==='crop').map(o=>o.position);
 postTask(w,{kind:'planting',cropKind:'corn',bounds:{...field,minX:8,maxX:16},resource:'food',amount:1,note:''});
 for(const crop of w.objects.filter(o=>o.kind==='crop'&&o.crop?.kind==='corn'))assert.ok(initial.every(p=>Math.hypot(p.x-crop.position.x,p.z-crop.position.z)>=1.2));
 postTask(w,{kind:'residential',bounds:{minX:20,maxX:32,minZ:-12,maxZ:0},resource:'wood',amount:1,note:''});
 assert.equal(w.camp!.zones!.at(-1)!.kind,undefined,'old residential shape remains supported');
 assert.ok(homeSites(w,field).length===0,'agriculture cannot become house sites even when crops have no food');
 assert.deepEqual(zoneBounds({x:-100,z:-100},{x:100,z:100}),{minX:-47,maxX:47,minZ:-47,maxZ:47});
 assert.throws(()=>postTask(w,{kind:'pasture',bounds:{minX:-2,maxX:4,minZ:-2,maxZ:4},resource:'food',amount:1,note:''}),/设施/);
});

test('Poultry moves deterministically within pasture bounds and uses walk, peck, idle and flap states',()=>{
 const w=emptyCamp();postTask(w,{kind:'pasture',bounds:{minX:16,maxX:28,minZ:12,maxZ:24},resource:'food',amount:1,note:''});
 const birds=w.objects.filter(o=>o.kind==='animal'),copy=structuredClone(w),start=birds.map(o=>({...o.position})),activities=new Set<string>();
 assert.equal(birds.length,9);assert.deepEqual(new Set(birds.map(o=>o.animal!.kind)),new Set(['chicken','duck','goose']));
 for(let tick=1;tick<=4000;tick++){
  w.tick=copy.tick=tick;advanceAgriculture(w);advanceAgriculture(copy);
  for(const bird of birds){assert.ok(bird.position.x>=16.9&&bird.position.x<=27.1&&bird.position.z>=12.9&&bird.position.z<=23.1);activities.add(bird.animal!.activity);}
 }
 assert.deepEqual(activities,new Set(['walk','peck','idle','flap']));assert.equal(hashCanonical(w),hashCanonical(copy));assert.ok(birds.some((o,i)=>Math.hypot(o.position.x-start[i].x,o.position.z-start[i].z)>1));assert.equal(w.camp!.stock!.food,undefined);
});

test('The local planner works untouched new farmland in a normal camp, fetches water, grows crops, harvests and hauls without remote calls',async()=>{
 const w=createCrewWorld(2);postTask(w,{kind:'planting',cropKind:'carrot',bounds:{minX:5,maxX:9,minZ:7,maxZ:11},resource:'food',amount:1,note:''});
 const p=new ColonyProvider(controlSettings({mode:'local',residents:2}),{async plan(){throw Error('must remain local');}}),sim=new Simulation(p,{world:w,controlMode:'local'});await sim.bootstrap();
 for(let i=0;i<12000&&!(sim.world.objects.some(o=>(o.crop?.cycles??0)>=1)&&(sim.world.camp!.stock!.food??0)>0&&sim.world.events.some(e=>e.kind==='action_completed'&&e.text==='haul'&&e.agentId===sim.world.residents[0].id));i++){if(sim.paused)await sim.settled();else sim.step();}
 assert.notEqual(sim.status,'ERROR_PAUSED',JSON.stringify(sim.barrier?.errors));
 const events=sim.world.events.filter(e=>e.kind==='action_completed').map(e=>e.text);
 assert.ok((sim.world.camp!.stock!.food??0)>0,JSON.stringify({tick:sim.world.tick,stock:sim.world.camp!.stock,events:events.slice(-30),farm:sim.world.objects.filter(o=>o.crop).map(o=>({id:o.id,crop:o.crop})),residents:sim.world.residents.map(r=>({id:r.id,pos:r.position,goal:r.goal,plan:r.plan,feedback:r.actionFeedback,known:Object.values(r.known).filter(k=>k.entityId.includes('crop')||k.entityId.includes('pond'))}))}));
 assert.ok(sim.world.objects.some(o=>(o.crop?.cycles??0)>=1),'at least one actual farm patch must be harvested; wild berries do not satisfy this test');assert.equal(p.remoteCalls,0);assert.ok(events.includes('farm'));assert.ok(events.includes('fetch_water'));assert.ok(events.includes('gather'));assert.ok(events.includes('haul'));
 sim.pause('TEST');const paused=hashCanonical(sim.world);sim.frame(500000);sim.frame(900000);assert.equal(hashCanonical(sim.world),paused);sim.stop();
});

test('Two residents keep a farmer and a worker for other camp tasks, and later farm phases rotate fields',async()=>{
 const w=createCrewWorld(2);postTask(w,{kind:'planting',bounds:{minX:5,maxX:9,minZ:7,maxZ:11},resource:'food',amount:1,note:''});
 const farmId=w.camp!.tasks.at(-1)!.id,otherId=w.camp!.tasks[0].id;
 const p=new ColonyProvider(controlSettings({mode:'local',residents:2}),{async plan(){throw Error('no remote');}}),sim=new Simulation(p,{world:w,controlMode:'local'});await sim.bootstrap();
 assert.match(sim.world.residents[0].goal,/种植区/);assert.match(sim.world.residents[1].goal,/木材/);
 const report=(p as any).report(sim.world),initial=(p as any).localPlan(report);assert.equal(initial.assignments[0].objective,farmId);assert.equal(initial.assignments[1].objective,otherId);
 report.tasks.unshift({id:'older-field',title:'种植区 · 水稻',progress:0,amount:4});
 (p as any).phase=0;const first=(p as any).localPlan(report).assignments[0].objective;(p as any).phase=2;const second=(p as any).localPlan(report).assignments[0].objective;
 assert.notEqual(first,second);sim.stop();
});

test('Older completed planting notices reopen once while preserving established crops',()=>{
 const w=emptyCamp();postTask(w,{kind:'planting',bounds:field,resource:'food',amount:1,note:''});const task=w.camp!.tasks[0],crop=w.objects.find(o=>o.crop)!;
 task.status='done';task.progress=task.amount;crop.crop!.stage='growing';crop.crop!.growth=.5;delete crop.crop!.moisture;
 const before=structuredClone(crop.position),sequence=w.camp!.sequence;advanceAgriculture(w);
 assert.equal(task.status,'open');assert.equal(task.progress,0);assert.equal(w.camp!.sequence,sequence+1);assert.ok(crop.crop!.growth>.5);assert.equal(crop.crop!.stage,'growing');assert.deepEqual(crop.position,before);assert.ok(crop.crop!.moisture!>0);
 advanceAgriculture(w);assert.equal(w.camp!.sequence,sequence+1);
});
