import {Simulation} from '../../../packages/sim-core/src/cognition.ts';
import {createWorld} from '../../../packages/sim-core/src/world.ts';
import {getOverlay} from '../../../packages/sim-core/src/perception.ts';
import {ReplayRecorder,ReplayPlayer} from '../../../packages/sim-core/src/replay.ts';
import type {ReplayFile} from '../../../packages/sim-core/src/replay.ts';
import type {World,SensoryOverlay} from '../../../packages/sim-core/src/domain.ts';
import type {BrainProvider,BrainRequest,BrainResponse} from '../../../packages/contracts/src/types.ts';
import {initialize} from './view.ts';
import type {ObserverView,ViewState} from './view.ts';
import {gatewayRequest} from './transport.ts';

class GatewayProvider implements BrainProvider{
  async decide(request:BrainRequest,signal?:AbortSignal):Promise<BrainResponse>{
    const r=await gatewayRequest('/api/decide',{method:'POST',body:request,signal});
    const value=await r.json();
    if(!r.ok){console.error('[Survive gateway]',{status:r.status,code:value.error,traceId:value.traceId});throw Error(`${value.message??'模型网关请求失败'} [HTTP ${r.status} · ${value.error??'UNKNOWN'}${value.traceId?' · '+value.traceId:''}]`);}
    if(value.source!=='REAL_MODEL')throw Error('真实自治模式拒绝非真实模型响应');
    return value;
  }
}
function overlays(world:World):Record<string,SensoryOverlay>{return Object.fromEntries(world.residents.map(r=>[r.id,getOverlay(world,r)]));}
function persist(key:string,value:unknown):void{
  // Storage is observer infrastructure; failures propagate and keep cognition frozen.
  const wx=(globalThis as any).wx;
  if(wx?.setStorageSync)wx.setStorageSync(key,JSON.stringify(value));
  else globalThis.localStorage.setItem(key,JSON.stringify(value));
}
function loadReplay():ReplayFile|null{
  const wx=(globalThis as any).wx;const s=wx?.getStorageSync?wx.getStorageSync('survive_agent_replay_v1'):globalThis.localStorage.getItem('survive_agent_replay_v1');
  return s?JSON.parse(s):null;
}

export async function boot():Promise<void>{
  let view:ObserverView;let configured=false;let canStart=false;let hosted=false;let diagnostic='';let started=false;
  let recorder=new ReplayRecorder();let player:ReplayPlayer|null=null;
  let selectedId='resident-a',showSenses=true,speed=1;
  const provider=new GatewayProvider();
  function makeSimulation():Simulation{
    return new Simulation(provider,{world:createWorld(),allowMock:false,
      onSnapshot:(world:World)=>recorder.capture(world,overlays(world)),
      onCommit:async(record:any)=>{
        // A single replacement stores a complete transaction before world release.
        persist('survive_agent_commit_v1',{schemaVersion:'1.0.0',world:record.nextWorld,commit:record});
        recorder.commit(record);
      }
    });
  }
  let sim=makeSimulation();sim.pause('NOT_STARTED');
  recorder.capture(sim.world,overlays(sim.world));
  async function health():Promise<void>{
    try{
      const r=await gatewayRequest('/api/health');const h=await r.json();
      if(!r.ok)throw Error('网关状态读取失败');
      configured=h.configured===true;canStart=h.canStart===true||(h.canStart===undefined&&h.authenticated===true);hosted=h.accessMode==='hosted';
      if(!configured)diagnostic='服务端尚未配置真实模型。世界保持静止，感官与镜头可操作。';
      else if(!canStart)diagnostic=hosted?'请使用本站所属账号登录后启动。':'请使用网关启动时给出的本地登录链接。';
      else if(!started)diagnostic='真实模型已配置，点击「开始真实自治」启动两名居民。';
    }catch{configured=false;canStart=false;diagnostic='无法连接模型网关，请稍后重试。';}
  }
  function pause():void{if(player)player.pause();else sim.pause('USER_PAUSE');}
  function resume():void{if(player)player.play();else sim.resume('USER_PAUSE');}
  async function start():Promise<void>{
    if(player){diagnostic='请先返回现场再开始。';return;}
    await health();if(!configured||!canStart)return;
    if(started&&sim.status!=='STOPPED'){diagnostic='本轮已启动；失败时可重试，暂停时可继续。';return;}
    if(started){recorder=new ReplayRecorder();sim=makeSimulation();}
    started=true;diagnostic='';sim.resume('NOT_STARTED');
    await sim.bootstrap();
  }
  function replay():void{
    try{
      const recording=recorder.commits.length?recorder.export(sim.status==='STOPPED'):loadReplay();
      if(!recording)throw Error('尚无回放，请先完成一次真实模型决策。');
      player=new ReplayPlayer(recording);sim.pause('REPLAY_VIEW');player.play();diagnostic='';
      // Save only on explicit replay action; never disguise storage failure as success.
      try{persist('survive_agent_replay_v1',recording);}catch{diagnostic='回放已在本次会话打开；本机存储空间不足，未能持久保存。';}
      if(recording.manifest.decisionMode!=='real')diagnostic='当前回放明确包含 Mock 测试决策，不是已验证真实模型运行。';
    }catch(e){diagnostic=(e as Error).message;}
  }
  view=await initialize({
    onPause:pause,onResume:resume,onRetry:()=>{if(!player)void health().then(()=>sim.retry());},
    onStop:()=>{if(player)player.pause();else sim.stop();},
    onSelect:id=>{selectedId=id;},onToggleSenses:()=>{showSenses=!showSenses;},onReplay:replay,
    onLive:()=>{player=null;sim.resume('REPLAY_VIEW');diagnostic='';},
    onSeek:tick=>{if(player)player.seek(tick);},onSpeed:value=>{speed=value;if(player)player.setSpeed(value);},
    onStart:()=>{void start().catch(e=>{diagnostic=e.message;});},
    onConnect:token=>{void gatewayRequest('/api/session',{method:'POST',body:{token}}).then(health).catch(()=>{diagnostic='本地登录失败，请使用服务端提供的登录链接。';});}
  });
  function frame():void{
    try{
      const now=performance.now();let world=sim.world,cover:Record<string,SensoryOverlay>;
      if(player){const f=player.frame(now);world=f.world;cover=f.overlays;}
      else{sim.frame(now);world=sim.world;cover=overlays(world);}
      const liveStatus=sim.pauseTokens.has('USER_PAUSE')&&!['ERROR_PAUSED','STOPPED'].includes(sim.status)?'PAUSED':sim.status;
      const modelErrors=Object.values(sim.barrier?.errors??{}).join('；');
      const s:ViewState={world,overlays:cover,selectedId,showSenses,speed,hosted,playbackTick:player?.tick??world.tick,maxTick:player?.manifest.endTick??world.tick,
        mode:player?'REPLAY':configured?'REAL_MODEL':'UNCONFIGURED',status:player?(player.buffering?'BUFFERING':player.playing?'PLAYING':'PAUSED'):liveStatus,
        error:diagnostic||sim.observerError||modelErrors||(sim.pauseTokens.has('USER_PAUSE')&&sim.status==='THINKING'?'用户已暂停；居民仍在思考，继续按钮只解除手动暂停。':'')};
      view.render(s);
    }catch(e){sim.pause('OBSERVER_ERROR');diagnostic=(e as Error).message;}
  }
  const L=(globalThis as any).Laya;L.timer.frameLoop(1,null,frame);
  const wx=(globalThis as any).wx;
  if(wx?.onHide){wx.onHide(()=>{sim.pause('APP_BACKGROUND');player?.pause();});wx.onShow(()=>sim.resume('APP_BACKGROUND'));}
  else document.addEventListener('visibilitychange',()=>{if(document.hidden){sim.pause('APP_BACKGROUND');player?.pause();}else sim.resume('APP_BACKGROUND');});
  await health();frame();
}
