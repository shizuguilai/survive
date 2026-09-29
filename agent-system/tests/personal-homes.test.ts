import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {claimHome,postTask,readBoard} from '../packages/sim-core/src/camp.ts';
import {finishBuild} from '../packages/sim-core/src/workshop.ts';
import {finishHomeCare} from '../packages/sim-core/src/home-care.ts';
import {houseSteps,houseCost} from '../packages/sim-core/src/recipes.ts';
import {HOME_DESIGNS,preferredHome,designedHomeSize,homeLayout} from '../packages/sim-core/src/home-design.ts';
import {homeFits} from '../packages/sim-core/src/housing.ts';
import {movementBlocked} from '../packages/sim-core/src/navigation.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {DAY_TICKS} from '../packages/sim-core/src/living.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import type {Resident} from '../packages/sim-core/src/domain.ts';
const ref=(r:Resident,id:string)=>Object.values(r.known).find(k=>k.entityId===id)!.ref;
function homes(){
 const w=createCrewWorld(6);w.objects=w.objects.filter(o=>o.kind==='board'||o.kind==='workbench');w.camp!.stock={wood:500,stone:500};
 postTask(w,{kind:'residential',resource:'wood',amount:1,note:'home variety',bounds:{minX:-24,maxX:24,minZ:-24,maxZ:-5}});const zone=w.camp!.tasks.at(-1)!;
 for(const r of w.residents){readBoard(w,r,w.objects[0]);assert.equal(claimHome(w,r,zone),null);const task=w.camp!.tasks.at(-1)!,h=w.objects.find(o=>o.projectId===task.id)!;r.position={...h.position};
  for(const s of houseSteps(task))assert.equal(finishBuild(w,r,ref(r,task.id),ref(r,task.id+':'+s.id)),null);
 }
 return w;
}
test('Six residents build stable, different footprints using their actual material costs and available land',()=>{
 const w=homes(),houses=w.objects.filter(o=>o.kind==='house');assert.equal(houses.length,6);assert.equal(new Set(houses.map(h=>`${h.width}×${h.depth}`)).size,6);assert.equal(new Set(houses.map(h=>h.homeDesign)).size,6);
 let wood=500,stone=500;for(const [i,h]of houses.entries()){
  assert.equal(h.homeDesign,preferredHome(w.residents[i].id).id);assert.deepEqual({width:h.width,depth:h.depth},designedHomeSize(1,h.homeDesign));
  assert.ok(homeFits(w,w.camp!.zones![0].bounds,h.position,h,h.id));const cost=houseCost(1,h.homeDesign);wood-=cost.wood;stone-=cost.stone;
 }
 assert.deepEqual(w.camp!.stock,{wood,stone});assert.ok(houseCost(1,'moss').wood>houseCost(1,'cedar').wood);assert.doesNotThrow(()=>hashCanonical(w));
});
test('Every layout puts the sleeper in the actual bed, inside the walls, and clear of the doorway',()=>{
 const w=homes();for(const r of w.residents){const h=w.objects.find(o=>o.id===r.homeId)!;h.furniture={bed:true,cabinet:true,lamp:true,mop:true};const layout=homeLayout(h),hw=h.width/2,hd=h.depth/2;
  assert.ok(Math.abs(layout.bed.x)+.6<hw-.1);assert.ok(Math.abs(layout.bed.z)+1.02<=hd-.14);assert.ok(Math.sign(layout.cabinet.x)!==Math.sign(layout.bed.x));
  r.position={...h.position};r.fatigue=.8;applyDecision(r,{schemaVersion:'1.0.0',decisionKind:'replace',goal:'rest',reasonBrief:'test',actions:[{op:'rest',stage:0,params:{placeRef:ref(r,h.id),durationSimMs:5000}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]},w.tick);
  for(let i=0;i<99;i++){const before={...r.position};w.tick++;stepActions(w,w.tick);assert.equal(movementBlocked(w,before,r.position),false);}
  assert.equal(r.plan[0].bedSettled,true);assert.equal(r.actionFeedback.length,0);assert.ok(Math.abs(r.position.x-h.position.x-layout.bed.x)<.01);assert.ok(Math.abs(r.position.z-h.position.z-layout.bed.z)<.01);
 }
});
test('A larger personal house expands in its own style, reserves correct inputs and preserves furniture and cabinet stock',()=>{
 const w=homes(),r=w.residents[3],h=w.objects.find(o=>o.id===r.homeId)!;h.furniture={bed:true,cabinet:true};h.stored={food:5};w.tick=DAY_TICKS+1;r.position={...h.position};const cost=houseCost(2,h.homeDesign),salvage=houseCost(1,h.homeDesign);
 w.camp!.stock={wood:cost.wood-1,stone:cost.stone};assert.ok(finishHomeCare(w,r,ref(r,h.id),'expand'));assert.equal(h.kind,'house');
 w.camp!.stock={...cost};assert.equal(finishHomeCare(w,r,ref(r,h.id),'expand'),null);assert.deepEqual(w.camp!.stock,{wood:0,stone:0});const task=w.camp!.tasks.at(-1)!;assert.equal(task.homeDesign,'moss');
 for(const step of houseSteps(task)){r.position={...h.position};assert.equal(finishBuild(w,r,ref(r,task.id),ref(r,task.id+':'+step.id)),null);}
 assert.deepEqual({width:h.width,depth:h.depth},designedHomeSize(2,'moss'));assert.equal(h.homeDesign,'moss');assert.equal(h.stored.food,5);assert.equal(h.furniture.bed,true);assert.deepEqual(w.camp!.stock,{wood:Math.floor(salvage.wood/2),stone:Math.floor(salvage.stone/2)});
});
test('Reserved renovation land uses the future personal footprint, and legacy dimensions remain compatible',()=>{
 const w=createCrewWorld(2);w.objects=[];w.camp!.tasks=[{id:'expansion',kind:'house',homeDesign:'moss',homeLevel:3,renovation:true,targetPosition:{x:0,y:0,z:0},resource:'wood',amount:4,progress:0,note:'',acceptedBy:[],status:'open',postedTick:0}];const bounds={minX:-24,maxX:24,minZ:-24,maxZ:24};
 assert.equal(homeFits(w,bounds,{x:7,z:0},{width:4,depth:3}),false);w.camp!.tasks[0].homeDesign='cedar';assert.equal(homeFits(w,bounds,{x:7,z:0},{width:4,depth:3}),true);
 assert.deepEqual(designedHomeSize(1),{width:4,depth:3});assert.deepEqual(designedHomeSize(2),{width:5.5,depth:4.5});assert.deepEqual(houseCost(2),{wood:24,stone:16});assert.equal(HOME_DESIGNS.length,6);
 assert.deepEqual(homeLayout({width:4,depth:3,ownerId:'resident-b'}).bed,{x:-(2-.82),z:-.13},'Old sleeping plans must still match the old bed location');
});
