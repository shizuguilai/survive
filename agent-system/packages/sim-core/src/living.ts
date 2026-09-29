import type {Resident,World,WorldObject,FurnitureKind,ResourceKind} from './domain.ts';
import {designedHomeSize} from './home-design.ts';

/** All life timers use simulation ticks. Model waits and manual pauses freeze them. */
export const DAY_TICKS=7200;
export const homeSize=designedHomeSize;
export function dayClock(tick:number){const hours=(8+tick/DAY_TICKS*24)%24;return {day:1+Math.floor((tick+DAY_TICKS/3)/DAY_TICKS),hours,night:hours<6||hours>=20,label:`第${1+Math.floor((tick+DAY_TICKS/3)/DAY_TICKS)}天 ${Math.floor(hours).toString().padStart(2,'0')}:${Math.floor(hours%1*60).toString().padStart(2,'0')}`};}
export function daylightAt(tick:number):number{return .12+.88*Math.max(0,Math.sin((dayClock(tick).hours-6)/12*Math.PI));}
export const ownHouse=(w:World,r:Resident)=>w.objects.find(o=>o.id===r.homeId&&o.ownerId===r.id&&o.kind==='house');
export const isInside=(r:Resident,o:WorldObject)=>Math.abs(r.position.x-o.position.x)<o.width/2-.16&&Math.abs(r.position.z-o.position.z)<o.depth/2-.12;
export const onBreak=(w:World,r:Resident)=>(r.living?.breakUntil??0)>w.tick;
export const FURNITURE:Record<FurnitureKind,{label:string;cost:Partial<Record<ResourceKind,number>>;effect:string}>={
 bed:{label:'床',cost:{wood:4},effect:'屋内休息恢复精力更快'},
 cabinet:{label:'柜子',cost:{wood:3,stone:1},effect:'个人专用储物，最多24份资源'},
 lamp:{label:'灯',cost:{wood:2,stone:2},effect:'夜间照亮住处，缓解黑暗带来的心情损失'},
 mop:{label:'拖把',cost:{wood:1},effect:'可打扫房间，恢复整洁度'},
};
export const desiredHomeLevel=(w:World,h:WorldObject)=>Math.min(3,(h.homeLevel??1)+((w.tick-(h.completedTick??w.tick))>=DAY_TICKS?1:0));
export function residentThought(w:World,r:Resident):string{
 const h=ownHouse(w,r);
 if(r.plan.some(p=>!p.done&&p.action.op==='rest'&&p.bedSettled))return 'Zzz… 好好睡一觉。';
 if(onBreak(w,r))return r.living?.breakKind==='tantrum'?'我气坏了，先让我冷静一下。':'我撑不住了，暂时不想工作。';
 if(r.hunger>.8)return '肚子好空，得找点吃的。';
 if(r.fatigue>.8)return '好困，想好好睡一觉。';
 if(!h){const project=w.camp?.tasks.find(t=>t.ownerId===r.id&&t.status==='open');return project?'我的房子还在施工，期待住进去。':'我好想有个家，能给我们划一片居住区吗？';}
 if(!h.furniture?.bed)return '有家了，还想做张床好好睡觉。';
 if(dayClock(w.tick).night&&!h.furniture?.lamp)return '屋里好黑，想装一盏灯。';
 if((h.cleanliness??1)<.4)return h.furniture?.mop?'房间脏了，得拖拖地。':'想做把拖把，把家收拾干净。';
 if((r.living?.desiredLevel??1)>(h.homeLevel??1))return '想把小屋改建得大一点，需要留出空地。';
 if(!h.furniture?.cabinet)return '想做个柜子，把自己的东西收好。';
 if(!h.furniture?.lamp)return '准备一盏灯，晚上回家就不黑了。';
 if(!h.furniture?.mop)return '添把拖把，以后自己打扫家。';
 return dayClock(w.tick).night?'天黑了，回家休息。':'有自己的家，心里踏实多了。';
}
export function moodReasons(w:World,r:Resident):string[]{
 const h=ownHouse(w,r),out:string[]=[];
 if(!h)out.push(`尚无完工住房 · 等待${Math.floor((r.living?.housingWait??0)/20)}秒`);
 else{out.push(`自己的${h.width}×${h.depth}住处`);if(!h.furniture?.bed)out.push('缺少床');if(dayClock(w.tick).night&&!h.furniture?.lamp)out.push('夜间缺少照明');if((h.cleanliness??1)<.4)out.push('房间脏乱');if((r.living?.desiredLevel??1)>(h.homeLevel??1))out.push('想要更宽敞的住处');}
 if(r.hunger>.6)out.push('肚子空');if(r.fatigue>.7)out.push('精力不足');if(r.pain>.15)out.push('身体疼痛');
 return out;
}
export function advanceLiving(w:World):void{
 if(!w.camp)return;
 for(const h of w.objects)if(h.kind==='house'){h.completedTick??=w.tick;h.cleanliness=Math.max(0,(h.cleanliness??1)-1/(DAY_TICKS*3));}
 for(const r of w.residents){
  if((r.health??100)<=0)continue;
  const life=r.living??={housingWait:0,upgradeWait:0,desiredLevel:1},h=ownHouse(w,r);
  if(h){life.housingWait=0;life.desiredLevel=desiredHomeLevel(w,h);life.upgradeWait=life.desiredLevel>(h.homeLevel??1)?life.upgradeWait+1:0;}
  else life.housingWait++;
  const housing=h?(!h.furniture?.bed ? .10 : 0)+(dayClock(w.tick).night&&!h.furniture?.lamp ? .07 : 0)+(1-(h.cleanliness??1))*.12+Math.min(.4,life.upgradeWait/DAY_TICKS*.15):.10+Math.min(.95,life.housingWait/(DAY_TICKS*1.5)*.7);
  const target=.92-r.hunger*.30-r.fatigue*.24-r.pain*.35-housing;
  const current=r.mood??.75;r.mood=Math.max(0,Math.min(1,current+Math.max(-.00016,Math.min(.00024,target-current))));
  if(life.breakUntil&&w.tick>=life.breakUntil){delete life.breakUntil;delete life.breakKind;r.mood=Math.max(.2,r.mood);w.events.push({tick:w.tick,kind:'mood_recovered',agentId:r.id,text:`${r.name}冷静下来，愿意重新安排生活。`});}
  if(r.mood<=.00001&&!onBreak(w,r)&&w.tick>=(life.cooldownUntil??0)){
   const furniture=h&&isInside(r,h)?(Object.keys(FURNITURE) as FurnitureKind[]).filter(k=>h.furniture?.[k]):[];
   const tantrum=furniture.length>0&&(r.id.charCodeAt(r.id.length-1)+Math.floor(w.tick/DAY_TICKS))%2===0;
   life.breakKind=tantrum?'tantrum':'strike';life.breakUntil=w.tick+600;life.cooldownUntil=w.tick+DAY_TICKS/2;
   const damage=tantrum?furniture.at(-1):undefined;if(damage)h!.furniture![damage]=false;
   const text=damage?`${r.name}心情降到零，发脾气损坏了自家的${FURNITURE[damage].label}，需要冷静30秒。`:`${r.name}心情降到零，暂时罢工30秒。`;
   r.plan=[];r.suspendedPlan=[];r.actionFeedback.push(text);r.nextReviewTick=w.tick;
   w.events.push({tick:w.tick,kind:'mental_break',agentId:r.id,text});
  }
 }
}
export function restRecovery(w:World,r:Resident):number{const h=w.objects.find(o=>o.kind==='house'&&isInside(r,o));return h?.furniture?.bed ? .0014 : h ? .00065 : .00032;}
