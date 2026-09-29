import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {postTask} from '../packages/sim-core/src/camp.ts';
import {controlSettings} from '../packages/contracts/src/command.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {CampSaves,type CampSaveState} from '../apps/laya-client/src/camp-save.ts';
import type {World} from '../packages/sim-core/src/domain.ts';
const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}},settings=controlSettings({mode:'local',residents:2}),saves=new CampSaves(storage);
const state=(world:World):CampSaveState=>({world,settings,queuedTasks:[],selectedId:'resident-a',showSenses:false,needsDecision:false});
const providers:ColonyProvider[]=[];let checkpoints=0;
function create(world:World){const p=new ColonyProvider(settings,{async plan(){throw Error('Remote forbidden in local verification');}});providers.push(p);return new Simulation(p,{world,controlMode:'local',onCommit:record=>{saves.save(state(record.nextWorld));checkpoints++;}});}
const world=createCrewWorld(2);postTask(world,{kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:-7,maxX:23,minZ:-24,maxZ:-16}});let sim=create(world);const began=performance.now();await sim.bootstrap();let restartTick=0,restoredHash='',lastLog=0;
try{
 while(sim.world.tick<12000&&!sim.world.residents.every(r=>r.homeId)){
  if(sim.status==='ERROR_PAUSED')throw Error(JSON.stringify(sim.barrier?.errors));if(sim.paused)await sim.settled();else sim.step();
  const building=sim.world.residents.find(r=>r.plan.some(p=>p.action.op==='build'&&!p.done&&p.elapsedTicks>=20));
  if(!restartTick&&building&&!sim.paused){
   const progress=structuredClone(building.plan);saves.save(state(sim.world));restartTick=sim.world.tick;restoredHash=hashCanonical(sim.world);sim.stop();
   const loaded=new CampSaves(storage).load(settings).save!;assert.equal(hashCanonical(loaded.world),restoredHash);sim=create(loaded.world);sim.pause('NOT_STARTED');sim.frame(86400000);assert.equal(sim.world.tick,restartTick);sim.resume('NOT_STARTED');await sim.bootstrap(true);
   assert.deepEqual(sim.world.residents.find(r=>r.id===building.id)!.plan,progress);assert.equal(sim.frame(86400000),0);console.log(JSON.stringify({restoredDuringConstruction:restartTick,hash:restoredHash}));
  }
  if(sim.world.tick-lastLog>=2000){lastLog=sim.world.tick;console.log(JSON.stringify({tick:lastLog,homes:sim.world.objects.filter(o=>o.kind==='house').length,wallMs:Math.round(performance.now()-began)}));}
 }
 assert.ok(restartTick,'Must reload during real construction');assert.equal(sim.world.residents.filter(r=>r.homeId).length,2);saves.save(state(sim.world));assert.equal(hashCanonical(new CampSaves(storage).load(settings).save!.world),hashCanonical(sim.world));
 const result={mode:'LOCAL_ALGORITHM',remoteCalls:providers.reduce((n,p)=>n+p.remoteCalls,0),tick:sim.world.tick,restartTick,restoredHash,finalHash:hashCanonical(sim.world),wallMs:Math.round(performance.now()-began),checkpoints,saveBytes:[...values.values()].map(s=>Buffer.byteLength(s)),houses:sim.world.objects.filter(o=>o.kind==='house').map(h=>({id:h.id,owner:h.ownerId,design:h.homeDesign,width:h.width,depth:h.depth})),failures:sim.world.events.filter(e=>e.kind==='action_failed').slice(-10)};
 assert.equal(result.remoteCalls,0);assert.equal(new Set(result.houses.map(h=>h.design)).size,2);writeFileSync('evidence/save-homes-local.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{sim.stop();}
