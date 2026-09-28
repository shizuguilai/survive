import type {Resident,World,WorldObject,ResourceKind} from './domain.ts';
import {homeSize,isInside} from './living.ts';
import {clearNewWalls} from './navigation.ts';
import {grantKnown,ownReceipt,updateBoard,learnHouse} from './camp.ts';
import {RECIPES,HOUSE_STEPS,houseSteps,materialText,taskTitle,skillLevel} from './recipes.ts';
import {validateCharacterState,equippedItem} from './character.ts';
export function addSkill(r:Resident,skill:'gathering'|'crafting'|'construction',amount=1):void{r.skills??={gathering:0,crafting:0,construction:0};r.skills[skill]+=amount;}
export function skillDuration(r:Resident,skill:'crafting'|'construction',base:number):number{return base*(1-skillLevel(r.skills?.[skill])*.04);}
export function gatherPeriod(r:Resident,kind:ResourceKind):number{
 const tool=kind==='wood'?'stone_axe':kind==='food'?'stone_hoe':null;
 return tool&&r.character&&(['leftHand','rightHand'] as const).some(slot=>equippedItem(r.character!,slot)?.item.catalogId===tool)?12:20;
}
export function readWorkbench(world:World,r:Resident,bench:WorldObject):void{
 for(const recipe of RECIPES){const description=`配方${recipe.label}：投入本人${materialText(recipe.cost)} → ${recipe.item?recipe.label:materialText(recipe.output!)}。${recipe.effect}。在工作台使用${recipe.kind}，recipeRef为本引用，stationRef为本人已知工作台。`;
 grantKnown(r,`recipe:${recipe.id}`,description,bench.position,world.tick);
 ownReceipt(r,world,`我读到${description}`,`memory_recipe_${recipe.id}`);
 }
 ownReceipt(r,world,'我实际读完工作台配方。合成只消耗自己的随身资源；公共仓储材料须先走近公告板withdraw领取。加工成功后工具归我，需自行equip_item才生效。');
}
export function findRecipe(r:Resident,ref:string){const id=r.known[ref]?.entityId;return RECIPES.find(recipe=>id===`recipe:${recipe.id}`);}
const nearby=(r:Resident,o:WorldObject|undefined,range=2.5)=>o&&Math.hypot(r.position.x-o.position.x,r.position.z-o.position.z)<=range;
export function finishRecipe(world:World,r:Resident,stationRef:string,recipeRef:string,op:'craft'|'exchange'):string|null{
 const station=world.objects.find(o=>o.id===r.known[stationRef]?.entityId&&o.kind==='workbench'),recipe=findRecipe(r,recipeRef);
 if(!nearby(r,station))return '必须实际走近本人已知的工作台才能加工。';
 if(!recipe||recipe.kind!==op)return '本人尚未学会该配方，或动作类型与配方不符。';
 for(const [kind,count] of Object.entries(recipe.cost))if((r.supplies?.[kind as ResourceKind]??0)<count!)return `随身材料不足：需要${materialText(recipe.cost)}，可以采集或从仓储领取。`;
 const cost=Object.values(recipe.cost).reduce((n,v)=>n+v!,0),gain=Object.values(recipe.output??{}).reduce((n,v)=>n+v!,0);
 if(r.inventory-cost+gain>30)return '置换后的随身资源超过30份容量。';
 let character=r.character?structuredClone(r.character):undefined;
 if(recipe.item){
  if(!character)return '角色装备系统未初始化。';
  const index=Math.max(0,...character.inventory.items.map(i=>Number(i.itemRef.slice(5))))+1;
  character.inventory.items.push({id:`${r.id}:crafted:${world.tick}:${index}`,itemRef:`item_${index}`,catalogId:recipe.item,ownerId:r.id});
  if(validateCharacterState(character,r.id))return '工具收纳空间不足，请先调整本人装备；材料未扣除。';
 }
 // Completion is atomic: preflight all checks before either removing inputs or adding outputs.
 r.supplies??={};for(const [kind,count]of Object.entries(recipe.cost))r.supplies[kind as ResourceKind]=(r.supplies[kind as ResourceKind]??0)-count!;
 for(const [kind,count]of Object.entries(recipe.output??{}))r.supplies[kind as ResourceKind]=(r.supplies[kind as ResourceKind]??0)+count!;
 r.inventory+=gain-cost;if(character)r.character=character;addSkill(r,'crafting');
 const text=`${r.name}完成${recipe.label}：消耗${materialText(recipe.cost)}，得到${recipe.item?recipe.label:materialText(recipe.output!)}。`;
 ownReceipt(r,world,text);world.events.push({tick:world.tick,kind:op,agentId:r.id,text});
 if(recipe.item){const task=world.camp?.tasks.find(t=>t.kind==='craft'&&t.recipeId===recipe.id&&t.status==='open'&&t.acceptedBy.includes(r.id));if(task){task.progress++;if(task.progress>=task.amount){task.status='done';updateBoard(world);}}}
 return null;
}
export function finishBuild(world:World,r:Resident,projectRef:string,stepRef:string):string|null{
 const task=world.camp?.tasks.find(t=>t.id===r.known[projectRef]?.entityId&&t.kind==='house');
 if(!task||task.status!=='open'||!task.acceptedBy.includes(r.id))return '必须先亲自阅读并自愿接受这项建房目标。';
 const plot=world.objects.find(o=>o.projectId===task.id);if(!nearby(r,plot,3))return '尚未走到这座房屋的建设地块。';
 const steps=houseSteps(task),step=steps[task.progress];
 if(!step||r.known[stepRef]?.entityId!==`${task.id}:${step.id}`)return '这个步骤已完成或前置步骤未完成，请根据现场进展或重读公告调整。';
 const stock=task.reserved??world.camp!.stock??{};
 for(const [kind,count]of Object.entries(step.cost))if((stock[kind as ResourceKind]??0)<count)return `建筑材料不足：${step.label}需要${materialText(step.cost)}；先采集并haul存入。`;
 for(const [kind,count]of Object.entries(step.cost))stock[kind as ResourceKind]=(stock[kind as ResourceKind]??0)-count;
 task.progress++;
 if(step.id==='dismantle'){
  const oldLevel=plot!.homeLevel??1;world.camp!.stock??={};world.camp!.stock.wood=(world.camp!.stock.wood??0)+6*oldLevel;world.camp!.stock.stone=(world.camp!.stock.stone??0)+4*oldLevel;
  plot!.position={...task.targetPosition!};Object.assign(plot!,homeSize(task.homeLevel));plot!.homeLevel=task.homeLevel;plot!.zoneId=task.zoneId;plot!.kind='plot';
 }
 plot!.buildStage=task.progress-(task.renovation?1:0);plot!.appearance=`住宅施工：${task.progress}/${task.amount}，刚完成${step.label}`;
 if(task.progress===steps.length){
  task.status='done';plot!.kind='house';plot!.height=3.5;plot!.homeLevel=task.homeLevel??1;plot!.completedTick=world.tick;plot!.cleanliness??=1;
  plot!.appearance=`${plot!.width}×${plot!.depth}住宅，南侧门口可进入，屋内可休息、添置家具与打扫`;
  const owner=world.residents.find(x=>x.id===task.ownerId);if(owner){owner.homeId=plot!.id;if(owner.living){owner.living.housingWait=0;owner.living.upgradeWait=0;owner.living.desiredLevel=plot!.homeLevel;}if(owner.id===r.id)grantKnown(owner,plot!.id,plot!.appearance+'；自己的住处，可使用home_care改善生活。',plot!.position,world.tick);}
  if(task.ownerId&&!task.renovation){const zone=world.camp?.tasks.find(t=>t.kind==='residential'&&t.zoneId===task.zoneId);if(zone)zone.progress++;}
 }
 clearNewWalls(world,plot!);addSkill(r,'construction');updateBoard(world);learnHouse(world,r,task);
 const text=`${r.name}完成${task.note||taskTitle(task)}的${step.label}，消耗${materialText(step.cost)}。${task.status==='done'?'房屋已建成，可进屋rest或home_care改善生活。':''}`;
 ownReceipt(r,world,text);world.events.push({tick:world.tick,kind:'construction',agentId:r.id,text});return null;
}
export function withdraw(world:World,r:Resident,storageRef:string,resource:ResourceKind,amount:number):string|null{
 const board=world.objects.find(o=>o.id===r.known[storageRef]?.entityId&&(o.kind==='board'||o.kind==='house'&&o.ownerId===r.id&&o.furniture?.cabinet));
 if(!nearby(r,board)||board!.kind==='house'&&!isInside(r,board!))return '必须走近公共仓储，或进入自己的住房才能领取。';
 if(!world.camp||!Number.isInteger(amount)||amount<1||!['wood','stone','food'].includes(resource))return '领取参数无效。';
 const stock=board!.kind==='house'?(board!.stored??={}):(world.camp.stock??={});
 if((stock[resource]??0)<amount)return '眼前仓储该资源不足，未领取任何物资。';
 if(r.inventory+amount>30)return '随身采集袋空间不足。';
 stock[resource]!-=amount;r.supplies??={};r.supplies[resource]=(r.supplies[resource]??0)+amount;r.inventory+=amount;
 ownReceipt(r,world,`我从${board!.kind==='house'?'自己的柜子':'公共仓储'}实际领取${materialText({[resource]:amount})}。`);return null;
}
