import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

// Visual-only fixture: crop stages and scenery clearing are explicit test input.
// This checks presentation and input, and makes no claim about autonomous farming.
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const fixture=`
import {initialize} from './apps/laya-client/src/view.ts';
import {createCrewWorld} from './packages/sim-core/src/world.ts';
import {postTask} from './packages/sim-core/src/camp.ts';
import {describeCrop,CROP_YIELD} from './packages/sim-core/src/agriculture.ts';
import {daylightAt} from './packages/sim-core/src/living.ts';
import {getOverlay} from './packages/sim-core/src/perception.ts';
import {hashCanonical} from './packages/contracts/src/canonical.ts';
import {DEFAULT_MAP_ZOOM} from './packages/sim-core/src/map-config.ts';
import {gardenLayout,gardenBedDistance} from './apps/laya-client/src/garden-ground.ts';
const w=createCrewWorld(3),zoneIds=[];
w.tick=600;w.daylight=daylightAt(w.tick);
// Clear only fixture scenery within the display garden, never production terrain.
w.objects=w.objects.filter(o=>!(['tree','berry','rock'].includes(o.kind)&&o.position.x>-33&&o.position.x<-14&&o.position.z>-23&&o.position.z<3));
const specs=[['carrot',-30,-20,'mature',1],['wheat',-22,-20,'growing',.52],['carrot',-30,-13,'seedling',.14],['corn',-22,-13,'mature',1],['rice',-30,-6,'growing',.52],['wheat',-22,-6,'mature',1]];
for(const [kind,minX,minZ,stage,growth] of specs){
 const prior=w.camp.zones?.length??0;postTask(w,{kind:'planting',cropKind:kind,bounds:{minX,maxX:minX+6,minZ,maxZ:minZ+6},resource:'food',amount:1,note:''});
 if(w.camp.zones.length!==prior+1)throw Error('Visual fixture designation failed for '+kind);
 const zone=w.camp.zones.at(-1);zoneIds.push(zone.id);
 for(const o of w.objects.filter(o=>o.zoneId===zone.id)){
  Object.assign(o.crop,{stage,growth,moisture:kind==='rice'?.95:.7,plantedTick:0});o.resources=stage==='mature'?CROP_YIELD[kind]:0;describeCrop(o);
 }
}
const crops=w.objects.filter(o=>o.crop),last=crops.filter(o=>o.zoneId===zoneIds.at(-1));
for(let i=0;i<3;i++){const o=last.at(-1-i);Object.assign(o.crop,{stage:['fallow','tilled','sown'][i],growth:0,moisture:0});o.resources=0;describeCrop(o);}
w.residents.forEach((r,i)=>{r.position={x:-23+i*4,y:0,z:-11};r.heading=-Math.PI/2;});
const noop=()=>{};let selected=w.residents[0].id;
const v=await initialize({onTask:noop,onPause:noop,onResume:noop,onRetry:noop,onStop:noop,onSelect:id=>selected=id,onToggleSenses:noop,onStart:noop,onConnect:noop});
const render=()=>v.render({world:w,overlays:Object.fromEntries(w.residents.map(r=>[r.id,getOverlay(w,r)])),selectedId:selected,showSenses:false,mode:'LOCAL_ALGORITHM',control:{mode:'local',residents:3},status:'PAUSED',hosted:true,controlDetail:'种植区画面验收 · 显式布置不同作物与生长阶段'});
const all=node=>{const nodes=[node];for(let i=0;i<node.numChildren;i++)nodes.push(...all(node.getChildAt(i)));return nodes;};
const pose=node=>JSON.stringify(all(node).map(n=>{const t=n.transform;return[n.name,n.active,t.localPosition.x,t.localPosition.y,t.localPosition.z,t.localScale.x,t.localScale.y,t.localScale.z,t.localRotationEuler.x,t.localRotationEuler.y,t.localRotationEuler.z];}));
Object.assign(globalThis,{
 qaView:v,qaWorld:w,qaCrops:crops,qaZones:zoneIds,qaAll:all,qaRender:render,
 qaDefaultZoom:DEFAULT_MAP_ZOOM,qaHash:()=>hashCanonical(w),
 qaGroundLayout:()=>{const beds=gardenLayout(w),connections=[];for(const bed of beds)for(let i=0;i<bed.cells.length;i++)for(let j=i+1;j<bed.cells.length;j++){const a=bed.cells[i].object.position,b=bed.cells[j].object.position,d=Math.hypot(a.x-b.x,a.z-b.z);if(d>2.05)continue;connections.push(Array.from({length:11},(_,k)=>gardenBedDistance(bed,a.x+(b.x-a.x)*k/10,a.z+(b.z-a.z)*k/10)).every(v=>v<=0));}const fallow=crops.find(o=>o.crop.stage==='fallow');return {beds:beds.length,prepared:bedCount(),connections:connections.length,allAdjacentCellsJoined:connections.every(Boolean),fallowStaysGrass:beds.every(b=>gardenBedDistance(b,fallow.position.x,fallow.position.z)>0)};},
 qaFrame:()=>({world:hashCanonical(w),poses:crops.map(o=>[o.id,pose(v.objects.get(o.id).node)]),ground:pose(all(v.scene).find(n=>n.name==='Natural cultivated garden ground'))}),
 qaFocus:(zoom=DEFAULT_MAP_ZOOM,yaw=0)=>{v.offset={x:-22.5,z:-10.5};v.setYaw(yaw);v.setZoom(zoom);render();},
 qaInspectTarget:()=>{const o=crops.find(o=>o.crop.kind==='carrot'&&o.crop.stage==='mature');const p=v.project(o.position);return{id:o.id,x:p.x,y:p.y,kind:o.crop.kind};},
});render();Laya.timer.frameLoop(1,null,render);
function bedCount(){return crops.filter(o=>o.crop.stage!=='fallow').length;}
`;
const output=await build({stdin:{sourcefile:'garden-fixture.ts',resolveDir:process.cwd(),contents:fixture},bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];await mkdir('local-evidence',{recursive:true});await mkdir('evidence',{recursive:true});
try{
 for(const [width,height,dpr]of [[1536,864,1],[844,390,2]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:dpr>1}),errors=[],missing=[],screenshots=[];
  const capture=async name=>{await page.waitForTimeout(120);const path=`local-evidence/garden-${name}-${width}.png`;await page.screenshot({path});screenshots.push(path);};
  page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.stack);});
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
  const initial=await page.evaluate(()=>{
   const grounds=qaAll(qaView.scene).filter(n=>n.name==='Natural cultivated garden ground'),nodes=grounds.flatMap(qaAll);
   const oldRims=qaCrops.flatMap(o=>qaAll(qaView.objects.get(o.id).node)).filter(n=>n.name==='planting bed rim');
   return{defaultZoom:qaView.zoom,expectedZoom:qaDefaultZoom,zoneShown:qaView.showZones,zoneCount:qaZones.length,crops:qaCrops.length,stages:[...new Set(qaCrops.map(o=>o.crop.stage))].sort(),kinds:[...new Set(qaCrops.map(o=>o.crop.kind))].sort(),groundRoots:grounds.length,groundChildren:nodes.map(n=>n.name),oldSquareRims:oldRims.length,worldIds:qaWorld.objects.map(o=>o.id),nativeCrops:qaCrops.every(o=>qaView.objects.get(o.id).node.active&&!qaView.art.hasObject(o.id))};
  });
  assert.equal(initial.defaultZoom,initial.expectedZoom);assert.equal(initial.zoneShown,false);assert.equal(initial.zoneCount,6);assert.ok(initial.crops>=30);assert.equal(initial.groundRoots,1);assert.equal(initial.oldSquareRims,0);assert.equal(initial.nativeCrops,true);assert.deepEqual(initial.kinds,['carrot','corn','rice','wheat']);assert.deepEqual(initial.stages,['fallow','growing','mature','seedling','sown','tilled']);
  assert.ok(initial.groundChildren.includes('Continuous garden soil'));
  const layout=await page.evaluate(()=>qaGroundLayout());assert.equal(layout.beds,6);assert.ok(layout.prepared>layout.beds*5);assert.ok(layout.connections>30);assert.equal(layout.allAdjacentCellsJoined,true);assert.equal(layout.fallowStaysGrass,true);
  const beforeWorld=await page.evaluate(()=>qaHash());
  await page.evaluate(()=>{globalThis.qaRefs=new Map(qaCrops.map(o=>[o.id,qaView.objects.get(o.id)]));globalThis.qaGardenChildren=qaAll(qaView.garden.node);qaFocus();});await capture('default');
  await page.evaluate(()=>qaFocus(23,0));await capture('close');
  const paused=await page.evaluate(()=>qaFrame());await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>qaFrame()),paused);
  await page.evaluate(()=>qaFocus(23,Math.PI/4));await capture('rotated-45');
  await page.evaluate(()=>{qaView.buttons.zoneToggle.root.event(Laya.Event.CLICK);});await capture('regions-shown');
  await page.evaluate(()=>{qaView.buttons.zoneToggle.root.event(Laya.Event.CLICK);qaFocus(23,0);});
  const input=await page.evaluate(()=>qaInspectTarget());
  // The engine is fixed at a 1280×720 design stage and showall-centered viewport.
  const scale=Math.min(width/1280,height/720),left=(width-1280*scale)/2,top=(height-720*scale)/2;
  if(dpr>1)await page.touchscreen.tap(left+input.x*scale,top+input.y*scale);else await page.mouse.click(left+input.x*scale,top+input.y*scale);
  await page.waitForFunction(()=>qaView.objectDetails.visible,undefined,{timeout:5000});
  const inspection=await page.evaluate(()=>({id:qaView.selectedObject,visible:qaView.objectDetails.visible,text:qaView.labels.objectDetail.text,realCrop:qaCrops.some(o=>o.id===qaView.selectedObject)}));
  assert.equal(inspection.id,input.id);assert.equal(inspection.visible,true);assert.equal(inspection.realCrop,true);assert.ok(inspection.text.includes('成熟'));await capture('crop-inspector');
  const stable=await page.evaluate(()=>({worldIds:qaWorld.objects.map(o=>o.id),sameCropInstances:[...qaRefs].every(([id,node])=>qaView.objects.get(id)===node),sameGroundChildren:qaAll(qaView.garden.node).every((node,i)=>node===qaGardenChildren[i])}));assert.deepEqual(stable.worldIds,initial.worldIds);assert.equal(stable.sameCropInstances,true);assert.equal(stable.sameGroundChildren,true);assert.equal(await page.evaluate(()=>qaHash()),beforeWorld);
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  results.push({width,height,dpr,initial:{...initial,worldIds:undefined},layout,inspection,defaultAndCloseZoom:true,rotationDegrees:45,pausedVisualsStable:true,viewControlsDoNotMutateWorld:true,noDecorativeWorldIds:true,sameCropInstances:true,sameGroundChildren:true,errors,missing,screenshots});await page.close();
 }
 const report={mode:'EXPLICIT_VISUAL_FIXTURE',fixture:'Six planting zones created with postTask; growth stages and cleared scenery explicitly injected only for visual comparison. No autonomous farming or full gameplay-cycle claim.',results,physicalDevice:'not_run',realModel:'not_run_visual_only'};
 await writeFile('evidence/garden-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
