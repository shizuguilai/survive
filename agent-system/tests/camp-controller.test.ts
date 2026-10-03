import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {CampSaves} from '../apps/laya-client/src/camp-save.ts';
import {controlSettings} from '../packages/contracts/src/command.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
const bundle=await build({entryPoints:['apps/laya-client/src/controller.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'observer-fixture',setup(b){b.onLoad({filter:/\/laya-client\/src\/view\.ts$/},()=>({contents:'export async function initialize(api){return globalThis.__campTestView(api)}',loader:'js'}));}}]});
const {boot}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settle=async()=>{for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r));};
test('Shipped controls save queued plans, auto-save, reload paused, continue the same camp and preserve it after Stop',async()=>{
 const g=globalThis as any,old={Laya:g.Laya,wx:g.wx,view:g.__campTestView,performance:g.performance},values=new Map<string,string>();let now=1,api:any,frame!:()=>void,rendered:any,hide!:()=>void,show!:()=>void;
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}},settings=controlSettings({mode:'local',residents:2});values.set('survive_control_v1',JSON.stringify(settings));
 Object.defineProperty(g,'performance',{configurable:true,value:{now:()=>now}});g.Laya={timer:{frameLoop(_n:number,_owner:any,fn:()=>void){frame=fn;}}};g.wx={getStorageSync:storage.getItem,setStorageSync:storage.setItem,onHide(fn:()=>void){hide=fn;},onShow(fn:()=>void){show=fn;}};g.__campTestView=(callbacks:any)=>{api=callbacks;return {render(s:any){rendered=s;}};};
 try{
  await boot();const run=rendered.world.runId;assert.equal(rendered.resumeReady,false);
  api.onTask({kind:'residential',resource:'wood',amount:1,note:'pending zone',bounds:{minX:-24,maxX:-5,minZ:-24,maxZ:-15}});await settle();
  let saved=new CampSaves(storage).load(settings).save!;assert.equal(saved.queuedTasks.length,1);assert.equal(saved.needsDecision,true);assert.equal(saved.world.camp!.zones?.length??0,0);
  await boot();assert.equal(rendered.resumeReady,true);assert.equal(rendered.world.runId,run);now+=86400000;frame();assert.equal(rendered.world.tick,0);
  api.onStart();await settle();frame();assert.equal(rendered.resumeReady,false);assert.equal(rendered.world.camp.zones.length,1);assert.equal(rendered.pendingTasks,0);
  now+=50;frame();await settle();frame();assert.ok(rendered.world.tick>0);api.onSave();await settle();saved=new CampSaves(storage).load(settings).save!;assert.equal(saved.world.runId,run);assert.equal(saved.needsDecision,false);
  const savedTick=saved.world.tick;now+=50;frame();await settle();frame();assert.ok(rendered.world.tick>savedTick);api.onLoad();await settle();frame();assert.equal(rendered.world.tick,savedTick);assert.equal(rendered.resumeReady,true);assert.match(rendered.saveStatus,/已存档/);
  api.onStart();await settle();frame();const seq=new CampSaves(storage).load(settings).save!.sequence;now+=10001;frame();await settle();frame();saved=new CampSaves(storage).load(settings).save!;assert.ok(saved.sequence>seq);assert.equal(saved.world.tick,rendered.world.tick);
  hide();const frozen=hashCanonical(rendered.world);now+=900000;frame();assert.equal(hashCanonical(rendered.world),frozen);show();frame();assert.equal(hashCanonical(rendered.world),frozen);
  api.onStop();await settle();frame();const stoppedTick=rendered.world.tick;api.onStart();await settle();frame();assert.equal(rendered.world.runId,run);assert.equal(rendered.world.tick,stoppedTick);assert.equal(rendered.world.camp.zones.length,1);api.onStop();await settle();
 }finally{g.Laya=old.Laya;g.wx=old.wx;g.__campTestView=old.view;Object.defineProperty(g,'performance',{configurable:true,value:old.performance});}
});

async function withControllerFixture(run:(fixture:any)=>Promise<void>):Promise<void>{
 const g=globalThis as any,old={Laya:g.Laya,wx:g.wx,view:g.__campTestView,performance:g.performance},values=new Map<string,string>();
 const fixture:any={now:1,api:null,rendered:null,frame:()=>{},values,quota:false,campWrites:0};
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{if(key.startsWith('survive_camp_')){fixture.campWrites++;if(fixture.quota)throw new DOMException('test quota','QuotaExceededError');}values.set(key,value);}};
 fixture.storage=storage;fixture.settings=controlSettings({mode:'local',residents:2});values.set('survive_control_v1',JSON.stringify(fixture.settings));
 Object.defineProperty(g,'performance',{configurable:true,value:{now:()=>fixture.now}});g.Laya={timer:{frameLoop(_n:number,_owner:any,fn:()=>void){fixture.frame=fn;}}};g.wx={getStorageSync:storage.getItem,setStorageSync:storage.setItem,onHide(){},onShow(){}};g.__campTestView=(callbacks:any)=>{fixture.api=callbacks;return {render(s:any){fixture.rendered=s;}};};
 try{await run(fixture);await settle();}finally{g.Laya=old.Laya;g.wx=old.wx;g.__campTestView=old.view;Object.defineProperty(g,'performance',{configurable:true,value:old.performance});}
}

test('Storage quota failure cannot abort a complete local decision batch; retries are bounded and manual save recovers',async()=>withControllerFixture(async f=>{
 await boot();f.api.onSave();await settle();f.frame();
 const good=new CampSaves(f.storage).load(f.settings).save!,priorSlots=[f.values.get('survive_camp_a_v1'),f.values.get('survive_camp_b_v1')];
 f.quota=true;f.now+=10001;f.api.onStart();await settle();f.frame();
 assert.equal(f.rendered.status,'RUNNING');assert.ok(f.rendered.world.revision>good.world.revision);
 assert.equal(f.rendered.world.events.filter((e:any)=>e.kind==='decision'&&e.source==='LOCAL_ALGORITHM').length,2,'both resident decisions commit together');
 assert.match(f.rendered.saveStatus,/存储空间不足.*游戏可继续/);assert.doesNotMatch(f.rendered.error??'',/quota|setItem|存档|网关/i);
 assert.deepEqual([f.values.get('survive_camp_a_v1'),f.values.get('survive_camp_b_v1')],priorSlots,'failed writes preserve both previous slots');
 assert.equal(new CampSaves(f.storage).load(f.settings).save!.savedAt,good.savedAt);
 const attempts=f.campWrites,startTick=f.rendered.world.tick,startRevision=f.rendered.world.revision;
 for(let i=0;i<12;i++){
  for(const r of f.rendered.world.residents){r.plan=[];r.nextReviewTick=f.rendered.world.tick;}
  f.now+=50;f.frame();await settle();f.frame();assert.notEqual(f.rendered.status,'ERROR_PAUSED');
 }
 assert.ok(f.rendered.world.tick>startTick);assert.ok(f.rendered.world.revision>startRevision+12,'subsequent local batches keep committing');
 assert.equal(f.campWrites,attempts,'local decision churn does not retry or serialize failed storage every batch');
 f.quota=false;f.api.onSave();await settle();f.frame();assert.match(f.rendered.saveStatus,/已存档/);
 const recovered=new CampSaves(f.storage).load(f.settings).save!;assert.ok(recovered.sequence>good.sequence);assert.equal(recovered.world.tick,f.rendered.world.tick);assert.equal(recovered.world.runId,good.world.runId);
 f.api.onStop();await settle();
}));

test('Unreadable legacy camp is preserved without freezing simulation until the user explicitly saves',async()=>withControllerFixture(async f=>{
 f.values.set('survive_camp_a_v1','{damaged legacy packet');await boot();assert.match(f.rendered.saveStatus,/存档校验失败/);
 f.api.onStart();await settle();f.frame();f.now+=50;f.frame();await settle();f.frame();assert.equal(f.rendered.status,'RUNNING');assert.ok(f.rendered.world.tick>0);
 assert.equal(f.values.get('survive_camp_a_v1'),'{damaged legacy packet');assert.equal(f.campWrites,0);assert.doesNotMatch(f.rendered.error??'',/存档|quota/i);
 f.api.onSave();await settle();f.frame();assert.match(f.rendered.saveStatus,/已存档/);assert.ok(new CampSaves(f.storage).load(f.settings).save);f.api.onStop();await settle();
}));

test('New camp wins over an already queued save and asynchronous load without restoring stale camp metadata',async()=>withControllerFixture(async f=>{
 await boot();f.api.onSave();await settle();const first=f.rendered.world.runId;
 f.api.onSave();f.api.onLoad();f.api.onControl({...f.settings,residents:4},true);await settle();f.frame();
 assert.notEqual(f.rendered.world.runId,first);assert.equal(f.rendered.world.residents.length,4);assert.equal(f.rendered.resumeReady,false);
 const current=f.rendered.world.runId,stored=new CampSaves(f.storage).load(f.settings).save!;assert.equal(stored.world.runId,current);assert.equal(stored.settings.residents,4);assert.equal(stored.needsDecision,true);
 f.api.onStart();await settle();f.frame();assert.equal(f.rendered.world.runId,current);assert.equal(f.rendered.status,'RUNNING');f.api.onStop();await settle();
}));

test('Offline retry recovers a local planning error without contacting the model gateway',async()=>withControllerFixture(async f=>{
 const fetchBefore=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('No network in offline mode');};
 try{
  await boot();const resident=f.rendered.world.residents[0],background=resident.background;
  resident.background='超长测试'.repeat(600);f.api.onStart();await settle();f.frame();
  assert.equal(f.rendered.status,'ERROR_PAUSED');assert.match(f.rendered.error,/本地规划失败/);
  resident.background=background;f.api.onRetry();await settle();f.frame();
  assert.equal(f.rendered.status,'RUNNING');assert.equal(requests,0);
  assert.doesNotMatch(f.rendered.error??'',/网关|连接|规划失败/);
  f.now+=50;f.frame();assert.ok(f.rendered.world.tick>0);f.api.onStop();await settle();
 }finally{globalThis.fetch=fetchBefore;}
}));
