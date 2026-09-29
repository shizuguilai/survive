import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CampSaves,CAMP_SAVE_KEYS,type CampSaveState} from '../apps/laya-client/src/camp-save.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {grantKnown} from '../packages/sim-core/src/camp.ts';
import {controlSettings} from '../packages/contracts/src/command.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import type {BrainProvider,BrainRequest,BrainResponse,Decision} from '../packages/contracts/src/types.ts';
const settings=controlSettings({mode:'local',residents:2});
class Storage{
 values=new Map<string,string>();fail=false;
 getItem(key:string){return this.values.get(key)??null;}
 setItem(key:string,value:string){if(this.fail)throw new DOMException('full','QuotaExceededError');this.values.set(key,value);}
}
const state=(world=createCrewWorld(2),needsDecision=false):CampSaveState=>({world,settings,queuedTasks:[],selectedId:'resident-b',showSenses:true,needsDecision});
const wait=():Decision=>({schemaVersion:'1.0.0',decisionKind:'replace',goal:'存档测试',reasonBrief:'explicit fixture',actions:[{op:'wait',params:{scope:'hands',durationSimMs:10000},stage:0}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
const turn=()=>new Promise<void>(r=>setImmediate(r));

test('Camp saves round-trip the whole camp, private state, partial actions and queued planning without mutation',()=>{
 const storage=new Storage(),saves=new CampSaves(storage),s=state(),w=s.world,r=w.residents[0];w.tick=127;w.revision=141;w.rngState=98765;w.camp!.stock={wood:13,stone:7,food:9};
 r.supplies={wood:2,food:1};r.inventory=3;r.homeId='home-a';r.living={housingWait:0,upgradeWait:123,desiredLevel:2};
 r.plan=[{action:{op:'speak',params:{text:'我想建个家。',volume:'normal',towardRef:null},stage:0},elapsedTicks:25,startedTick:102,emittedChars:3,done:false}];r.suspendedPlan=structuredClone(r.plan);r.actionFeedback=['等待继续'];
 w.objects.push({id:'home-a',ownerId:r.id,kind:'house',homeDesign:'cedar',homeLevel:1,buildStage:3,position:{x:-15,y:0,z:-16},width:4,depth:3,height:4,resources:0,appearance:'家',furniture:{bed:true,lamp:true,cabinet:true},stored:{food:5},cleanliness:.8});
 w.sounds.push({id:'fragment',sourceId:r.id,position:{...r.position},heading:r.heading,text:'我想建',volume:'normal',emittedTick:126,deliveredTo:['resident-b']});
 s.queuedTasks=[{kind:'residential',resource:'wood',amount:1,note:'已圈定待发布',bounds:{minX:10,maxX:24,minZ:-24,maxZ:-14}}];const before=hashCanonical(w);
 saves.save(s,12345);const loaded=new CampSaves(storage).load(controlSettings(null));assert.equal(loaded.blocked,false);assert.equal(loaded.warning,'');assert.deepEqual(loaded.save,{version:1,sequence:1,savedAt:12345,...s});assert.equal(hashCanonical(w),before);
 r.supplies.wood=99;assert.equal(loaded.save!.world.residents[0].supplies!.wood,2);
});

test('Corrupt latest save falls back to the previous slot; two corrupt slots remain untouched until explicit saving',()=>{
 const storage=new Storage(),saves=new CampSaves(storage),s=state();saves.save(s,10);s.world.tick=5;saves.save(s,20);
 const newest=JSON.parse(storage.getItem(CAMP_SAVE_KEYS[1])!);newest.data.world.tick=999;storage.values.set(CAMP_SAVE_KEYS[1],JSON.stringify(newest));
 const fallback=new CampSaves(storage).load(settings);assert.equal(fallback.save!.world.tick,0);assert.match(fallback.warning,/另一份/);
 storage.values.set(CAMP_SAVE_KEYS[0],'{interrupted');const original=[...storage.values];const recovery=new CampSaves(storage),bad=recovery.load(settings);assert.equal(bad.save,null);assert.equal(bad.blocked,true);assert.deepEqual([...storage.values],original);
 recovery.save(s,30);assert.equal(new CampSaves(storage).load(settings).save!.world.tick,5);
});

test('Storage quota or denied access cannot destroy the last complete save',()=>{
 const storage=new Storage(),saves=new CampSaves(storage),s=state();saves.save(s,10);storage.fail=true;s.world.tick=6;
 assert.throws(()=>saves.save(s,20),{name:'QuotaExceededError'});assert.equal(new CampSaves(storage).load(settings).save!.world.tick,0);
 storage.fail=false;assert.equal(saves.save(s,30).sequence,2);assert.equal(new CampSaves(storage).load(settings).save!.world.tick,6);
 const inaccessible=new CampSaves({getItem(){throw Error('denied');},setItem(){throw Error('denied');}}).load(settings);assert.equal(inaccessible.save,null);assert.equal(inaccessible.blocked,true);
 const invalid=state();invalid.world.residents[0].position.x=NaN;const original=[...storage.values];assert.throws(()=>saves.save(invalid));assert.deepEqual([...storage.values],original);
});

test('The old durable decision checkpoint migrates only with a matching world hash and remains backed up',()=>{
 const storage=new Storage(),w=createCrewWorld(2);w.tick=500;w.revision=519;
 const raw=JSON.stringify({schemaVersion:'1.0.0',world:w,commit:{afterHash:hashCanonical(w)}});storage.values.set('survive_agent_commit_v1',raw);
 const saves=new CampSaves(storage),legacy=saves.load(settings);assert.deepEqual(legacy.save!.world,w);assert.match(legacy.warning,/旧版/);assert.equal(legacy.save!.needsDecision,false);
 saves.save({...legacy.save!,world:{...w,tick:501}},30);assert.equal(new CampSaves(storage).load(settings).save!.world.tick,501);assert.equal(storage.getItem('survive_agent_commit_v1'),raw);
 const broken=new Storage();broken.values.set('survive_agent_commit_v1',raw.replace('"tick":500','"tick":900'));assert.equal(new CampSaves(broken).load(settings).blocked,true);
});

test('Resuming a partial gather preserves progress and produces the same resources as uninterrupted play; no offline catch-up',async()=>{
 const w=createCrewWorld(2),r=w.residents[0];w.objects=[{id:'tree',kind:'tree',resourceKind:'wood',maxResources:20,resources:20,position:{x:0,y:0,z:1},width:1,height:3,depth:1,appearance:'tree'}];r.position={x:0,y:0,z:0};const ref=grantKnown(r,'tree','tree',w.objects[0].position,0).ref;
 const brain:BrainProvider={async decide(request){const decision=wait();if(request.metadata.agentId===r.id)decision.actions=[{op:'gather',params:{targetRef:ref,amount:5},stage:0}];return {metadata:request.metadata,decision,source:'MOCK_TEST',model:'save fixture'};}};
 const original=new Simulation(brain,{world:w,allowMock:true});await original.bootstrap();for(let i=0;i<25;i++){original.step();await original.settled();}assert.equal(original.world.residents[0].supplies!.wood,1);
 const storage=new Storage();new CampSaves(storage).save(state(original.world),1);const saved=new CampSaves(storage).load(settings).save!;let calls=0;
 const resumed=new Simulation({async decide(request){calls++;return brain.decide(request);}},{world:saved.world,allowMock:true});resumed.pause('NOT_STARTED');const before=hashCanonical(resumed.world);resumed.frame(999999999);assert.equal(hashCanonical(resumed.world),before);
 resumed.resume('NOT_STARTED');await resumed.bootstrap(true);assert.equal(calls,0);assert.equal(resumed.frame(999999999),0);assert.equal(resumed.world.tick,25);
 for(let i=0;i<25;i++){original.step();resumed.step();await Promise.all([original.settled(),resumed.settled()]);}
 assert.equal(hashCanonical(resumed.world),hashCanonical(original.world));assert.equal(resumed.world.residents[0].supplies!.wood,2);assert.equal(resumed.world.objects[0].resources,18);original.stop();resumed.stop();
});

test('An interrupted cognition save contains no half-batch; fresh decisions resume from the same frozen tick',async()=>{
 const requests:{request:BrainRequest;resolve:(r:BrainResponse)=>void}[]=[];
 const provider:BrainProvider={decide:request=>new Promise(resolve=>requests.push({request,resolve}))};const sim=new Simulation(provider,{world:createCrewWorld(2),allowMock:true});const pending=sim.bootstrap();
 requests[0].resolve({metadata:requests[0].request.metadata,decision:wait(),source:'MOCK_TEST',model:'partial test'});await turn();assert.equal(sim.barrier!.acceptedAgentIds.length,1);
 const storage=new Storage(),savedWorld=hashCanonical(sim.world);new CampSaves(storage).save(state(sim.world,true));sim.stop();await pending;
 requests[1].resolve({metadata:requests[1].request.metadata,decision:wait(),source:'MOCK_TEST',model:'late test'});await turn();assert.equal(hashCanonical(sim.world),savedWorld);
 const saved=new CampSaves(storage).load(settings).save!;assert.equal(saved.needsDecision,true);assert.ok(saved.world.residents.every(r=>r.lastDecision===null));let count=0;
 const restored=new Simulation({async decide(request){count++;return {metadata:request.metadata,decision:wait(),source:'MOCK_TEST',model:'fresh test'};}},{world:saved.world,allowMock:true});await restored.bootstrap(!saved.needsDecision);assert.equal(count,2);assert.equal(restored.world.tick,0);assert.ok(restored.world.residents.every(r=>r.lastDecision));restored.stop();
});

test('Saving a committed batch is a durable gate: failed writes leave both the simulation and its previous save intact',async()=>{
 const storage=new Storage(),saves=new CampSaves(storage),w=createCrewWorld(2);saves.save(state(w,true));storage.fail=true;
 const sim=new Simulation({async decide(request){return {metadata:request.metadata,decision:wait(),source:'MOCK_TEST',model:'gate test'};}},{world:w,allowMock:true,onCommit:record=>{saves.save(state(record.nextWorld));}});
 await sim.bootstrap();assert.equal(sim.status,'ERROR_PAUSED');assert.ok(sim.world.residents.every(r=>r.lastDecision===null));assert.ok(new CampSaves(storage).load(settings).save!.world.residents.every(r=>r.lastDecision===null));
 storage.fail=false;await sim.retry();assert.equal(sim.status,'RUNNING');assert.equal(hashCanonical(new CampSaves(storage).load(settings).save!.world),hashCanonical(sim.world));sim.stop();
});
