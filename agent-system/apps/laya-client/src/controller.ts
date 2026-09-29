import {UiNotice} from './ui-notice.ts';
import {CampSaves,type CampSaveState} from './camp-save.ts';
import {ColonyProvider} from '../../../packages/sim-core/src/colony.ts';
import {controlSettings,type ControlSettings,type CommandProvider,type CommandRequest,type CommandResponse} from '../../../packages/contracts/src/command.ts';
import {Simulation} from '../../../packages/sim-core/src/cognition.ts';
import {createCrewWorld} from '../../../packages/sim-core/src/world.ts';
import type {World} from '../../../packages/sim-core/src/domain.ts';
import type {BrainProvider,BrainRequest,BrainResponse} from '../../../packages/contracts/src/types.ts';
import {initialize} from './view.ts';
import type {ObserverView,ViewState} from './view.ts';
import {gatewayRequest} from './transport.ts';
import {restoreSummaries} from './journal-summary.ts';
import {validateSummaryResponse,type SummaryRequest,type SavedSummary} from '../../../packages/contracts/src/journal-summary.ts';
import {ResidentJournal} from './journal.ts';
import {LiveObserver} from './live-observer.ts';

class GatewayProvider implements BrainProvider{
  async decide(request:BrainRequest,signal?:AbortSignal):Promise<BrainResponse>{
    const r=await gatewayRequest('/api/decide',{method:'POST',body:request,signal});
    const value=await r.json();
    if(!r.ok){console.error('[Survive gateway]',{status:r.status,code:value.error,traceId:value.traceId});throw Error(`${value.message??'模型网关请求失败'} [HTTP ${r.status} · ${value.error??'UNKNOWN'}${value.traceId?' · '+value.traceId:''}]`);}
    if(value.source!=='REAL_MODEL')throw Error('真实自治模式拒绝非真实模型响应');
    return value;
  }
}
class GatewayCommander implements CommandProvider{
 async plan(request:CommandRequest,signal?:AbortSignal):Promise<CommandResponse>{const r=await gatewayRequest('/api/command',{method:'POST',body:request,signal});const v=await r.json();if(!r.ok)throw Error(v.message??'统筹网关请求失败');return v;}
}
function persist(key:string,value:unknown):void{
  // Storage is observer infrastructure; failures propagate and keep cognition frozen.
  const wx=(globalThis as any).wx;
  if(wx?.setStorageSync)wx.setStorageSync(key,JSON.stringify(value));
  else globalThis.localStorage.setItem(key,JSON.stringify(value));
}
export async function boot():Promise<void>{
  const notice=new UiNotice();
  let view:ObserverView;let configured=false;let canStart=false;let hosted=false;let diagnostic='';let started=false;
  let settings=controlSettings(null);try{const wx=(globalThis as any).wx;const raw=wx?.getStorageSync?wx.getStorageSync('survive_control_v1'):globalThis.localStorage.getItem('survive_control_v1');settings=controlSettings(raw?JSON.parse(raw):null);}catch{}
  const saves=new CampSaves({getItem:key=>{const wx=(globalThis as any).wx;return (wx?.getStorageSync?wx.getStorageSync(key):globalThis.localStorage.getItem(key))||null;},setItem:(key,value)=>{const wx=(globalThis as any).wx;if(wx?.setStorageSync)wx.setStorageSync(key,value);else globalThis.localStorage.setItem(key,value);}});
  const restored=saves.load(settings);if(restored.save)settings=restored.save.settings;
  let saveBlocked=restored.blocked,saveWarning=restored.warning,lastSavedAt=restored.save?.savedAt??0,lastSaveWall=0,lastSaveKey='',restoreReady=!!restored.save,resumeSavedPlans=!!restored.save&&!restored.save.needsDecision;
  let colony:ColonyProvider|null=null;
  let selectedId=restored.save?.selectedId??'resident-a',showSenses=restored.save?.showSenses??false;
  let observedBarrier='';let barrierWallStart=0;let latestRequestMs=0;
  let journal:ResidentJournal;let savedJournalVersion=-1;let lastJournalSave=0;let historyWarning='';
  try{const wx=(globalThis as any).wx;const raw=wx?.getStorageSync?wx.getStorageSync('survive_resident_history_v1'):globalThis.localStorage.getItem('survive_resident_history_v1');journal=new ResidentJournal(raw?JSON.parse(raw):undefined);}catch{journal=new ResidentJournal();historyWarning='历史存储读取失败，本次记录仍可在会话内查看。';}
  const observer=new LiveObserver(journal);
  function saveJournal():void{observer.observe(sim.world);if(savedJournalVersion===journal.version)return;try{persist('survive_resident_history_v1',journal.rows);savedJournalVersion=journal.version;historyWarning='';}catch{historyWarning='本机历史存储失败；本次会话内仍可查看，刷新可能丢失。';}}
  let summaries:SavedSummary[]=[];let summaryBusy=false;let summaryError='';let summaryVersion=0;
  try{const wx=(globalThis as any).wx;const raw=wx?.getStorageSync?wx.getStorageSync('survive_archive_summaries_v1'):globalThis.localStorage.getItem('survive_archive_summaries_v1');summaries=restoreSummaries(raw?JSON.parse(raw):undefined);}catch{summaryError='已保存总结读取失败，原始档案仍可查看。';}
  async function summarize(request:SummaryRequest):Promise<void>{
    if(summaryBusy)return;
    summaryBusy=true;summaryError='';summaryVersion++;
    try{
      const response=await gatewayRequest('/api/summarize',{method:'POST',body:request,signal:AbortSignal.timeout(125000)});const raw=await response.json();
      if(!response.ok)throw Error(raw.message??'总结生成失败，请重试');
      const result=validateSummaryResponse(raw,request);summaries=[...summaries.filter(s=>s.response.runId!==result.runId||s.response.residentId!==result.residentId),{response:result,entries:request.entries,createdAt:new Date().toISOString()}].slice(-40);
      try{persist('survive_archive_summaries_v1',summaries);}catch{summaryError='总结已生成，但本机存储失败；刷新后可能丢失。';}
    }catch(e){summaryError=(e as Error).name==='TimeoutError'?'总结超时，可重试；原始档案仍保留。':(e as Error).message;}
    finally{summaryBusy=false;summaryVersion++;}
  }
  const provider=new GatewayProvider();
  function makeSimulation(world?:World):Simulation{
    colony=settings.mode==='independent'?null:new ColonyProvider(settings,new GatewayCommander());
    return new Simulation(colony??provider,{world:world??createCrewWorld(settings.residents),allowMock:false,controlMode:settings.mode,allowLocalFallback:settings.fallback,requestTimeoutMs:settings.mode==='independent'?120000:30000,
      onCommit:record=>{if(saveBlocked)throw Error('请先处理本机存档问题，或点击保存进度确认使用当前营地。');writeSave(record.nextWorld,false);}
    });
  }
  let sim=makeSimulation(restored.save?.world);for(const task of restored.save?.queuedTasks??[])sim.queueTask(task);sim.pause('NOT_STARTED');
  if(!sim.world.residents.some(r=>r.id===selectedId))selectedId=sim.world.residents[0].id;
  function needsDecisionNow():boolean{return ['THINKING','COMMITTING','ERROR_PAUSED'].includes(sim.status)||((!started||sim.status==='STOPPED')&&!resumeSavedPlans);}
  function saveState(world=sim.world,needsDecision=needsDecisionNow()):CampSaveState{return {world,settings,queuedTasks:sim.queuedTasks,selectedId,showSenses,needsDecision};}
  function savedKey(world=sim.world,needsDecision=needsDecisionNow()){return [world.runId,world.tick,world.revision,needsDecision,JSON.stringify(sim.queuedTasks),selectedId,showSenses,JSON.stringify(settings)].join('|');}
  function writeSave(world=sim.world,needsDecision=needsDecisionNow()):void{
    try{const saved=saves.save(saveState(world,needsDecision));lastSavedAt=saved.savedAt;lastSaveKey=savedKey(world,needsDecision);lastSaveWall=performance.now();saveWarning='';}
    catch(e){saveWarning=(e as Error).name==='QuotaExceededError'?'本机存储空间不足，进度未保存；上一份完整存档仍保留。':'本机存档写入失败，上一份完整存档仍保留。';console.warn('[Survive save]',{reason:(e as Error).name});throw e;}
  }
  function saveCurrent(manual=false):void{if(sim.status==='COMMITTING')return;if(saveBlocked&&!manual)return;try{writeSave();if(manual){saveBlocked=false;notice.show('营地进度已保存在本机。',performance.now());}}catch{}}
  function loadSavedCamp():void{
    const loaded=saves.load(settings);if(!loaded.save){saveWarning=loaded.warning||'本机还没有营地存档。';return;}
    const s=loaded.save;sim.stop();settings=s.settings;selectedId=s.world.residents.some(r=>r.id===s.selectedId)?s.selectedId:s.world.residents[0].id;showSenses=s.showSenses;
    sim=makeSimulation(s.world);for(const task of s.queuedTasks)sim.queueTask(task);sim.pause('NOT_STARTED');started=false;restoreReady=true;resumeSavedPlans=!s.needsDecision;saveBlocked=false;saveWarning=loaded.warning;lastSavedAt=s.savedAt;lastSaveKey=savedKey();lastSaveWall=performance.now();diagnostic='';notice.show('营地已恢复，点击“继续营地”后运行。',performance.now());
  }
  observer.observe(sim.world);
  async function health():Promise<void>{
    try{
      const r=await gatewayRequest('/api/health',{signal:AbortSignal.timeout(4000)});const h=await r.json();
      if(!r.ok)throw Error('网关状态读取失败');
      configured=h.configured===true;canStart=h.canStart===true||(h.canStart===undefined&&h.authenticated===true);hosted=h.accessMode==='hosted';
      if(!configured)diagnostic='服务端尚未配置真实模型。世界保持静止，感官与镜头可操作。';
      else if(!canStart)diagnostic=hosted?'请使用本站所属账号登录后启动。':'请使用网关启动时给出的本地登录链接。';
      else if(!started)diagnostic=restoreReady?'已恢复本机营地，点击「继续营地」后运行。':'点击「开始运行」，或在「运行设置」选择模式和居民数量。';
    }catch{configured=false;canStart=false;diagnostic='无法连接模型网关，请稍后重试。';}
  }
  function pause():void{sim.pause('USER_PAUSE');saveCurrent();}
  function resume():void{sim.resume('USER_PAUSE');}
  async function start():Promise<void>{
    if(settings.mode!=='local'){if(!configured||!canStart)await health();if(!configured||!canStart){if(settings.mode==='commander'&&settings.fallback)colony?.useLocal('网关尚未配置或不可连接，可在设置中重试远程。');else return;}}
    if(started&&sim.status!=='STOPPED'){diagnostic='本轮已启动；失败时可重试，暂停时可继续。';return;}
    if(started){const world=sim.world,queued=sim.queuedTasks;sim=makeSimulation(world);for(const task of queued)sim.queueTask(task);}
    if(settings.mode==='commander'&&settings.fallback&&(!configured||!canStart))colony?.useLocal('网关尚未配置或不可连接，可在设置中重试远程。');
    started=true;diagnostic='';sim.resume('NOT_STARTED');
    const resumePlans=resumeSavedPlans;restoreReady=false;resumeSavedPlans=false;await sim.bootstrap(resumePlans);saveCurrent();
  }
  async function configure(next:ControlSettings,newCamp=false):Promise<void>{
    const keepPaused=sim.pauseTokens.has('USER_PAUSE'),continuePlans=!newCamp&&!needsDecisionNow();const world=sim.world,queued=sim.queuedTasks;sim.stop();settings=controlSettings(next);
    try{persist('survive_control_v1',settings);}catch{historyWarning='运行设置未能保存，当前会话仍有效';}
    if(newCamp){selectedId='resident-a';restoreReady=false;resumeSavedPlans=false;saveBlocked=false;}
    sim=makeSimulation(newCamp?undefined:world);if(!newCamp)for(const task of queued)sim.queueTask(task);if(keepPaused)sim.pause('USER_PAUSE');
    diagnostic='';notice.show(newCamp?'已建立新营地。':'模式已更新，现有居民、任务和私人记忆保留。',performance.now());
    if(started)await sim.bootstrap(continuePlans);else{resumeSavedPlans=continuePlans;sim.pause('NOT_STARTED');}saveCurrent();
  }
  view=await initialize({
    onSave:()=>saveCurrent(true),onLoad:loadSavedCamp,
    onControl:(next,newCamp)=>{void configure(next,newCamp).catch(e=>{diagnostic=e.message;});},onRemoteRetry:()=>{colony?.retryRemote();},
    onSummarize:request=>{void summarize(request);},
    onPause:pause,onResume:resume,onRetry:()=>{void health().then(()=>sim.retry());},
    onTask:draft=>{try{sim.queueTask(draft);saveCurrent();notice.show('规划已接收；世界恢复运行后写入公告板。',performance.now(),true);return true;}catch(e){diagnostic=(e as Error).message;return false;}},
    onStop:()=>{resumeSavedPlans=!needsDecisionNow();saveCurrent();sim.stop();saveJournal();},
    onSelect:id=>{selectedId=id;},onToggleSenses:()=>{showSenses=!showSenses;},
    onStart:()=>{void start().catch(e=>{diagnostic=e.message;});},
    onConnect:token=>{void gatewayRequest('/api/session',{method:'POST',body:{token}}).then(health).catch(()=>{diagnostic='本地登录失败，请使用服务端提供的登录链接。';});}
  });
  function frame():void{
    try{
      const now=performance.now();sim.frame(now);const world=sim.world;observer.observe(world);const cover=observer.senses(world,selectedId,showSenses);
      const liveStatus=sim.pauseTokens.has('USER_PAUSE')&&!['ERROR_PAUSED','STOPPED'].includes(sim.status)?'PAUSED':sim.status;
      const barrier=sim.barrier;const modelErrors=Object.values(barrier?.errors??{}).join('；');
      let cognitionDetail='';
      if(barrier&&['THINKING','COMMITTING','ERROR_PAUSED'].includes(sim.status)){
        if(observedBarrier!==barrier.id){observedBarrier=barrier.id;barrierWallStart=now;}
        const pending=barrier.dueAgentIds.filter(id=>!barrier.acceptedAgentIds.includes(id)).map(id=>sim.world.residents.find(r=>r.id===id)?.name??id);
        const elapsed=Math.floor((now-barrierWallStart)/1000);
        cognitionDetail=`${barrier.id.replace('cognition-','第')}批 · 已返回${barrier.acceptedAgentIds.length}/${barrier.dueAgentIds.length} · ${pending.length?'等'+pending.join('、'):'提交中'} ${elapsed}秒`;
        const attempt=Math.max(1,...Object.values(barrier.requestAttempts));if(attempt>1)cognitionDetail+=` · 第${attempt}次尝试`;
        if(elapsed>=30)cognitionDetail+=' · 等待较久，可停止';
        latestRequestMs=now-barrierWallStart;
      }else if(started)cognitionDetail=`上轮等待 ${(latestRequestMs/1000).toFixed(1)}秒 · 正在执行已提交动作`;
      if(now-lastJournalSave>2000){saveJournal();lastJournalSave=now;}
      if(now-lastSaveWall>=10000){lastSaveWall=now;if(savedKey()!==lastSaveKey)saveCurrent();}
      const saveStatus=saveWarning||(lastSavedAt?'本机已存档 '+new Date(lastSavedAt).toLocaleTimeString('zh-CN',{hour12:false}):'本机自动存档 · 每10秒及关键操作保存');
      const s:ViewState={saveStatus,resumeReady:restoreReady&&!started,control:settings,controlDetail:colony?.detail,controlNotice:colony?.notice,fallbackActive:colony?.fallbackActive,summaries,summaryBusy,summaryError,summaryVersion,world,overlays:cover,cognitionDetail,history:journal.rows,historyVersion:journal.version,historyWarning,pendingTasks:sim.pendingTaskCount,selectedId,showSenses,hosted,
        mode:settings.mode==='local'||colony?.fallbackActive?'LOCAL_ALGORITHM':configured?'REAL_MODEL':'UNCONFIGURED',status:liveStatus,
        error:sim.observerError||modelErrors||notice.read(now,sim.pendingTaskCount)||diagnostic||(sim.pauseTokens.has('USER_PAUSE')&&sim.status==='THINKING'?'用户已暂停；居民仍在思考，继续按钮只解除手动暂停。':'')};
      view.render(s);
    }catch(e){sim.pause('OBSERVER_ERROR');diagnostic=(e as Error).message;}
  }
  const L=(globalThis as any).Laya;L.timer.frameLoop(1,null,frame);
  const wx=(globalThis as any).wx;
  const saveOnLeave=()=>{saveCurrent();saveJournal();};
  if(wx?.onHide){wx.onHide(()=>{sim.pause('APP_BACKGROUND');saveOnLeave();});wx.onShow(()=>sim.resume('APP_BACKGROUND'));}
  else {globalThis.addEventListener('pagehide',saveOnLeave);document.addEventListener('visibilitychange',()=>{if(document.hidden){sim.pause('APP_BACKGROUND');saveOnLeave();}else sim.resume('APP_BACKGROUND');});}
  if(settings.mode!=='local')await health();frame();
}
