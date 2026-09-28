import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveObserver,liveCheckpoint} from '../apps/laya-client/src/live-observer.ts';
import {ResidentJournal} from '../apps/laya-client/src/journal.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {DEFAULT_CONTROL} from '../packages/contracts/src/command.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';

test('Live observation is read-only, keeps only selected senses, and skips unchanged worlds',()=>{
 const world=createCrewWorld(4),journal=new ResidentJournal(),observer=new LiveObserver(journal);
 const original=journal.collect.bind(journal);let collections=0;journal.collect=w=>{collections++;original(w);};
 const before=hashCanonical(world);
 for(let i=0;i<300;i++){observer.observe(world);assert.deepEqual(observer.senses(world,'resident-a',false),{});}
 assert.equal(collections,1);
 const first=observer.senses(world,'resident-a',true);assert.deepEqual(Object.keys(first),['resident-a']);
 assert.equal(observer.senses(world,'resident-a',true),first);
 assert.deepEqual(Object.keys(observer.senses(world,'resident-b',true)),['resident-b']);
 assert.deepEqual(observer.senses(world,'missing',true),{});
 assert.deepEqual(observer.senses(world,'resident-a',false),{});
 assert.equal(hashCanonical(world),before);
 world.revision++;observer.observe(world);assert.equal(collections,2);
 world.runId+='-new';observer.observe(world);assert.equal(collections,3);
});

test('Compact checkpoint preserves all private state; failed durable write freezes the original batch',async()=>{
 const world=createCrewWorld(4),provider=new ColonyProvider({...DEFAULT_CONTROL,mode:'local'},{async plan(){throw Error('No remote calls allowed');}});
 let serialized='',attempts=0;const sim=new Simulation(provider,{world,controlMode:'local',onCommit:record=>{
  const checkpoint=liveCheckpoint(record);serialized=JSON.stringify(checkpoint);const saved=JSON.parse(serialized);
  assert.deepEqual(saved.world,record.nextWorld);
  assert.equal(hashCanonical(saved.world),record.afterHash);
  assert.equal(saved.commit.decisions.length,record.accepted.length);
  assert.equal('nextWorld' in saved.commit,false);assert.equal('accepted' in saved.commit,false);
  assert.ok(saved.world.residents.every((r:any)=>r.memories&&r.spatialMemory));
  if(++attempts===1)throw Error('EXPLICIT_STORAGE_FAILURE');
 }});
 const done=sim.bootstrap(),before=hashCanonical(sim.world);await done;assert.equal(sim.status,'ERROR_PAUSED');assert.equal(hashCanonical(sim.world),before);
 sim.frame(100000);assert.equal(hashCanonical(sim.world),before);
 await sim.retry();assert.equal(attempts,2);assert.equal(sim.status,'RUNNING');assert.equal(hashCanonical(sim.world),hashCanonical(JSON.parse(serialized).world));
 assert.equal(sim.frame(200000),0);assert.equal(sim.world.tick,0);assert.equal(provider.remoteCalls,0);sim.stop();
});
