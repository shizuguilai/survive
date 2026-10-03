import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampWorld,advanceEnvironment} from '../packages/sim-core/src/world.ts';
import {postTask,grantKnown} from '../packages/sim-core/src/camp.ts';
import {advanceAgriculture,CROP_GROWTH_TICKS,CROP_REGROW_TICKS,CROP_YIELD} from '../packages/sim-core/src/agriculture.ts';
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

test('Four crop species grow through seedlings and mature food, harvest through resident work, then regrow',()=>{
 for(const kind of ['rice','wheat','corn','carrot'] as CropKind[]){
  const w=emptyCamp(),r=w.residents[0];postTask(w,{kind:'planting',cropKind:kind,bounds:field,resource:'food',amount:1,note:''});
  const crop=w.objects.find(o=>o.kind==='crop')!;
  assert.equal(crop.crop!.stage,'seedling');assert.equal(crop.resources,0);assert.equal(w.camp!.stock!.food,undefined);
  r.position={...crop.position,x:crop.position.x-3};r.heading=0;samplePerception(w);
  const targetRef=Object.values(r.known).find(k=>k.entityId===crop.id)!.ref;
  assert.equal(r.spatialMemory!.landmarks[targetRef].state,'depleted');assert.ok(!r.known[targetRef].description.includes('采空'));
  r.position.x=crop.position.x-1.5;applyDecision(r,act('gather',{targetRef,amount:1}),0);stepActions(w,1);assert.equal(r.supplies!.food,undefined);assert.match(r.actionFeedback.at(-1)!,/尚未成熟/);r.actionFeedback=[];
  w.tick=Math.floor(CROP_GROWTH_TICKS[kind]*.5);advanceEnvironment(w);assert.equal(crop.crop!.stage,'growing');assert.equal(crop.resources,0);
  w.tick=CROP_GROWTH_TICKS[kind];advanceEnvironment(w);assert.equal(crop.crop!.stage,'mature');assert.equal(crop.resources,CROP_YIELD[kind]);assert.equal(w.camp!.stock!.food,undefined);
  r.position.x=crop.position.x-3;samplePerception(w);assert.equal(r.spatialMemory!.landmarks[targetRef].state,'remembered');assert.match(r.known[targetRef].description,/已成熟/);validateCharacterContext(buildContext(w,r));
  r.position.x=crop.position.x-1.5;applyDecision(r,act('gather',{targetRef,amount:8}),w.tick);
  for(let i=0;i<100&&!r.plan[0].done;i++){w.tick++;stepActions(w,w.tick);}
  assert.equal(r.supplies!.food,CROP_YIELD[kind]);assert.equal(r.inventory,CROP_YIELD[kind]);assert.equal(crop.resources,0);assert.equal(crop.crop!.stage,'harvested');assert.equal(crop.crop!.cycles,1);assert.equal(w.camp!.stock!.food,undefined);
  assert.equal(r.spatialMemory!.landmarks[targetRef].state,'depleted');assert.match(r.known[targetRef].description,/已收割/);
  const harvestedTick=crop.crop!.harvestedTick!;w.tick=harvestedTick+CROP_REGROW_TICKS-1;advanceAgriculture(w);assert.equal(crop.crop!.stage,'harvested');
  w.tick++;advanceAgriculture(w);assert.equal(crop.crop!.stage,'seedling');assert.equal(crop.crop!.growth,0);assert.equal(crop.crop!.harvestedTick,undefined);
  w.tick+=CROP_GROWTH_TICKS[kind];advanceAgriculture(w);assert.equal(crop.crop!.stage,'mature');assert.equal(crop.resources,CROP_YIELD[kind]);assert.equal(crop.crop!.cycles,1);
  const board=w.objects.find(o=>o.kind==='board')!;r.position={...board.position};samplePerception(w);
  const sourceRef=Object.values(r.known).find(k=>k.entityId===`supply-food-${r.id}`)!.ref,destinationRef=grantKnown(r,board.id,board.appearance,board.position,w.tick).ref;
  applyDecision(r,act('haul',{sourceRef,destinationRef,amount:CROP_YIELD[kind]}),w.tick);for(let i=0;i<40;i++){w.tick++;stepActions(w,w.tick);}
  assert.equal(w.camp!.stock!.food,CROP_YIELD[kind]);assert.equal(r.supplies!.food,0);assert.equal(r.inventory,0);
 }
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

test('The local planner harvests observed mature crops and physically hauls their food without remote calls',async()=>{
 const w=emptyCamp();postTask(w,{kind:'planting',bounds:field,resource:'food',amount:1,note:''});postTask(w,{kind:'pasture',bounds:{minX:16,maxX:24,minZ:12,maxZ:20},resource:'food',amount:1,note:''});w.tick=CROP_GROWTH_TICKS.rice;advanceAgriculture(w);
 const r=w.residents[0];r.position={x:2.7,y:0,z:0};r.heading=0;samplePerception(w);const board=w.objects.find(o=>o.kind==='board')!;grantKnown(r,board.id,board.appearance,board.position,w.tick);
 const p=new ColonyProvider(controlSettings({mode:'local',residents:2}),{async plan(){throw Error('must remain local');}}),sim=new Simulation(p,{world:w,controlMode:'local'});await sim.bootstrap();
 for(let i=0;i<1200&&!sim.world.events.some(e=>e.kind==='action_completed'&&e.text==='haul');i++){if(sim.paused)await sim.settled();else sim.step();}
 assert.notEqual(sim.status,'ERROR_PAUSED',JSON.stringify(sim.barrier?.errors));assert.ok((sim.world.camp!.stock!.food??0)>=2);assert.equal(p.remoteCalls,0);
 assert.ok(sim.world.events.some(e=>e.kind==='action_completed'&&e.text==='gather'));assert.ok(sim.world.events.some(e=>e.kind==='action_completed'&&e.text==='haul'));
 sim.pause('TEST');const paused=hashCanonical(sim.world);sim.frame(500000);sim.frame(900000);assert.equal(hashCanonical(sim.world),paused);sim.stop();
});
