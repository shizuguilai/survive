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
  api.onTask({kind:'residential',resource:'wood',amount:1,note:'pending zone',bounds:{minX:-24,maxX:-5,minZ:-24,maxZ:-15}});
  let saved=new CampSaves(storage).load(settings).save!;assert.equal(saved.queuedTasks.length,1);assert.equal(saved.needsDecision,true);assert.equal(saved.world.camp!.zones?.length??0,0);
  await boot();assert.equal(rendered.resumeReady,true);assert.equal(rendered.world.runId,run);now+=86400000;frame();assert.equal(rendered.world.tick,0);
  api.onStart();await settle();frame();assert.equal(rendered.resumeReady,false);assert.equal(rendered.world.camp.zones.length,1);assert.equal(rendered.pendingTasks,0);
  now+=50;frame();await settle();frame();assert.ok(rendered.world.tick>0);api.onSave();saved=new CampSaves(storage).load(settings).save!;assert.equal(saved.world.runId,run);assert.equal(saved.needsDecision,false);
  const savedTick=saved.world.tick;now+=50;frame();await settle();frame();assert.ok(rendered.world.tick>savedTick);api.onLoad();frame();assert.equal(rendered.world.tick,savedTick);assert.equal(rendered.resumeReady,true);assert.match(rendered.saveStatus,/已存档/);
  api.onStart();await settle();frame();const seq=new CampSaves(storage).load(settings).save!.sequence;now+=10001;frame();await settle();frame();saved=new CampSaves(storage).load(settings).save!;assert.ok(saved.sequence>seq);assert.equal(saved.world.tick,rendered.world.tick);
  hide();const frozen=hashCanonical(rendered.world);now+=900000;frame();assert.equal(hashCanonical(rendered.world),frozen);show();frame();assert.equal(hashCanonical(rendered.world),frozen);
  api.onStop();await settle();frame();const stoppedTick=rendered.world.tick;api.onStart();await settle();frame();assert.equal(rendered.world.runId,run);assert.equal(rendered.world.tick,stoppedTick);assert.equal(rendered.world.camp.zones.length,1);api.onStop();await settle();
 }finally{g.Laya=old.Laya;g.wx=old.wx;g.__campTestView=old.view;Object.defineProperty(g,'performance',{configurable:true,value:old.performance});}
});
