import type { Resident, World } from './domain.ts';
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
    position:{x,y:0,z:0},heading,hunger:0.15,fatigue:0.1,pain:0,inventory:0,
    known:{},familiar:{},observations:[],memories:[{ref:'memory_background',kind:'direct',text:background,evidenceRefs:[],experiencedWhen:'过去多年，在营地共同生活'}],
    observationSequence:0,knowledgeSequence:0,consumedObservationRefs:[],goal:'尚未决定接下来的行动',plan:[],suspendedPlan:[],nextReviewTick:0,lastDecision:null,
    bodyBands:{},visualSignature:'',actionFeedback:[]};
}
export function cloneWorld(world:World):World { return structuredClone(world); }
/** Deterministic environment update; never consults wall clocks or engine timers. */
export function advanceEnvironment(world:World):void {
  for(const resident of world.residents){ resident.hunger=Math.min(1,resident.hunger+0.000005); resident.fatigue=Math.min(1,resident.fatigue+0.000002); }
  world.daylight=0.65+Math.sin(world.tick/24000)*0.2;
  world.weatherProgress=(world.tick%72000)/72000;
}
