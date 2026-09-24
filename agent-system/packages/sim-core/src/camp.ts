import type {Resident,World,WorldObject,ResourceKind,CampTask} from './domain.ts';
import {BUILD_SITES,HOUSE_STEPS,RECIPES,materialText,taskTitle} from './recipes.ts';
import {experiencedWhen,rememberObservation} from './knowledge.ts';
export const RESOURCE_LABELS:Record<ResourceKind,string>={wood:'木材',stone:'石料',food:'浆果'};
export type TaskDraft={kind?:'gather'|'craft'|'house';resource:ResourceKind;amount:number;note:string;recipeId?:string;siteId?:string};
export function postTask(world:World,draft:TaskDraft):void{
  if(!world.camp)throw Error('当前场景没有营地公告板');
  if(!['wood','stone','food'].includes(draft.resource)||!Number.isInteger(draft.amount)||draft.amount<1||draft.amount>50)throw Error('采集目标必须为1—50份');
  if(world.camp.tasks.filter(t=>t.status==='open').length>=6)throw Error('最多保留6项未完成目标');
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
    if(task.kind==='house'){const plot=world.objects.find(o=>o.projectId===task.id)!;entry.lastPosition={...plot.position};entry.description+=`；在${BUILD_SITES.find(s=>s.id===task.siteId)?.label}，共需12木材8石料。简化建造规则：到地块施工时自动扣公共仓储材料，不消耗随身材料，无需withdraw取出。按地基→墙体→屋顶施工，build的projectRef使用本任务引用。`;
      HOUSE_STEPS.forEach((step,index)=>grantKnown(resident,`${task.id}:${step.id}`,`本小屋施工步骤${index+1}：${step.label}；自动扣公共仓储${materialText(step.cost)}，无需领取或搬到地块；${index<task.progress?'已完成':index===task.progress?'可准备':'等待前一步完成'}；build的stepRef使用本引用，projectRef使用${entry!.ref}；这是施工步骤而非公告板`,plot.position,world.tick));
    }
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
