import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

// Explicit browser-only fixture. No real save is opened, and no crop stage is injected.
// Worker knowledge is fixture input; all farming, fetching, walking and harvesting use actions.
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const fixture=`
import {initialize} from './apps/laya-client/src/view.ts';
import {createCrewWorld} from './packages/sim-core/src/world.ts';
import {postTask,grantKnown} from './packages/sim-core/src/camp.ts';
import {advanceAgriculture} from './packages/sim-core/src/agriculture.ts';
import {applyDecision,stepActions} from './packages/sim-core/src/actions.ts';
import {insidePond,crossesPond,pondWaterRadius,pondCollisionRadius} from './packages/sim-core/src/navigation.ts';
import {daylightAt} from './packages/sim-core/src/living.ts';
import {getOverlay,samplePerception} from './packages/sim-core/src/perception.ts';
import {hashCanonical} from './packages/contracts/src/canonical.ts';
import {DEFAULT_MAP_ZOOM,MAP_SIZE} from './packages/sim-core/src/map-config.ts';
const w=createCrewWorld(4),zoneIds={},worker=w.residents[0],pond=w.objects.find(o=>o.kind==='pond');
w.tick=4500;w.daylight=daylightAt(w.tick);
const designate=(label,kind,bounds,variant)=>{postTask(w,{kind,bounds,resource:'food',amount:1,note:'',...(kind==='planting'?{cropKind:variant}:{animalKind:variant})});zoneIds[label]=w.camp.zones.at(-1).id;};
for(const [kind,minX] of [['rice',-22],['wheat',-16],['corn',-10],['carrot',-4]])designate(kind,'planting',{minX,maxX:minX+4,minZ:-18,maxZ:-14},kind);
designate('birds','pasture',{minX:3,maxX:11,minZ:-24,maxZ:-16},'mixed');
w.residents.forEach((r,i)=>{r.position=i===0?{x:pond.position.x-6,y:0,z:pond.position.z}:{x:-19+i*2,y:0,z:-19};r.heading=-Math.PI/2;});
const crops=w.objects.filter(o=>o.crop),rice=crops.find(o=>o.crop.kind==='rice');
const know=o=>grantKnown(worker,o.id,o.appearance,o.position,w.tick).ref;
know(pond);for(const crop of crops)know(crop);samplePerception(w);
const noop=()=>{};let selected=worker.id,senses=false;
const v=await initialize({onTask:draft=>{postTask(w,draft);w.revision++;return true;},onPause:noop,onResume:noop,onRetry:noop,onStop:noop,onSelect:id=>selected=id,onToggleSenses:()=>senses=!senses,onStart:noop,onConnect:noop});
const render=()=>v.render({world:w,overlays:Object.fromEntries(w.residents.map(r=>[r.id,getOverlay(w,r)])),selectedId:selected,showSenses:senses,mode:'LOCAL_ALGORITHM',control:{mode:'local',residents:4},status:'PAUSED',hosted:true,controlDetail:'农事流程验收 · 开垦、播种、岸边取水、浇水与收割'});
const all=node=>{const nodes=[node];for(let i=0;i<node.numChildren;i++)nodes.push(...all(node.getChildAt(i)));return nodes;};
const visible=(node,parentActive=true)=>{const active=parentActive&&node.active!==false,nodes=active?[node.name]:[];for(let i=0;i<node.numChildren;i++)nodes.push(...visible(node.getChildAt(i),active));return nodes;};
const pose=node=>JSON.stringify(all(node).map(n=>{const t=n.transform;return [n.name,n.active,t.localPosition.x,t.localPosition.y,t.localPosition.z,t.localScale.x,t.localScale.y,t.localScale.z,t.localRotationEuler.x,t.localRotationEuler.y,t.localRotationEuler.z];}));
const cropState=()=>({id:rice.id,...rice.crop,resources:rice.resources,water:worker.water??0,tick:w.tick});
let activeFeedback=0;const actionLog=[],trace=[];
const oneTick=()=>{
 const old={...worker.position};w.tick++;stepActions(w,w.tick);advanceAgriculture(w);
 if(worker.position.x!==old.x||worker.position.z!==old.z){
  const next={...worker.position};trace.push({tick:w.tick,from:old,to:next});
  if(insidePond(next,pond)||crossesPond(old,next,pond))throw new Error('Actual resident movement crossed pond water at tick '+w.tick);
 }
};
const advance=n=>{for(let i=0;i<n;i++)oneTick();w.daylight=daylightAt(w.tick);w.revision++;render();};
const begin=(op,params)=>{
 if(worker.plan.some(p=>!p.done))throw new Error('Fixture attempted to replace unfinished work');
 activeFeedback=worker.actionFeedback.length;
 applyDecision(worker,{schemaVersion:'1.0.0',decisionKind:'replace',goal:'完成已知农地的实际农事',reasonBrief:'显式验收行动，目标来自测试角色本人已知对象',actions:[{op,stage:1,params}],nextReviewAfterSimMs:100000,watch:[],memorySuggestions:[]},w.tick);
};
const finish=()=>{
 const started=w.tick,action=worker.plan.find(p=>!p.done)?.action;
 while(worker.plan.some(p=>!p.done)&&w.tick-started<6000)oneTick();
 if(worker.plan.some(p=>!p.done))throw new Error('Action timed out: '+JSON.stringify(action));
 const errors=worker.actionFeedback.slice(activeFeedback);if(errors.length)throw new Error(errors.join(' / '));
 actionLog.push({op:action?.op,work:action?.params.work,steps:w.tick-started,tick:w.tick});w.daylight=daylightAt(w.tick);w.revision++;samplePerception(w);render();return cropState();
};
const run=(op,params)=>{begin(op,params);return finish();};
const walkTo=o=>{if(o.kind==='pond'||Math.hypot(worker.position.x-o.position.x,worker.position.z-o.position.z)>1.65)run('walk',{targetRef:know(o),gait:'walk'});};
const farm=(o,work)=>{walkTo(o);return run('farm',{targetRef:know(o),work});};
const fetch=()=>{walkTo(pond);return run('fetch_water',{sourceRef:know(pond)});};
const water=o=>{if(!(worker.water>=1))fetch();walkTo(o);if(o.crop.stage==='mature')return cropState();return run('farm',{targetRef:know(o),work:'water'});};
Object.assign(globalThis,{
 qaView:v,qaWorld:w,qaZones:zoneIds,qaWorker:worker,qaRice:rice,qaCrops:crops,qaPond:pond,qaLog:actionLog,
 qaConfig:{defaultZoom:DEFAULT_MAP_ZOOM,mapSize:MAP_SIZE},qaHash:()=>hashCanonical(w),qaRender:render,qaAdvance:advance,
 qaAll:all,qaVisible:visible,qaPose:id=>pose(v.objects.get(id).node),qaWorkerPose:()=>pose(v.residents.get(worker.id).node),qaCropState:cropState,
 qaFrame:()=>({tick:w.tick,world:hashCanonical(w),worker:pose(v.residents.get(worker.id).node),poses:w.objects.filter(o=>o.crop||o.animal).map(o=>[o.id,pose(v.objects.get(o.id).node)])}),
 qaFocusFarm:()=>{v.offset={x:-7,z:-17};v.setYaw(0);v.setZoom(19);},
 qaFocusWork:()=>{v.offset={x:rice.position.x+.8,z:rice.position.z+1};v.setYaw(0);v.setZoom(8);},
 qaPondWalk:()=>{
  const from={...worker.position},target={x:pond.position.x+6,y:0,z:pond.position.z},ref=grantKnown(worker,'qa-opposite-bank','亲见池塘另一侧的陆地',target,w.tick).ref,start=trace.length;
  run('walk',{targetRef:ref,gait:'walk'});const steps=trace.slice(start);
  v.offset={x:pond.position.x,z:pond.position.z};v.setZoom(10);
  return {from,to:{...worker.position},steps:steps.length,pathLength:steps.reduce((n,s)=>n+Math.hypot(s.to.x-s.from.x,s.to.z-s.from.z),0),straightDistance:Math.hypot(target.x-from.x,target.z-from.z),minCenterDistance:Math.min(...steps.map(s=>Math.hypot(s.to.x-pond.position.x,s.to.z-pond.position.z))),collisionRadius:pondCollisionRadius(pond),waterRadius:pondWaterRadius(pond),segmentsClear:steps.every(s=>!crossesPond(s.from,s.to,pond)),feedback:[...worker.actionFeedback]};
 },
 qaStartFarm:work=>{walkTo(rice);begin('farm',{targetRef:know(rice),work});advance(5);return cropState();},
 qaFinish:finish,
 qaStartFetch:()=>{walkTo(pond);begin('fetch_water',{sourceRef:know(pond)});advance(5);v.offset={x:pond.position.x,z:pond.position.z};v.setZoom(9);return {water:worker.water??0,...cropState()};},
 qaGrowField:()=>{
  const start=w.tick;
  for(const crop of crops){if(crop.crop.stage==='fallow')farm(crop,'till');if(crop.crop.stage==='tilled')farm(crop,'sow');}
  const sownTick=w.tick;
  for(const crop of crops){
   while(crop.crop.stage!=='mature'){
    if(w.tick-start>120000)throw new Error('Farming fixture exceeded its bounded duration');
    if(crop.crop.stage==='sown'||(crop.crop.moisture??0)<.35)water(crop);else advance(100);
   }
  }
  return {start,sownTick,tick:w.tick,crops:crops.map(o=>({kind:o.crop.kind,stage:o.crop.stage,growth:o.crop.growth,resources:o.resources})),actions:actionLog.reduce((a,x)=>{const k=x.op==='farm'?x.work:x.op;a[k]=(a[k]??0)+1;return a;},{}),actualMovementSteps:trace.length,feedback:[...worker.actionFeedback]};
 },
 qaHarvest:()=>{
  walkTo(rice);const amount=rice.resources,beforeFood=worker.supplies.food??0,beforeStock=w.camp.stock.food??0;
  run('gather',{targetRef:know(rice),amount});return {...cropState(),amount,foodGained:(worker.supplies.food??0)-beforeFood,stockUnchanged:(w.camp.stock.food??0)===beforeStock,completed:worker.plan.every(p=>p.done),errors:[...worker.actionFeedback]};
 },
});render();Laya.timer.frameLoop(1,null,render);
`;
const output=await build({stdin:{sourcefile:'agriculture-fixture.ts',resolveDir:process.cwd(),contents:fixture},bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];await mkdir('local-evidence',{recursive:true});await mkdir('evidence',{recursive:true});
try{
 for(const [width,height,dpr] of [[1536,864,1],[844,390,2]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:dpr>1}),errors=[],missing=[],screenshots=[];
  const capture=async name=>{await page.waitForTimeout(90);const path=`local-evidence/farming-${name}-${width}.png`;await page.screenshot({path});screenshots.push(path);};
  const freeze=async()=>{const before=await page.evaluate(()=>qaFrame());await page.waitForTimeout(160);assert.deepEqual(await page.evaluate(()=>qaFrame()),before);};
  page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.message);});
  await page.route('https://survive.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   try{
    if(pathname==='/qa-font.woff')return route.fulfill({body:await readFile('apps/laya-client/assets/art/camp-sans.woff'),contentType:'font/woff'});
    if(pathname==='/app.js')return route.fulfill({body:output.outputFiles[0].text,contentType:'text/javascript'});
    let body=await readFile(resolve('dist','.'+(pathname==='/'?'/index.html':pathname)));
    if(pathname==='/')body=Buffer.from(body.toString().replace('<script src="app.js"></script>','<script type="module">const f=new FontFace("Camp Sans","url(/qa-font.woff)");await f.load();document.fonts.add(f);await import("/app.js");</script>'));
    await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'}[pathname==='/'?'.html':extname(pathname)]??'application/octet-stream')});
   }catch{missing.push(pathname);await route.fulfill({status:404,body:'missing'});}
  });
  await page.goto('https://survive.test/');
  await page.waitForFunction(()=>globalThis.qaView?.buttons.zoneToggle,undefined,{timeout:20000}).catch(async error=>{await capture('error');console.log({errors,missing});throw error;});
  await page.waitForTimeout(300);
  const initial=await page.evaluate(()=>({fontLoaded:document.fonts.check('14px "Camp Extension"','开垦播种取水浇水缺水'),zoneShown:qaView.showZones,zoneCommands:qaView.zoneOverlay.graphics.cmds.length,zoom:qaView.zoom,expectedZoom:qaConfig.defaultZoom,mapSize:qaConfig.mapSize,crops:qaCrops.length,animals:qaWorld.objects.filter(o=>o.animal).length,stages:[...new Set(qaCrops.map(o=>o.crop.stage))],resources:qaCrops.reduce((n,o)=>n+o.resources,0),nativeResidents:qaWorld.residents.filter(r=>qaView.residents.get(r.id).node.active).length,paintedResidents:qaWorld.residents.filter(r=>qaView.art.sprites.has(r.id)).length,visibleRice:qaVisible(qaView.objects.get(qaRice.id).node)}));
  assert.equal(initial.fontLoaded,true);assert.equal(initial.zoneShown,false);assert.equal(initial.zoneCommands,0);assert.equal(initial.zoom,initial.expectedZoom);assert.equal(initial.mapSize,96);assert.deepEqual(initial.stages,['fallow']);assert.equal(initial.crops,16);assert.ok(initial.animals>=6);assert.equal(initial.resources,0);assert.equal(initial.nativeResidents,4);assert.equal(initial.paintedResidents,0);
  assert.equal(initial.visibleRice.some(n=>/growth|planting bed rim|shallow rice paddy|tilled earth/.test(n)),false);
  await capture('default');await page.evaluate(()=>qaFocusFarm());await capture('pending-field');
  await page.evaluate(()=>{globalThis.qaRefs=new Map(qaWorld.objects.filter(o=>o.crop||o.animal).map(o=>[o.id,qaView.objects.get(o.id)]));globalThis.qaWorkerRef=qaView.residents.get(qaWorker.id);});
  const pendingBefore=await page.evaluate(()=>qaCrops.map(o=>({...o.crop})));await page.evaluate(()=>qaAdvance(2200));assert.deepEqual(await page.evaluate(()=>qaCrops.map(o=>({...o.crop}))),pendingBefore);
  const pond=await page.evaluate(()=>qaPondWalk());assert.ok(pond.steps>100);assert.ok(pond.pathLength>pond.straightDistance);assert.ok(pond.minCenterDistance>=pond.collisionRadius-1e-8);assert.equal(pond.segmentsClear,true);assert.deepEqual(pond.feedback,[]);await capture('pond-route');
  const workAnimations={};
  for(const work of ['till','sow']){
   const started=await page.evaluate(work=>qaStartFarm(work),work);assert.equal(started.stage,work==='till'?'fallow':'tilled');
   await page.evaluate(()=>qaFocusWork());const before=await page.evaluate(()=>qaWorkerPose());await page.evaluate(()=>qaAdvance(6));assert.notEqual(await page.evaluate(()=>qaWorkerPose()),before);await freeze();assert.equal(await page.evaluate(work=>qaVisible(qaView.residents.get(qaWorker.id).node).includes(work==='till'?'farm hoe':'farm seed pouch'),work),true);await capture(work+'-working');
   const finished=await page.evaluate(()=>qaFinish());assert.equal(finished.stage,work==='till'?'tilled':'sown');assert.equal(finished.resources,0);assert.equal(finished.growth,0);assert.equal(await page.evaluate(work=>work==='till'?qaVisible(qaView.garden.node).includes('Continuous garden soil'):qaVisible(qaView.objects.get(qaRice.id).node).includes('sown seed'),work),true);workAnimations[work]={moves:true,pauseFreezes:true,toolVisible:true,startStage:started.stage,endStage:finished.stage};await capture(work+'-finished');
  }
  const sownBefore=await page.evaluate(()=>qaCropState());await page.evaluate(()=>qaAdvance(1200));const sownAfter=await page.evaluate(()=>qaCropState());assert.equal(sownAfter.stage,'sown');assert.equal(sownAfter.growth,sownBefore.growth);
  await page.evaluate(()=>qaStartFetch());const fetchPose=await page.evaluate(()=>qaWorkerPose());await page.evaluate(()=>qaAdvance(6));assert.notEqual(await page.evaluate(()=>qaWorkerPose()),fetchPose);await freeze();await capture('fetching-water');const fetched=await page.evaluate(()=>qaFinish());assert.equal(fetched.water,6);assert.equal(await page.evaluate(()=>qaVisible(qaView.residents.get(qaWorker.id).node).includes('farm bucket water surface')),true);await capture('fetched-water');
  await page.evaluate(()=>{qaStartFarm('water');qaFocusWork();});const waterPose=await page.evaluate(()=>qaWorkerPose());await page.evaluate(()=>qaAdvance(6));assert.notEqual(await page.evaluate(()=>qaWorkerPose()),waterPose);await freeze();assert.equal(await page.evaluate(()=>qaVisible(qaView.residents.get(qaWorker.id).node).filter(n=>n==='farm water droplet').length),6);await capture('watering');const watered=await page.evaluate(()=>qaFinish());assert.equal(watered.stage,'seedling');assert.equal(watered.water,5);assert.ok(watered.moisture>.99);assert.ok(watered.growth>0);await capture('first-water');
  const seedlingPose=await page.evaluate(()=>qaPose(qaRice.id));await page.evaluate(()=>qaAdvance(10));assert.notEqual(await page.evaluate(()=>qaPose(qaRice.id)),seedlingPose);await freeze();
  await page.evaluate(()=>qaAdvance(1200));const dry=await page.evaluate(()=>qaCropState());assert.equal(dry.moisture,0);assert.ok(dry.growth>0&&dry.growth<1);await page.evaluate(()=>qaAdvance(300));assert.equal((await page.evaluate(()=>qaCropState())).growth,dry.growth);await capture('dry-growth-paused');
  const grown=await page.evaluate(()=>qaGrowField());assert.equal(grown.crops.length,16);assert.ok(grown.crops.every(o=>o.stage==='mature'&&o.growth===1&&o.resources>0));assert.ok(grown.actions.till>=16);assert.ok(grown.actions.sow>=16);assert.ok(grown.actions.water>=32);assert.ok(grown.actions.fetch_water>=6);assert.deepEqual(grown.feedback,[]);await page.evaluate(()=>qaFocusFarm());await capture('cultivated-field');
  const stable=await page.evaluate(()=>({sameInstances:[...qaRefs].every(([id,mesh])=>qaView.objects.get(id)===mesh),sameResident:qaView.residents.get(qaWorker.id)===qaWorkerRef,nativeAgriculture:qaWorld.objects.filter(o=>o.crop||o.animal).every(o=>qaView.objects.get(o.id).node.active&&!qaView.art.hasObject(o.id))}));assert.deepEqual(stable,{sameInstances:true,sameResident:true,nativeAgriculture:true});
  const beforeUi=await page.evaluate(()=>qaHash());await page.evaluate(()=>qaView.buttons.zoneToggle.root.event(Laya.Event.CLICK));
  const shown=await page.evaluate(()=>({shown:qaView.showZones,commands:qaView.zoneOverlay.graphics.cmds.length,aboveArt:Laya.stage.getChildIndex(qaView.zoneOverlay)>Laya.stage.getChildIndex(qaView.art.root),passThrough:!qaView.zoneOverlay.mouseEnabled}));assert.equal(shown.shown,true);assert.ok(shown.commands>0);assert.equal(shown.aboveArt,true);assert.equal(shown.passThrough,true);await capture('zones');
  await page.evaluate(()=>{qaView.buttons.zoneToggle.root.event(Laya.Event.CLICK);qaView.buttons.tasks.root.event(Laya.Event.CLICK);qaView.buttons['kind-planting'].root.event(Laya.Event.CLICK);});await capture('planting-planner');assert.equal(await page.evaluate(()=>['rice','wheat','corn','carrot'].every(kind=>qaView.buttons['crop-'+kind].root.visible)),true);
  await page.evaluate(()=>qaView.buttons.publishTask.root.event(Laya.Event.CLICK));assert.equal(await page.evaluate(()=>qaView.zoneDrawing&&qaView.zoneOverlay.graphics.cmds.length>0),true);
  await page.evaluate(()=>{qaView.buttons.zoneCancel.root.event(Laya.Event.CLICK);qaView.buttons.tasks.root.event(Laya.Event.CLICK);qaView.buttons['kind-pasture'].root.event(Laya.Event.CLICK);});await capture('pasture-planner');assert.equal(await page.evaluate(()=>['chicken','duck','goose','mixed'].every(kind=>qaView.buttons['animal-'+kind].root.visible)),true);await page.evaluate(()=>qaView.buttons.closeTasks.root.event(Laya.Event.CLICK));assert.equal(await page.evaluate(()=>qaHash()),beforeUi);
  const harvest=await page.evaluate(()=>qaHarvest());assert.equal(harvest.stage,'harvested');assert.equal(harvest.resources,0);assert.equal(harvest.foodGained,harvest.amount);assert.equal(harvest.stockUnchanged,true);assert.equal(harvest.harvestedTick,harvest.tick);assert.equal(harvest.cycles,1);assert.equal(harvest.completed,true);assert.deepEqual(harvest.errors,[]);await page.evaluate(()=>qaFocusWork());await capture('harvest');
  await page.evaluate(()=>qaAdvance(2200));const afterHarvest=await page.evaluate(()=>qaCropState());assert.equal(afterHarvest.stage,'harvested');assert.equal(afterHarvest.growth,0);assert.equal(afterHarvest.resources,0);
  const poultry=await page.evaluate(()=>{const birds=qaWorld.objects.filter(o=>o.animal),before=birds.map(o=>qaPose(o.id));qaAdvance(20);return {species:[...new Set(birds.map(o=>o.animal.kind))].sort(),posesMove:birds.some((o,i)=>qaPose(o.id)!==before[i])};});assert.deepEqual(poultry.species,['chicken','duck','goose']);assert.equal(poultry.posesMove,true);await freeze();await page.evaluate(()=>{qaView.offset={x:7,z:-20};qaView.setZoom(8);});await capture('poultry');
  const committed=await page.evaluate(()=>{
   const result=[];for(const [kind,variant,minX] of [['planting','corn',20],['pasture','goose',26]]){
    qaView.buttons.tasks.root.event(Laya.Event.CLICK);qaView.buttons['kind-'+kind].root.event(Laya.Event.CLICK);qaRender();qaView.buttons[(kind==='planting'?'crop-':'animal-')+variant].root.event(Laya.Event.CLICK);qaView.buttons.publishTask.root.event(Laya.Event.CLICK);
    qaView.zoneDraft={minX,maxX:minX+4,minZ:-24,maxZ:-20};qaView.drawZones();qaView.updateZoneHint();qaView.buttons.zoneConfirm.root.event(Laya.Event.CLICK);qaRender();const zone=qaWorld.camp.zones.at(-1),objects=qaWorld.objects.filter(o=>o.zoneId===zone.id);
    result.push({kind:zone.kind,variant:zone.cropKind??zone.animalKind,objects:objects.length,allExpected:objects.every(o=>(o.crop?.kind??o.animal?.kind)===variant),allFallow:kind==='planting'?objects.every(o=>o.crop.stage==='fallow'&&o.resources===0):null,drawingClosed:!qaView.zoneDrawing});
   }return result;
  });assert.deepEqual(committed,[{kind:'planting',variant:'corn',objects:4,allExpected:true,allFallow:true,drawingClosed:true},{kind:'pasture',variant:'goose',objects:4,allExpected:true,allFallow:null,drawingClosed:true}]);
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  results.push({width,height,dpr,initial,pond,workAnimations,fetchWater:{moves:true,pauseFreezes:true,capacity:fetched.water},firstWater:watered,pendingAndUnwateredDoNotAutoGrow:true,dryGrowthPauses:true,grown,stable,zoneToggle:shown,viewControlsDoNotMutateWorld:true,confirmedUiZones:committed,harvest,noAutomaticRegrowth:afterHarvest.stage==='harvested',poultry,errors,missing,screenshots});await page.close();
 }
 await writeFile('evidence/agriculture-ui.json',JSON.stringify({mode:'EXPLICIT_VISUAL_FIXTURE',simulation:'postTask + applyDecision(walk, farm, fetch_water, gather) + stepActions + advanceAgriculture; no injected crop stage',knownTargets:'explicit fixture knowledge; independent local-algorithm integration is tested separately',results,physicalDevice:'not_run',realModel:'not_run_visual_only'},null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
