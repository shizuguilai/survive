import type {BrainProvider,BrainRequest,BrainResponse,CharacterContext} from '../../contracts/src/types.ts';
import {hashCanonical} from '../../contracts/src/canonical.ts';
import {validateDecision,validateBrainRequest} from '../../contracts/src/validation.ts';
import type {World} from './domain.ts';
import {SimulationClock} from './clock.ts';
import {createWorld,cloneWorld,advanceEnvironment} from './world.ts';
import {applyDecision,stepActions,validateActionConcurrency} from './actions.ts';
import {samplePerception,buildContext} from './perception.ts';
import {postTask,type TaskDraft} from './camp.ts';
import {addModelMemories} from './knowledge.ts';

export type SimulationStatus='RUNNING'|'THINKING'|'COMMITTING'|'READY'|'ERROR_PAUSED'|'STOPPED';
export type AcceptedDecision={request:BrainRequest;response:BrainResponse};
export type CommitRecord={schemaVersion:'1.0.0';runId:string;barrierId:string;tick:number;beforeHash:string;afterHash:string;accepted:AcceptedDecision[];nextWorld:World};
export type BarrierView={id:string;tick:number;worldRevision:number;snapshotHash:string;dueAgentIds:string[];causeObservationIds:string[];status:SimulationStatus;errors:Record<string,string>;acceptedAgentIds:string[];requestAttempts:Record<string,number>};
type Slot={context:CharacterContext;generation:number;accepted?:AcceptedDecision;error?:string};
type Pending={view:BarrierView;snapshot:World;slots:Map<string,Slot>;epoch:number};
export type SimulationOptions={world?:World;seed?:number;runId?:string;allowMock?:boolean;controlMode?:'commander'|'independent'|'local';allowLocalFallback?:boolean;maxRetries?:number;requestTimeoutMs?:number;
  onSnapshot?:(world:World,reason:string)=>void;onCommit?:(record:CommitRecord)=>void|Promise<void>;
  onStatus?:(status:SimulationStatus,barrier:BarrierView|null)=>void};

/** A single, global cognition transaction coordinator. No rule-brain fallback exists. */
export class Simulation {
  world:World;
  status:SimulationStatus='READY';
  observerError:string|null=null;
  readonly clock=new SimulationClock();
  private readonly provider:BrainProvider & {decideBatch?:(requests:BrainRequest[],world:World,signal?:AbortSignal)=>Promise<BrainResponse[]>};
  private readonly options:SimulationOptions;
  private pending:Pending|null=null;
  private active=Promise.resolve();
  private epoch=0;
  private sequence=0;
  private bootstrapped=false;
  private plannerInbox:TaskDraft[]=[];
  get queuedTasks():TaskDraft[]{return structuredClone(this.plannerInbox);}
  get pendingTaskCount():number{return this.plannerInbox.length;}
  queueTask(draft:TaskDraft):void{
    if(this.status==='STOPPED')throw Error('本轮已停止，请重新开始后发布目标');
    if(!this.world.camp)throw Error('当前场景不支持营地任务');
    const probe=cloneWorld(this.world);for(const entry of this.plannerInbox)postTask(probe,entry);postTask(probe,draft);
    this.plannerInbox.push(structuredClone(draft));
  }
  private applyPlannerInbox():void{for(const draft of this.plannerInbox)postTask(this.world,draft);this.plannerInbox=[];}
  private controllers=new Set<AbortController>();
  constructor(provider:BrainProvider,options:SimulationOptions={}){
    this.provider=provider;this.options=options;this.world=options.world?cloneWorld(options.world):createWorld(options);
    this.clock.acquire('BOOTSTRAP');
  }
  get pauseTokens():ReadonlySet<string>{return this.clock.pauseTokens;}
  get barrier():BarrierView|null{return this.pending?structuredClone(this.pending.view):null;}
  get paused():boolean{return this.clock.paused;}
  pause(token='USER_PAUSE'):void{this.clock.acquire(token);this.notify();}
  resume(token='USER_PAUSE'):void{
    // Observer controls can never release cognition, startup, error, or stopped locks.
    if(/^(COGNITION:|ERROR:|BOOTSTRAP$|STOPPED$)/.test(token))return;
    this.clock.release(token);if(token==='OBSERVER_ERROR')this.observerError=null;if(!this.clock.paused&&this.status!=='STOPPED')this.status='RUNNING';this.notify();
  }
  frame(wallMs:number):number{return this.clock.frame(wallMs,()=>this.step());}
  step():boolean{
    if(this.clock.paused||this.status==='STOPPED')return false;
    const newTasks=this.plannerInbox.length>0;this.applyPlannerInbox();
    const nextTick=this.world.tick+1;
    const due=new Set(stepActions(this.world,nextTick));
    this.world.tick=nextTick;advanceEnvironment(this.world);
    for(const id of samplePerception(this.world))due.add(id);
    for(const resident of this.world.residents)if(resident.nextReviewTick<=nextTick)due.add(resident.id);
    this.world.revision++;
    this.emit('tick');
    const alive=[...due].filter(id=>(this.world.residents.find(r=>r.id===id)?.health??100)>0);
    if(this.options.controlMode&&this.options.controlMode!=='independent'){
      const workers=this.world.residents.filter(r=>(r.health??100)>0);
      if(newTasks||workers.some(r=>r.actionFeedback.length>0||!r.plan.some(p=>!p.done)&&r.nextReviewTick<=nextTick))this.begin(workers.map(r=>r.id));
    }else if(alive.length)this.begin(alive);
    return true;
  }
  bootstrap():Promise<void>{
    if(this.bootstrapped||this.status==='STOPPED')return this.active;
    this.bootstrapped=true;this.applyPlannerInbox();samplePerception(this.world);this.emit('initial');
    this.begin(this.world.residents.map(r=>r.id));
    this.clock.release('BOOTSTRAP');
    return this.active;
  }
  retry():Promise<void>{
    if(!this.pending||this.status!=='ERROR_PAUSED')return this.active;
    this.clock.release(`ERROR:${this.pending.view.id}`);
    for(const slot of this.pending.slots.values())if(!slot.accepted)slot.error=undefined;
    this.pending.view.errors={};this.setStatus('THINKING');
    this.active=this.resolve(this.pending);return this.active;
  }
  stop():void{
    this.epoch++;for(const controller of this.controllers)controller.abort();this.controllers.clear();
    this.clock.acquire('STOPPED');this.setStatus('STOPPED');
  }
  settled():Promise<void>{return this.active;}
  private begin(ids:string[]):void{
    if(this.pending&&['THINKING','COMMITTING','ERROR_PAUSED'].includes(this.status))throw new Error('A cognition transaction is already pending');
    const dueAgentIds=[...new Set(ids)].sort();
    const id=`cognition-${++this.sequence}`;
    // Synchronous lock acquisition happens before any promise/provider call.
    this.clock.acquire(`COGNITION:${id}`);this.status='THINKING';
    const snapshot=cloneWorld(this.world),snapshotHash=hashCanonical(snapshot);
    const slots=new Map<string,Slot>();
    for(const agentId of dueAgentIds){const resident=snapshot.residents.find(r=>r.id===agentId);if(!resident)throw new Error('Unknown due resident');slots.set(agentId,{context:buildContext(snapshot,resident),generation:0});}
    this.pending={view:{id,tick:snapshot.tick,worldRevision:snapshot.revision,snapshotHash,dueAgentIds,causeObservationIds:[...slots.values()].flatMap(s=>s.context.observations.map(o=>o.obsRef)),status:'THINKING',errors:{},acceptedAgentIds:[],requestAttempts:{}},snapshot,slots,epoch:this.epoch};
    this.notify();this.active=this.resolve(this.pending);
  }
  private current(pending:Pending):boolean{return this.pending===pending&&pending.epoch===this.epoch&&this.status!=='STOPPED';}
  private async resolve(pending:Pending):Promise<void>{
    try{
      if(this.options.controlMode&&this.options.controlMode!=='independent'&&this.provider.decideBatch)await this.resolveBatch(pending);
      else await Promise.all([...pending.slots].filter(([,slot])=>!slot.accepted).map(([agentId,slot])=>this.resolveSlot(pending,agentId,slot)));
      if(!this.current(pending))return;
      const failed=[...pending.slots].filter(([,slot])=>!slot.accepted);
      if(failed.length){for(const [id,slot]of failed)pending.view.errors[id]=slot.error??'Model request failed';this.fail(pending);return;}
      if(hashCanonical(this.world)!==pending.view.snapshotHash)throw new Error('Frozen world changed before commit');
      this.setStatus('COMMITTING');
      const nextWorld=cloneWorld(pending.snapshot);
      const accepted=[...pending.slots].sort(([a],[b])=>a.localeCompare(b)).map(([,slot])=>slot.accepted!);
      for(const entry of accepted){
        const resident=nextWorld.residents.find(r=>r.id===entry.request.metadata.agentId)!;
        const decision=validateDecision(entry.response.decision,entry.request.context);
        applyDecision(resident,decision,nextWorld.tick);addModelMemories(resident,decision.memorySuggestions,nextWorld.tick);
        resident.consumedObservationRefs=[...new Set([...resident.consumedObservationRefs,...entry.request.context.observations.map(o=>o.obsRef)])];
        if(!(decision.decisionKind==='continue'&&['MODEL_DIRECTED','LOCAL_ALGORITHM'].includes(entry.response.source)))nextWorld.events.push({tick:nextWorld.tick,kind:'decision',agentId:resident.id,source:entry.response.source,text:`目标：${decision.goal}。理由：${decision.reasonBrief}。计划动作：${decision.actions.map(a=>a.op).join(' → ')}。`});
        resident.actionFeedback=[];
      }
      nextWorld.revision++;
      const record:CommitRecord={schemaVersion:'1.0.0',runId:nextWorld.runId,barrierId:pending.view.id,tick:nextWorld.tick,beforeHash:pending.view.snapshotHash,afterHash:hashCanonical(nextWorld),accepted:structuredClone(accepted),nextWorld:cloneWorld(nextWorld)};
      // Persistence/recorder barrier completes before a single intent becomes authoritative.
      await this.options.onCommit?.(record);
      if(!this.current(pending))return;
      if(hashCanonical(this.world)!==pending.view.snapshotHash)throw new Error('Frozen world changed during commit');
      this.world=nextWorld;this.emit('commit');
      this.clock.release(`COGNITION:${pending.view.id}`);this.clock.release(`ERROR:${pending.view.id}`);
      this.setStatus(this.clock.paused?'READY':'RUNNING');
    }catch(error){if(this.current(pending)){pending.view.errors.transaction=message(error);this.fail(pending);}}
  }
  private async resolveBatch(pending:Pending):Promise<void>{
    const requests=[...pending.slots].map(([agentId,slot])=>{const generation=++slot.generation;pending.view.requestAttempts[agentId]=generation;return {metadata:{runId:pending.snapshot.runId,barrierId:pending.view.id,agentId,requestId:`group-${hashCanonical({run:pending.snapshot.runId,b:pending.view.id,agentId,generation}).split(':').pop()}`,generation,tick:pending.snapshot.tick,snapshotHash:pending.view.snapshotHash,contextHash:hashCanonical(slot.context),schemaVersion:'1.0.0' as const},context:structuredClone(slot.context)};});
    const controller=new AbortController();this.controllers.add(controller);this.notify();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      requests.forEach(validateBrainRequest);
      const abort=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('批次已取消')),{once:true}));
      timer=setTimeout(()=>controller.abort(),this.options.requestTimeoutMs??30000);
      const responses=await Promise.race([this.provider.decideBatch!(requests,cloneWorld(pending.snapshot),controller.signal),abort]);
      if(!this.current(pending))return;
      if(responses.length!==requests.length)throw Error('Incomplete grouped decision batch');
      const validated=requests.map(request=>{const response=responses.find(r=>r.metadata.agentId===request.metadata.agentId);
        if(!response||hashCanonical(response.metadata)!==hashCanonical(request.metadata))throw Error('Stale grouped response');
        const allowed=response.source==='MODEL_DIRECTED'&&this.options.controlMode==='commander'||response.source==='LOCAL_ALGORITHM'&&(this.options.controlMode==='local'||this.options.allowLocalFallback);
        if(!allowed)throw Error('Grouped decision source is not enabled');
        validateDecision(response.decision,request.context);validateActionConcurrency(response.decision.actions);return {request,response};});
      for(const entry of validated){pending.slots.get(entry.request.metadata.agentId)!.accepted=structuredClone(entry);}
      pending.view.acceptedAgentIds=requests.map(r=>r.metadata.agentId);this.notify();
    }catch(e){if(this.current(pending))for(const slot of pending.slots.values()){slot.accepted=undefined;slot.error=message(e);}}
    finally{if(timer)clearTimeout(timer);controller.abort();this.controllers.delete(controller);}
  }
  private async resolveSlot(pending:Pending,agentId:string,slot:Slot):Promise<void>{
    const attempts=1+Math.max(0,Math.min(2,this.options.maxRetries??2));
    for(let attempt=0;attempt<attempts&&this.current(pending);attempt++){
      const generation=++slot.generation;
      pending.view.requestAttempts[agentId]=generation;this.notify();
      const request:BrainRequest={metadata:{runId:pending.snapshot.runId,barrierId:pending.view.id,agentId,requestId:`request-${hashCanonical({runId:pending.snapshot.runId,barrierId:pending.view.id,agentId,generation}).split(':').pop()}`,generation,tick:pending.snapshot.tick,snapshotHash:pending.view.snapshotHash,contextHash:hashCanonical(slot.context),schemaVersion:'1.0.0'},context:structuredClone(slot.context)};
      const controller=new AbortController();this.controllers.add(controller);
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        validateBrainRequest(request);
        const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Model request cancelled')),{once:true}));
        const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new Error('Model request timed out'));controller.abort();},this.options.requestTimeoutMs??120000);});
        const response=await Promise.race([this.provider.decide(structuredClone(request),controller.signal),timeout,aborted]);
        if(!this.current(pending)||generation!==slot.generation)return;
        if(hashCanonical(response.metadata)!==hashCanonical(request.metadata))throw new Error('Stale or mismatched response metadata');
        if(response.source!=='REAL_MODEL'&&!(response.source==='MOCK_TEST'&&this.options.allowMock))throw new Error('Real-model mode cannot accept a mock or unknown decision source');
        if(!response.model||typeof response.model!=='string')throw new Error('Model identity is missing');
        const decision=validateDecision(response.decision,slot.context);validateActionConcurrency(decision.actions);
        slot.accepted={request,response:{...structuredClone(response),decision:structuredClone(decision)}};slot.error=undefined;
        pending.view.acceptedAgentIds=[...pending.slots].filter(([,s])=>!!s.accepted).map(([id])=>id).sort();this.notify();return;
      }catch(error){if(!this.current(pending))return;slot.error=message(error);}
      finally{if(timer!==undefined)clearTimeout(timer);controller.abort();this.controllers.delete(controller);}
    }
  }
  private fail(pending:Pending):void{this.clock.acquire(`ERROR:${pending.view.id}`);this.setStatus('ERROR_PAUSED');}
  private emit(reason:string):void{
    try{this.options.onSnapshot?.(cloneWorld(this.world),reason);}
    catch(error){this.observerError=message(error);this.clock.acquire('OBSERVER_ERROR');if(this.status==='RUNNING')this.status='READY';}
  }
  private setStatus(status:SimulationStatus):void{this.status=status;if(this.pending)this.pending.view.status=status;this.notify();}
  private notify():void{
    try{this.options.onStatus?.(this.status,this.barrier);}
    catch(error){this.observerError=message(error);this.clock.acquire('OBSERVER_ERROR');if(this.status==='RUNNING')this.status='READY';}
  }
}
function message(error:unknown):string{return error instanceof Error?error.message:'Unknown cognition failure';}
