import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {spawn} from 'node:child_process';import {writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(resolve(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright/index.mjs`)).href);
const server=spawn(process.execPath,['services/brain-gateway/src/server.ts'],{stdio:'ignore',env:{...process.env,SURVIVE_MODEL_API_KEY:'',SURVIVE_PORT:'8792'}});
const browser=await chromium.launch({executablePath:'/workspace/scratch/4be8967a8182/browser-tools/runtime/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const profiles=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:8792/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const size of [{width:1280,height:720},{width:844,height:390}]){
  const page=await browser.newPage({viewport:size});const errors=[];page.on('pageerror',e=>errors.push(e.message));let requests=0;const releases=[];
  // Explicit delayed-transport fixture. No decision response, credentials or real model claims.
  await page.route('**/api/health',r=>r.fulfill({json:{configured:true,canStart:true,accessMode:'hosted'}}));
  await page.route('**/api/decide',async route=>{requests++;await new Promise(r=>releases.push(r));await route.abort('aborted').catch(()=>{});});
  await page.goto('http://127.0.0.1:8792');await page.waitForFunction(()=>globalThis.Laya?.stage?._children?.some(n=>n.name==='Observer UI'));
  const click=async(x,y)=>{const s=Math.min(size.width/1280,size.height/720);await page.mouse.click((size.width-1280*s)/2+x*s,(size.height-720*s)/2+y*s);};
  const texts=()=>page.evaluate(()=>{const walk=n=>n.visible===false?[]:[n,...(n._children??[]).flatMap(walk)];return walk(Laya.stage).filter(n=>typeof n.text==='string').map(n=>n.text);});
  await click(379,644);await page.waitForTimeout(1300);let t=await texts();assert.ok(t.some(x=>x.includes('已返回0/2')&&x.includes('等阿林、小禾')));assert.equal(requests,2);assert.ok(t.some(x=>x.includes('模拟 00:00')));
  await click(79,555);await page.waitForTimeout(300);assert.ok((await texts()).some(x=>x.includes('的档案')));await click(1125,559);await page.waitForTimeout(1000);t=await texts();assert.ok(t.some(x=>x.includes('模拟 00:00')));assert.ok(t.some(x=>x.includes('秒')&&x.includes('已返回0/2')));
  await mkdir('local-evidence',{recursive:true});await page.screenshot({path:`local-evidence/thinking-wait-${size.width}.png`});await click(655,643);await page.waitForTimeout(150);assert.ok((await texts()).some(x=>x.startsWith('已停止')));releases.forEach(r=>r());assert.deepEqual(errors,[]);profiles.push({viewport:size,waitingNamesAndCount:true,elapsedTime:true,historyOperableWhileFrozen:true,worldTimeFrozen:true,stopOperable:true,requests,acceptedDecisions:0,errors});await page.close();
 }
 await writeFile('evidence/thinking-browser.json',JSON.stringify({status:'passed',mode:'explicit-delayed-transport-fixture-no-model-response',profiles,realModel:'not_run_in_browser',physicalDevice:'not_run'},null,2)+'\n');console.log(JSON.stringify({status:'passed',profiles:profiles.length}));
}finally{await browser.close();server.kill();}
