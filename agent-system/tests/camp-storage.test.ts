import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AsyncCampSaves,IndexedDBCampStorage,type AsyncSaveStorage} from '../apps/laya-client/src/camp-storage.ts';
import {CampSaves,CAMP_SAVE_KEYS,type CampSaveState,type SaveStorage} from '../apps/laya-client/src/camp-save.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {controlSettings} from '../packages/contracts/src/command.ts';

const settings=controlSettings({mode:'local',residents:2});
const state=():CampSaveState=>({world:createCrewWorld(2),settings,queuedTasks:[],selectedId:'resident-a',showSenses:false,needsDecision:false});
class Legacy implements SaveStorage{
 values=new Map<string,string>();fail=false;removed:string[]=[];
 getItem(key:string){return this.values.get(key)??null;}
 setItem(key:string,value:string){if(this.fail)throw new DOMException('full','QuotaExceededError');this.values.set(key,value);}
 removeItem(key:string){this.removed.push(key);this.values.delete(key);}
}
class Database implements AsyncSaveStorage{
 values=new Map<string,string>();failRead=false;failWrite=false;writeCount=0;readCount=0;pending?:()=>Promise<void>;
 async read(keys:readonly string[]){this.readCount++;if(this.failRead)throw Error('blocked');return new Map(keys.filter(key=>this.values.has(key)).map(key=>[key,this.values.get(key)!]));}
 async write(entries:readonly (readonly [string,string])[]){this.writeCount++;await this.pending?.();if(this.failWrite)throw new DOMException('full','QuotaExceededError');for(const [key,raw]of entries)this.values.set(key,raw);}
}
function seed(storage:Legacy){const saves=new CampSaves(storage),s=state();s.world.tick=10;saves.save(s,100);s.world.tick=20;saves.save(s,200);return s;}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('full localStorage migrates both validated slots, verifies them, then removes only their exact originals',async()=>{
 const legacy=new Legacy(),database=new Database(),s=seed(legacy),original=new Map(legacy.values);legacy.values.set('other-game','keep');legacy.values.set('survive_resident_history_v1','history');legacy.fail=true;
 const saves=new AsyncCampSaves(legacy,database),loaded=await saves.load(settings);
 assert.equal(loaded.save!.world.tick,20);assert.equal(loaded.blocked,false);assert.match(loaded.warning,/迁移/);assert.equal(saves.storageMode,'indexeddb');
 assert.deepEqual(database.values,original);assert.ok(database.readCount>=2);assert.deepEqual(legacy.removed,[...CAMP_SAVE_KEYS]);assert.equal(legacy.getItem('other-game'),'keep');assert.equal(legacy.getItem('survive_resident_history_v1'),'history');
 s.world.tick=30;await saves.save(s,300);assert.equal((await new AsyncCampSaves(legacy,database).load(settings)).save!.world.tick,30);
});

test('failed migration and quota preserve every old slot and never report a successful save',async()=>{
 const legacy=new Legacy(),s=seed(legacy),original=[...legacy.values],database=new Database();database.failWrite=true;legacy.fail=true;
 const saves=new AsyncCampSaves(legacy,database),loaded=await saves.load(settings);assert.equal(loaded.save!.world.tick,20);assert.equal(saves.storageMode,'legacy');assert.deepEqual([...legacy.values],original);assert.deepEqual(legacy.removed,[]);
 s.world.tick=99;await assert.rejects(saves.save(s,300),{name:'QuotaExceededError'});assert.deepEqual([...legacy.values],original);assert.equal(new CampSaves(legacy).load(settings).save!.world.tick,20);
});

test('migration read-back mismatch or concurrently changed legacy slots cannot delete the originals',async()=>{
 const legacy=new Legacy();seed(legacy);const original=[...legacy.values];const database=new Database();const read=database.read.bind(database);
 database.read=async keys=>{const result=await read(keys);if(database.writeCount)result.set(CAMP_SAVE_KEYS[0],'corrupt');return result;};
 await new AsyncCampSaves(legacy,database).load(settings);assert.deepEqual([...legacy.values],original);assert.deepEqual(legacy.removed,[]);
 const other=new Legacy();seed(other);const second=new Database();second.pending=async()=>{other.values.set(CAMP_SAVE_KEYS[0],'concurrent edit');};
 await new AsyncCampSaves(other,second).load(settings);assert.equal(other.getItem(CAMP_SAVE_KEYS[0]),'concurrent edit');assert.deepEqual(other.removed,[CAMP_SAVE_KEYS[1]]);
});

test('corrupt newest database slot restores the previous valid snapshot; corrupt legacy raw data is kept',async()=>{
 const legacy=new Legacy(),database=new Database(),source=new Legacy();seed(source);database.values=new Map(source.values);database.values.set(CAMP_SAVE_KEYS[1],'{interrupted');legacy.values.set(CAMP_SAVE_KEYS[0],'{old corrupt');
 const saves=new AsyncCampSaves(legacy,database),loaded=await saves.load(settings);assert.equal(loaded.save!.world.tick,10);assert.match(loaded.warning,/另一份/);assert.equal(legacy.getItem(CAMP_SAVE_KEYS[0]),'{old corrupt');
 const s=state();s.world.tick=11;await saves.save(s,300);assert.equal((await new AsyncCampSaves(legacy,database).load(settings)).save!.world.tick,11);
});

test('both corrupt database slots block autosave and stay intact until explicit save',async()=>{
 const legacy=new Legacy(),database=new Database();database.values.set(CAMP_SAVE_KEYS[0],'{a');database.values.set(CAMP_SAVE_KEYS[1],'{b');const original=[...database.values];
 const saves=new AsyncCampSaves(legacy,database),loaded=await saves.load(settings);assert.equal(loaded.save,null);assert.equal(loaded.blocked,true);assert.deepEqual([...database.values],original);assert.equal(database.writeCount,0);
 await saves.save(state(),100);assert.ok((await new AsyncCampSaves(legacy,database).load(settings)).save);
});

test('the newest valid timestamp wins across database and legacy; migrating preserves the whole world',async()=>{
 const legacy=new Legacy(),s=seed(legacy),database=new Database(),oldDB=new Legacy();new CampSaves(oldDB).save(state(),50);database.values=new Map(oldDB.values);
 const loaded=await new AsyncCampSaves(legacy,database).load(settings);assert.deepEqual(loaded.save!.world,s.world);
 // An older legacy backup must not replace a newer durable database snapshot.
 const newer=new Legacy(),latest=state();latest.world.tick=500;new CampSaves(newer).save(latest,1000);database.values=new Map(newer.values);seed(legacy);
 assert.equal((await new AsyncCampSaves(legacy,database).load(settings)).save!.world.tick,500);assert.equal(database.values.get(CAMP_SAVE_KEYS[0]),newer.getItem(CAMP_SAVE_KEYS[0]));
});

test('one surviving legacy slot replaces a stale database sequence without leaving a newer-looking old backup',async()=>{
 const legacy=new Legacy(),database=new Database(),old=new Legacy(),oldCodec=new CampSaves(old),s=state();
 for(let i=0;i<6;i++)oldCodec.save(s,10+i);database.values=new Map(old.values);
 s.world.tick=800;new CampSaves(legacy).save(s,1000);legacy.values.set(CAMP_SAVE_KEYS[1],'{corrupt old backup');
 assert.equal((await new AsyncCampSaves(legacy,database).load(settings)).save!.world.tick,800);
 assert.equal((await new AsyncCampSaves(legacy,database).load(settings)).save!.world.tick,800);
 assert.equal(legacy.getItem(CAMP_SAVE_KEYS[1]),'{corrupt old backup');assert.equal(database.values.get(CAMP_SAVE_KEYS[0]),database.values.get(CAMP_SAVE_KEYS[1]));
});

test('save snapshots immediately, serializes writes and load waits for the complete transaction',async()=>{
 const legacy=new Legacy(),database=new Database(),saves=new AsyncCampSaves(legacy,database);await saves.load(settings);
 let release!:()=>void;database.pending=()=>new Promise<void>(resolve=>{release=resolve;});const s=state();s.world.tick=1;let firstDone=false;const first=saves.save(s,10).then(save=>{firstDone=true;return save;});s.world.tick=2;
 const second=saves.save(s,20);s.world.tick=3;const loaded=saves.load(settings);await turn();assert.equal(database.writeCount,1);assert.equal(firstDone,false);assert.equal(database.values.size,0);
 database.pending=undefined;release();assert.equal((await first).world.tick,1);assert.equal((await second).world.tick,2);assert.equal((await loaded).save!.world.tick,2);assert.equal(database.writeCount,2);
});

test('failed durable write retains the previous slot; the next save retries without advancing the sequence',async()=>{
 const legacy=new Legacy(),database=new Database(),saves=new AsyncCampSaves(legacy,database),s=state();legacy.fail=true;await saves.save(s,10);const original=[...database.values];database.failWrite=true;s.world.tick=100;
 await assert.rejects(saves.save(s,20),{name:'QuotaExceededError'});assert.deepEqual([...database.values],original);database.failWrite=false;assert.equal((await saves.save(s,30)).sequence,2);assert.equal((await saves.load(settings)).save!.world.tick,100);
});

test('the committed cursor follows a successful legacy fallback and resets to externally reloaded database slots',async()=>{
 const legacy=new Legacy(),database=new Database(),saves=new AsyncCampSaves(legacy,database),s=state();await saves.save(s,10);
 database.failWrite=true;s.world.tick=20;assert.equal((await saves.save(s,20)).sequence,2);assert.equal(saves.storageMode,'legacy');
 database.failWrite=false;s.world.tick=30;assert.equal((await saves.save(s,30)).sequence,3);assert.equal(saves.storageMode,'indexeddb');
 const external=new AsyncCampSaves(legacy,database);await external.load(settings);s.world.tick=40;assert.equal((await external.save(s,40)).sequence,4);
 assert.equal((await saves.load(settings)).save!.world.tick,40);s.world.tick=50;assert.equal((await saves.save(s,50)).sequence,5);
 assert.equal((await new AsyncCampSaves(legacy,database).load(settings)).save!.world.tick,50);
});

test('database accepts a complete camp larger than synchronous quota without dropping private memories',async()=>{
 const legacy=new Legacy(),database=new Database(),saves=new AsyncCampSaves(legacy,database),s=state();legacy.fail=true;
 s.world.residents[0].background='长久记忆'.repeat(800_000);await saves.save(s,100);const restored=(await new AsyncCampSaves(legacy,database).load(settings)).save!;
 assert.equal(restored.world.residents[0].background,s.world.residents[0].background);assert.ok(database.values.get(CAMP_SAVE_KEYS[0])!.length>3_000_000);
});

test('unavailable database falls back to synchronous storage; bounded blocked open closes a late connection',async()=>{
 const legacy=new Legacy(),database=new Database();database.failRead=true;const saves=new AsyncCampSaves(legacy,database);await saves.save(state(),100);assert.equal(saves.storageMode,'legacy');assert.ok(new CampSaves(legacy).load(settings).save);
 const request:any={};let closed=0;const storage=new IndexedDBCampStorage({open(){return request;}}as any,10,10);const pending=storage.read(CAMP_SAVE_KEYS);await assert.rejects(pending,/超时/);request.result={close(){closed++;}};request.onsuccess();assert.equal(closed,1);
});
