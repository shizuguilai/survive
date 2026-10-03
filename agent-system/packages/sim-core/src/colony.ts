import type {BrainProvider,BrainRequest,BrainResponse,Decision,Action,CharacterContext} from '../../contracts/src/types.ts';
import {validateCommandPlan,type CommandProvider,type ControlSettings,type CommandRequest,type CommandPlan} from '../../contracts/src/command.ts';
import type {World,Resident,KnowledgeEntry,ResourceKind} from './domain.ts';
import {dayClock,FURNITURE,ownHouse,isInside,onBreak,residentThought} from './living.ts';
import {nextHomeCare} from './home-care.ts';
import {homeSites} from './housing.ts';
import {HOUSE_STEPS,houseSteps,houseCost,RECIPES,taskTitle} from './recipes.ts';
import {hashCanonical} from '../../contracts/src/canonical.ts';

type Order={objective:string;startProgress:number;startTick:number;done:boolean;failures:number;blocked:Set<string>};
const dist=(r:Resident,k:KnowledgeEntry)=>Math.hypot(r.position.x-k.lastPosition.x,r.position.z-k.lastPosition.z);
const action=(op:string,params:Record<string,any>={}):Action=>({op,params,stage:0});
const wait=()=>action('wait',{durationSimMs:5000,scope:'locomotion'});
/** Deterministic execution of phase orders. This is explicitly not an independent resident model. */
export class ColonyProvider implements BrainProvider{
 readonly settings:ControlSettings;private remote:CommandProvider;private orders=new Map<string,Order>();
 private lastTick=0;private phaseTick=-Infinity;private sequence=-1;private phase=0;private nextRemoteTick=0;
 remoteCalls=0;localBatches=0;fallbackActive=false;notice='';summary='等待安排阶段任务';
 constructor(settings:ControlSettings,remote:CommandProvider){this.settings={...settings};this.remote=remote;}
 async decide(_r:BrainRequest):Promise<BrainResponse>{throw Error('Colony provider requires one grouped batch');}
 useLocal(reason:string):void{if(!this.settings.fallback)throw Error('Local fallback is disabled');this.fallbackActive=true;this.notice='远程不可用，已转本地算法；'+reason;}
 retryRemote():void{this.fallbackActive=false;this.nextRemoteTick=0;this.orders.clear();this.notice='下个执行节点重新尝试统筹模型';}
 private report(world:World):CommandRequest{
  const tasks=(world.camp?.tasks??[]).filter(t=>t.status==='open');
  return {requestId:`command-${world.runId}-${this.phase+1}-${world.tick}`,runId:world.runId,tick:world.tick,phaseUnits:this.settings.phaseUnits,tasks:tasks.map(t=>({id:t.id,title:t.ownerId?(world.residents.find(r=>r.id===t.ownerId)?.name+'的住处 · '+taskTitle(t)):taskTitle(t),progress:t.progress,amount:t.amount})),stock:{wood:world.camp?.stock?.wood??0,stone:world.camp?.stock?.stone??0,food:world.camp?.stock?.food??0},reports:world.residents.filter(r=>(r.health??100)>0).map(r=>({residentId:r.id,name:r.name,body:`${dayClock(world.tick).label} 饱腹感${Math.round((1-r.hunger)*100)}% 精力${Math.round((1-r.fatigue)*100)}% 心情${Math.round((r.mood??.75)*100)}% 生命${r.health??100}；${residentThought(world,r)}`,working:r.goal||'暂无安排',recentResults:r.memories.filter(m=>m.ref.startsWith('memory_action_')||m.ref.startsWith('memory_task_')).slice(-4).map(m=>m.text.slice(0,500)),knownLandmarks:Object.values(r.known).filter(k=>k.descriptionSeenTick!==undefined).slice(-16).map(k=>k.description.slice(0,160)),options:[...tasks.filter(t=>t.kind!=='residential'||(!r.homeId&&!world.camp?.tasks.some(h=>h.ownerId===r.id)&&!!world.camp?.zones?.some(z=>z.id===t.zoneId&&homeSites(world,z.bounds).length))).map(t=>({id:t.id,label:taskTitle(t)})),{id:'stock-wood',label:'采集并入库木材'},{id:'stock-stone',label:'采集并入库石料'},{id:'stock-food',label:'采集并入库口粮'},...(nextHomeCare(world,r)?[{id:'home-care',label:'满足自己的家具、清洁或扩建需求'}]:[]),{id:'rest',label:'休息恢复'},{id:'explore',label:'观察附近、探索已知方向'}]}))};
 }
 private localPlan(r:CommandRequest):CommandPlan{
  const tasks=[...r.tasks].reverse();
  return {summary:'本地算法：优先新任务，按缺料补给、实际加工与施工执行',assignments:r.reports.map((p,i)=>({residentId:p.residentId,objective:p.knownLandmarks.some(k=>k.includes('已成熟')&&k.includes('收割'))&&r.stock.food<24?'stock-food':tasks.find(t=>t.title.includes(p.name+'的住处'))?.id??p.options.find(o=>o.id==='home-care')?.id??tasks.find(t=>p.options.some(o=>o.id===t.id))?.id??(['stock-wood','stock-stone','stock-food'][i%3])}))};
 }
 async decideBatch(requests:BrainRequest[],world:World,signal?:AbortSignal):Promise<BrainResponse[]>{
  signal?.throwIfAborted();this.lastTick=world.tick;
  for(const r of world.residents){const o=this.orders.get(r.id);if(!o)continue;const task=world.camp?.tasks.find(t=>t.id===o.objective);
   if(task&&(task.status==='done'||task.progress>=o.startProgress+(task.kind==='house'||task.kind==='craft'?1:this.settings.phaseUnits)))o.done=true;
   if(world.events.some(e=>e.agentId===r.id&&e.tick>o.startTick&&e.kind==='action_completed'&&(e.text==='haul'&&o.objective.startsWith('stock-')||e.text==='rest'&&o.objective==='rest')))o.done=true;
   if(world.tick-o.startTick>=2400||o.failures>=5)o.done=true;
  }
  const changed=(world.camp?.sequence??0)!==this.sequence;
  const finished=world.residents.filter(r=>(r.health??100)>0).every(r=>this.orders.get(r.id)?.done);
  const want=!this.orders.size||changed||finished;
  if(want&&(this.settings.mode==='local'||this.fallbackActive||world.tick>=this.nextRemoteTick)){
   const report=this.report(world);let plan:CommandPlan;
   if(this.settings.mode==='commander'&&!this.fallbackActive){
    try{this.remoteCalls++;const response=await this.remote.plan(report,signal);signal?.throwIfAborted();if(response.source!=='REAL_MODEL'||response.model!=='glm-4.5-air'||response.requestId!==report.requestId)throw Error('统筹响应来源或请求不匹配');plan=validateCommandPlan(response.plan,report);this.notice='';}
    catch(e){signal?.throwIfAborted();if(!this.settings.fallback)throw e;this.fallbackActive=true;this.notice='远程不可用，已转本地算法；点击设置可恢复远程。原因：'+(e as Error).message.slice(0,100);plan=this.localPlan(report);}
   }else plan=this.localPlan(report);
   signal?.throwIfAborted();this.phase++;this.phaseTick=world.tick;this.nextRemoteTick=world.tick+this.settings.reviewSeconds*20;this.sequence=world.camp?.sequence??0;this.summary=plan.summary;
   if(this.settings.mode==='local'||this.fallbackActive)for(const a of plan.assignments){
    const person=world.residents.find(r=>r.id===a.residentId)!;
    const own=world.camp?.tasks.find(t=>t.ownerId===person.id&&t.status==='open');
    if(own)a.objective=own.id;
    else if(nextHomeCare(world,person)&&a.objective!=='stock-food')a.objective='home-care';
    else if(person.homeId&&world.camp?.tasks.find(t=>t.id===a.objective)?.kind==='residential')a.objective='stock-wood';
   }
   this.orders=new Map(plan.assignments.map(a=>[a.residentId,{objective:a.objective,startProgress:world.camp?.tasks.find(t=>t.id===a.objective)?.progress??0,startTick:world.tick,done:false,failures:0,blocked:new Set<string>()}]));
  }
  this.localBatches++;
  return requests.map(request=>{
   const r=world.residents.find(r=>r.id===request.metadata.agentId)!,o=this.orders.get(r.id);
   let actions:Action[];
   if(r.plan.some(p=>!p.done)&&!r.actionFeedback.length)actions=[action('continue')];
   else if(!o)actions=[wait()];else actions=this.execute(world,r,o,request.context);
   actions.forEach((a,i)=>a.stage=i);
   const decision:Decision={schemaVersion:'1.0.0',decisionKind:actions[0]?.op==='continue'?'continue':'replace',goal:o?`阶段${this.phase} · ${o.objective.startsWith('task-')?taskTitle(world.camp!.tasks.find(t=>t.id===o.objective)!):o.objective==='home-care'?'改善自己的住处':o.objective==='rest'?'休息':o.objective==='explore'?'探索':`储备${o.objective.slice(6)==='wood'?'木材':o.objective.slice(6)==='stone'?'石料':'口粮'}`}`:'等待阶段安排',reasonBrief:this.settings.mode==='local'||this.fallbackActive?'本地算法执行；不是大模型决定':`执行统筹模型的阶段安排：${this.summary}`.slice(0,500),actions,nextReviewAfterSimMs:2000,watch:[],memorySuggestions:[]};
   return {metadata:request.metadata,decision,source:this.settings.mode==='local'||this.fallbackActive?'LOCAL_ALGORITHM':'MODEL_DIRECTED',model:this.settings.mode==='local'||this.fallbackActive?'local-task-planner-v1':'glm-4.5-air / phase-executor'};
  });
 }
 private execute(w:World,r:Resident,o:Order,context:CharacterContext):Action[]{
  const known=Object.values(r.known);const find=(id:string)=>known.find(k=>k.entityId===id);const near=(k:KnowledgeEntry)=>dist(r,k)<=1.8;
  const at=(k:KnowledgeEntry,a:Action)=>near(k)?[a]:[action('walk',{targetRef:k.ref,gait:'walk'}),a];
  const board=known.find(k=>k.entityId==='camp-board'),station=known.find(k=>k.entityId==='camp-workbench');
  const supply=(kind:ResourceKind)=>find(`supply-${kind}-${r.id}`);
  if(r.actionFeedback.length){o.failures++;const last=[...r.plan].reverse().find(p=>p.done)?.action;const ref=last?.params.targetRef;if(ref&&!r.actionFeedback.some(x=>x.includes('太远')))o.blocked.add(ref);}
  const gather=(kind:ResourceKind,amount:number):Action[]=>{
   const type=kind==='wood'?'tree':kind==='stone'?'rock':'berry';
   const refs=new Set(Object.values(r.spatialMemory?.landmarks??{}).filter(l=>(l.kind===type||kind==='food'&&l.kind==='crop')&&l.state!=='depleted').map(l=>l.knownRef));
   const target=known.filter(k=>refs.has(k.ref)&&!o.blocked.has(k.ref)&&!k.description.includes('采空')).sort((a,b)=>(kind==='food'?Number(b.description.includes('已成熟'))-Number(a.description.includes('已成熟')):0)||dist(r,a)-dist(r,b))[0];
   if(!target)return explore();return at(target,action('gather',{targetRef:target.ref,amount:Math.max(1,Math.min(amount,8,30-r.inventory))}));
  };
  const explore=():Action[]=>{
   const target=known.filter(k=>!o.blocked.has(k.ref)&&dist(r,k)>2&&dist(r,k)<24&&!k.entityId.startsWith('supply-')&&!k.entityId.startsWith('item_')&&!k.description.includes('墙')).sort((a,b)=>a.lastSeenTick-b.lastSeenTick||dist(r,a)-dist(r,b))[0];
   if(target)return [action('walk',{targetRef:target.ref,gait:'walk'})];
   // Survey is physical turning, not a hidden map scan or cognition call.
   return [action('survey',{durationSimMs:2000})];
  };
  const deposit=(kind:ResourceKind):Action[]=>{const k=supply(kind);if(!board)return explore();if(!k||!r.supplies?.[kind])return gather(kind,this.settings.phaseUnits);return at(board,action('haul',{sourceRef:k.ref,destinationRef:board.ref,amount:Math.min(r.supplies[kind]!,this.settings.phaseUnits)}));};
  if(onBreak(w,r))return [wait()];
  const homeObject=ownHouse(w,r),home=homeObject?find(homeObject.id):undefined;
  const atHome=(k:KnowledgeEntry,a:Action)=>dist(r,k)<=.81?[a]:[action('walk',{targetRef:k.ref,gait:'walk'}),a];
  if(r.hunger>.62){const food=supply('food');if(food&&r.supplies?.food)return [action('eat',{foodRef:food.ref,amount:Math.min(r.supplies.food,3)})];if(home&&homeObject?.furniture?.cabinet&&(homeObject.stored?.food??0)>0)return atHome(home,action('withdraw',{storageRef:home.ref,resource:'food',amount:Math.min(3,homeObject.stored!.food!)}));return gather('food',3);}
  if(r.fatigue>.75||(dayClock(w.tick).night&&r.fatigue>.30)||o.objective==='rest'){const place=home??known.find(near);return place?(home?atHome:at)(place,action('rest',{placeRef:place.ref,durationSimMs:30000})):[action('survey',{durationSimMs:2000})];}
  if(home&&homeObject?.furniture?.cabinet&&isInside(r,homeObject)&&(r.supplies?.food??0)>3&&Object.values(homeObject.stored??{}).reduce((n,v)=>n+(v??0),0)<24)return [action('haul',{sourceRef:supply('food')!.ref,destinationRef:home.ref,amount:Math.min(3,r.supplies!.food!-3)})];
  if(o.objective==='home-care'){
   const care=nextHomeCare(w,r);if(!care){o.done=true;return [wait()];}if(!home)return board?at(board,action('read_notice',{noticeRef:board.ref})):explore();
   const cost=care==='expand'?houseCost((homeObject!.homeLevel??1)+1,homeObject!.homeDesign):care==='clean'?{}:FURNITURE[care].cost;
   const missing=(['wood','stone'] as const).find(k=>(w.camp?.stock?.[k]??0)<(cost[k]??0));
   if(missing)return r.supplies?.[missing]?deposit(missing):gather(missing,Math.min(this.settings.phaseUnits,(cost[missing]??0)-(w.camp?.stock?.[missing]??0)));
   return atHome(home,action('home_care',{homeRef:home.ref,improvement:care}));
  }
  if(o.done)return [wait()];
  if(r.inventory>=26){const kind=(['wood','stone','food'] as const).find(k=>r.supplies?.[k]);if(kind)return deposit(kind);}
  if(o.objective.startsWith('stock-')){const kind=o.objective.slice(6) as ResourceKind;return (r.supplies?.[kind]??0)>=(kind==='food'?Math.min(2,this.settings.phaseUnits):this.settings.phaseUnits)?deposit(kind):gather(kind,this.settings.phaseUnits-(r.supplies?.[kind]??0));}
  const task=w.camp?.tasks.find(t=>t.id===o.objective);
  if(!task)return explore();
  if(task.kind==='residential'&&(r.homeId||w.camp?.tasks.some(t=>t.ownerId===r.id))){o.done=true;return [wait()];}
  const tk=find(task.id);
  if(!tk){if(!board)return explore();return at(board,action('read_notice',{noticeRef:board.ref}));}
  if(!task.acceptedBy.includes(r.id)){const evidence=context.observations.filter(x=>x.detail.knownRef===tk.ref).slice(-1).map(x=>x.obsRef);if(!evidence.length)return board?at(board,action('read_notice',{noticeRef:board.ref})):explore();return [action('accept_task',{taskRef:tk.ref,evidenceRefs:evidence})];}
  if(task.kind==='house'){
   const step=houseSteps(task)[task.progress];if(!step){o.done=true;return [wait()];}
   const missing=(['wood','stone'] as const).filter(k=>((task.reserved??w.camp?.stock)?.[k]??0)<(step.cost[k]??0));
   if(missing.length){const kind=missing[w.residents.indexOf(r)%missing.length];return r.supplies?.[kind]?deposit(kind):gather(kind,Math.min(this.settings.phaseUnits,(step.cost[kind]??0)-(w.camp?.stock?.[kind]??0)));}
   const sk=find(`${task.id}:${step.id}`);if(!sk){if(!board)return explore();return at(board,action('read_notice',{noticeRef:board.ref}));}
   return at(tk,action('build',{projectRef:tk.ref,stepRef:sk.ref}));
  }
  if(task.kind==='craft'){
   const recipe=RECIPES.find(x=>x.id===task.recipeId)!;const rk=find('recipe:'+recipe.id);
   if(!station)return explore();if(!rk)return at(station,action('read_notice',{noticeRef:station.ref}));
   const missing=(['wood','stone'] as const).find(k=>(r.supplies?.[k]??0)<(recipe.cost[k]??0));
   if(missing)return gather(missing,(recipe.cost[missing]??0)-(r.supplies?.[missing]??0));
   return at(station,action('craft',{stationRef:station.ref,recipeRef:rk.ref}));
  }
  return gather(task.resource,Math.min(this.settings.phaseUnits,task.amount-task.progress));
 }
 get detail():string{const waiting=this.orders.size&&[...this.orders.values()].every(o=>o.done)&&this.lastTick<this.nextRemoteTick&&this.settings.mode==='commander'&&!this.fallbackActive?` · 阶段完成，${Math.ceil((this.nextRemoteTick-this.lastTick)/20)}秒后复查`:'';return `阶段${this.phase} · ${this.fallbackActive?'已降级本地算法':this.settings.mode==='local'?'本地算法':'模型统筹'} · 远程调用${this.remoteCalls}次${waiting} · ${this.summary}`;}
}
