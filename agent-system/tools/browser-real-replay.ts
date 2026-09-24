/** Browser playback of the actual REAL_MODEL recording; never injects decisions. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createGatewayServer} from '../services/brain-gateway/src/server.ts';
import {loadConfig,RealModelGateway} from '../services/brain-gateway/src/gateway.ts';
import {ReplayPlayer} from '../packages/sim-core/src/replay.ts';

const recording=JSON.parse(gunzipSync(await readFile('evidence/real-meeting-replay.json.gz')).toString('utf8'));
new ReplayPlayer(recording);assert.equal(recording.manifest.decisionMode,'real');assert.equal(recording.manifest.decisionCounts.mock,0);
const {server}=createGatewayServer({gateway:new RealModelGateway(loadConfig({}))});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const modulePath=process.env.PLAYWRIGHT_MODULE??join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??'node_modules','playwright','index.mjs');
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
const report:any={status:'running',kind:'real-recording-browser-playback',source:'REAL_MODEL_RECORDING',liveModelBrowser:'NOT_TESTED',cloudBrowser:'NOT_TESTED',physicalDevice:'NOT_TESTED',mockDecisions:0,browserVersion:browser.version(),appSha256:createHash('sha256').update(await readFile('dist/app.js')).digest('hex')};
try{
  const context=await browser.newContext({viewport:{width:1280,height:720}});const page=await context.newPage();
  let requests=0;const errors:string[]=[];page.on('request',(r:any)=>{if(r.url().includes('/api/decide'))requests++;});page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.addInitScript((data:any)=>localStorage.setItem('survive_agent_replay_v1',JSON.stringify(data)),recording);
  await page.goto(origin,{waitUntil:'load'});await page.waitForFunction(()=>!!(globalThis as any).Laya?.stage);
  const inspect=()=>page.evaluate(()=>{
    const L=(globalThis as any).Laya;const walk=(n:any):any[]=>[n,...(n._children??[]).flatMap(walk)];const nodes=walk(L.stage);
    const scene=nodes.find(n=>n.name==='Survive — 认知观察场');
    return {texts:nodes.filter(n=>typeof n.text==='string'&&n.visible).map(n=>n.text),positions:(scene?._children??[]).filter((n:any)=>['阿林','小禾'].includes(n.name)).map((n:any)=>({name:n.name,x:n.transform.position.x,z:n.transform.position.z})),senses:nodes.find(n=>n.name==='有限感知参考')?.lineCount??0};
  });
  const click=async(x:number,y:number)=>{await page.mouse.click(x,y);await page.waitForTimeout(100);};
  await page.waitForFunction(()=>{const walk=(n:any):any[]=>[n,...(n._children??[]).flatMap(walk)];return walk((globalThis as any).Laya.stage).some(n=>n.text==='查看回放');});
  await click(753,644);await page.waitForFunction(()=>{const walk=(n:any):any[]=>[n,...(n._children??[]).flatMap(walk)];return walk((globalThis as any).Laya.stage).some(n=>n.text==='返回现场');});
  await click(490,644);await click(1199,684);const end=await inspect();
  assert.ok(end.texts.includes('观察回放 · 不调用模型'));assert.ok(end.texts.includes(`${recording.manifest.endTick}/${recording.manifest.endTick}`));
  assert.ok(!end.texts.some((t:string)=>t.includes('服务端尚未配置真实模型')),'live gateway diagnostic must not cover independent replay');
  for(const r of recording.frames.at(-1).world.residents){const p=end.positions.find((p:any)=>p.name===r.name);assert.ok(p);assert.ok(Math.abs(p.x-r.position.x)<1e-5&&Math.abs(p.z-r.position.z)<1e-5);}
  await click(210,145);assert.ok((await inspect()).texts.some((t:string)=>t.includes('●')&&t.includes('小禾')));
  await click(120,555);assert.equal((await inspect()).senses,0);await click(120,555);assert.ok((await inspect()).senses>0);
  await page.screenshot({path:'evidence/browser-real-replay.png',fullPage:true});
  await click(320,684);assert.ok((await inspect()).texts.includes(`0/${recording.manifest.endTick}`));
  assert.equal(requests,0);assert.deepEqual(errors,[]);
  Object.assign(report,{status:'passed',endTick:recording.manifest.endTick,decisionCounts:recording.manifest.decisionCounts,checks:{laya3D:true,realRecordingLoaded:true,endPositionsMatch:true,seekStartAndEnd:true,residentSelection:true,sensesToggle:true,zeroModelRequests:true},errors,decisionRequests:requests,screenshot:'browser-real-replay.png'});
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{await writeFile('evidence/browser-real-replay.json',JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
console.log(JSON.stringify(report));
