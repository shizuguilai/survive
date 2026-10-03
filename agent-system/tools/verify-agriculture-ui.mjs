import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

// Explicit browser-only fixture. The normal demo world and saved games are never changed.
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const fixture=`
import {initialize} from './apps/laya-client/src/view.ts';
import {createCrewWorld} from './packages/sim-core/src/world.ts';
import {postTask,grantKnown} from './packages/sim-core/src/camp.ts';
import {advanceAgriculture} from './packages/sim-core/src/agriculture.ts';
import {applyDecision,stepActions} from './packages/sim-core/src/actions.ts';
import {daylightAt} from './packages/sim-core/src/living.ts';
import {getOverlay,samplePerception} from './packages/sim-core/src/perception.ts';
import {hashCanonical} from './packages/contracts/src/canonical.ts';
import {DEFAULT_MAP_ZOOM,MAP_SIZE} from './packages/sim-core/src/map-config.ts';
const w=createCrewWorld(4),zoneIds={};
const advanceTo=(target)=>{while(w.tick<target){w.tick++;advanceAgriculture(w);}w.daylight=daylightAt(w.tick);w.revision++;};
const designate=(label,kind,bounds,variant)=>{postTask(w,{kind,bounds,resource:'food',amount:1,note:'',...(kind==='planting'?{cropKind:variant}:{animalKind:variant})});zoneIds[label]=w.camp.zones.at(-1).id;};
advanceTo(4500);
designate('ripe-rice','planting',{minX:-22,maxX:-18,minZ:-24,maxZ:-20},'rice');
designate('wheat','planting',{minX:-22,maxX:-18,minZ:-18,maxZ:-14},'wheat');
designate('corn','planting',{minX:-16,maxX:-12,minZ:-18,maxZ:-14},'corn');
designate('carrot','planting',{minX:-10,maxX:-6,minZ:-18,maxZ:-14},'carrot');
advanceTo(7100);
designate('growing-rice','planting',{minX:-16,maxX:-12,minZ:-24,maxZ:-20},'rice');
advanceTo(8000);
designate('seedling-rice','planting',{minX:-10,maxX:-6,minZ:-24,maxZ:-20},'rice');
designate('birds','pasture',{minX:-3,maxX:7,minZ:-24,maxZ:-14},'mixed');
w.residents.forEach((r,i)=>{r.position={x:-19+i*2,y:0,z:-19};r.heading=-Math.PI/2;});samplePerception(w);
const noop=()=>{};let selected=w.residents[0].id,senses=false;
const v=await initialize({onTask:draft=>{postTask(w,draft);w.revision++;return true;},onPause:noop,onResume:noop,onRetry:noop,onStop:noop,onSelect:id=>selected=id,onToggleSenses:()=>senses=!senses,onStart:noop,onConnect:noop});
const render=()=>v.render({world:w,overlays:Object.fromEntries(w.residents.map(r=>[r.id,getOverlay(w,r)])),selectedId:selected,showSenses:senses,mode:'LOCAL_ALGORITHM',control:{mode:'local',residents:4},status:'PAUSED',hosted:true,controlDetail:'农业动画验收 · 同一世界的真实播种、生长与采收'});
const all=node=>{const nodes=[node];for(let i=0;i<node.numChildren;i++)nodes.push(...all(node.getChildAt(i)));return nodes;};
const pose=id=>JSON.stringify(all(v.objects.get(id).node).map(n=>{const t=n.transform;return [n.name,n.active,t.localPosition.x,t.localPosition.y,t.localPosition.z,t.localScale.x,t.localScale.y,t.localScale.z,t.localRotationEuler.x,t.localRotationEuler.y,t.localRotationEuler.z];}));
const cropIn=label=>w.objects.find(o=>o.zoneId===zoneIds[label]&&o.kind==='crop');
Object.assign(globalThis,{qaView:v,qaWorld:w,qaZones:zoneIds,qaHash:()=>hashCanonical(w),qaAll:all,qaPose:pose,qaCropIn:cropIn,qaConfig:{defaultZoom:DEFAULT_MAP_ZOOM,mapSize:MAP_SIZE},qaAdvance:n=>{advanceTo(w.tick+n);render();},qaRender:render,qaFrame:()=>({tick:w.tick,world:hashCanonical(w),poses:w.objects.filter(o=>o.crop||o.animal).map(o=>[o.id,pose(o.id)])}),qaFocusFarm:()=>{v.offset={x:-7.5,z:-19};v.setYaw(0);v.setZoom(16);},
qaHarvest:()=>{
 const object=cropIn('ripe-rice'),resident=w.residents[0],beforeFood=resident.supplies.food??0,beforeStock=w.camp.stock.food??0,amount=object.resources;
 resident.position={x:object.position.x-1.25,y:0,z:object.position.z};resident.heading=0;
 const known=grantKnown(resident,object.id,object.appearance,object.position,w.tick);
 applyDecision(resident,{schemaVersion:'1.0.0',decisionKind:'replace',goal:'收割眼前成熟的水稻',reasonBrief:'走近亲见成熟稻株后采收',actions:[{op:'gather',stage:1,params:{targetRef:known.ref,amount}}],nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]},w.tick);
 let steps=0;while(resident.plan.some(p=>!p.done)&&steps<200){w.tick++;stepActions(w,w.tick);advanceAgriculture(w);steps++;}
 w.revision++;samplePerception(w);render();
 return {id:object.id,stage:object.crop.stage,resources:object.resources,harvestedTick:object.crop.harvestedTick,tick:w.tick,cycles:object.crop.cycles,foodGained:(resident.supplies.food??0)-beforeFood,amount,stockUnchanged:(w.camp.stock.food??0)===beforeStock,completed:resident.plan.every(p=>p.done),errors:resident.actionFeedback,steps};
}});
render();Laya.timer.frameLoop(1,null,render);
`;
const output=await build({stdin:{sourcefile:'agriculture-fixture.ts',resolveDir:process.cwd(),contents:fixture},bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];await mkdir('local-evidence',{recursive:true});await mkdir('evidence',{recursive:true});
try{
 for(const [width,height,dpr] of [[1536,864,1],[844,390,2]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:dpr>1}),errors=[],missing=[],screenshots=[];
  const capture=async name=>{const path=`local-evidence/agriculture-${name}-${width}.png`;await page.screenshot({path});screenshots.push(path);};
  page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.message);});
  page.on('console',message=>{if(message.type()==='error')console.log('BROWSER ERROR',message.text());});
  await page.route('https://survive.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   try{
    if(pathname==='/qa-font.ttf')return route.fulfill({body:await readFile('apps/laya-client/assets/art/camp-sans.woff'),contentType:'font/woff'});
    if(pathname==='/app.js')return route.fulfill({body:output.outputFiles[0].text,contentType:'text/javascript'});
    let body=await readFile(resolve('dist','.'+(pathname==='/'?'/index.html':pathname)));
    if(pathname==='/')body=Buffer.from(body.toString().replace('<script src="app.js"></script>','<script type="module">const f=new FontFace("Camp Sans","url(/qa-font.ttf)");await f.load();document.fonts.add(f);await import("/app.js");</script>'));
    await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff'}[pathname==='/'?'.html':extname(pathname)]??'application/octet-stream')});
   }catch{missing.push(pathname);await route.fulfill({status:404,body:'missing'});}
  });
  await page.goto('https://survive.test/');
  await page.waitForFunction(()=>globalThis.qaView?.buttons.zoneToggle,undefined,{timeout:20000}).catch(async error=>{await capture('error');console.log({errors,missing});throw error;});
  await page.waitForTimeout(500);
  const initial=await page.evaluate(()=>({agricultureFontLoaded:document.fonts.check('14px "Camp Extension"','种植畜牧稻鸡鸭鹅'),zoneShown:qaView.showZones,zoneCommands:qaView.zoneOverlay.graphics.cmds.length,zoom:qaView.zoom,expectedZoom:qaConfig.defaultZoom,mapSize:qaConfig.mapSize,crops:qaWorld.objects.filter(o=>o.crop).length,animals:qaWorld.objects.filter(o=>o.animal).length,stages:['seedling-rice','growing-rice','ripe-rice'].map(label=>qaCropIn(label).crop.stage),nativeResidents:qaWorld.residents.filter(r=>qaView.residents.get(r.id).node.active).length,paintedResidents:qaWorld.residents.filter(r=>qaView.art.sprites.has(r.id)).length}));
  assert.equal(initial.agricultureFontLoaded,true);assert.equal(initial.zoneShown,false);assert.equal(initial.zoneCommands,0);assert.equal(initial.zoom,initial.expectedZoom);assert.equal(initial.mapSize,96);assert.deepEqual(initial.stages,['seedling','growing','mature']);assert.equal(initial.crops,24);assert.ok(initial.animals>=6);assert.equal(initial.nativeResidents,4);assert.equal(initial.paintedResidents,0);
  await capture('default');await page.evaluate(()=>qaFocusFarm());await page.waitForTimeout(120);await capture('overview');
  const stable=await page.evaluate(()=>{globalThis.qaRefs=new Map(qaWorld.objects.filter(o=>o.crop||o.animal).map(o=>[o.id,qaView.objects.get(o.id)]));const grow=qaCropIn('growing-rice'),bird=qaWorld.objects.find(o=>o.animal);return {crop:grow.id,growth:grow.crop.growth,bird:bird.id,position:{...bird.position},pose:qaPose(bird.id)};});
  await page.evaluate(()=>qaAdvance(5));
  const motion=await page.evaluate(({crop,bird,pose,position,growth})=>({sameInstances:[...qaRefs].every(([id,mesh])=>qaView.objects.get(id)===mesh),animalMoves:qaWorld.objects.find(o=>o.id===bird).position.x!==position.x||qaWorld.objects.find(o=>o.id===bird).position.z!==position.z,poseMoves:qaPose(bird)!==pose,cropGrows:qaWorld.objects.find(o=>o.id===crop).crop.growth>growth,nativeAgriculture:qaWorld.objects.filter(o=>o.crop||o.animal).every(o=>qaView.objects.get(o.id).node.active&&!qaView.art.hasObject(o.id))}),stable);
  assert.deepEqual(motion,{sameInstances:true,animalMoves:true,poseMoves:true,cropGrows:true,nativeAgriculture:true});
  const frozen=await page.evaluate(()=>qaFrame());await page.waitForTimeout(320);assert.deepEqual(await page.evaluate(()=>qaFrame()),frozen);
  const beforeUi=await page.evaluate(()=>qaHash());
  await page.evaluate(()=>qaView.buttons.zoneToggle.root.event(Laya.Event.CLICK));
  const shown=await page.evaluate(()=>({shown:qaView.showZones,commands:qaView.zoneOverlay.graphics.cmds.length,aboveArt:Laya.stage.getChildIndex(qaView.zoneOverlay)>Laya.stage.getChildIndex(qaView.art.root),passThrough:!qaView.zoneOverlay.mouseEnabled,clipWidth:qaView.zoneOverlay.scrollRect.width,viewportWidth:qaView.mapViewport().width}));
  assert.equal(shown.shown,true);assert.ok(shown.commands>0);assert.equal(shown.aboveArt,true);assert.equal(shown.passThrough,true);assert.equal(shown.clipWidth,shown.viewportWidth);await capture('zones');
  await page.evaluate(()=>{qaView.buttons.zoneToggle.root.event(Laya.Event.CLICK);qaView.buttons.tasks.root.event(Laya.Event.CLICK);qaView.buttons['kind-planting'].root.event(Laya.Event.CLICK);qaView.buttons['crop-rice'].root.event(Laya.Event.CLICK);});await page.waitForTimeout(100);await capture('planting-planner');
  const cropButtons=await page.evaluate(()=>['rice','wheat','corn','carrot'].every(kind=>qaView.buttons['crop-'+kind].root.visible));assert.equal(cropButtons,true);
  await page.evaluate(()=>qaView.buttons.publishTask.root.event(Laya.Event.CLICK));
  const drawing=await page.evaluate(()=>({drawing:qaView.zoneDrawing,commands:qaView.zoneOverlay.graphics.cmds.length}));assert.equal(drawing.drawing,true);assert.ok(drawing.commands>0);await capture('drawing');
  await page.evaluate(()=>{qaView.buttons.zoneCancel.root.event(Laya.Event.CLICK);qaView.buttons.tasks.root.event(Laya.Event.CLICK);qaView.buttons['kind-pasture'].root.event(Laya.Event.CLICK);});await page.waitForTimeout(100);await capture('pasture-planner');
  assert.equal(await page.evaluate(()=>['chicken','duck','goose','mixed'].every(kind=>qaView.buttons['animal-'+kind].root.visible)),true);
  await page.evaluate(()=>qaView.buttons.closeTasks.root.event(Laya.Event.CLICK));assert.equal(await page.evaluate(()=>qaHash()),beforeUi);
  const harvest=await page.evaluate(()=>qaHarvest());assert.equal(harvest.stage,'harvested');assert.equal(harvest.resources,0);assert.equal(harvest.foodGained,harvest.amount);assert.equal(harvest.stockUnchanged,true);assert.equal(harvest.harvestedTick,harvest.tick);assert.equal(harvest.cycles,1);assert.equal(harvest.completed,true);assert.deepEqual(harvest.errors,[]);
  const harvestVisual=await page.evaluate(id=>({sameInstance:qaView.objects.get(id)===qaRefs.get(id),grainHidden:qaAll(qaView.objects.get(id).node).filter(n=>n.name==='drooping rice panicle').every(n=>!n.active),flecks:qaAll(qaView.objects.get(id).node).filter(n=>n.name==='harvest grain fleck'&&n.active).length}),harvest.id);assert.deepEqual(harvestVisual,{sameInstance:true,grainHidden:true,flecks:3});
  await page.waitForTimeout(80);await capture('harvest');
  await page.evaluate(()=>{const p=qaCropIn('ripe-rice').position;qaView.offset={x:p.x+1,z:p.z+1};qaView.setZoom(9);});await page.waitForTimeout(100);await capture('rice-closeup');
  await page.evaluate(()=>{qaView.offset={x:2,z:-19};qaView.setZoom(9);});await page.waitForTimeout(100);await capture('poultry-closeup');
  const committed=await page.evaluate(()=>{
   const results=[];
   for(const [kind,variant,minX] of [['planting','corn',20],['pasture','goose',26]]){
    qaView.buttons.tasks.root.event(Laya.Event.CLICK);qaView.buttons['kind-'+kind].root.event(Laya.Event.CLICK);qaRender();qaView.buttons[(kind==='planting'?'crop-':'animal-')+variant].root.event(Laya.Event.CLICK);qaView.buttons.publishTask.root.event(Laya.Event.CLICK);
    qaView.zoneDraft={minX,maxX:minX+4,minZ:-24,maxZ:-20};qaView.drawZones();qaView.updateZoneHint();qaView.buttons.zoneConfirm.root.event(Laya.Event.CLICK);qaRender();
    const zone=qaWorld.camp.zones.at(-1),objects=qaWorld.objects.filter(o=>o.zoneId===zone.id);
    results.push({kind:zone.kind,variant:zone.cropKind??zone.animalKind,objects:objects.length,allExpected:objects.every(o=>(o.crop?.kind??o.animal?.kind)===variant),drawingClosed:!qaView.zoneDrawing});
   }
   return results;
  });
  assert.deepEqual(committed,[{kind:'planting',variant:'corn',objects:4,allExpected:true,drawingClosed:true},{kind:'pasture',variant:'goose',objects:4,allExpected:true,drawingClosed:true}]);
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  results.push({width,height,dpr,initial,motion,pauseFreezesTickWorldAndNativePoses:true,zoneToggle:shown,drawingAutoShowsZones:true,viewControlsDoNotMutateWorld:true,confirmedUiZones:committed,harvest,harvestVisual,errors,missing,screenshots});await page.close();
 }
 await writeFile('evidence/agriculture-ui.json',JSON.stringify({mode:'EXPLICIT_VISUAL_FIXTURE',simulation:'postTask + advanceAgriculture + applyDecision(gather) + stepActions',results,physicalDevice:'not_run',realModel:'not_run_visual_only'},null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
