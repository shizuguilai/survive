import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCrewWorld,advanceEnvironment} from '../packages/sim-core/src/world.ts';
import {postTask,readBoard,claimHome,grantKnown} from '../packages/sim-core/src/camp.ts';
import {finishBuild,withdraw} from '../packages/sim-core/src/workshop.ts';
import {finishHomeCare,renovationSite} from '../packages/sim-core/src/home-care.ts';
import {DAY_TICKS,dayClock,daylightAt,advanceLiving,ownHouse,onBreak,restRecovery,homeSize} from '../packages/sim-core/src/living.ts';
import {houseSteps} from '../packages/sim-core/src/recipes.ts';
import {applyDecision,stepActions} from '../packages/sim-core/src/actions.ts';
import {movementBlocked} from '../packages/sim-core/src/navigation.ts';
import {buildContext,samplePerception} from '../packages/sim-core/src/perception.ts';
import {validateCharacterContext,validateDecision} from '../packages/contracts/src/validation.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {UiNotice} from '../apps/laya-client/src/ui-notice.ts';
import type {Resident,World} from '../packages/sim-core/src/domain.ts';
const ref=(r:Resident,id:string)=>Object.values(r.known).find(k=>k.entityId===id)!.ref;
const decision=(op:string,params:any)=>({schemaVersion:'1.0.0' as const,decisionKind:'replace' as const,goal:'regression',reasonBrief:'test',actions:[{op,params,stage:0}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
function home(){
 const w=createCrewWorld(2),r=w.residents[0];w.objects=w.objects.filter(o=>['board','workbench'].includes(o.kind));
 postTask(w,{kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:-24,maxX:-4,minZ:-24,maxZ:-5}});
 readBoard(w,r,w.objects[0]);assert.equal(claimHome(w,r,w.camp!.tasks.at(-1)!),null);
 const task=w.camp!.tasks.at(-1)!,h=w.objects.find(o=>o.projectId===task.id)!;r.position={...h.position};w.camp!.stock={wood:200,stone:200};
 for(const step of houseSteps(task))assert.equal(finishBuild(w,r,ref(r,task.id),ref(r,task.id+':'+step.id)),null);
 return {w,r,h,homeRef:ref(r,h.id)};
}
test('Queued notices expire even while paused, and clear once safely applied',()=>{
 const n=new UiNotice();n.show('queued',100,true);assert.equal(n.read(200,1),'queued');assert.equal(n.read(201,0),'');
 n.show('queued',500,true);assert.equal(n.read(5000,1),'');n.show('saved',6000);assert.equal(n.read(6001,0),'saved');assert.equal(n.read(10500,0),'');
});
test('Daylight has day/night and exact deterministic day boundaries',()=>{
 assert.equal(dayClock(0).hours,8);assert.equal(dayClock(3600).night,true);assert.equal(dayClock(DAY_TICKS).hours,8);assert.ok(daylightAt(1200)>.99);assert.ok(daylightAt(4200)<.15);
 const w=createCrewWorld();w.tick=4200;advanceEnvironment(w);assert.equal(w.daylight,daylightAt(4200));
});
test('Furniture consumes real stock once, needs ownership/proximity and improves recovery',()=>{
 const {w,r,h,homeRef}=home(),before={...w.camp!.stock},floor=restRecovery(w,r);
 r.position.x+=20;assert.ok(finishHomeCare(w,r,homeRef,'bed'));assert.deepEqual(w.camp!.stock,before);r.position={...h.position};
 assert.equal(finishHomeCare(w,r,homeRef,'bed'),null);assert.equal(w.camp!.stock!.wood,before.wood!-4);assert.ok(restRecovery(w,r)>floor);assert.ok(finishHomeCare(w,r,homeRef,'bed'));
 const other=w.residents[1];grantKnown(other,h.id,'saw another house',h.position,w.tick);other.position={...h.position};assert.ok(finishHomeCare(w,other,ref(other,h.id),'lamp'));
 assert.equal(finishHomeCare(w,r,homeRef,'mop'),null);h.cleanliness=.1;assert.equal(finishHomeCare(w,r,homeRef,'clean'),null);assert.equal(h.cleanliness,1);
 samplePerception(w);const context=buildContext(w,r);validateCharacterContext(context);validateDecision(decision('home_care',{homeRef,improvement:'lamp'}),context);applyDecision(r,decision('home_care',{homeRef,improvement:'lamp'}),w.tick);validateCharacterContext(buildContext(w,r));
});
test('Private cabinet preserves actual items and rejects access by another resident',()=>{
 const {w,r,h,homeRef}=home();finishHomeCare(w,r,homeRef,'cabinet');r.supplies!.food=6;r.inventory=6;const food=grantKnown(r,`supply-food-${r.id}`,'my food',r.position,0);
 applyDecision(r,decision('haul',{sourceRef:food.ref,destinationRef:homeRef,amount:4}),0);for(let i=1;i<=40;i++)stepActions(w,i);
 assert.equal(h.stored!.food,4);assert.equal(r.inventory,2);assert.equal(withdraw(w,r,homeRef,'food',2),null);assert.equal(r.inventory,4);assert.equal(h.stored!.food,2);
 const b=w.residents[1];b.position={...h.position};const k=grantKnown(b,h.id,'not mine',h.position,0);assert.ok(withdraw(w,b,k.ref,'food',1));assert.equal(h.stored!.food,2);
});
test('Rest settles into a real bed, recovers energy and finishes without a stale distance failure',()=>{
 const {w,r,h,homeRef}=home();Object.assign(h,homeSize(3));finishHomeCare(w,r,homeRef,'bed');r.fatigue=.8;
 applyDecision(r,decision('rest',{placeRef:homeRef,durationSimMs:5000}),0);
 for(let t=1;t<100;t++){w.tick=t;stepActions(w,t);}
 assert.equal(r.plan[0].bedHomeId,h.id);assert.equal(r.plan[0].bedSettled,true);assert.ok(r.fatigue<.7);assert.equal(r.actionFeedback.length,0);
 w.tick=100;stepActions(w,100);assert.ok(r.plan[0].done);assert.doesNotThrow(()=>hashCanonical(w));
});
test('Unmet housing slowly lowers mood to a visible, temporary strike without fabricating speech',()=>{
 const w=createCrewWorld(2),r=w.residents[0];r.hunger=.1;r.fatigue=.1;
 for(let t=1;t<=DAY_TICKS*4&&!onBreak(w,r);t++){w.tick=t;advanceLiving(w);}
 assert.ok(onBreak(w,r));assert.equal(r.living!.breakKind,'strike');assert.ok(w.events.some(e=>e.kind==='mental_break'));assert.equal(w.sounds.length,0);
 w.tick=r.living!.breakUntil!;advanceLiving(w);assert.equal(onBreak(w,r),false);assert.ok(r.mood!>=.2);assert.doesNotThrow(()=>hashCanonical(w));
});
test('A tantrum can damage only furniture physically inside the resident’s own home',()=>{
 const {w,r,h,homeRef}=home();finishHomeCare(w,r,homeRef,'bed');finishHomeCare(w,r,homeRef,'cabinet');
 w.tick=DAY_TICKS;r.hunger=1;r.fatigue=1;r.pain=1;r.mood=0;r.living={housingWait:0,upgradeWait:DAY_TICKS*4,desiredLevel:2};h.cleanliness=0;
 advanceLiving(w);assert.equal(r.living.breakKind,'tantrum');assert.equal(h.furniture!.cabinet,false);assert.equal(h.furniture!.bed,true);
});
test('Renovation checks land/materials before demolition; reserves inputs, salvages old walls and keeps belongings',()=>{
 const {w,r,h,homeRef}=home();h.furniture={bed:true,cabinet:true};h.stored={food:5};w.tick=DAY_TICKS+1;
 w.camp!.stock={wood:23,stone:16};assert.ok(finishHomeCare(w,r,homeRef,'expand'));assert.equal(h.kind,'house');assert.equal(h.width,4);
 w.camp!.stock={wood:24,stone:16};assert.ok(renovationSite(w,r,h,2));assert.equal(finishHomeCare(w,r,homeRef,'expand'),null);
 const task=w.camp!.tasks.at(-1)!;assert.deepEqual(w.camp!.stock,{wood:0,stone:0});assert.equal(h.kind,'house');
 for(const step of houseSteps(task)){r.position={...h.position};assert.equal(finishBuild(w,r,ref(r,task.id),ref(r,task.id+':'+step.id)),null);}
 assert.equal(task.status,'done');assert.deepEqual({width:h.width,depth:h.depth},homeSize(2));assert.equal(h.kind,'house');assert.equal(h.stored.food,5);assert.equal(h.furniture.bed,true);assert.deepEqual(w.camp!.stock,{wood:6,stone:4});assert.equal(ownHouse(w,r),h);
 assert.equal(w.camp!.tasks.find(t=>t.kind==='residential')!.progress,1);
});
test('Expanded houses route residents through the real doorway',()=>{
 const {w,r,h,homeRef}=home();Object.assign(h,homeSize(3));r.position={x:h.position.x,y:0,z:h.position.z-7};r.known[homeRef].lastPosition={...h.position};
 applyDecision(r,decision('walk',{targetRef:homeRef,gait:'walk'}),0);for(let t=1;t<800&&!r.plan[0].done;t++){const before={...r.position};stepActions(w,t);assert.equal(movementBlocked(w,before,r.position),false);}
 assert.equal(r.actionFeedback.length,0);assert.ok(r.plan[0].done);assert.ok(Math.hypot(r.position.x-h.position.x,r.position.z-h.position.z)<.801);
});
