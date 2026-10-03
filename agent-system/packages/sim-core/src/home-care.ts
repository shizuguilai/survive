import type {World,Resident,FurnitureKind,WorldObject,ResourceKind} from './domain.ts';
import {FURNITURE,homeSize,ownHouse,isInside,desiredHomeLevel} from './living.ts';
import {homeFits,homeSites,ownHomeProject} from './housing.ts';
import {grantKnown,ownReceipt,learnHouse,updateBoard} from './camp.ts';
import {houseCost,materialText} from './recipes.ts';
import {homeDesign} from './home-design.ts';
export function renovationSite(w:World,r:Resident,h:WorldObject,level:number){
 const knownZones=new Set(Object.values(r.known).map(k=>k.entityId));
 const zones=(w.camp?.zones??[]).filter(z=>(z.kind??'residential')==='residential'&&(z.id===h.zoneId||knownZones.has(z.taskId)));
 const size=homeSize(level,h.homeDesign),current=zones.find(z=>homeFits(w,z.bounds,h.position,size,h.id));
 if(current)return {zone:current,position:{...h.position}};
 for(const zone of zones){const p=homeSites(w,zone.bounds,size,h.id)[0];if(p)return {zone,position:{...p,y:0}};}
 return null;
}
export function nextHomeCare(w:World,r:Resident):FurnitureKind|'clean'|'expand'|null{
 const h=ownHouse(w,r);if(!h||ownHomeProject(w,r))return null;
 if(!h.furniture?.bed)return 'bed';if(!h.furniture?.lamp)return 'lamp';
 if(!h.furniture?.cabinet)return 'cabinet';if(!h.furniture?.mop)return 'mop';
 if((h.cleanliness??1)<.45)return 'clean';
 if(desiredHomeLevel(w,h)>(h.homeLevel??1)&&renovationSite(w,r,h,(h.homeLevel??1)+1))return 'expand';
 return null;
}
export function finishHomeCare(w:World,r:Resident,homeRef:string,improvement:string):string|null{
 const h=ownHouse(w,r);if(!h||r.known[homeRef]?.entityId!==h.id)return '只能改善自己已完工、亲自知道的住房。';
 if(!isInside(r,h))return '需要先从门口进入自己的住房。';
 if(ownHomeProject(w,r))return '自己的房屋正在施工，先完成当前工程。';
 if(improvement==='expand'){
  const level=(h.homeLevel??1)+1;if(level>3||desiredHomeLevel(w,h)<level)return '目前对住房大小满意，暂不需要扩建。';
  const site=renovationSite(w,r,h,level);if(!site)return '已知居住区没有足够的扩建空地，请扩大用地并亲自阅读新公告；旧房保留。';
  const cost=houseCost(level,h.homeDesign);for(const k of ['wood','stone'] as const)if((w.camp?.stock?.[k]??0)<cost[k])return `先备齐${materialText(cost)}才会拆旧房。`;
  for(const k of ['wood','stone'] as const)w.camp!.stock![k]!-=cost[k];
  const task={id:`task-${++w.camp!.sequence}`,kind:'house' as const,ownerId:r.id,zoneId:site.zone.id,...(h.homeDesign?{homeDesign:h.homeDesign}:{}),homeLevel:level,renovation:true,reserved:{...cost},targetPosition:site.position,resource:'wood' as const,amount:4,progress:0,note:`${r.name}自主改建为${homeSize(level,h.homeDesign).width}×${homeSize(level,h.homeDesign).depth}${homeDesign(h.homeDesign,r.id).name}`,acceptedBy:[r.id],status:'open' as const,postedTick:w.tick};
  w.camp!.tasks.push(task);h.projectId=task.id;learnHouse(w,r,task);updateBoard(w);
  ownReceipt(r,w,`我为扩建备齐并预留了${materialText(cost)}，先拆旧回收，再建地基、墙体和屋顶。原有家具和柜内物资会保留。`);
  w.events.push({tick:w.tick,kind:'construction',agentId:r.id,text:task.note+'；材料已预留，开始拆旧重建。'});return null;
 }
 if(improvement==='clean'){
  if(!h.furniture?.mop)return '家里没有拖把，先制作一把。';h.cleanliness=1;
 }else{
  const item=FURNITURE[improvement as FurnitureKind];if(!item)return '未知的住宅改善项目。';
  if(h.furniture?.[improvement as FurnitureKind])return '家里已经有这件家具。';
  for(const [k,n]of Object.entries(item.cost))if((w.camp?.stock?.[k as ResourceKind]??0)<n!)return `家具材料不足：需要${materialText(item.cost)}，先采集并存入仓储。`;
  for(const [k,n]of Object.entries(item.cost))w.camp!.stock![k as ResourceKind]!-=n!;
  h.furniture??={};h.furniture[improvement as FurnitureKind]=true;
 }
 const text=improvement==='clean'?'打扫了房间':`添置了${FURNITURE[improvement as FurnitureKind].label}`;
 grantKnown(r,h.id,`自己的${h.width}×${h.depth}住宅；可在屋内rest、home_care，柜子可haul/withdraw存取自有物资。家具：${Object.keys(FURNITURE).filter(k=>h.furniture?.[k as FurnitureKind]).map(k=>FURNITURE[k as FurnitureKind].label).join('、')}`,h.position,w.tick);
 ownReceipt(r,w,`我${text}。`);w.events.push({tick:w.tick,kind:'home_care',agentId:r.id,text:`${r.name}${text}。`});return null;
}
