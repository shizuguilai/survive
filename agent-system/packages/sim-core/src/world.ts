import type { Resident, World } from './domain.ts';
import {postTask} from './camp.ts';
import { createCharacterState } from './character.ts';
export function createWorld(options: {seed?:number;runId?:string} = {}): World {
  const residents: Resident[] = [
    makeResident('resident-a', '阿林', -1, 0, '小禾'),
    makeResident('resident-b', '小禾', 1, Math.PI, '阿林'),
  ];
  residents[0].familiar[residents[1].id] = residents[1].name;
  residents[1].familiar[residents[0].id] = residents[0].name;
  return {schemaVersion:'1.0.0',runId:options.runId ?? crypto.randomUUID(),tick:0,revision:0,
    seed:options.seed ?? 23,rngState:options.seed ?? 23,residents,
    objects:[
      {id:'tree-west',kind:'tree',position:{x:-5,y:0,z:4},width:1,height:4,depth:1,appearance:'枝叶茂盛的树',resources:30},
      {id:'tree-east',kind:'tree',position:{x:5,y:0,z:4},width:1,height:4,depth:1,appearance:'枝叶稀疏的树',resources:30},
      {id:'wall-north',kind:'wall',position:{x:0,y:0,z:-4},width:5,height:3,depth:0.5,appearance:'不透光的石墙',resources:0},
    ],sounds:[],daylight:0.65,weatherProgress:0,events:[]};
}
function makeResident(id:string,name:string,x:number,heading:number,friend:string):Resident {
  const background=`你和${friend}是营地里相识多年的朋友，认识彼此的面容和声音。今早你们各自来到营地的空地附近。`;
  return {id,name,character:createCharacterState(id),background,personality:name==='阿林'?'温和、直率，愿意主动与熟人交流。':'友善、细心，愿意回应熟人的问候。',
    personalGoal:`今天希望见到${friend}时打个招呼，听听对方的近况，之后再考虑自己的事情。`,
    position:{x,y:0,z:0},heading,health:100,hunger:0.15,fatigue:0.1,pain:0,inventory:0,
    known:{},familiar:{},observations:[],memories:[{ref:'memory_background',kind:'direct',text:background,evidenceRefs:[],experiencedWhen:'过去多年，在营地共同生活'}],
    observationSequence:0,knowledgeSequence:0,consumedObservationRefs:[],goal:'尚未决定接下来的行动',plan:[],suspendedPlan:[],nextReviewTick:0,lastDecision:null,
    bodyBands:{},visualSignature:'',actionFeedback:[]};
}
export function cloneWorld(world:World):World { return structuredClone(world); }
/** Deterministic environment update; never consults wall clocks or engine timers. */
export function advanceEnvironment(world:World):void {
  for(const resident of world.residents){ resident.hunger=Math.min(1,resident.hunger+(world.camp?0.00012:0.000005)); resident.fatigue=Math.min(1,resident.fatigue+(world.camp?0.00003:0.000002)); }
  for(const resident of world.residents){if((resident.health??100)<=0)continue;
    const previous=resident.health??100;resident.health=Math.max(0,Math.min(100,previous+(resident.hunger>=.9?-.015:resident.hunger<.5&&resident.fatigue<.4?.002:0)));
    if(previous>0&&resident.health===0)world.events.push({tick:world.tick,kind:'incapacitated',agentId:resident.id,text:'生命耗尽，无法行动'});
  }
  world.daylight=0.65+Math.sin(world.tick/24000)*0.2;
  world.weatherProgress=(world.tick%72000)/72000;
}

/** Playable camp uses the same simulation; the small encounter fixture remains for regression tests. */
export function createCampWorld():World{
  const world=createWorld();world.objects=world.objects.filter(o=>o.kind!=='wall');for(const object of world.objects)object.resourceKind='wood';
  world.camp={stock:{},sequence:0,noticeVersion:0,tasks:[]};
  world.objects.push({id:'camp-board',kind:'board',position:{x:0,y:0,z:.4},width:.8,height:1.5,depth:.3,appearance:'营地公告板',resources:0});
  world.objects.push({id:'camp-workbench',kind:'workbench',position:{x:2.5,y:0,z:3},width:2,height:1.4,depth:1,appearance:'配方工作台兼物资置换台；走近read_notice可学习工具制作和资源兑换配方',resources:0});
  for(let i=0;i<30;i++){
    const kind=i%3===0?'tree':i%3===1?'rock':'berry',n=Math.floor(i/3),centers=[{x:-11,z:7},{x:10,z:9},{x:9,z:-9}],center=centers[i%3],angle=n*2.4,radius=1.8+Math.sqrt(n)*2;
    world.objects.push({id:`camp-resource-${i}`,kind,resourceKind:kind==='tree'?'wood':kind==='rock'?'stone':'food',position:{x:center.x+Math.cos(angle)*radius,y:0,z:center.z+Math.sin(angle)*radius},width:1,height:kind==='tree'?3.2:kind==='rock'?1.4:.8,depth:1,appearance:kind==='tree'?'可采集木材的树木':kind==='rock'?'可采集石料的岩石':'结满可食浆果的灌木',resources:kind==='berry'?12:24});
  }
  world.objects.push({id:'camp-pond',kind:'pond',position:{x:-12,y:0,z:-10},width:5,height:.2,depth:4,appearance:'一汪池塘，岸边可以休息',resources:0});
  for(const r of world.residents){r.supplies={};r.skills={gathering:0,crafting:0,construction:0};r.hunger=.4;r.personalGoal='照顾自己的温饱与休息，了解营地公告中的发展需要，自主选择有价值的事情并完成。熟人问候结束后继续生活，不必反复寒暄。';r.background+='你会识别木材、石料和浆果，懂得走近资源后采集、吃自己采到的浆果和休息；任务需要走近公告板阅读后自主接受。工作台上的具体配方要亲自走近阅读才能学会，公共仓储可存取材料，小屋建成后门廊适合休息。你不知道未亲见资源的位置。';}
  postTask(world,{resource:'wood',amount:8,note:'为营地准备第一批材料。可自由选择是否参与，完成后再读新目标。'});
  return world;
}
