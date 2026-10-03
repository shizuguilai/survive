import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

// Isolated browser contexts only. The production controller, simulation and Laya UI run unchanged.
// Prototype wrappers expose read-only QA metrics; explicit fixtures seed old saves and browser quota.
// No real remote model is used, and no user's actual browser data is opened or cleared.
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const fixture=`
import {boot} from './apps/laya-client/src/controller.ts';
import {ObserverView} from './apps/laya-client/src/view.ts';
import {CampSaves,CAMP_SAVE_KEYS} from './apps/laya-client/src/camp-save.ts';
import {Simulation} from './packages/sim-core/src/cognition.ts';
import {createCrewWorld} from './packages/sim-core/src/world.ts';
import {postTask} from './packages/sim-core/src/camp.ts';
import {controlSettings} from './packages/contracts/src/command.ts';
import {hashCanonical} from './packages/contracts/src/canonical.ts';
const failing=new URL(location.href).searchParams.get('case')==='unavailable';
const nativeOpen=indexedDB.open.bind(indexedDB);
const statusHistory=[];globalThis.qaStatuses=statusHistory;
const render=ObserverView.prototype.render;
ObserverView.prototype.render=function(state){globalThis.qaView=this;globalThis.qaState=state;return render.call(this,state);};
const frame=Simulation.prototype.frame;
Simulation.prototype.frame=function(now){globalThis.qaSim=this;return frame.call(this,now);};
const status=Simulation.prototype.setStatus;
Simulation.prototype.setStatus=function(value){statusHistory.push({status:value,tick:this.world.tick});return status.call(this,value);};
const fillQuota=()=>{let low=0,high=6*1024*1024,quotaName='';while(low<high){const mid=Math.ceil((low+high)/2);try{localStorage.setItem('qa-storage-filler','x'.repeat(mid));low=mid;}catch(error){quotaName=error.name;high=mid-1;}}localStorage.setItem('qa-storage-filler','x'.repeat(low));try{localStorage.setItem('qa-extra','x');}catch(error){quotaName=error.name;}return {fillerCharacters:low,quotaName};};
globalThis.qaFillQuota=fillQuota;
const fingerprint=()=>CAMP_SAVE_KEYS.map(key=>{const raw=localStorage.getItem(key);return {key,length:raw?.length??0,hash:hashCanonical(raw)};});
if(!sessionStorage.getItem('qaSeed')){
 const settings=controlSettings({mode:'local',residents:4}),world=createCrewWorld(4);
 world.runId='save-quota-browser-fixture-'+(failing?'failure':'indexeddb');world.tick=100;world.camp.stock={wood:91,stone:27,food:73};
 postTask(world,{kind:'planting',resource:'food',amount:1,note:'显式验收农地',cropKind:'rice',bounds:{minX:-22,maxX:-18,minZ:-20,maxZ:-16}});
 const storage=new CampSaves(localStorage),state={world,settings,queuedTasks:[],selectedId:world.residents[0].id,showSenses:false,needsDecision:true};
 localStorage.setItem('survive_control_v1',JSON.stringify(settings));localStorage.setItem('qa-unrelated-settings','preserve-me');
 storage.save(state,Date.now()-2000);world.tick=102;world.revision++;storage.save(state,Date.now()-1000);
 // Reach the browser's real localStorage limit, not a mocked Storage.setItem failure.
 const {fillerCharacters,quotaName}=fillQuota();
 sessionStorage.setItem('qaSeed',JSON.stringify({runId:world.runId,tick:world.tick,stock:{...world.camp.stock},zoneIds:world.camp.zones.map(z=>z.id),slots:fingerprint(),fillerCharacters,quotaName}));
}
if(failing)indexedDB.open=()=>{throw new DOMException('Explicit test backend quota','QuotaExceededError');};
globalThis.qaSeed=JSON.parse(sessionStorage.getItem('qaSeed'));
globalThis.qaFingerprint=fingerprint;
globalThis.qaSummary=()=>({runId:qaSim.world.runId,tick:qaSim.world.tick,revision:qaSim.world.revision,stock:{...qaSim.world.camp.stock},zoneIds:qaSim.world.camp.zones.map(z=>z.id),status:qaSim.status,viewStatus:qaState.status,saveStatus:qaState.saveStatus,saveLabel:qaView.labels.saveStatus.text,error:qaState.error??'',historyWarning:qaState.historyWarning??'',worldHash:hashCanonical(qaSim.world),statuses:[...statusHistory],pauseTokens:[...qaSim.pauseTokens]});
globalThis.qaDurable=()=>new Promise((resolve,reject)=>{
 const request=nativeOpen('survive-camp-v1',1);request.onerror=()=>reject(request.error);
 request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('snapshots')){db.close();resolve([]);return;}
 const tx=db.transaction('snapshots','readonly'),req=tx.objectStore('snapshots').getAll();req.onerror=()=>reject(req.error);req.onsuccess=async()=>{try{const results=await Promise.all(req.result.map(async raw=>{if(raw?.format==='survive-camp-gzip-v1')raw=await new Response(new Blob([raw.data]).stream().pipeThrough(new DecompressionStream('gzip'))).text();const packet=typeof raw==='string'?JSON.parse(raw):raw;const d=packet.data;return {sequence:d.sequence,savedAt:d.savedAt,tick:d.world.tick,runId:d.world.runId,stock:d.world.camp.stock,worldHash:hashCanonical(d.world)};}));db.close();resolve(results.sort((a,b)=>b.savedAt-a.savedAt||b.sequence-a.sequence));}catch(error){db.close();reject(error);}};};
});
await boot();globalThis.qaReady=true;
`;
const built=await build({stdin:{sourcefile:'save-quota-fixture.ts',resolveDir:process.cwd(),contents:fixture},bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const warningRefresh=process.argv.includes('--refresh-warning');
const profiles=[];await mkdir('local-evidence',{recursive:true});await mkdir('evidence',{recursive:true});
try{
 for(const config of [{name:'indexeddb',width:1536,height:864,dpr:1},{name:'unavailable',width:844,height:390,dpr:2}].filter(config=>!warningRefresh||config.name==='unavailable')){
  const context=await browser.newContext({viewport:{width:config.width,height:config.height},deviceScaleFactor:config.dpr,hasTouch:config.dpr>1});
  const page=await context.newPage(),errors=[],missing=[],requests=[],screenshots=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://survive.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname.startsWith('/api/')){requests.push(pathname);return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'EXPLICIT_QA_REMOTE_DISABLED'})});}
   try{
    if(pathname==='/qa-font.woff')return route.fulfill({body:await readFile('apps/laya-client/assets/art/camp-sans.woff'),contentType:'font/woff'});
    if(pathname==='/app.js')return route.fulfill({body:built.outputFiles[0].text,contentType:'text/javascript'});
    let body=await readFile(resolve('dist','.'+(pathname==='/'?'/index.html':pathname)));
    if(pathname==='/')body=Buffer.from(body.toString().replace('<script src="app.js"></script>','<script type="module">const f=new FontFace("Camp Sans","url(/qa-font.woff)");await f.load();document.fonts.add(f);await import("/app.js");</script>'));
    await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'}[pathname==='/'?'.html':extname(pathname)]??'application/octet-stream')});
   }catch{missing.push(pathname);await route.fulfill({status:404,body:'missing'});}
  });
  const ready=()=>page.waitForFunction(()=>globalThis.qaReady&&globalThis.qaView?.buttons.start,undefined,{timeout:30000});
  const click=id=>page.evaluate(id=>qaView.buttons[id].root.event(Laya.Event.CLICK),id);
  const shot=async name=>{await page.waitForTimeout(80);const path='local-evidence/save-quota-'+config.name+'-'+name+'.png';await page.screenshot({path});screenshots.push(path);};
  try{
   await page.goto('https://survive.test/?case='+config.name);await ready();
   const seed=await page.evaluate(()=>qaSeed),initial=await page.evaluate(()=>qaSummary());
   assert.equal(seed.quotaName,'QuotaExceededError');assert.ok(seed.fillerCharacters>1_000_000);
   assert.equal(initial.runId,seed.runId);assert.equal(initial.tick,seed.tick);assert.deepEqual(initial.stock,seed.stock);assert.deepEqual(initial.zoneIds,seed.zoneIds);
   const migratedSlots=await page.evaluate(()=>qaFingerprint());
   if(config.name==='indexeddb')assert.ok(migratedSlots.every(slot=>slot.length===0));else assert.deepEqual(migratedSlots,seed.slots);
   const quotaAtCommit=await page.evaluate(()=>qaFillQuota());assert.equal(quotaAtCommit.quotaName,'QuotaExceededError');
   await click('start');await page.waitForFunction(tick=>qaSim.world.tick>=tick+30&&qaSim.status==='RUNNING'&&!qaSim.paused,seed.tick,{timeout:20000});
   const running=await page.evaluate(()=>qaSummary());
   assert.ok(running.statuses.some(x=>x.status==='COMMITTING'));assert.ok(running.statuses.some(x=>x.status==='RUNNING'));assert.ok(running.statuses.every(x=>x.status!=='ERROR_PAUSED'));
   assert.equal(/quota|setItem|storage|认知请求失败/i.test(running.error),false);
   await shot('running');await click('pause');await click('saveCamp');
   let durable=null;
   if(config.name==='indexeddb'){
    await page.waitForFunction(async()=>{const rows=await qaDurable();return rows[0]?.tick===qaSim.world.tick&&/^本机已存档/.test(qaState.saveStatus);},undefined,{timeout:20000});
    durable=await page.evaluate(()=>qaDurable());assert.ok(durable.length>=2);assert.equal(durable[0].runId,seed.runId);assert.ok(durable[0].tick>seed.tick);
   }else{
    await page.waitForFunction(()=>/不足|失败|未保存/.test(qaState.saveStatus),undefined,{timeout:15000});
   }
   await page.waitForFunction(()=>qaState.status==='PAUSED');
   const stopped=await page.evaluate(()=>qaSummary());
   assert.equal(stopped.viewStatus,'PAUSED');assert.equal(stopped.saveLabel,stopped.saveStatus);assert.equal(/quota|setItem|storage|认知请求失败/i.test(stopped.error),false);
   assert.deepEqual(await page.evaluate(()=>qaFingerprint()),migratedSlots);
   if(durable){assert.equal(durable[0].worldHash,stopped.worldHash);assert.deepEqual(durable[0].stock,stopped.stock);}
   else{assert.match(stopped.saveStatus,/未保存|不足|失败/);assert.doesNotMatch(stopped.saveStatus,/本机已存档/);}
   await shot('save-status');
   if(warningRefresh){
    const fontRefresh=await page.evaluate(()=>({label:qaView.labels.saveStatus.text,extensionLoaded:document.fonts.check('14px \"Camp Extension\"','游戏迁'),containsCompleteWarning:qaView.labels.saveStatus.text.endsWith('游戏可继续。')}));
    assert.equal(fontRefresh.extensionLoaded,true);assert.equal(fontRefresh.containsCompleteWarning,true);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    const prior=JSON.parse(await readFile('evidence/save-quota-ui.json','utf8'));prior.warningFontRefresh={...fontRefresh,viewport:config,screenshot:screenshots.at(-1),errors,missing};await writeFile('evidence/save-quota-ui.json',JSON.stringify(prior,null,2)+'\n');console.log(JSON.stringify({warningFontRefresh:prior.warningFontRefresh}));continue;
   }
   await page.reload();await ready();const reloaded=await page.evaluate(()=>qaSummary());
   assert.equal(reloaded.runId,seed.runId);assert.equal(reloaded.tick,durable?durable[0].tick:seed.tick);assert.deepEqual(reloaded.stock,durable?durable[0].stock:seed.stock);assert.deepEqual(reloaded.zoneIds,seed.zoneIds);assert.equal(await page.evaluate(()=>localStorage.getItem('qa-unrelated-settings')),'preserve-me');
   assert.deepEqual(await page.evaluate(()=>qaFingerprint()),migratedSlots);
   if(durable)assert.equal(reloaded.worldHash,durable[0].worldHash);
   await shot('reloaded');assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(requests,[]);
   profiles.push({config,seed,quotaAtCommit,migratedSlots,initial,running,stopped,durable,reloaded,assertions:{realLocalStorageQuotaReached:true,productionControllerAndSimulation:true,decisionCommitsWithoutErrorPause:true,simulationTicksAdvance:true,legacySlotsPreservedOnFailure:durable?null:true,verifiedMigratedLegacySlotsRemoved:durable?true:null,durableReload:durable?true:null,failedWritesDoNotClaimSaved:durable?null:true,lastGoodReloadAfterFailure:durable?null:true},errors,missing,remoteCalls:requests.length,screenshots});
   console.log(JSON.stringify({profile:config.name,status:'passed',tick:running.tick,saveStatus:stopped.saveStatus,reloadedTick:reloaded.tick}));
  }catch(error){console.error(JSON.stringify({profile:config.name,errors,missing,requests,state:await page.evaluate(()=>globalThis.qaSummary?.()).catch(()=>null)}));await shot('error');throw error;}
  finally{await context.close();}
 }
 if(!warningRefresh)await writeFile('evidence/save-quota-ui.json',JSON.stringify({status:'passed',mode:'EXPLICIT_BROWSER_STORAGE_FIXTURE',simulation:'Real production controller + local algorithm + real Laya UI; readonly QA prototype wrappers',quota:'Actual localStorage capacity reached in fresh contexts',failureInjection:'Failure profile only: indexedDB.open throws QuotaExceededError',realModel:'not_run',physicalDevice:'not_run',profiles},null,2)+'\n');
}finally{await browser.close();}
