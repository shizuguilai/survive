import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

// Presentation-only fixture. Poses and resource quantities are explicit test input;
// this does not claim that a resident autonomously harvested these bushes.
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const fixture=`
import {initialize} from './apps/laya-client/src/view.ts';
import {createCrewWorld} from './packages/sim-core/src/world.ts';
import {getOverlay} from './packages/sim-core/src/perception.ts';
import {daylightAt} from './packages/sim-core/src/living.ts';
import {hashCanonical} from './packages/contracts/src/canonical.ts';
import {artFrame} from './apps/laya-client/src/painted-world.ts';
const w=createCrewWorld(2);w.residents=w.residents.slice(0,1);w.tick=600;w.daylight=daylightAt(w.tick);
const board=w.objects.find(o=>o.kind==='board'),bench=w.objects.find(o=>o.kind==='workbench'),tree=w.objects.find(o=>o.kind==='tree'),berry=w.objects.find(o=>o.kind==='berry'),pond=w.objects.find(o=>o.kind==='pond');pond.position={x:-9,y:0,z:-9};
board.position={x:0,y:0,z:0};bench.position={x:8,y:0,z:0};tree.position={x:-8,y:0,z:0};
const berries=[0,3,6,12].map((resources,i)=>({...structuredClone(berry),id:'qa-berry-'+resources,position:{x:-4+i*3,y:0,z:9},resources}));
w.objects=[board,bench,tree,pond,...berries];w.residents[0].position={x:0,y:0,z:1};w.residents[0].heading=Math.PI;
const noop=()=>{};const v=await initialize({onTask:noop,onPause:noop,onResume:noop,onRetry:noop,onStop:noop,onSelect:noop,onToggleSenses:noop,onStart:noop,onConnect:noop});
const render=()=>v.render({world:w,overlays:Object.fromEntries(w.residents.map(r=>[r.id,getOverlay(w,r)])),selectedId:w.residents[0].id,showSenses:false,mode:'LOCAL_ALGORITHM',control:{mode:'local',residents:1},status:'PAUSED',hosted:true,controlDetail:'场景遮挡验收 · 显式布置人物前后与浆果余量'});
const all=node=>{const nodes=[node];for(let i=0;i<node.numChildren;i++)nodes.push(...all(node.getChildAt(i)));return nodes;};
const inspect=id=>{const e=v.art.sprites.get(id),o=w.objects.find(o=>o.id===id),native=v.objects.get(id);return {id,kind:o.kind,resources:o.resources,painted:v.art.hasObject(id),nativeActive:native.node.active,frame:e?.frame,alpha:e?.image?.alpha??e?.alpha,paintedRootName:e?.root?.name,paintedWidth:e?.image?.width,depthTested:e?.root instanceof Laya.MeshSprite3D&&e?.root.parent===v.art.node&&v.art.node.parent===v.scene,materialAlpha:e?.material?.albedoColor?.a,frameTextureMatches:e?.material?.albedoTexture===artFrame(e?.frame)?.texture.bitmap,characterHands:v.residents.get(w.residents[0].id).hands.length,characterActive:v.residents.get(w.residents[0].id).node.active,position:{...o.position}};};
const pose=(kind,deg,side)=>{const o=w.objects.find(o=>o.kind===kind),a=deg*Math.PI/180,d=side==='front'?.9:side==='behind'?-.65:0;
 w.residents[0].position={x:o.position.x+Math.sin(a)*d+(side==='side'?3*Math.cos(a):0),y:0,z:o.position.z+Math.cos(a)*d-(side==='side'?3*Math.sin(a):0)};w.revision++;v.offset={x:o.position.x,z:o.position.z};v.setYaw(a);v.setZoom(12);render();return inspect(o.id);};
Object.assign(globalThis,{qaView:v,qaWorld:w,qaRender:render,qaAll:all,qaHash:()=>hashCanonical(w),qaPose:pose,qaInspect:inspect,qaBerries:berries,qaFocusPond:()=>{w.residents[0].position={x:15,y:0,z:15};w.revision++;v.offset={x:pond.position.x,z:pond.position.z};v.setYaw(Math.PI/4);v.setZoom(15);render();return inspect(pond.id);},qaFocusBerries:()=>{w.residents[0].position={x:15,y:0,z:15};w.revision++;v.offset={x:.5,z:9};v.setYaw(0);v.setZoom(15);render();return berries.map(o=>inspect(o.id));}});
render();Laya.timer.frameLoop(1,null,render);
`;
const output=await build({stdin:{sourcefile:'scenery-fixture.ts',resolveDir:process.cwd(),contents:fixture},bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('local-evidence',{recursive:true});await mkdir('evidence',{recursive:true});const results=[];
try{
 for(const [width,height,dpr] of [[1536,864,1],[844,390,2]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:dpr>1}),errors=[],missing=[],screenshots=[],poses=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.stack);});
  await page.route('https://survive.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;try{
   if(pathname==='/qa-font.woff')return route.fulfill({body:await readFile('apps/laya-client/assets/art/camp-sans.woff'),contentType:'font/woff'});
   if(pathname==='/app.js')return route.fulfill({body:output.outputFiles[0].text,contentType:'text/javascript'});
   let body=await readFile(pathname.startsWith('/assets/art/')?resolve('apps/laya-client','.'+pathname):resolve('dist','.'+(pathname==='/'?'/index.html':pathname)));
   if(pathname==='/')body=Buffer.from(body.toString().replace('<script src="app.js"></script>','<script type="module">const f=new FontFace("Camp Sans","url(/qa-font.woff)");await f.load();document.fonts.add(f);await import("/app.js");</script>'));
   await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'}[pathname==='/'?'.html':extname(pathname)]??'application/octet-stream')});
  }catch{missing.push(pathname);await route.fulfill({status:404,body:'missing'});}});
  const capture=async name=>{await page.waitForTimeout(120);const path='local-evidence/scenery-'+name+'-'+width+'.png';await page.screenshot({path});screenshots.push(path);};
  await page.goto('https://survive.test/');await page.waitForFunction(()=>globalThis.qaView?.art,undefined,{timeout:20000}).catch(async error=>{await capture('error');console.log({errors,missing});throw error;});
  for(const kind of ['board','workbench','tree'])for(const degrees of (kind==='board'?[0,45,90,180]:[0,90]))for(const side of ['front','behind','side']){
   const result=await page.evaluate(([kind,degrees,side])=>qaPose(kind,degrees,side),[kind,degrees,side]);
   const before=await page.evaluate(()=>qaHash());await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>qaHash()),before,'Renderer must not change world');
   if(side!=='side'&&(kind==='board'||degrees===0))await capture(kind+'-'+degrees+'-'+side);
   assert.equal(result.painted,true);assert.equal(result.nativeActive,false);assert.equal(result.characterActive,true);assert.equal(result.characterHands,2);assert.equal(result.depthTested,true);assert.equal(result.materialAlpha,result.alpha);assert.equal(result.frameTextureMatches,true);
   assert.equal(result.alpha,side==='behind'?.3:1,kind+' '+degrees+' '+side+' alpha');
   poses.push({kind,degrees,side,alpha:result.alpha,painted:result.painted,nativeCharacter:result.characterActive,depthTested:result.depthTested,materialAlpha:result.materialAlpha,frameTextureMatches:result.frameTextureMatches});
  }
  const berries=await page.evaluate(()=>qaFocusBerries()),before=await page.evaluate(()=>qaHash());
  for(const result of berries){assert.equal(result.painted,true,'All berry quantities retain painted foliage');assert.equal(result.nativeActive,false,'Harvested berries must not use primitive fallback');assert.equal(result.alpha,1);assert.equal(result.depthTested,true);assert.equal(result.frameTextureMatches,true);}
  assert.deepEqual(berries.map(o=>o.resources),[0,3,6,12]);assert.deepEqual(berries.map(o=>o.frame),['berryBushEmpty','berryBush','berryBush','berryBush']);assert.ok(berries.every(o=>Math.abs(o.paintedWidth-berries[0].paintedWidth)<.001),'Harvest keeps the whole bush width');
  await capture('berry-stages');assert.equal(await page.evaluate(()=>qaHash()),before);
  const pond=await page.evaluate(()=>qaFocusPond());assert.equal(pond.frame,'pond');assert.equal(pond.painted,true);assert.equal(pond.nativeActive,false);assert.equal(pond.depthTested,true);assert.equal(pond.materialAlpha,1);assert.equal(pond.frameTextureMatches,true);await capture('pond-45');
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  results.push({width,height,dpr,poses,berries,pond:{...pond,degrees:45},renderDoesNotMutateWorld:true,errors,missing,screenshots});await page.close();
 }
 const report={mode:'EXPLICIT_VISUAL_FIXTURE',fixture:'One native resident is explicitly positioned in front of, behind, and beside board/workbench/tree at camera rotations. Berry quantities 0/3/6/12 are fixture values. No autonomous gathering claim.',results,physicalDevice:'not_run',realModel:'not_run_visual_only'};
 await writeFile('evidence/scenery-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,results:results.map(r=>({width:r.width,height:r.height,poses:r.poses.length,berries:r.berries.length,errors:r.errors,missing:r.missing}))},null,2));
}finally{await browser.close();}
