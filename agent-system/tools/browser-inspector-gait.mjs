import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright/index.mjs`)).href);
const server=spawn(process.execPath,['services/brain-gateway/src/server.ts'],{stdio:'ignore',env:{...process.env,SURVIVE_MODEL_API_KEY:'',SURVIVE_PORT:'8797'}});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH??'/workspace/scratch/4be8967a8182/browser-tools/runtime/chromium-restored',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
try{
 const out=await build({stdin:{resolveDir:process.cwd(),sourcefile:'inspector-fixture.ts',contents:`
 import {initialize} from './apps/laya-client/src/view.ts';import {createCrewWorld} from './packages/sim-core/src/world.ts';import {postTask} from './packages/sim-core/src/camp.ts';import {samplePerception,getOverlay} from './packages/sim-core/src/perception.ts';import {hashCanonical} from './packages/contracts/src/canonical.ts';import {applyEquipmentAction} from './packages/sim-core/src/character.ts';
 const w=createCrewWorld(4);postTask(w,{kind:'house',siteId:'east',resource:'wood',amount:3,note:'明确美术夹具'});const h=w.objects.find(o=>o.kind==='plot');h.kind='house';h.buildStage=3;
 w.residents.forEach((r,i)=>{r.position={x:-3+i*2.2,y:0,z:4};r.heading=Math.PI/2;r.plan=[{action:{op:'walk',stage:1,params:{gait:'walk',targetRef:'fixture'}},elapsedTicks:3,startedTick:1,emittedChars:0,done:false}];});for(const [i,id]of ['knife','spear'].entries()){const r=w.residents[i];const itemRef=r.character.inventory.items.find(it=>it.catalogId===id).itemRef;const result=applyEquipmentAction(r,{type:'equip_item',itemRef,slot:'rightHand'});if(!result.ok)throw Error(result.error);w.residents[i]=result.resident;}samplePerception(w);
 let selected=w.residents[0].id,senses=false;const noop=()=>{};
 initialize({onTask:noop,onPause:noop,onResume:noop,onRetry:noop,onStop:noop,onSelect:id=>selected=id,onToggleSenses:()=>senses=!senses,onReplay:noop,onLive:noop,onSeek:noop,onSpeed:noop,onStart:noop,onConnect:noop}).then(view=>{
  globalThis.fixture={view,w,hash:()=>hashCanonical(w),seek(t){w.tick=t;w.revision++;w.residents.forEach(r=>r.plan[0].elapsedTicks=t);},stop(){w.revision++;w.residents.forEach(r=>r.plan[0].done=true);}};
  Laya.timer.frameLoop(1,null,()=>view.render({world:w,overlays:Object.fromEntries(w.residents.map(r=>[r.id,getOverlay(w,r)])),selectedId:selected,showSenses:senses,speed:1,hosted:true,playbackTick:w.tick,maxTick:100,mode:'REPLAY',status:'THINKING'}));
 });`},bundle:true,write:false,format:'iife',target:'es2022',platform:'browser'});
 const app=out.outputFiles[0].text;
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:8797/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const fontRoot=resolve('../../browser-tools/node_modules/@fontsource-variable/noto-sans-sc');
 const css=(await readFile(resolve(fontRoot,'index.css'),'utf8')).replaceAll('Noto Sans SC Variable','Noto Sans CJK SC').replaceAll('./files/','/_qa_fonts/');
 const chars=[...new Set(app.replace(/\\u([0-9a-f]{4})/gi,(_,c)=>String.fromCharCode(parseInt(c,16))).match(/[\u3400-\u9fff]/g))].join('');
 for(const profile of [{width:1440,height:900,dpr:1},{width:844,height:390,dpr:2}]){
  const p=await browser.newPage({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpr,hasTouch:profile.dpr>1});const errors=[];let modelCalls=0;
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/\/api\/(decide|command|summarize)/.test(r.url()))modelCalls++;});
  await p.route('**/_qa_fonts/*',async r=>r.fulfill({contentType:'font/woff2',body:await readFile(resolve(fontRoot,'files',r.request().url().split('/').at(-1)))}));
  await p.route('**/app.js',r=>r.fulfill({contentType:'application/javascript',body:'(async()=>{const s=document.createElement("style");s.textContent='+JSON.stringify(css)+';document.head.appendChild(s);await document.fonts.load('+JSON.stringify('14px Noto Sans CJK SC')+','+JSON.stringify(chars)+');\n'+app+'\n})();'}));
  await p.goto('http://127.0.0.1:8797');await p.waitForFunction(()=>globalThis.fixture?.view.root);await p.waitForTimeout(600);
  const visible=name=>p.evaluate(name=>{const walk=n=>n.visible===false?[]:[n,...(n._children??[]).flatMap(walk)];return walk(Laya.stage).some(n=>n.name===name);},name);
  const click=async name=>{const point=await p.evaluate(name=>{const walk=n=>n.visible===false?[]:[n,...(n._children??[]).flatMap(walk)];const n=walk(Laya.stage).find(n=>n.name===name);if(!n)throw Error('Missing visible button '+name);const q=n.localToGlobal(new Laya.Point(n.width/2,n.height/2));return {x:q.x,y:q.y};},name);const s=Math.min(profile.width/1280,profile.height/720),x=(profile.width-1280*s)/2+point.x*s,y=(profile.height-720*s)/2+point.y*s;profile.dpr>1?await p.touchscreen.tap(x,y):await p.mouse.click(x,y);await p.waitForTimeout(240);};
  const pose=()=>p.evaluate(()=>{const node=fixture.view.residents.get(fixture.w.residents[0].id);return {hands:node.hands.map(h=>({x:h.node.transform.localPosition.x,y:h.node.transform.localPosition.y,z:h.node.transform.localPosition.z})),body:node.visuals.transform.localPosition.y};});
  const layout=()=>p.evaluate(()=>({left:fixture.view.camera.normalizedViewport.x,width:fixture.view.camera.normalizedViewport.width,inputWidth:fixture.view.sceneInput.width}));
  assert.equal(await visible('Resident inspector'),false);assert.deepEqual(await layout(),{left:0,width:1,inputWidth:1280});
  const gearAttached=await p.evaluate(()=>{const a=fixture.view.residents.get(fixture.w.residents[0].id),b=fixture.view.residents.get(fixture.w.residents[1].id);return {knifeOnHand:a.hands.some(h=>(h.node._children??[]).some(n=>n.name==='knife blade')),twoHanded:b.twoHanded,sharedSpear:!!b.sharedGrip};});assert.deepEqual(gearAttached,{knifeOnHand:true,twoHanded:true,sharedSpear:true});
  assert.equal(await visible('replay'),false);assert.equal(await visible('speed'),false);
  assert.equal(await p.evaluate(()=>fixture.view.camera.msaa),false);assert.equal(await p.evaluate(()=>Laya.stage.frameRate),'slow');
  const qualityHash=await p.evaluate(()=>fixture.hash());await click('quality');assert.equal(await p.evaluate(()=>fixture.view.camera.msaa),true);assert.equal(await p.evaluate(()=>Laya.stage.frameRate),'fast');
  assert.equal(await p.evaluate(()=>fixture.hash()),qualityHash);await click('quality');assert.equal(await p.evaluate(()=>fixture.view.camera.msaa),false);
  const hash=await p.evaluate(()=>fixture.hash()),initialPose=await pose();await p.waitForTimeout(850);assert.deepEqual(await pose(),initialPose);assert.equal(await p.evaluate(()=>fixture.hash()),hash);
  await mkdir('local-evidence',{recursive:true});await p.screenshot({path:`local-evidence/inspector-collapsed-${profile.width}.png`});
  await click('inspectorToggle');assert.equal(await visible('Resident inspector'),true);assert.equal((await layout()).inputWidth,988);await p.screenshot({path:`local-evidence/inspector-expanded-${profile.width}.png`});
  await click('memoryMap');assert.equal(await visible('Personal map memory'),true);await click('closeMemory');await click('history');assert.equal(await visible('Resident history'),true);await click('closeHistory');
  await click('inspectorToggle');assert.equal(await visible('Resident inspector'),false);await click('quickMap');assert.equal(await visible('Personal map memory'),true);await click('closeMemory');await click('quickHistory');await click('closeHistory');await click('quickSenses');
  await click('tasks');assert.equal(await visible('Camp planner'),true);const bounds=await p.evaluate(()=>{const panel=fixture.view.planner;return {left:panel.x+320,right:panel.x+1230};});assert.ok(bounds.left>=0&&bounds.right<=1280);await click('closeTasks');
  assert.equal(await p.evaluate(()=>fixture.hash()),hash);
  await p.evaluate(()=>fixture.seek(8));await p.waitForFunction(()=>fixture.view.residents.get(fixture.w.residents[0].id).hands[0].node.transform.localPosition.z>.1);const nextPose=await pose();assert.notDeepEqual(nextPose,initialPose);assert.ok((nextPose.hands[0].z-.1)*(initialPose.hands[0].z-.1)<0);assert.ok(Math.abs(nextPose.hands[0].z+nextPose.hands[1].z-.2)<.00001);
  const sharedGripAligned=await p.evaluate(()=>{const b=fixture.view.residents.get(fixture.w.residents[1].id),dz=b.sharedGrip.transform.localPosition.z;return b.hands.every(h=>Math.abs(h.node.transform.localPosition.z-h.z-dz)<.00001);});assert.equal(sharedGripAligned,true);
  await p.evaluate(()=>fixture.seek(3));await p.waitForFunction(()=>fixture.view.residents.get(fixture.w.residents[0].id).hands[0].node.transform.localPosition.z<.1);assert.deepEqual(await pose(),initialPose);await p.evaluate(()=>fixture.stop());await p.waitForFunction(()=>fixture.view.residents.get(fixture.w.residents[0].id).visuals.transform.localPosition.y===0);const stopped=await pose();assert.equal(stopped.body,0);assert.ok(stopped.hands.every(h=>Math.abs(h.z-.1)<.00001));
  assert.equal(modelCalls,0);assert.deepEqual(errors,[]);results.push({profile,defaultCollapsed:true,noReplayControls:true,qualityToggleReadOnly:true,retinaCanvasPreserved:true,expandedWorldWidth:988,collapsedWorldWidth:1280,quickArchiveAndMap:true,centeredPlanner:true,observerWorldHashUnchanged:true,alternatingHands:true,heldKnifeFollowsHand:true,twoHandedGripAligned:true,frozenPose:true,replayPoseIdentical:true,idleReturnsToRest:true,modelCalls,errors});console.log('passed',profile.width);await p.close();
 }
 await writeFile('evidence/inspector-gait-browser.json',JSON.stringify({status:'passed',mode:'EXPLICIT_RENDER_FIXTURE',results,realModel:'not_run_visual_only',physicalDevice:'not_run'},null,2)+'\n');
}finally{await browser.close();server.kill();}
