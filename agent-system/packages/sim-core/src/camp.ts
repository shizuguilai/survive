import type {Resident,World,WorldObject,ResourceKind,CampTask,ResidentialBounds} from './domain.ts';
import {BUILD_SITES,HOUSE_STEPS,houseSteps,houseCost,RECIPES,materialText,taskTitle} from './recipes.ts';
import {homeSites,validateZone,ownHomeProject} from './housing.ts';
import {experiencedWhen,rememberObservation} from './knowledge.ts';
import {preferredHome,designedHomeSize} from './home-design.ts';
export const RESOURCE_LABELS:Record<ResourceKind,string>={wood:'木材',stone:'石料',food:'浆果'};
export type TaskDraft={kind?:'gather'|'craft'|'house'|'residential';bounds?:ResidentialBounds;resource:ResourceKind;amount:number;note:string;recipeId?:string;siteId?:string};
export function postTask(world:World,draft:TaskDraft):void{
  if(!world.camp)throw Error('当前场景没有营地公告板');
  if(draft.kind==='residential'){
    const error=validateZone(draft.bounds!);if(error)throw Error(error);
    const bounds={...draft.bounds!};world.camp.zones??=[];
    if(world.camp.zones.length>=8)throw Error('最多保留8个居住区');
    if(world.camp.zones.some(z=>bounds.minX<z.bounds.maxX&&bounds.maxX>z.bounds.minX&&bounds.minZ<z.bounds.maxZ&&bounds.maxZ>z.bounds.minZ))throw Error('这片区域与已有居住区重叠，请在空白处圈选');
    const id=`zone-${world.camp.zones.length+1}`,taskId=`task-${++world.camp.sequence}`;
    world.camp.zones.push({id,taskId,bounds});
    world.camp.tasks.push({id:taskId,kind:'residential',zoneId:id,resource:'wood',amount:world.residents.length,progress:0,note:'没有住房的居民可自愿申请自己的小屋，已有住处不重复申请。',acceptedBy:[],status:'open',postedTick:world.tick});
    updateBoard(world);world.events.push({tick:world.tick,kind:'planner_task',agentId:'planner',text:`划定居住区 ${bounds.maxX-bounds.minX}×${bounds.maxZ-bounds.minZ}格；居民阅读公告后按需安家。`});return;
  }
  if(!['wood','stone','food'].includes(draft.resource)||!Number.isInteger(draft.amount)||draft.amount<1||draft.amount>50)throw Error('采集目标必须为1—50份');
  if(world.camp.tasks.filter(t=>t.status==='open'&&!t.ownerId&&t.kind!=='residential').length>=6)throw Error('最多保留6项未完成目标');
  const kind=draft.kind??'gather';
  if(!['gather','craft','house'].includes(kind))throw Error('目标类型不支持');
  if(kind==='craft'&&!RECIPES.some(r=>r.id===draft.recipeId&&r.kind==='craft'))throw Error('制作目标配方不存在');
  const site=BUILD_SITES.find(s=>s.id===draft.siteId);
  if(kind==='house'&&(!site||world.objects.some(o=>o.id===`plot-${site.id}`)))throw Error('请选一块尚未占用的居住地块');
  const task:CampTask={kind,...(kind==='craft'?{recipeId:draft.recipeId}:{}),...(kind==='house'?{siteId:site!.id}:{}),id:`task-${++world.camp.sequence}`,resource:draft.resource,amount:kind==='house'?3:draft.amount,progress:0,note:draft.note.trim().slice(0,120),acceptedBy:[],status:'open',postedTick:world.tick};
  world.camp.tasks.push(task);
  if(kind==='house')world.objects.push({id:`plot-${site!.id}`,kind:'plot',projectId:task.id,buildStage:0,position:{x:site!.x,y:0,z:site!.z},width:4,height:.5,depth:3,appearance:'划定的小屋建设地块，需读公告了解方案',resources:0});
  updateBoard(world);
  world.events.push({tick:world.tick,kind:'planner_task',agentId:'planner',text:`发布${taskTitle(task)}：${task.note}`});
}
export function updateBoard(world:World):void{
  const board=world.objects.find(o=>o.kind==='board');if(!board||!world.camp)return;
  for(const zone of world.camp.tasks.filter(t=>t.kind==='residential'))zone.progress=world.objects.filter(o=>o.kind==='house'&&o.ownerId&&o.zoneId===zone.zoneId).length;
  board.appearance=`公告板实体兼公共仓储，第${++world.camp.noticeVersion}版。走近后read_notice读取任务和库存；此实体引用可用于noticeRef或storageRef。`;
}
export function ownReceipt(resident:Resident,world:World,text:string,ref?:string):void{
  const key=ref??`memory_action_${world.tick}_${resident.memories.length}`;
  const existing=resident.memories.find(m=>m.ref===key);
  if(existing){existing.text=text;existing.experiencedWhen=experiencedWhen(world.tick);return;}
  resident.memories.push({ref:key,kind:'direct',text,evidenceRefs:[],experiencedWhen:experiencedWhen(world.tick)});
}
export function readBoard(world:World,resident:Resident,board:WorldObject):void{
  for(const task of world.camp?.tasks??[]){
    let entry=Object.values(resident.known).find(k=>k.entityId===task.id);
    if(!entry){const ref=`known_${++resident.knowledgeSequence}`;entry={ref,entityId:task.id,description:'',lastPosition:{...board.position},lastSeenTick:world.tick,visible:false,recognizedName:null};resident.known[ref]=entry;}
    const description=`公告任务：${taskTitle(task)}；进度${task.progress}/${task.amount}；${task.status==='done'?'已完成':task.acceptedBy.includes(resident.id)?'你已自愿接受':'可自愿接受或拒绝'}。这是已读任务，直接accept_task，无需对任务引用read_notice。${task.note}`;
    entry.description=description;entry.lastSeenTick=world.tick;entry.lastPosition={...board.position};
    const obs={obsRef:`observation_${++resident.observationSequence}`,experiencedWhen:experiencedWhen(world.tick),certainty:'clear' as const,modality:'visual' as const,detail:{level:'described',relativeDirection:'front',distanceBand:'near',appearance:description.match(/.{1,120}/gu)??[],recognizedName:null,knownRef:entry.ref}};
    resident.observations.push(obs);rememberObservation(resident,obs);
    if(task.kind==='house')learnHouse(world,resident,task);
    if(task.kind==='residential')entry.description+='；这是一片长期居住区，不是单间房。无住房时可用accept_task自主申请自己的小屋；随后为自己的新建房任务备料、build。已拥有或正在建设自己的房屋时无需再申请。';
    if(task.kind==='craft')entry.description+=`；需自行在工作台读配方再制作，不会凭空获得工具。`;
  }
  const notice=grantKnown(resident,board.id,`公告板实体兼公共仓储；刚看到库存：${materialText(world.camp?.stock??{})||'空'}。可haul存入，withdraw领取；这是此次亲见快照。`,board.position,world.tick);
  ownReceipt(resident,world,`我亲眼读到公共仓储库存：${materialText(world.camp?.stock??{})||'空'}。这是此刻的快照，之后他人可能存取。公告板实体引用为${notice.ref}，重读公告用它作为noticeRef；已读任务引用直接accept_task，建房再使用build。`,'memory_stock_notice');
  ownReceipt(resident,world,'我走近并读完了公告板。接受任务需accept_task。采集任务要实际gather；制作任务需craft；建房需按已读步骤build并消耗仓储材料，备料不足时再采集搬运。');
}
export function creditGather(world:World,resident:Resident,resource:ResourceKind):void{
  const task=world.camp?.tasks.find(t=>(!t.kind||t.kind==='gather')&&t.status==='open'&&t.resource===resource&&t.acceptedBy.includes(resident.id));
  if(!task)return;
  task.progress++;
  if(task.progress>=task.amount){task.status='done';updateBoard(world);}
  ownReceipt(resident,world,`我的采集为已接受的${RESOURCE_LABELS[resource]}目标增加1份。${task.status==='done'?'该目标已达成。':''}`,`memory_task_progress_${task.id}`);
}

export function grantKnown(resident:Resident,entityId:string,description:string,position:WorldObject['position'],tick:number){
 let entry=Object.values(resident.known).find(k=>k.entityId===entityId);
 if(!entry){const ref=`known_${++resident.knowledgeSequence}`;entry={ref,entityId,description,lastPosition:{...position},lastSeenTick:tick,visible:false,recognizedName:null};resident.known[ref]=entry;}
 entry.description=description;entry.lastPosition={...position};entry.lastSeenTick=tick;return entry;
}

/** A resident requests a home by accepting a personally read residential notice. */
export function claimHome(world:World,resident:Resident,notice:CampTask):string|null{
  if(resident.homeId||ownHomeProject(world,resident))return '我已经有自己的住房或在建住处，无需重复申请。';
  const zone=world.camp?.zones?.find(z=>z.id===notice.zoneId);if(!zone)return '这片居住区已不存在。';
  const design=preferredHome(resident.id),size=designedHomeSize(1,design.id);
  const site=homeSites(world,zone.bounds,size).sort((a,b)=>Math.hypot(a.x-resident.position.x,a.z-resident.position.z)-Math.hypot(b.x-resident.position.x,b.z-resident.position.z))[0];
  if(!site)return '居住区暂无可用空地，需要扩大居住区或清理资源，原有房屋不会被覆盖。';
  const task:CampTask={id:`task-${++world.camp!.sequence}`,kind:'house',zoneId:zone.id,ownerId:resident.id,homeDesign:design.id,resource:'wood',amount:3,progress:0,note:`${resident.name}的${design.name} · ${size.width}×${size.depth}`,acceptedBy:[resident.id],status:'open',postedTick:world.tick};
  world.camp!.tasks.push(task);if(!notice.acceptedBy.includes(resident.id))notice.acceptedBy.push(resident.id);
  world.objects.push({id:`home-${resident.id}`,kind:'plot',projectId:task.id,zoneId:zone.id,ownerId:resident.id,homeDesign:design.id,homeLevel:1,buildStage:0,position:{...site,y:0},...size,height:.5,appearance:`${resident.name}申请的${design.name}地块`,resources:0});
  learnHouse(world,resident,task);updateBoard(world);
  ownReceipt(resident,world,'我自主申请了自己的住处，已确认地块和施工步骤。按需要采集并把木石搬入公共仓储，再按地基、墙体、屋顶施工。完成后可以进屋休息。');
  world.events.push({tick:world.tick,kind:'construction',agentId:resident.id,text:`${resident.name}在居住区申请了自己的小屋。`});return null;
}
export function learnHouse(world:World,resident:Resident,task:CampTask):void{
  const plot=world.objects.find(o=>o.projectId===task.id);if(!plot)return;
  if(task.status==='done'&&task.ownerId===resident.id)grantKnown(resident,plot.id,plot.appearance+'；自己的住处，可home_care改善生活。',plot.position,world.tick);
  const entry=grantKnown(resident,task.id,`${task.note||'木石小屋'}；进度${task.progress}/${task.amount}；${task.status==='done'?'已建成，可从南侧门口进入休息':`需${materialText(houseCost(task.homeLevel,task.homeDesign))}，${task.reserved?'扩建材料已预留':'施工自动扣公共仓储'}；按${houseSteps(task).map(s=>s.label).join('→')}使用build`}；projectRef使用本引用。`,plot.position,world.tick);
  houseSteps(task).forEach((step,index)=>grantKnown(resident,`${task.id}:${step.id}`,`施工步骤${index+1}：${step.label}；消耗公共仓储${materialText(step.cost)}；${index<task.progress?'已完成':index===task.progress?'可准备':'等待前序'}；build的stepRef使用本引用，projectRef使用${entry.ref}。`,plot.position,world.tick));
}
