import {CampSaves,CAMP_SAVE_KEYS,LEGACY_CAMP_SAVE_KEY,decodeCampSave,type CampSave,type CampSaveState,type SaveStorage} from './camp-save.ts';
import type {ControlSettings} from '../../../packages/contracts/src/command.ts';

export const CAMP_DATABASE='survive-camp-v1';
export const CAMP_OBJECT_STORE='snapshots';
export type StoredCampPacket=string|{format:'survive-camp-gzip-v1';data:Uint8Array};
export type CampLoadResult=ReturnType<CampSaves['load']>;
/** All writes in one call must commit atomically; success means the transaction completed. */
export interface AsyncSaveStorage{
 read(keys:readonly string[]):Promise<Map<string,string>>;
 write(entries:readonly (readonly [string,string])[]):Promise<void>;
}
async function compressPacket(raw:string):Promise<StoredCampPacket>{
 if(typeof CompressionStream==='undefined'||typeof DecompressionStream==='undefined')return raw;
 try{
  const packed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return {format:'survive-camp-gzip-v1',data:packed};
 }catch{return raw;}
}
async function decompressPacket(packet:unknown):Promise<string>{
 if(typeof packet==='string')return packet;
 if(packet&&typeof packet==='object'&&(packet as any).format==='survive-camp-gzip-v1'&&(packet as any).data instanceof Uint8Array){
  return new Response(new Blob([(packet as {data:Uint8Array<ArrayBuffer>}).data]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 }
 throw Error('营地压缩存档无法读取');
}

/** Browser database, independent of the small synchronous localStorage quota. */
export class IndexedDBCampStorage implements AsyncSaveStorage{
 private factory:IDBFactory;private openTimeout:number;private transactionTimeout:number;
 constructor(factory:IDBFactory=globalThis.indexedDB,openTimeout=3000,transactionTimeout=8000){this.factory=factory;this.openTimeout=openTimeout;this.transactionTimeout=transactionTimeout;}
 private open():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
   let done=false,request:IDBOpenDBRequest;
   const finish=(error?:unknown,db?:IDBDatabase)=>{if(done){db?.close();return;}done=true;clearTimeout(timer);error?reject(error):resolve(db!);};
   const timer=setTimeout(()=>finish(Error('营地数据库读取超时')),this.openTimeout);
   try{request=this.factory.open(CAMP_DATABASE,1);}catch(error){finish(error);return;}
   request.onupgradeneeded=()=>{if(done){request.transaction?.abort();return;}if(!request.result.objectStoreNames.contains(CAMP_OBJECT_STORE))request.result.createObjectStore(CAMP_OBJECT_STORE);};
   request.onblocked=()=>finish(Error('营地数据库暂被其他页面占用'));
   request.onerror=()=>finish(request.error??Error('营地数据库无法打开'));
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();finish(undefined,db);};
  });
 }
 private async transaction<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>()=>T):Promise<T>{
  const db=await this.open();
  return new Promise((resolve,reject)=>{
   let done=false,tx:IDBTransaction|undefined;
   const finish=(error?:unknown,value?:T)=>{if(done)return;done=true;clearTimeout(timer);db.close();error?reject(error):resolve(value!);};
   const timer=setTimeout(()=>{try{tx?.abort();}catch{}finish(Error('营地数据库写入超时'));},this.transactionTimeout);
   try{
    tx=db.transaction(CAMP_OBJECT_STORE,mode);
    const result=operation(tx.objectStore(CAMP_OBJECT_STORE));
    tx.oncomplete=()=>finish(undefined,result());
    tx.onabort=()=>finish(tx?.error??Error('营地数据库事务已中止'));
    tx.onerror=()=>{/* An error aborts the transaction; only oncomplete reports success. */};
   }catch(error){try{tx?.abort();}catch{}finish(error);}
  });
 }
 async read(keys:readonly string[]):Promise<Map<string,string>>{
  const records=await this.transaction('readonly',store=>{const values=new Map<string,unknown>();for(const key of keys){const request=store.get(key);request.onsuccess=()=>{if(request.result!==undefined)values.set(key,request.result);};}return()=>values;});
  const decoded=new Map<string,string>();await Promise.all([...records].map(async([key,packet])=>{try{decoded.set(key,await decompressPacket(packet));}catch{decoded.set(key,'{unreadable compressed save');}}));return decoded;
 }
 async write(entries:readonly (readonly [string,string])[]):Promise<void>{
  const records=await Promise.all(entries.map(async([key,raw])=>[key,await compressPacket(raw)]as const));
  return this.transaction('readwrite',store=>{for(const [key,value]of records)store.put(value,key);return()=>undefined;});
 }
}

class MemorySlots implements SaveStorage{
 values:Map<string,string>;
 constructor(values:ReadonlyMap<string,string>=new Map()){this.values=new Map(values);}
 getItem(key:string){return this.values.get(key)??null;}
 setItem(key:string,value:string){this.values.set(key,value);}
}
const newer=(a:CampSave,b:CampSave)=>a.savedAt-b.savedAt||a.sequence-b.sequence;
const append=(...messages:string[])=>[...new Set(messages.filter(Boolean))].join(' ');
const keys=[...CAMP_SAVE_KEYS,LEGACY_CAMP_SAVE_KEY];

/**
 * Saves capture an immutable snapshot at invocation, then queue durable commits.
 * The two verified legacy slots stay intact during migration and on database failure.
 * Mini-game runtimes without IndexedDB keep the existing synchronous atomic writer.
 */
export class AsyncCampSaves{
 private legacy:SaveStorage;private backend:AsyncSaveStorage|null;private mode:'indexeddb'|'legacy'='legacy';
 private memory=new MemorySlots();private ready=false;private tail:Promise<unknown>=Promise.resolve();
 constructor(legacy:SaveStorage,backend?:AsyncSaveStorage|null){
  this.legacy=legacy;
  if(backend!==undefined)this.backend=backend;else{try{this.backend=globalThis.indexedDB?new IndexedDBCampStorage():null;}catch{this.backend=null;}}
 }
 get storageMode(){return this.mode;}
 private queue<T>(work:()=>Promise<T>):Promise<T>{const next=this.tail.then(work);this.tail=next.catch(()=>{});return next;}
 private readLegacy():{memory:MemorySlots;readFailed:boolean}{
  const memory=new MemorySlots();let readFailed=false;
  for(const key of keys)try{const raw=this.legacy.getItem(key);if(raw)memory.setItem(key,raw);}catch{readFailed=true;}
  return {memory,readFailed};
 }
 private async initialize(settings:ControlSettings):Promise<CampLoadResult>{
  const legacy=this.readLegacy(),old=new CampSaves(legacy.memory).load(settings);
  if(legacy.readFailed){old.warning=append(old.warning,'本机旧存档暂时无法读取。');if(!old.save)old.blocked=true;}
  let database=new MemorySlots(),current:CampLoadResult={save:null,warning:'',blocked:false};
  if(this.backend){try{database=new MemorySlots(await this.backend.read(keys));current=new CampSaves(database).load(settings);this.mode='indexeddb';}catch{this.backend=null;this.mode='legacy';}}
  let result=current.save&&(!old.save||newer(current.save,old.save)>=0)?current:old;
  this.memory=result===current?database:legacy.memory;
  if(this.backend&&result===old&&old.save){
   // The old checkpoint has sequence zero; convert it through the validated packet codec.
   if(old.save.sequence===0){const converter=new CampSaves(this.memory);converter.load(settings);converter.save(old.save,old.save.savedAt);}
   const valid:CAMPEntry[]=[];
   for(const key of CAMP_SAVE_KEYS){const raw=this.memory.getItem(key);if(raw)try{decodeCampSave(raw);valid.push([key,raw]);}catch{}}
   try{
    // Replace both database slots even when only one legacy slot survived. Otherwise an
    // unrelated older database record with a larger sequence could win on the next load.
    const migrating=valid.length===1?CAMP_SAVE_KEYS.map(key=>[key,valid[0][1]]as const):valid;
    await this.backend.write(migrating);
    const verified=await this.backend.read(CAMP_SAVE_KEYS);
    for(const [key,raw]of migrating){if(verified.get(key)!==raw)throw Error('营地迁移校验失败');decodeCampSave(verified.get(key)!);}
    // Free only the exact originals now present in a completed, verified database transaction.
    // A corrupt slot, legacy checkpoint or concurrent edit is never removed here.
    if(this.legacy.removeItem)for(const [key,raw]of valid)try{if(this.legacy.getItem(key)===raw)this.legacy.removeItem(key);}catch{}
    this.memory=new MemorySlots(verified);
    this.mode='indexeddb';result={...old,warning:append(old.warning,'旧营地已迁移到新的本机存档。')};
   }
   catch{this.backend=null;this.mode='legacy';result={...old,warning:append(old.warning,'新存档暂不可用，继续保留旧营地存档。')};}
  }
  if(!result.save){result={save:null,blocked:old.blocked||current.blocked,warning:append(old.warning,current.warning)};}
  else if(result===old&&current.blocked)result={...result,warning:append(result.warning,'新存档无法读取，已恢复旧营地存档。')};
  this.ready=true;return result;
 }
 load(settings:ControlSettings):Promise<CampLoadResult>{return this.queue(()=>this.initialize(settings));}
 save(state:CampSaveState,savedAt=Date.now()):Promise<CampSave>{
  // Snapshot before any await: a changing world must never enter a pending database write.
  let snapshot:CampSaveState;try{snapshot=structuredClone(state);}catch(error){return Promise.reject(error);}
  return this.queue(async()=>{
   if(!this.ready)await this.initialize(snapshot.settings);
   const staged=new MemorySlots(this.memory.values),codec=new CampSaves(staged);codec.load(snapshot.settings);
   const data=codec.save(snapshot,savedAt),changed:CAMPEntry[]=[];
   for(const key of CAMP_SAVE_KEYS){const raw=staged.getItem(key);if(raw&&raw!==this.memory.getItem(key))changed.push([key,raw]);}
   if(this.backend){try{await this.backend.write(changed);this.memory=staged;this.mode='indexeddb';return data;}catch{/* A safe legacy write may still work; neither old slot is removed. */}}
   // There is only one changed alternating slot for a normal save. setItem is atomic.
   for(const [key,value]of changed)this.legacy.setItem(key,value);
   this.memory=staged;this.mode='legacy';return data;
  });
 }
}
type CAMPEntry=readonly [string,string];
