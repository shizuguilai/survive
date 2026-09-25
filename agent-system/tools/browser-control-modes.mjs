import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {spawn} from 'node:child_process';import {mkdir,writeFile,readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright/index.mjs`)).href);
const server=spawn(process.execPath,['services/brain-gateway/src/server.ts'],{stdio:'ignore',env:{...process.env,SURVIVE_MODEL_API_KEY:'',SURVIVE_PORT:'8795'}});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH??'/workspace/scratch/4be8967a8182/browser-tools/runtime/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const profiles=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:8795/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const profile of [{width:1280,height:720,touch:false},{width:844,height:390,touch:true}]){
  console.log('profile',profile.width);const page=await browser.newPage({viewport:{width:profile.width,height:profile.height},hasTouch:profile.touch});const errors=[];let commandCalls=0,independentCalls=0;page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/command',r=>{commandCalls++;return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'EXPLICIT_TEST_PROVIDER_UNAVAILABLE'})});});
  await page.route('**/api/decide',r=>{independentCalls++;return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'EXPLICIT_TEST_INDEPENDENT_UNAVAILABLE'})});});
  // This headless runtime has no CJK system fonts. Load local QA fonts before the unchanged production bundle.
  const fontRoot=resolve('../../browser-tools/node_modules/@fontsource-variable/noto-sans-sc');
  await page.route('**/_qa_fonts/*',async r=>r.fulfill({contentType:'font/woff2',body:await readFile(resolve(fontRoot,'files',r.request().url().split('/').at(-1)))}));
  const css=(await readFile(resolve(fontRoot,'index.css'),'utf8')).replaceAll('Noto Sans SC Variable','Noto Sans CJK SC').replaceAll('./files/','/_qa_fonts/');
  await page.route('**/app.js',async r=>{const app=await readFile('dist/app.js','utf8');const chars=[...new Set(app.replace(/\\u([0-9a-f]{4})/gi,(_,code)=>String.fromCharCode(parseInt(code,16))).match(/[\u3400-\u9fff]/g))].join('');return r.fulfill({contentType:'application/javascript',body:'(async()=>{const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.appendChild(style);await document.fonts.load('+JSON.stringify('14px Noto Sans CJK SC')+','+JSON.stringify(chars)+');\n'+app+'\n})();'});});
  await page.goto('http://127.0.0.1:8795');await page.waitForFunction(()=>globalThis.Laya?.stage?._children?.some(n=>n.name==='Observer UI'));
  const text=()=>page.evaluate(()=>{const walk=n=>n.visible===false?[]:[n,...(n._children??[]).flatMap(walk)];return walk(Laya.stage).filter(n=>typeof n.text==='string').map(n=>n.text);});
  const waitText=async(value)=>page.waitForFunction(value=>{const walk=n=>n.visible===false?[]:[n,...(n._children??[]).flatMap(walk)];return walk(Laya.stage).some(n=>typeof n.text==='string'&&n.text.includes(value));},value,{timeout:15000});
  const click=async(x,y)=>{const s=Math.min(profile.width/1280,profile.height/720),px=(profile.width-1280*s)/2+x*s,py=(profile.height-720*s)/2+y*s;profile.touch?await page.touchscreen.tap(px,py):await page.mouse.click(px,py);await page.waitForTimeout(500);};
  await click(1170,67);await waitText('运行设置 ·');assert.ok((await text()).includes('模型统筹（默认）'));await click(1060,236);await waitText('完全本地任务算法');await click(480,561);await click(380,645);
  await page.waitForFunction(()=>{const raw=localStorage.getItem('survive_agent_commit_v1');return raw&&JSON.parse(raw).world.tick>=40;},null,{timeout:20000});assert.equal(commandCalls,0);assert.equal(independentCalls,0);
  const baseline=await page.evaluate(()=>{const w=JSON.parse(localStorage.getItem('survive_agent_commit_v1')).world;return {run:w.runId,count:w.residents.length,tick:w.tick};});assert.equal(baseline.count,4);
  await click(230,105);await click(230,105);await waitText('阿岚');await click(140,595);await waitText('阿岚的私人地图');await click(980,561);await waitText('小川的私人地图');await click(1130,561);
  await click(1170,67);await click(475,236);await click(480,561);await waitText('已转本地算法');assert.equal(commandCalls,1);const preserved=await page.evaluate(()=>JSON.parse(localStorage.getItem('survive_agent_commit_v1')).world.runId);assert.equal(preserved,baseline.run);
  await click(1170,67);await click(760,236);await click(480,561);await waitText('EXPLICIT_TEST_INDEPENDENT_UNAVAILABLE');console.log('mode transitions passed',profile.width);assert.ok(independentCalls>=4);
  await click(1170,67);await click(1050,236);await click(480,561);await waitText('本地算法 ·');
  await click(1170,67);await click(1050,382);await waitText('新营地人数：6');await mkdir('local-evidence',{recursive:true});await page.screenshot({path:`local-evidence/control-modes-${profile.width}.png`});await click(760,561);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('survive_agent_commit_v1')).world.residents.length===6);const fresh=await page.evaluate(()=>JSON.parse(localStorage.getItem('survive_agent_commit_v1')).world.runId);assert.notEqual(fresh,baseline.run);assert.deepEqual(errors,[]);
  profiles.push({viewport:profile,defaultCommander:true,localActualExecution:true,localRemoteCalls:0,moreResidentsSelectable:true,ownMapVisible:true,modeChangePreservesRun:true,explicitFailureFallback:true,independentFailurePaused:true,newCampSixResidents:true,errors,remoteTransport:'EXPLICIT_MOCK_FAILURE_ONLY',realModelBrowser:false});await page.close();
 }
 await writeFile('evidence/control-browser.json',JSON.stringify({status:'passed',profiles,physicalDevice:'not_run'},null,2)+'\n');console.log(JSON.stringify({status:'passed',profiles:profiles.length}));
}finally{await browser.close();server.kill();}
