import type {Resident,World,WorldObject,ResourceKind,CampTask} from './domain.ts';
import {experiencedWhen,rememberObservation} from './knowledge.ts';
export const RESOURCE_LABELS:Record<ResourceKind,string>={wood:'木材',stone:'石料',food:'浆果'};
export type TaskDraft={resource:ResourceKind;amount:number;note:string};
export function postTask(world:World,draft:TaskDraft):void{
  if(!world.camp)throw Error('当前场景没有营地公告板');
  if(!['wood','stone','food'].includes(draft.resource)||!Number.isInteger(draft.amount)||draft.amount<1||draft.amount>50)throw Error('采集目标必须为1—50份');
  if(world.camp.tasks.filter(t=>t.status==='open').length>=6)throw Error('最多保留6项未完成目标');
  const task:CampTask={id:`task-${++world.camp.sequence}`,resource:draft.resource,amount:draft.amount,progress:0,note:draft.note.trim().slice(0,120),acceptedBy:[],status:'open',postedTick:world.tick};
  world.camp.tasks.push(task);updateBoard(world);
  world.events.push({tick:world.tick,kind:'planner_task',agentId:'planner',text:`发布采集${RESOURCE_LABELS[draft.resource]}${draft.amount}份：${task.note}`});
}
export function updateBoard(world:World):void{
  const board=world.objects.find(o=>o.kind==='board');if(!board||!world.camp)return;
  board.appearance=`营地公告板兼公共仓储，第${++world.camp.noticeVersion}版。可走近后用read_notice阅读发展目标；不会自动分配工作。`;
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
    const description=`公告任务：采集${RESOURCE_LABELS[task.resource]}${task.amount}份；已完成${task.progress}份；${task.status==='done'?'已完成':task.acceptedBy.includes(resident.id)?'你已自愿接受':'可自愿接受或拒绝'}。${task.note}`;
    entry.description=description;entry.lastSeenTick=world.tick;entry.lastPosition={...board.position};
    const obs={obsRef:`observation_${++resident.observationSequence}`,experiencedWhen:experiencedWhen(world.tick),certainty:'clear' as const,modality:'visual' as const,detail:{level:'described',relativeDirection:'front',distanceBand:'near',appearance:description.match(/.{1,120}/gu)??[],recognizedName:null,knownRef:entry.ref}};
    resident.observations.push(obs);rememberObservation(resident,obs);
  }
  ownReceipt(resident,world,'我走近并读完了公告板。接受任务需accept_task，之后自行寻找亲眼见过的资源并walk、gather；未承诺的采集不计入任务。');
}
export function creditGather(world:World,resident:Resident,resource:ResourceKind):void{
  const task=world.camp?.tasks.find(t=>t.status==='open'&&t.resource===resource&&t.acceptedBy.includes(resident.id));
  if(!task)return;
  task.progress++;
  if(task.progress>=task.amount){task.status='done';updateBoard(world);}
  ownReceipt(resident,world,`我的采集为已接受的${RESOURCE_LABELS[resource]}目标增加1份。${task.status==='done'?'该目标已达成。':''}`,`memory_task_progress_${task.id}`);
}
