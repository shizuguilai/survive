/** Opt-in REAL upstream verification. Missing credentials produce BLOCKED, never PASS. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadConfig,RealModelGateway,type AuditRecord} from '../services/brain-gateway/src/gateway.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {ReplayPlayer,ReplayRecorder} from '../packages/sim-core/src/replay.ts';
import {getOverlay} from '../packages/sim-core/src/perception.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import type {BrainRequest,BrainProvider} from '../packages/contracts/src/types.ts';

const evidence=resolve('evidence');await mkdir(evidence,{recursive:true});
const config=loadConfig();
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),mode:'REAL_MODEL',model:config.model,providerVersion:'unknown',status:'RUNNING',mockUsed:false,browser:'NOT_RUN',device:'NOT_RUN',published:'NOT_PUBLISHED'};
const save=()=>writeFile(resolve(evidence,'real-model-verification.json'),JSON.stringify(report,null,2)+'\n');
if(!config.apiKey.trim()){
  Object.assign(report,{status:'BLOCKED',code:'MODEL_NOT_CONFIGURED',reason:'本项目未配置 SURVIVE_MODEL_API_KEY；真实模型相遇、问候和回放验收未执行。',realRequests:0});
  await save();console.error('BLOCKED: 本项目未配置真实模型密钥。未使用 Mock、规则问候或伪造真实结果。');process.exitCode=2;
}else{
  const audits:AuditRecord[]=[];const requests:BrainRequest[]=[];const gateway=new RealModelGateway(config,{audit:r=>audits.push(r)});
  const recorder=new ReplayRecorder();const maxRequests=24;
  const provider:BrainProvider={async decide(request,signal){
    if(requests.length>=maxRequests)throw new Error('真实验收达到 24 次独立请求预算；未获得闭环时不算通过。');
    requests.push(structuredClone(request));return gateway.decide(request,signal);
  }};
  const sim=new Simulation(provider,{runId:`real-verification-${Date.now()}`,maxRetries:0,requestTimeoutMs:125_000,
    onSnapshot:world=>recorder.capture(world,Object.fromEntries(world.residents.map(r=>[r.id,getOverlay(world,r)]))),
    onCommit:record=>recorder.commit({tick:record.tick,accepted:record.accepted})});
  let freezeChecks=0,freezeViolation=false;let frozenHash:string|null=null;let previousBarrier:string|null=null;let observerWall=0;
  const timer=setInterval(()=>{
    if(sim.status==='THINKING'||sim.status==='COMMITTING'){
      const barrier=sim.barrier?.id??null;const hash=hashCanonical(sim.world);
      if(previousBarrier===barrier&&frozenHash!==null&&frozenHash!==hash)freezeViolation=true;
      frozenHash=hash;previousBarrier=barrier;observerWall+=60_000;
      sim.frame(observerWall);if(hashCanonical(sim.world)!==hash)freezeViolation=true;freezeChecks++;
    }else{frozenHash=null;previousBarrier=null;}
  },20);
  let completed=false;
  try{
    await sim.bootstrap();
    const both=(predicate:(id:string)=>boolean)=>sim.world.residents.every(r=>predicate(r.id));
    const spoke=(id:string)=>recorder.commits.some(c=>c.accepted.some(a=>a.request.metadata.agentId===id&&a.response.decision.actions.some(action=>action.op==='speak')));
    const heardAndDecided=(id:string)=>recorder.commits.some(c=>c.accepted.some(a=>a.request.metadata.agentId===id&&a.request.context.observations.some(o=>o.modality==='auditory'&&typeof o.detail.heardText==='string'&&o.detail.heardText.length>0)));
    // Up to 30 seconds of simulation, model waits consume zero simulation time.
    for(let tick=0;tick<600;tick++){
      if(sim.status==='ERROR_PAUSED')throw new Error('真实模型事务错误暂停；查看 observerErrors。');
      if(both(spoke)&&both(heardAndDecided)){completed=true;break;}
      if(!sim.step())throw new Error('世界未能从完整决策批次恢复');
      await sim.settled();
    }
    if(!completed)throw new Error('预算内未观察到两名居民均自主发言且听到对方后独立决策；不代写问候。');
    if(freezeViolation)throw new Error('真实请求等待期间世界快照发生变化');
    const replay=recorder.export(true);const player=new ReplayPlayer(replay);const first=player.current();player.seek(replay.manifest.endTick);const last=player.current();player.seek(first.tick);
    if(hashCanonical(player.current())!==hashCanonical(first)||last.tick!==sim.world.tick)throw new Error('回放 seek 快照不一致');
    if(replay.manifest.decisionMode!=='real'||replay.manifest.decisionCounts.mock!==0)throw new Error('真实验收含非真实决策');
    // Resume frame establishes a fresh wall anchor, never consumes request wait time.
    sim.pause('VERIFY_NO_CATCHUP');const before=sim.world.tick;sim.frame(observerWall+100_000);sim.resume('VERIFY_NO_CATCHUP');sim.frame(observerWall+200_000);
    if(sim.world.tick!==before)throw new Error('恢复时补跑了网络等待时间');
    await writeFile(resolve(evidence,'real-meeting-replay.json'),JSON.stringify(replay,null,2)+'\n');
    Object.assign(report,{status:'PASS',realRequests:requests.length,independentResidents:new Set(requests.map(r=>r.metadata.agentId)).size,freezeChecks,freezeViolation:false,noCatchup:true,simTick:sim.world.tick,decisionCounts:replay.manifest.decisionCounts,bothSpoke:both(spoke),bothHeardAndDecided:both(heardAndDecided),replay:'real-meeting-replay.json'});
    console.log('PASS: 两名居民真实独立模型、发言/听觉反馈、冻结/无补跑及确定快照回放通过。浏览器与真机仍独立验收。');
  }catch(error){
    Object.assign(report,{status:'FAILED',message:error instanceof Error?error.message:'真实验收失败',realRequests:requests.length,freezeChecks,freezeViolation,observerErrors:sim.barrier?.errors??{}});process.exitCode=1;console.error(String(report.message));
  }finally{
    clearInterval(timer);sim.stop();report.audit=audits;await save();
  }
}
