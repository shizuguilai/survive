import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

// A real browser smoke check of the production UNCONFIGURED scene. No fake
// model responses or model credentials are injected by this script.
const modulePath=process.env.PLAYWRIGHT_MODULE??join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??'node_modules','playwright','index.mjs');
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href);
const executablePath=process.env.BROWSER_EXECUTABLE_PATH;
const baseUrl=process.env.BROWSER_BASE_URL??'http://127.0.0.1:8787';
await mkdir('evidence',{recursive:true});
let serverProcess;
if(process.env.BROWSER_START_SERVER==='1'){
  serverProcess=spawn(process.execPath,['services/brain-gateway/src/server.ts'],{stdio:'ignore',env:{...process.env,SURVIVE_MODEL_API_KEY:'',SURVIVE_PORT:new URL(baseUrl).port||'8787'}});
  let ready=false;
  for(let n=0;n<100;n++){
    try{const response=await fetch(`${baseUrl}/api/health`);if(response.ok){const health=await response.json();assert.equal(health.configured,false,'smoke server must remain unconfigured');ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready){serverProcess.kill();throw Error('Unconfigured local server did not become ready');}
}
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
const report={test:'production-unconfigured-observer',source:'NO_MODEL_CALLED',realModelStatus:'BLOCKED_MISSING_CREDENTIALS',realDeviceStatus:'NOT_RUN',browserVersion:browser.version(),appSha256:createHash('sha256').update(await readFile('dist/app.js')).digest('hex'),profiles:[],status:'running'};
try{
  for(const profile of [{name:'desktop',viewport:{width:1280,height:720},isMobile:false,hasTouch:false,deviceScaleFactor:1},{name:'mobile_emulation',viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:2}]){
    const context=await browser.newContext(profile);const page=await context.newPage();
    const errors=[],consoleErrors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
    page.on('request',r=>{if(r.url().includes('/api/decide'))requests.push(r.url());});
    const response=await page.goto(baseUrl,{waitUntil:'networkidle'});assert.equal(response?.ok(),true);
    await page.waitForFunction(()=>!!globalThis.Laya?.stage?._children?.some(n=>n.name==='Observer UI'));
    await page.waitForTimeout(700);
    const inspect=()=>page.evaluate(()=>{
      const walk=n=>[n,...(n._children??[]).flatMap(walk)];const nodes=walk(globalThis.Laya.stage);
      const texts=nodes.filter(n=>typeof n.text==='string').map(n=>n.text);
      const scene=nodes.find(n=>n.name==='Survive — 认知观察场');
      const residents=(scene?._children??[]).filter(n=>['阿林','小禾'].includes(n.name)).map(n=>({name:n.name,position:{x:n.transform.position.x,y:n.transform.position.y,z:n.transform.position.z},parts:walk(n).map(v=>v.name).filter(Boolean)}));
      const camera=(scene?._children??[]).find(n=>n.constructor.name==='Camera');
      const cameraPosition=camera?{x:camera.transform.position.x,y:camera.transform.position.y,z:camera.transform.position.z}:null;
      const senses=nodes.find(n=>n.name==='有限感知参考');
      return {texts,residents,cameraPosition,sensesLines:senses?.lineCount??null,canvasCount:document.querySelectorAll('canvas').length,stage:{width:globalThis.Laya.stage.width,height:globalThis.Laya.stage.height}};
    });
    const screen=async(x,y)=>page.evaluate(({x,y})=>{const scale=Math.min(innerWidth/1280,innerHeight/720);return {x:(innerWidth-1280*scale)/2+x*scale,y:(innerHeight-720*scale)/2+y*scale};},{x,y});
    const click=async(x,y)=>{const p=await screen(x,y);if(profile.hasTouch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);await page.waitForTimeout(150);};
    const initial=await inspect();assert.ok(initial.texts.some(t=>t.includes('尚未接入真实模型')),'unconfigured indicator');assert.equal(initial.residents.length,2);
    for(const resident of initial.residents)for(const required of ['body','head','round hand -1','round hand 1','tunic collar','backpack'])assert.ok(resident.parts.includes(required),`${resident.name}: ${required}`);
    await page.screenshot({path:`evidence/browser-${profile.name}.png`,fullPage:true});
    await click(210,145);const selected=await inspect();assert.ok(selected.texts.some(t=>t.includes('●')&&t.includes('小禾')),'resident B selection');
    await click(120,555);const sensesOff=await inspect();assert.ok(sensesOff.texts.includes('感官显示  关'),'senses off');
    await click(120,555);assert.ok((await inspect()).texts.includes('感官显示  开'),'senses on');
    await click(490,644);assert.ok((await inspect()).texts.includes('继续'),'manual pause can be resumed');
    await click(490,644);assert.ok((await inspect()).texts.includes('暂停'),'resume button returns to pause');
    const dragStart=await screen(800,320),dragEnd=await screen(900,370);
    if(profile.hasTouch){const client=await context.newCDPSession(page);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dragStart]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[dragEnd]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();}
    else {await page.mouse.move(dragStart.x,dragStart.y);await page.mouse.down();await page.mouse.move(dragEnd.x,dragEnd.y,{steps:8});await page.mouse.up();}
    await page.waitForTimeout(200);const dragged=await inspect();assert.notDeepEqual(dragged.cameraPosition,initial.cameraPosition,'observer camera moves during world pause');assert.deepEqual(dragged.residents,initial.residents,'static world preserved');
    await click(375,644);await click(752,644);const after=await inspect();assert.equal(requests.length,0,'no unconfigured model request');assert.ok(after.texts.some(t=>t.includes('尚无回放')),'empty replay is explicitly rejected');assert.deepEqual(after.residents,initial.residents);
    await page.screenshot({path:`evidence/browser-${profile.name}-interacted.png`,fullPage:true});
    assert.deepEqual(errors,[],'no browser runtime errors');
    report.profiles.push({profile:profile.name,viewport:profile.viewport,mobileEmulation:profile.isMobile,realDevice:false,checks:{laya3D:true,twoDressedFourPartResidents:true,residentSelection:true,sensesToggle:true,pauseResumeControls:true,cameraDuringPause:true,worldStayedFrozen:true,noUnconfiguredRequests:true,emptyReplayRejected:true},initial,after,errors,consoleErrors,decisionRequests:requests.length});
    await context.close();
  }
  report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);throw error;}
finally{await writeFile('evidence/browser-smoke.json',JSON.stringify(report,null,2));await browser.close();serverProcess?.kill();}
console.log(JSON.stringify({status:report.status,profiles:report.profiles.map(p=>p.profile),realModel:report.realModelStatus,realDevice:report.realDeviceStatus}));
