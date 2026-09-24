import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {chromium}=await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE??`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??'node_modules'}/playwright/index.mjs`)).href);
import {spawn} from 'node:child_process';import {mkdir,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const server=spawn(process.execPath,['services/brain-gateway/src/server.ts'],{stdio:'ignore',env:{...process.env,SURVIVE_MODEL_API_KEY:'',SURVIVE_PORT:'8791'}});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH??'/workspace/scratch/4be8967a8182/browser-tools/runtime/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:8791/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const size of [{width:1280,height:720},{width:844,height:390}]){
 const page=await browser.newPage({viewport:size});const errors=[];let modelRequests=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/decide'))modelRequests++;});
 await page.goto('http://127.0.0.1:8791');await page.waitForFunction(()=>globalThis.Laya?.stage?._children?.some(n=>n.name==='Observer UI'));
 const texts=()=>page.evaluate(()=>{const walk=n=>[n,...(n._children??[]).flatMap(walk)];return walk(Laya.stage).filter(n=>typeof n.text==='string').map(n=>n.text);});
 const click=async(x,y)=>{const scale=Math.min(size.width/1280,size.height/720);await page.mouse.click((size.width-1280*scale)/2+x*scale,(size.height-720*scale)/2+y*scale);await page.waitForTimeout(100);};
 await page.waitForTimeout(200);assert.ok((await texts()).some(t=>t.includes('生命 100')));
 await click(1140,110);await click(610,255);await click(760,255);assert.ok((await texts()).includes('发布浆果目标'));
 await click(420,549);assert.ok((await texts()).some(t=>t.includes('待写入公告')));
 assert.equal(modelRequests,0);assert.deepEqual(errors,[]);
 const objects=await page.evaluate(()=>{const scene=Laya.stage._children.find(n=>n.name==='Survive — 认知观察场');return scene._children.filter(n=>n.name?.startsWith('camp-resource-')).length;});assert.equal(objects,30);
 await mkdir('local-evidence',{recursive:true});await page.screenshot({path:`local-evidence/camp-${size.width}.png`});
 results.push({viewport:size,taskPanel:true,resourceSelection:true,queuedDuringFreeze:true,vitalsVisible:true,resourceNodes:objects,modelRequests,errors});await page.close();
 }
 await writeFile('evidence/camp-browser.json',JSON.stringify({status:'passed',mode:'unconfigured-native-Laya-ui',profiles:results,liveModelBrowser:'not_run',physicalDevice:'not_run'},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.kill();}
