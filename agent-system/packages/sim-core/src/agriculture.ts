import type {AnimalKind,CropKind,ResidentialBounds,ResidentialZone,World,WorldObject,ZoneKind,Resident} from './domain.ts';
import {FIXED_DT_MS} from './clock.ts';

export const CROP_LABELS:Record<CropKind,string>={rice:'水稻',wheat:'小麦',corn:'玉米',carrot:'胡萝卜'};
export const ANIMAL_LABELS:Record<AnimalKind|'mixed',string>={chicken:'鸡',duck:'鸭',goose:'鹅',mixed:'鸡鸭鹅'};
export const CROP_GROWTH_TICKS:Record<CropKind,number>={rice:2000,wheat:1800,corn:2600,carrot:1500};
export const FARM_WORK_TICKS={till:100,sow:60,water:40} as const;
export const WATER_CAPACITY=6;
export const FETCH_WATER_TICKS=60;
export const CROP_DRY_TICKS=1000;
export type FarmWork=keyof typeof FARM_WORK_TICKS;
export const CROP_YIELD:Record<CropKind,number>={rice:3,wheat:3,corn:4,carrot:2};
export const zoneKind=(z:ResidentialZone):ZoneKind=>z.kind??'residential';
export const boundsOverlap=(a:ResidentialBounds,b:ResidentialBounds)=>a.minX<b.maxX&&a.maxX>b.minX&&a.minZ<b.maxZ&&a.maxZ>b.minZ;
export function zoneConflict(world:World,bounds:ResidentialBounds,kind:ZoneKind):string|null{
 if(world.camp?.zones?.some(z=>zoneKind(z)!==kind&&boundsOverlap(bounds,z.bounds)))return '不同用途的区域不能重叠，请选择另一片空地';
 if(kind!=='residential'&&world.objects.some(o=>['house','plot','board','workbench','pond','wall'].includes(o.kind)&&boundsOverlap(bounds,{minX:o.position.x-o.width/2-.4,maxX:o.position.x+o.width/2+.4,minZ:o.position.z-o.depth/2-.4,maxZ:o.position.z+o.depth/2+.4})))return '种植区和畜牧区需要避开房屋、建筑设施和池塘';
 return null;
}
const inside=(b:ResidentialBounds,x:number,z:number)=>x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ;
function available(world:World,zone:ResidentialZone,x:number,z:number):boolean{
 if(world.camp?.zones?.some(z0=>z0.id!==zone.id&&zoneKind(z0)===zoneKind(zone)&&inside(z0.bounds,x,z)))return false;
 return !world.objects.some(o=>o.kind!=='animal'&&Math.abs(o.position.x-x)<o.width/2+.75&&Math.abs(o.position.z-z)<o.depth/2+.75);
}
/** Designation marks untouched ground; residents must actually till, sow and water. */
export function populateAgriculture(world:World,zone:ResidentialZone):number{
 const b=zone.bounds,planting=zone.kind==='planting',columns=Math.min(planting?6:3,Math.max(1,Math.floor((b.maxX-b.minX)/2))),rows=Math.min(planting?6:3,Math.max(1,Math.floor((b.maxZ-b.minZ)/2)));
 let count=0;
 for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
  const x=b.minX+(column+.5)*(b.maxX-b.minX)/columns,z=b.minZ+(row+.5)*(b.maxZ-b.minZ)/rows;
  if(!available(world,zone,x,z))continue;
  const index=row*columns+column,id=`${zone.id}-${planting?'crop':'animal'}-${index}`,position={x,y:0,z};
  if(planting){
   const kind=zone.cropKind??'rice';
   const object:WorldObject={id,kind:'crop',zoneId:zone.id,position,width:1.2,depth:1.2,height:.2,resourceKind:'food',maxResources:CROP_YIELD[kind],resources:0,appearance:'',crop:{kind,stage:'fallow',growth:0,plantedTick:0,cycles:0,moisture:0}};
   describeCrop(object);world.objects.push(object);
  }else{
   const kind=zone.animalKind&&zone.animalKind!=='mixed'?zone.animalKind:(['chicken','duck','goose'] as const)[index%3];
   const heading=randomUnit(world.seed,id,0)*Math.PI*2;
   world.objects.push({id,kind:'animal',zoneId:zone.id,position,width:.5,depth:.7,height:kind==='goose'?.85:kind==='chicken'?.6:.55,resources:0,appearance:`畜牧区里的${ANIMAL_LABELS[kind]}，会在畜牧区内散步、啄食和扑翅`,animal:{kind,heading,activity:'walk',phaseStartedTick:world.tick,phaseUntilTick:world.tick+35+index*7,phase:0}});
  }
  count++;
 }
 return count;
}
export function describeCrop(object:WorldObject):void{
 const c=object.crop!,soil=(c.moisture??1)<=0?'缺水，生长已暂停':(c.moisture??1)<=.35?'土壤偏干，需要浇水':'土壤湿润';
 const stage=c.stage==='fallow'?'待开垦的荒地，需要先开垦，再播种、取水浇水':c.stage==='tilled'?'已开垦的土地，等待播种':c.stage==='sown'?'已播种，尚未发芽，需要取水浇水':c.stage==='seedling'?`幼苗，尚未成熟；${soil}`:c.stage==='growing'?`正在生长，尚未成熟；${soil}`:c.stage==='mature'?`已成熟，可走近收割，剩余${object.resources}份食物`:'已收割的田茬，需要重新开垦、播种和浇水';
 object.appearance=`${CROP_LABELS[c.kind]}：${stage}。`;
 object.height=['fallow','tilled','sown','harvested'].includes(c.stage)?.12:.2+c.growth*(c.kind==='corn'?1.15:c.kind==='carrot'?.25:.75);
}
/** Returns an error before work, and checks again when real timed labour finishes. */
export function farmError(object:WorldObject|undefined,resident:Resident,work:FarmWork):string|null{
 if(!object?.crop||object.kind!=='crop')return '这个目标不是可耕种的地块。';
 if(!Object.hasOwn(FARM_WORK_TICKS,work))return '没有这种农事动作。';
 if(Math.hypot(resident.position.x-object.position.x,resident.position.z-object.position.z)>1.8)return '我距离这块农地太远，需要先走到它附近。';
 const crop=object.crop;
 if(work==='till'&&!['fallow','harvested'].includes(crop.stage))return '这块地已经开垦，不能重复开垦或毁掉正在生长的作物。';
 if(work==='sow'&&crop.stage!=='tilled')return '这块地尚未开垦或已经播种，不能跳过开垦。';
 if(work==='water'&&crop.stage==='mature')return '这块地作物已成熟，不需要再浇水，可以收割了。';
 if(work==='water'&&!['sown','seedling','growing'].includes(crop.stage))return '这块地还不能浇水，需要先开垦、播种。';
 if(work==='water'&&(resident.water??0)<1)return '我没有携带水，需要先去自己知道的池塘岸边取水。';
 if(work==='water'&&(crop.moisture??0)>.9)return '这块地水分充足，暂时不需要重复浇水。';
 return null;
}
export function finishFarm(object:WorldObject,resident:Resident,work:FarmWork,tick:number):void{
 const crop=object.crop!;
 if(work==='till'){crop.stage='tilled';crop.growth=0;crop.moisture=0;object.resources=0;delete crop.harvestedTick;}
 if(work==='sow'){crop.stage='sown';crop.growth=0;crop.plantedTick=tick;crop.moisture=0;}
 if(work==='water'){resident.water=(resident.water??0)-1;crop.moisture=1;crop.lastWateredTick=tick;if(crop.stage==='sown'){crop.stage='seedling';crop.plantedTick=tick;}}
 describeCrop(object);
}
/** Called after a successful resident gather, never by the renderer. */
export function harvestCrop(object:WorldObject,tick:number):void{
 if(!object.crop||object.crop.stage!=='mature')return;
 if(object.resources<=0){object.crop.stage='harvested';object.crop.harvestedTick=tick;object.crop.growth=0;object.crop.moisture=0;object.crop.cycles++;}
 describeCrop(object);
}
function randomUnit(seed:number,id:string,phase:number):number{
 let value=(seed^Math.imul(phase+1,2654435761))>>>0;
 for(let i=0;i<id.length;i++)value=Math.imul(value^id.charCodeAt(i),16777619)>>>0;
 value^=value>>>16;value=Math.imul(value,2246822507);value^=value>>>13;
 return (value>>>0)/4294967296;
}
/** One authoritative 50 ms step; saving stores every movement phase, pausing freezes it. */
export function advanceAgriculture(world:World):void{
 // Version 26 treated sowing designations as completed tasks. Reopen just those
 // legacy notices once; existing plant stages/yields and positions stay intact.
 const legacy=world.camp?.tasks.filter(t=>t.kind==='planting'&&t.status==='done')??[];
 if(legacy.length&&world.camp){
  for(const task of legacy){task.status='open';task.progress=0;task.note='长期农田：居民需实际开垦、播种、取水浇水，缺水补浇，成熟收割入库；收割后重新开垦播种。';}
  world.camp.sequence++;world.camp.noticeVersion++;
  const board=world.objects.find(o=>o.kind==='board');if(board)board.appearance=`公告板实体兼公共仓储，第${world.camp.noticeVersion}版。种植区需持续照料；走近read_notice了解开垦、播种、取水浇水和收割流程。`;
 }
 const zones=new Map(world.camp?.zones?.map(z=>[z.id,z])??[]);
 for(const object of world.objects){
  const crop=object.crop;
  if(object.kind==='crop'&&crop){
   // Old saves retain their already-grown crops and receive one initial wet period.
   // There is no wall-clock catch-up or regrowth without new resident labour.
   if(crop.moisture===undefined){crop.moisture=['seedling','growing','mature'].includes(crop.stage)?1:0;describeCrop(object);}
   if(!['seedling','growing'].includes(crop.stage))continue;
   const previous=crop.stage,oldMoisture=crop.moisture;
   if(oldMoisture>0){
    crop.growth=Math.min(1,crop.growth+1/CROP_GROWTH_TICKS[crop.kind]);
    crop.moisture=Math.max(0,oldMoisture-1/CROP_DRY_TICKS);
    crop.stage=crop.growth>=1-1e-10?'mature':crop.growth>=.26?'growing':'seedling';
    if(crop.stage==='mature'){crop.growth=1;object.resources=CROP_YIELD[crop.kind];object.maxResources=object.resources;}
   }
   if(crop.stage!==previous||(oldMoisture>.35&&crop.moisture<=.35)||(oldMoisture>0&&crop.moisture<=0))describeCrop(object);
   object.height=.2+crop.growth*(crop.kind==='corn'?1.15:crop.kind==='carrot'?.25:.75);
  }
  const animal=object.animal,zone=object.zoneId?zones.get(object.zoneId):undefined;
  if(object.kind!=='animal'||!animal||!zone||zone.kind!=='pasture')continue;
  if(world.tick>=animal.phaseUntilTick){
   animal.phase++;const choice=randomUnit(world.seed,object.id,animal.phase);
   animal.activity=choice<.52?'walk':choice<.8?'peck':choice<.94?'idle':'flap';
   animal.heading+=(randomUnit(world.seed,object.id,animal.phase+1000)-.5)*Math.PI*1.7;
   animal.phaseStartedTick=world.tick;animal.phaseUntilTick=world.tick+Math.round(24+randomUnit(world.seed,object.id,animal.phase+2000)*80);
  }
  if(animal.activity!=='walk')continue;
  const b=zone.bounds,margin=.9,speed=(animal.kind==='goose'?.65:animal.kind==='duck'?.52:.58)*FIXED_DT_MS/1000;
  const x=object.position.x+Math.cos(animal.heading)*speed,z=object.position.z+Math.sin(animal.heading)*speed;
  if(x<b.minX+margin||x>b.maxX-margin)animal.heading=Math.PI-animal.heading;
  if(z<b.minZ+margin||z>b.maxZ-margin)animal.heading=-animal.heading;
  object.position.x=Math.max(b.minX+margin,Math.min(b.maxX-margin,x));object.position.z=Math.max(b.minZ+margin,Math.min(b.maxZ-margin,z));
 }
}
