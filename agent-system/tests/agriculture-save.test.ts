import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CampSaves,CAMP_SAVE_KEYS,type CampSaveState} from '../apps/laya-client/src/camp-save.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {postTask} from '../packages/sim-core/src/camp.ts';
import {advanceAgriculture} from '../packages/sim-core/src/agriculture.ts';
import {controlSettings} from '../packages/contracts/src/command.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import type {CropKind,CropState,AnimalKind,World} from '../packages/sim-core/src/domain.ts';

class Storage{
 values=new Map<string,string>();
 getItem(key:string){return this.values.get(key)??null;}
 setItem(key:string,value:string){this.values.set(key,value);}
}
const settings=controlSettings({mode:'local',residents:2});
function farmState():CampSaveState{
 const world=createCrewWorld(2);world.tick=400;world.residents[0].water=3;
 world.camp!.zones=[
  {id:'old-housing',taskId:'old-notice',bounds:{minX:-30,maxX:-20,minZ:-30,maxZ:-20}},
  {id:'farm',taskId:'farm-notice',kind:'planting',cropKind:'rice',bounds:{minX:20,maxX:30,minZ:-30,maxZ:-20}},
  {id:'yard',taskId:'yard-notice',kind:'pasture',animalKind:'mixed',bounds:{minX:20,maxX:30,minZ:20,maxZ:30}},
 ];
 world.camp!.tasks.push(
  {id:'farm-notice',kind:'planting',cropKind:'rice',zoneId:'farm',resource:'food',amount:4,progress:2,note:'水稻田',acceptedBy:[],status:'open',postedTick:0},
  {id:'yard-notice',kind:'pasture',animalKind:'mixed',zoneId:'yard',resource:'food',amount:3,progress:0,note:'鸡鸭鹅牧场',acceptedBy:[],status:'open',postedTick:0},
 );
 const kinds:CropKind[]=['rice','wheat','corn','carrot'],stages:CropState['stage'][]=['seedling','growing','mature','harvested'];
 kinds.forEach((kind,i)=>world.objects.push({id:`save-crop-${kind}`,kind:'crop',zoneId:'farm',position:{x:22+i,y:0,z:-24},width:.7,height:.6,depth:.7,resources:i===2?4:0,resourceKind:'food',maxResources:4,appearance:kind,
  crop:{kind,stage:stages[i],growth:[.1,.5,1,1][i],plantedTick:100,cycles:i,moisture:[.2,.6,0,0][i],lastWateredTick:300,...(i===3?{harvestedTick:390}:{})},
 }));
 for(const [i,stage]of (['fallow','tilled','sown'] as const).entries())world.objects.push({id:`save-soil-${stage}`,kind:'crop',zoneId:'farm',position:{x:22+i,y:0,z:-27},width:.7,height:.2,depth:.7,resources:0,resourceKind:'food',maxResources:3,appearance:stage,crop:{kind:'rice',stage,growth:0,plantedTick:stage==='sown'?390:0,cycles:0,moisture:0}});
 const animals:AnimalKind[]=['chicken','duck','goose'];
 animals.forEach((kind,i)=>world.objects.push({id:`save-animal-${kind}`,kind:'animal',zoneId:'yard',position:{x:22+i,y:0,z:24},width:.5,height:.5,depth:.5,resources:0,appearance:kind,
  animal:{kind,heading:i*.7,activity:i===0?'walk':i===1?'peck':'flap',phaseStartedTick:380,phaseUntilTick:420,phase:i*.3},
 }));
 return {world,settings,queuedTasks:[],selectedId:world.residents[0].id,showSenses:false,needsDecision:false};
}
function packet(data:unknown):string{
 const raw=JSON.stringify(data);let checksum=2166136261;
 for(let i=0;i<raw.length;i++)checksum=Math.imul(checksum^raw.charCodeAt(i),16777619);
 return JSON.stringify({checksum:(checksum>>>0).toString(16),data});
}
const crop=(s:CampSaveState)=>s.world.objects.find(o=>o.id==='save-crop-rice')!;
const animal=(s:CampSaveState)=>s.world.objects.find(o=>o.id==='save-animal-chicken')!;

test('Agriculture saves preserve all crop stages, poultry animation phases, typed zones and queued plans',()=>{
 const storage=new Storage(),s=farmState();
 s.queuedTasks=[
  {kind:'planting',cropKind:'corn',bounds:{minX:-44,maxX:-34,minZ:30,maxZ:40},resource:'food',amount:1,note:'下一块玉米田'},
  {kind:'pasture',animalKind:'duck',bounds:{minX:32,maxX:42,minZ:30,maxZ:40},resource:'food',amount:1,note:'下一块鸭舍'},
 ];
 const before=hashCanonical(s.world);new CampSaves(storage).save(s,123);
 const result=new CampSaves(storage).load(settings);
 assert.equal(result.blocked,false);assert.equal(result.warning,'');
 assert.deepEqual(result.save,{...s,version:1,sequence:1,savedAt:123});
 assert.equal(hashCanonical(s.world),before,'validating queued plans must not create fields or animals in the live world');
 crop(s).crop!.growth=.8;animal(s).animal!.heading=4;
 assert.equal(crop(result.save!).crop!.growth,.1);assert.equal(animal(result.save!).animal!.heading,0);
});

test('Older saves without zone kinds or any agriculture metadata still load',()=>{
 const s=farmState();s.world.objects=s.world.objects.filter(o=>o.kind!=='crop'&&o.kind!=='animal');
 s.world.camp!.zones=s.world.camp!.zones!.slice(0,1);
 s.world.camp!.tasks=s.world.camp!.tasks.filter(t=>t.kind!=='planting'&&t.kind!=='pasture');
 delete s.world.camp!.tasks[0].kind;
 const storage=new Storage();new CampSaves(storage).save(s,10);
 const result=new CampSaves(storage).load(settings);
 assert.equal(result.blocked,false);assert.deepEqual(result.save!.world,s.world);
 assert.equal(result.save!.world.camp!.zones![0].kind,undefined);
});

test('Older crop saves without irrigation fields load unchanged; boundary water states and partial farm work roundtrip',()=>{
 const s=farmState(),storage=new Storage();
 for(const o of s.world.objects)if(o.crop){delete o.crop.moisture;delete o.crop.lastWateredTick;}
 for(const resident of s.world.residents)delete resident.water;
 new CampSaves(storage).save(s,10);const older=new CampSaves(storage).load(settings);
 assert.deepEqual(older.save!.world,s.world);assert.equal(crop(older.save!).crop!.moisture,undefined);
 s.world.residents[0].water=0;s.world.residents[1].water=6;
 crop(s).crop!.moisture=0;crop(s).crop!.lastWateredTick=0;
 s.world.objects.find(o=>o.id==='save-crop-wheat')!.crop!.moisture=1;
 s.world.residents[0].plan=[{action:{op:'farm',stage:0,params:{targetRef:'known_field',work:'till'}},elapsedTicks:17,startedTick:383,emittedChars:0,done:false}];
 s.world.residents[1].plan=[{action:{op:'fetch_water',stage:0,params:{sourceRef:'known_pond'}},elapsedTicks:23,startedTick:377,emittedChars:0,done:false}];
 new CampSaves(storage).save(s,20);const restored=new CampSaves(storage).load(settings);
 assert.deepEqual(restored.save!.world,s.world,'irrigation boundaries and in-progress work survive a save without changing their progress');
});

test('Saving mid-growth and mid-movement resumes the same crops and poultry phases as uninterrupted simulation',()=>{
 const world=createCrewWorld(2);
 postTask(world,{kind:'planting',cropKind:'rice',bounds:{minX:-44,maxX:-34,minZ:30,maxZ:40},resource:'food',amount:1,note:'恢复测试水稻田'});
 postTask(world,{kind:'pasture',animalKind:'mixed',bounds:{minX:32,maxX:42,minZ:30,maxZ:40},resource:'food',amount:1,note:'恢复测试鸡鸭鹅'});
 // Saved established crops remain compatible; this fixture starts after residents have actually sown and watered them.
 for(const o of world.objects)if(o.crop){o.crop.stage='seedling';o.crop.growth=.1;o.crop.plantedTick=0;o.crop.moisture=1;o.crop.lastWateredTick=0;}
 const advance=(w:World,ticks:number)=>{for(let i=0;i<ticks;i++){w.tick++;advanceAgriculture(w);}};
 const phaseCount=(w:World)=>w.objects.reduce((total,o)=>total+(o.animal?.phase??0),0);
 advance(world,83);
 const midpointPhases=phaseCount(world);assert.ok(midpointPhases>0,'birds have already changed behavior before saving');
 assert.ok(world.objects.some(o=>o.crop&&o.crop.growth>0&&o.crop.growth<1));
 const storage=new Storage();new CampSaves(storage).save({world,settings,queuedTasks:[],selectedId:world.residents[0].id,showSenses:false,needsDecision:false},123);
 const loaded=new CampSaves(storage).load(settings);assert.equal(loaded.blocked,false);
 const restored=loaded.save!.world;assert.equal(phaseCount(restored),midpointPhases);
 advance(world,2020);advance(restored,2020);
 const uninterruptedPhaseChanges=phaseCount(world)-midpointPhases,restoredPhaseChanges=phaseCount(restored)-midpointPhases;
 assert.ok(uninterruptedPhaseChanges>9,'the continuation crosses multiple behavior changes for the flock');
 assert.equal(restoredPhaseChanges,uninterruptedPhaseChanges,'the saved phase counter advances by exactly the same count');
 assert.ok(world.objects.some(o=>o.crop&&o.crop.growth>0),'the saved crops retain real growth while irrigation continues to govern progress');
 assert.equal(hashCanonical(restored),hashCanonical(world),'crop growth, animal positions, behavior and phase timers all resume identically');
});

test('Malformed agriculture metadata is rejected on write and on checksummed load without replacing a good save',()=>{
 const corruptions:[string,(s:CampSaveState)=>void][]=[
  ['missing crop state',s=>{delete crop(s).crop;}],
  ['unknown crop kind',s=>{(crop(s).crop as any).kind='potato';}],
  ['unknown crop stage',s=>{(crop(s).crop as any).stage='dry';}],
  ['out-of-range growth',s=>{crop(s).crop!.growth=1.1;}],
  ['negative growth',s=>{crop(s).crop!.growth=-.1;}],
  ['fractional planting tick',s=>{crop(s).crop!.plantedTick=1.5;}],
  ['negative harvest tick',s=>{crop(s).crop!.harvestedTick=-1;}],
  ['negative cycle count',s=>{crop(s).crop!.cycles=-1;}],
  ['negative moisture',s=>{crop(s).crop!.moisture=-.1;}],
  ['excess moisture',s=>{crop(s).crop!.moisture=1.1;}],
  ['non-finite moisture',s=>{crop(s).crop!.moisture=Infinity;}],
  ['negative watered tick',s=>{crop(s).crop!.lastWateredTick=-1;}],
  ['fractional watered tick',s=>{crop(s).crop!.lastWateredTick=.5;}],
  ['negative carried water',s=>{s.world.residents[0].water=-1;}],
  ['water beyond carry capacity',s=>{s.world.residents[0].water=6.1;}],
  ['non-finite carried water',s=>{s.world.residents[0].water=Infinity;}],
  ['missing animal state',s=>{delete animal(s).animal;}],
  ['unknown poultry kind',s=>{(animal(s).animal as any).kind='cow';}],
  ['unknown activity',s=>{(animal(s).animal as any).activity='run';}],
  ['invalid heading',s=>{animal(s).animal!.heading=Infinity;}],
  ['invalid phase',s=>{animal(s).animal!.phase=NaN;}],
  ['invalid phase start',s=>{animal(s).animal!.phaseStartedTick=-1;}],
  ['phase ends before it starts',s=>{animal(s).animal!.phaseUntilTick=100;}],
  ['crop metadata on animal',s=>{animal(s).crop=structuredClone(crop(s).crop);}],
  ['animal metadata on tree',s=>{s.world.objects.find(o=>o.kind==='tree')!.animal=structuredClone(animal(s).animal);}],
  ['unknown zone kind',s=>{(s.world.camp!.zones![1] as any).kind='factory';}],
  ['invalid zone crop kind',s=>{(s.world.camp!.zones![1] as any).cropKind='potato';}],
  ['animal choice on crop zone',s=>{s.world.camp!.zones![1].animalKind='duck';}],
  ['invalid zone animal kind',s=>{(s.world.camp!.zones![2] as any).animalKind='cow';}],
  ['unknown task kind',s=>{(s.world.camp!.tasks.find(t=>t.id==='farm-notice') as any).kind='factory';}],
  ['invalid task crop kind',s=>{(s.world.camp!.tasks.find(t=>t.id==='farm-notice') as any).cropKind='potato';}],
  ['crop choice on pasture task',s=>{s.world.camp!.tasks.find(t=>t.id==='yard-notice')!.cropKind='rice';}],
  ['invalid queued crop kind',s=>{s.queuedTasks=[{kind:'planting',cropKind:'potato' as CropKind,bounds:{minX:-44,maxX:-34,minZ:30,maxZ:40},resource:'food',amount:1,note:''}];}],
 ];
 for(const [name,corrupt] of corruptions){
  const storage=new Storage(),saves=new CampSaves(storage),good=farmState();saves.save(good,10);
  const bad=structuredClone(good);corrupt(bad);const original=[...storage.values];
  assert.throws(()=>saves.save(bad,20),name);assert.deepEqual([...storage.values],original,name);
  storage.setItem(CAMP_SAVE_KEYS[1],packet({...bad,version:1,sequence:2,savedAt:20}));
  const recovered=new CampSaves(storage).load(settings);
  assert.equal(recovered.blocked,false,name);assert.equal(recovered.save!.sequence,1,name);assert.match(recovered.warning,/另一份/,name);
  assert.deepEqual(recovered.save!.world,good.world,name);
 }
});
