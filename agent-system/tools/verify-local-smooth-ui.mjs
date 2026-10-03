import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

// Disposable browser contexts only; no remote model or user browser data.
// Mature fixture is produced by running the unchanged local simulation to tick 11,739.
// Optional survey fixture samples the real perception code at explicit survey positions,
// then restores the residents: a formerly explored camp, not omniscient planner inputs.
const baseline=process.argv.includes('--baseline');
const sourceRoot=resolve(process.env.QA_SOURCE_ROOT??'.');
const snapshotPath=process.env.QA_WORLD_FIXTURE??'/tmp/survive-local-mature-world.json';
async function fixtureText(){
 try{return await readFile(snapshotPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const source=path=>import(pathToFileURL(resolve(sourceRoot,path)).href);
 const [{createCrewWorld},{postTask},{ColonyProvider},{Simulation},{controlSettings}]=await Promise.all([source('packages/sim-core/src/world.ts'),source('packages/sim-core/src/camp.ts'),source('packages/sim-core/src/colony.ts'),source('packages/sim-core/src/cognition.ts'),source('packages/contracts/src/command.ts')]);
 const world=createCrewWorld(4),settings=controlSettings({mode:'local',residents:4});
 postTask(world,{kind:'planting',cropKind:'carrot',bounds:{minX:-26,maxX:-18,minZ:-12,maxZ:0},resource:'food',amount:1,note:''});
 const provider=new ColonyProvider(settings,{async plan(){throw Error('No remote calls permitted in local QA fixture');}}),sim=new Simulation(provider,{world,controlMode:'local'}),started=performance.now();
 await sim.bootstrap();while(sim.world.tick<11739){if(performance.now()-started>180000)throw Error('Mature fixture exceeded 180s bound');if(sim.paused){await sim.settled();if(sim.status==='ERROR_PAUSED')throw Error(JSON.stringify(sim.barrier?.errors??sim.observerError));}else sim.step();}
 const text=JSON.stringify(sim.world);sim.stop();await writeFile(snapshotPath,text);return text;
}
const worldText=await fixtureText();
const worldSeed=JSON.parse(worldText);assert.ok(worldSeed.tick>=11700,'Generate a mature normal local camp first');
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const fixture=`
import {boot} from './apps/laya-client/src/controller.ts';
import {ObserverView} from './apps/laya-client/src/view.ts';
import {CampSaves} from './apps/laya-client/src/camp-save.ts';
import {AsyncCampSaves} from './apps/laya-client/src/camp-storage.ts';
import {Simulation} from './packages/sim-core/src/cognition.ts';
import {ColonyProvider} from './packages/sim-core/src/colony.ts';
import {samplePerception,buildContext} from './packages/sim-core/src/perception.ts';
import {postTask} from './packages/sim-core/src/camp.ts';
import {controlSettings} from './packages/contracts/src/command.ts';
import {cameraExtent,MAP_HALF} from './apps/laya-client/src/map-camera.ts';
import {LiveObserver} from './apps/laya-client/src/live-observer.ts';
const times={},statuses=[],frames=[],longTasks=[];let measuring=false,lastFrame=0;
globalThis.qaTime=(key,ms)=>{if(measuring)(times[key]??=[]).push(ms);};
new PerformanceObserver(list=>{if(measuring)for(const entry of list.getEntries())longTasks.push(entry.duration);}).observe({entryTypes:['longtask']});
const wrap=(proto,key,label)=>{const fn=proto[key];if(!fn)return;proto[key]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{qaTime(label,performance.now()-start);}};};
for(const key of ['step','begin','resolve','resolveBatch','planLocal','commitLocal','beginLocal'])wrap(Simulation.prototype,key,'simulation.'+key);
wrap(ColonyProvider.prototype,'decideBatch','colony.decideBatch');wrap(ColonyProvider.prototype,'decideLocalBatch','colony.decideLocalBatch');
wrap(AsyncCampSaves.prototype,'save','save.capture');wrap(LiveObserver.prototype,'observe','observer.journal');
const render=ObserverView.prototype.render;ObserverView.prototype.render=function(state){globalThis.qaView=this;globalThis.qaState=state;globalThis.qaRenderCount=(globalThis.qaRenderCount??0)+1;const at=performance.now();try{return render.call(this,state);}finally{qaTime('observer.render',performance.now()-at);}};
const frame=Simulation.prototype.frame;Simulation.prototype.frame=function(now){globalThis.qaSim=this;if(measuring&&lastFrame)frames.push(now-lastFrame);lastFrame=now;return frame.call(this,now);};
const setStatus=Simulation.prototype.setStatus;Simulation.prototype.setStatus=function(value){if(measuring)statuses.push({status:value,tick:this.world.tick});return setStatus.call(this,value);};
const world=await (await fetch('/qa-world.json')).json();world.runId='local-smooth-mature-fixture';
const surveyed=new URL(location.href).searchParams.get('survey')==='1';
if(surveyed){for(const bounds of [{minX:12,maxX:26,minZ:-30,maxZ:-16},{minX:-30,maxX:-16,minZ:14,maxZ:28},{minX:14,maxX:28,minZ:14,maxZ:28}])postTask(world,{kind:'planting',cropKind:'rice',bounds,resource:'food',amount:1,note:'Survey regression field'});const positions=world.residents.map(r=>({...r.position})),facings=world.residents.map(r=>r.heading);for(let x=-30;x<=30;x+=5)for(let z=-30;z<=30;z+=5)for(const facing of [0,Math.PI/2,Math.PI,Math.PI*1.5]){for(const r of world.residents){r.position={x,y:0,z};r.heading=facing;r.visualSignature='';}samplePerception(world);}world.residents.forEach((r,i)=>{r.position=positions[i];r.heading=facings[i];r.visualSignature='';});samplePerception(world);}
const settings=controlSettings({mode:'local',residents:4});localStorage.setItem('survive_control_v1',JSON.stringify(settings));
new CampSaves(localStorage).save({world,settings,queuedTasks:[],selectedId:world.residents[0].id,showSenses:false,needsDecision:true});
globalThis.qaFixture={tick:world.tick,known:world.residents.map(r=>Object.keys(r.known).length),observations:world.residents.map(r=>r.observations.length),memories:world.residents.map(r=>r.memories.length),characters:JSON.stringify(world).length,surveyed};
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,totalMs:values.reduce((a,b)=>a+b,0),maxMs:sorted.at(-1)??0,p95Ms:sorted[Math.floor(sorted.length*.95)]??0,p50Ms:sorted[Math.floor(sorted.length*.5)]??0};};
globalThis.qaMeasureStart=()=>{for(const key in times)delete times[key];statuses.length=frames.length=longTasks.length=0;lastFrame=0;measuring=true;};
globalThis.qaMeasureEnd=()=>{measuring=false;return {tick:qaSim.world.tick,status:qaSim.status,error:qaState.error??'',statuses:[...statuses],times:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,summary(v)])),frames:summary(frames),longTasks:summary(longTasks),known:qaSim.world.residents.map(r=>Object.keys(r.known).length),contexts:qaSim.world.residents.map(r=>buildContext(qaSim.world,r).knownTargets.length),saveStatus:qaState.saveStatus};};
globalThis.qaFocus=()=>{const v=qaView,r=qaState.world.residents.find(r=>r.id===qaState.selectedId),head=v.project({...r.position,y:r.position.y+(v.residents.get(r.id)?.height??1.95)});return {selectedId:r.id,head:{x:head.x,y:head.y},target:{x:(v.sceneLeft+1013)/2,y:418},edgeDistance:Math.min(...Object.entries(cameraExtent(v.zoom,v.mapViewport(),v.yaw)).map(([k,extent])=>Math.abs(MAP_HALF-.5-extent-Math.abs(v.offset[k])))),sceneLeft:v.sceneLeft,camera:{...v.offset,zoom:v.zoom,yaw:v.yaw},collapsed:v.sidebarCollapsed};};
await boot();globalThis.qaReady=true;
`;
const built=await build({stdin:{sourcefile:'local-smooth-fixture.ts',resolveDir:sourceRoot,contents:fixture},bundle:true,write:false,format:'esm',target:'es2022',platform:'browser',plugins:[{name:'readonly-timing',setup(build){build.onLoad({filter:/(canonical|world)\.ts$/},async args=>{let contents=await readFile(args.path,'utf8');if(args.path.endsWith('/contracts/src/canonical.ts'))contents=contents.replace('export function hashCanonical(', 'function hashCanonicalUnprofiled(')+`\nexport function hashCanonical(value:unknown):string{const t=performance.now();try{return hashCanonicalUnprofiled(value);}finally{(globalThis as any).qaTime?.('hashCanonical',performance.now()-t);}}\n`;else if(args.path.endsWith('/sim-core/src/world.ts'))contents=contents.replace('export function cloneWorld(', 'function cloneWorldUnprofiled(')+`\nexport function cloneWorld(world:World):World{const t=performance.now();try{return cloneWorldUnprofiled(world);}finally{(globalThis as any).qaTime?.('cloneWorld',performance.now()-t);}}\n`;return {contents,loader:'ts'};});}}]});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const profiles=[];await mkdir('local-evidence',{recursive:true});await mkdir('evidence',{recursive:true});
try{
 for(const config of [{name:'desktop',width:1536,height:864,dpr:1,survey:false},{name:'mobile-surveyed',width:844,height:390,dpr:2,survey:true}]){
  const context=await browser.newContext({viewport:{width:config.width,height:config.height},deviceScaleFactor:config.dpr,hasTouch:config.dpr>1});
  const page=await context.newPage(),errors=[],missing=[],remoteCalls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://survive.test/**',async route=>{const path=new URL(route.request().url()).pathname;
   if(path.startsWith('/api/')){remoteCalls.push(path);return route.fulfill({status:503,body:'EXPLICIT_REMOTE_DISABLED'});}
   try{
    if(path==='/qa-world.json')return route.fulfill({contentType:'application/json',body:worldText});
    if(path==='/qa-font.woff')return route.fulfill({contentType:'font/woff',body:await readFile('apps/laya-client/assets/art/camp-sans.woff')});
    if(path==='/app.js')return route.fulfill({contentType:'text/javascript',body:built.outputFiles[0].text});
    let body=await readFile(resolve('dist','.'+(path==='/'?'/index.html':path)));
    if(path==='/')body=Buffer.from(body.toString().replace('<script src="app.js"></script>','<script type="module">const f=new FontFace("Camp Sans","url(/qa-font.woff)");await f.load();document.fonts.add(f);await import("/app.js");</script>'));
    await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'}[path==='/'?'.html':extname(path)]??'application/octet-stream')});
   }catch{missing.push(path);await route.fulfill({status:404,body:'missing'});}
  });
  const click=async id=>{const box=await page.evaluate(id=>{const r=qaView.buttons[id].root,p=r.localToGlobal(new Laya.Point(r.width/2,r.height/2));const c=document.querySelector('canvas').getBoundingClientRect();return {x:c.left+p.x*c.width/1280,y:c.top+p.y*c.height/720};},id);const count=await page.evaluate(()=>qaRenderCount);await page.mouse.click(box.x,box.y);await page.waitForFunction(n=>qaRenderCount>n+1,count,{timeout:10000});};
  try{
   await page.goto('https://survive.test/?survey='+(config.survey?'1':'0'));await page.waitForFunction(()=>globalThis.qaReady,undefined,{timeout:30000});
   const seed=await page.evaluate(()=>qaFixture);if(config.survey)assert.ok(seed.known.every(n=>n>128));
   await page.evaluate(()=>qaMeasureStart());await click('start');await page.waitForTimeout(config.survey&&baseline?1500:12000);
   const measured=await page.evaluate(()=>qaMeasureEnd());
   console.log(JSON.stringify({mode:baseline?'before':'after',profile:config.name,seed,measured}));
   if(!baseline){assert.equal(measured.status,'RUNNING');assert.ok(measured.tick>seed.tick+80);assert.equal(measured.statuses.some(x=>['THINKING','COMMITTING','ERROR_PAUSED'].includes(x.status)),false);assert.doesNotMatch(measured.error,/knownTargets|认知请求失败|array length/);}
   await click('pause');await page.waitForTimeout(150);
   const focus=[];
   if(!baseline){
    await click('inspectorToggle');await page.waitForTimeout(100);
    for(const rotation of [0,1,2]){
     if(rotation)await click('rotateRight');
     for(const id of ['resident0','resident1','nextResident']){
      const prior=await page.evaluate(()=>qaFocus());await click(id);await page.waitForTimeout(100);const selected=await page.evaluate(()=>qaFocus());
      assert.equal(selected.camera.zoom,prior.camera.zoom);assert.equal(selected.camera.yaw,prior.camera.yaw);const centered=Math.hypot(selected.head.x-selected.target.x,selected.head.y-selected.target.y)<2;assert.ok(centered||selected.edgeDistance<.01&&selected.head.x>selected.sceneLeft+40&&selected.head.x<990&&selected.head.y>205&&selected.head.y<620,JSON.stringify(selected));focus.push(selected);
     }
    }
    const dragStart=await page.evaluate(()=>({...qaView.offset}));await page.mouse.move(config.width*.5,config.height*.5);await page.mouse.down();await page.mouse.move(config.width*.58,config.height*.55,{steps:6});await page.mouse.up();await page.waitForTimeout(100);const dragged=await page.evaluate(()=>({...qaView.offset}));assert.notDeepEqual(dragged,dragStart,'Manual pan remains usable after focus');
   }
   const screenshot='local-evidence/local-smooth-'+(baseline?'before-':'after-')+config.name+'.png';await page.screenshot({path:screenshot});
   assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(remoteCalls,[]);profiles.push({config,seed,measured,focus,errors,missing,remoteCalls,screenshot});
  }finally{await context.close();}
 }
 const evidence={status:'passed',environment:'Headless Chromium SwiftShader; 30 fps quality setting; not physical phone',instrumentation:'Read-only timings of production functions. Hash and clone timings overlap caller timings; no totals should be summed.',fixture:'Normal local farm simulation to tick 11739. Mobile survey additionally records real limited-cone perception at explicit survey positions before boot, restoring resident positions.',baseline,profiles};
 if(baseline)await writeFile('/tmp/survive-local-baseline-ui.json',JSON.stringify(evidence,null,2)+'\n');
 else{try{evidence.before=JSON.parse(await readFile('/tmp/survive-local-baseline-ui.json','utf8'));}catch{}await writeFile('evidence/local-smooth-ui.json',JSON.stringify(evidence,null,2)+'\n');}
}finally{await browser.close();}
