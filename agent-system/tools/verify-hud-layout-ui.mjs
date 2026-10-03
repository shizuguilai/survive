import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Explicit presentation stress fixture, isolated browser data, no model calls.
// The checks inspect real Laya typeset line boxes after the bundled fonts load.
const auditOnly=process.argv.includes('--audit-only'),residentOnly=process.argv.includes('--resident-only'),mapOnly=process.argv.includes('--map-only');
const viewSha256=createHash('sha256').update(await readFile('apps/laya-client/src/view.ts')).digest('hex'),mapSha256=createHash('sha256').update(await readFile('apps/laya-client/src/memory-map.ts')).digest('hex');
const {chromium}=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
const fixture=`
import {initialize} from './apps/laya-client/src/view.ts';
import {createCrewWorld} from './packages/sim-core/src/world.ts';
import {getOverlay,samplePerception} from './packages/sim-core/src/perception.ts';
import {postTask} from './packages/sim-core/src/camp.ts';
import {controlSettings} from './packages/contracts/src/command.ts';
import {hashCanonical} from './packages/contracts/src/canonical.ts';
const w=createCrewWorld(4),noop=()=>{};
w.tick=800;w.camp.stock={wood:999,stone:999,food:999};
const r=w.residents[0];r.supplies={wood:12,stone:6,food:12};r.inventory=30;r.water=6;r.goal='先照料水稻幼苗，再取水浇灌，完成种植并把成熟的收成搬回公共仓储。'.repeat(4);
for(let i=0;i<4;i++)postTask(w,{kind:'gather',resource:['wood','stone','food'][i%3],amount:20,note:'长目标说明：先收集材料再搬运入库，检查个人随身工具与仓储余额。'.repeat(3)});
samplePerception(w);
const v=await initialize({onTask:noop,onPause:noop,onResume:noop,onRetry:noop,onStop:noop,onSelect:id=>state.selectedId=id,onToggleSenses:noop,onStart:noop,onConnect:noop});
const state={world:w,overlays:Object.fromEntries(w.residents.map(r=>[r.id,getOverlay(w,r)])),selectedId:r.id,showSenses:false,mode:'LOCAL_ALGORITHM',control:controlSettings({mode:'local',residents:4}),status:'PAUSED',hosted:true,pendingTasks:12,saveStatus:'本机已存档 20:42:24',controlDetail:'阶段5 · 本地算法 · 远程调用0次 · 分配农田照料，同时保留备料、加工与施工人手。'.repeat(5),history:Array.from({length:12},(_,i)=>({id:'qa-history-'+i,runId:w.runId,tick:i*20,residentId:r.id,category:'action',text:'完成种植田块照料：开垦、播种、取水浇灌，之后按需维护房屋并将成熟食物搬入仓储。'.repeat(6)}))};
state.overlays[r.id].observations=[{modality:'visual',detail:{appearance:'先前看到的水稻：待开垦的荒地，需要开垦翻土、播种、取水浇灌并照料幼苗。'.repeat(6)}}];
const render=()=>{v.hudDirty=true;v.render(state);};
const all=node=>{const nodes=[node];for(let i=0;i<node.numChildren;i++)nodes.push(...all(node.getChildAt(i)));return nodes;};
const visible=n=>{for(let p=n;p&&p!==Laya.stage;p=p.parent)if(!p.visible||p.alpha===0)return false;return true;};
const globalRect=(n,x=0,y=0,w=n.width,h=n.height)=>{const p=n.localToGlobal(new Laya.Point(x,y)),q=n.localToGlobal(new Laya.Point(x+w,y+h));return {x:p.x,y:p.y,w:q.x-p.x,h:q.y-p.y};};
const inter=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(a.x+a.w,b.x+b.w)-x,h=Math.min(a.y+a.h,b.y+b.h)-y;return w>0&&h>0?{x,y,w,h}:null;};
const buttonId=n=>Object.entries(v.buttons).find(([,b])=>b.root===n)?.[0];
const labelId=n=>n===v.memoryMap.info?'mapLegend':Object.entries(v.labels).find(([,t])=>t===n)?.[0]??(n.parent&&buttonId(n.parent)?'button:'+buttonId(n.parent):n.name||n.text.slice(0,24));
const audit=scope=>{
 const nodes=all(scope).filter(visible),texts=[],buttons=nodes.filter(n=>buttonId(n)).map(n=>({id:buttonId(n),rect:globalRect(n),node:n}));
 for(const n of nodes){if(!(n instanceof Laya.Text)||!n.text)continue;n.typeset();const clipped=['hidden','scroll'].includes(n.overflow),clip=globalRect(n),lines=[];
  for(const line of n._lines??[]){for(let cmd=line.cmd;cmd;cmd=cmd.next){if(!cmd.text)continue;let rect=globalRect(n,n.padding[3]+line.x+cmd.x-(n.scrollX??0),n.padding[0]+line.y+cmd.y-(n.scrollY??0),cmd.width,cmd.height);if(clipped){rect=inter(rect,clip);if(!rect)continue;}lines.push({text:cmd.text,rect});}}
  texts.push({id:labelId(n),text:n.text.slice(0,200),overflow:n.overflow,declared:clip,textHeight:n.textHeight,textWidth:n.textWidth,lines,node:n});
 }
 const overlap=[];for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++)for(const a of texts[i].lines)for(const b of texts[j].lines){const rect=inter(a.rect,b.rect);if(rect&&rect.w>2&&rect.h>2)overlap.push({a:texts[i].id,b:texts[j].id,rect});}
 for(const t of texts)for(const b of buttons){if(t.node.parent===b.node)continue;for(const line of t.lines){const rect=inter(line.rect,b.rect);if(rect&&rect.w>2&&rect.h>2)overlap.push({a:t.id,b:'button-background:'+b.id,rect});}}
 const outside=[];for(const t of texts)for(const line of t.lines){if(line.rect.x<-.1||line.rect.y<-.1||line.rect.x+line.rect.w>1280.1||line.rect.y+line.rect.h>720.1)outside.push({id:t.id,rect:line.rect});}
 const keyNames=['mapLegend','person','personality','equipment','goal','action','perception','objectStock','objectDetail','objectLocation','controlHelp','saveDetail','taskList','taskNotice','requirements','draftHelp','inventoryBody','lifeBody','statusDetails','historyDetail'];
 const keyFields=texts.filter(t=>keyNames.includes(t.id)).map(t=>({id:t.id,rect:t.declared,textHeight:t.textHeight,overflow:t.overflow,...(t.id==='goal'?{lineCount:t.lines.length,lines:t.lines.map(l=>({text:l.text,rect:l.rect}))}:{})}));
 const buttonOverflow=texts.filter(t=>t.id.startsWith('button:')&&(t.textWidth>t.declared.w+.5||t.textHeight>t.declared.h+.5)).map(t=>({id:t.id,width:t.textWidth,height:t.textHeight,rect:t.declared}));
 return {textCount:texts.length,buttonCount:buttons.length,overlap,outside,buttonOverflow,keyFields};
};
const show=name=>{v.hideModals();v.selectedObject=null;v.sidebarCollapsed=false;v.layoutInspector();state.error='';state.controlNotice='';state.saveStatus='本机已存档 20:42:24';
 if(name==='collapsed')v.sidebarCollapsed=true;
 else if(name.startsWith('object-')){const kind=name.slice(7),o=w.objects.find(o=>o.kind===kind);v.selectedObject=o.id;if(kind==='board')o.appearance='公告板与公共仓储，居民阅读目标并交付物资。'.repeat(16);}
 else if(name.startsWith('planner-')){v.draftKind=name.slice(8);v.planner.visible=true;}
 else if(name==='history'){v.openHistory();}
 else if(name==='history-detail'){v.openHistory();render();v.historyDetail=v.displayedHistory[0];v.historyCache='';}
 else if(name==='status'){v.statusPanel.visible=true;state.error='本地存储空间不足，进度未保存，上一份完整存档可恢复。'.repeat(10);}
 else if(name==='settings'){v.controlDraft=state.control;v.controlPanel.visible=true;state.saveStatus='本机存储空间不足，进度未保存，上一份完整存档可恢复。'.repeat(8);}
 else if(name==='inventory')v.inventoryPanel.visible=true;
 else if(name==='life')v.lifePanel.visible=true;
 else if(name==='map')v.memoryPanel.visible=true;
 else if(name==='workshop')v.workshopPanel.visible=true;
 v.layoutInspector();render();const panel=v.modalLayouts.find(x=>x.panel.visible)?.panel;return {scope:panel??v.root,hash:hashCanonical(w)};};
Object.assign(globalThis,{qaView:v,qaWorld:w,qaState:state,qaShow:name=>{const {scope,hash}=show(name);globalThis.qaScope=scope;return hash;},qaAudit:()=>audit(qaScope),qaRender:render,qaHash:()=>hashCanonical(w),qaScrollCheck:()=>{const fields=['objectDetail','saveDetail','taskList','inventoryBody','lifeBody','statusDetails','historyDetail'];return fields.map(id=>({id,t:v.labels[id]})).filter(({t})=>t&&visible(t)&&t.overflow==='scroll').map(({id,t})=>{t.typeset();const max=t.maxScrollY,before=t.scrollY;t.scrollY=max;const after=t.scrollY;t.scrollY=before;return {id,max,after,restored:t.scrollY===before};});}});show('resident');globalThis.qaScope=v.root;globalThis.qaReady=true;
`;
const built=await build({stdin:{sourcefile:'hud-layout-fixture.ts',resolveDir:process.cwd(),contents:fixture},bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const profiles=[];await mkdir('local-evidence',{recursive:true});await mkdir('evidence',{recursive:true});
try{
 for(const [width,height,dpr] of [[1536,864,1],[844,390,2],[2048,1110,1]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:dpr>1}),page=await context.newPage(),errors=[],missing=[],cases=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://survive.test/**',async route=>{const path=new URL(route.request().url()).pathname;try{
   if(path==='/qa-font.woff')return route.fulfill({contentType:'font/woff',body:await readFile('apps/laya-client/assets/art/camp-sans.woff')});
   if(path==='/app.js')return route.fulfill({contentType:'text/javascript',body:built.outputFiles[0].text});
   let body=await readFile(resolve('dist','.'+(path==='/'?'/index.html':path)));
   if(path==='/')body=Buffer.from(body.toString().replace('<script src="app.js"></script>','<script type="module">const f=new FontFace("Camp Sans","url(/qa-font.woff)");await f.load();document.fonts.add(f);await import("/app.js");</script>'));
   await route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'}[path==='/'?'.html':extname(path)]??'application/octet-stream')});
  }catch{missing.push(path);await route.fulfill({status:404,body:'missing'});}});
  await page.goto('https://survive.test/');await page.waitForFunction(()=>globalThis.qaReady,undefined,{timeout:30000}).catch(e=>{console.log({errors,missing});throw e;});
  for(const name of (mapOnly?['map']:residentOnly?['resident','map']:['resident','collapsed','object-board','object-berry','object-pond','planner-gather','planner-craft','planner-residential','planner-planting','planner-pasture','workshop','settings','history','history-detail','inventory','life','status','map'])){
   const before=await page.evaluate(name=>qaShow(name),name);await page.waitForTimeout(80);const audit=await page.evaluate(()=>qaAudit()),scrollChecks=await page.evaluate(()=>qaScrollCheck());assert.equal(await page.evaluate(()=>qaHash()),before,'Rendering cannot mutate simulation');
   const screenshot='local-evidence/hud-'+(auditOnly?'audit-':'verified-')+name+'-'+width+'.png';await page.screenshot({path:screenshot});
   console.log(JSON.stringify({width,name,overlap:audit.overlap,outside:audit.outside}));cases.push({name,screenshot,...audit,scrollChecks});for(const check of scrollChecks){assert.ok(check.restored);assert.equal(check.after,check.max);}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);profiles.push({width,height,dpr,errors,missing,cases});await context.close();
 }
 const report={mode:'EXPLICIT_PRESENTATION_FIXTURE',auditOnly,residentOnly,mapOnly,viewSha256,mapSha256,environment:'Headless Chromium, bundled Camp Sans + Camp Extension loaded; three viewport sizes, not a physical phone.',fixture:'4 residents, long repeated goal/perception/task/history/status text, 999 stock resources, object and all HUD/modal types. No remote calls or simulation planning.',profiles};
 if(residentOnly||mapOnly){for(const profile of profiles){const goal=profile.cases[0].keyFields.find(f=>f.id==='goal');if(goal)assert.equal(goal.lineCount,2,'Normal housing wish should remain readable on two complete lines');const legend=profile.cases.find(c=>c.name==='map')?.keyFields.find(f=>f.id==='mapLegend');if(legend)assert.ok(legend.textHeight<=legend.rect.h,'Populated map legend must fit without clipping its last line');}const full=JSON.parse(await readFile('evidence/hud-layout-ui.json','utf8'));full[mapOnly?'finalMapFollowup':'finalResidentFollowup']=report;await writeFile('evidence/hud-layout-ui.json',JSON.stringify(full,null,2)+'\n');}else await writeFile(auditOnly?'/tmp/survive-hud-exploratory.json':'evidence/hud-layout-ui.json',JSON.stringify(report,null,2)+'\n');
 if(!auditOnly){const issues=profiles.flatMap(p=>p.cases.flatMap(c=>c.overlap.concat(c.outside,c.buttonOverflow)));assert.equal(issues.length,0,JSON.stringify(issues.slice(0,20)));}
}finally{await browser.close();}
