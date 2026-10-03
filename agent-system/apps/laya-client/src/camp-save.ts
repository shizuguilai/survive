import type {World} from '../../../packages/sim-core/src/domain.ts';
import type {TaskDraft} from '../../../packages/sim-core/src/camp.ts';
import {postTask} from '../../../packages/sim-core/src/camp.ts';
import {controlSettings,type ControlSettings} from '../../../packages/contracts/src/command.ts';
import {hashCanonical} from '../../../packages/contracts/src/canonical.ts';
import {validateCharacterState} from '../../../packages/sim-core/src/character.ts';

export type CampSaveState={world:World;settings:ControlSettings;queuedTasks:TaskDraft[];selectedId:string;showSenses:boolean;needsDecision:boolean};
export type CampSave=CampSaveState&{version:1;sequence:number;savedAt:number};
export type SaveStorage={getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem?(key:string):void};
export const CAMP_SAVE_KEYS=['survive_camp_a_v1','survive_camp_b_v1'] as const;
export const LEGACY_CAMP_SAVE_KEY='survive_agent_commit_v1';
const record=(x:any)=>x&&typeof x==='object'&&!Array.isArray(x);
const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x);
const count=(x:any)=>Number.isSafeInteger(x)&&x>=0;
const point=(x:any)=>record(x)&&['x','y','z'].every(k=>finite(x[k]));
const list=(x:any)=>Array.isArray(x);
const cropKinds=['rice','wheat','corn','carrot'];
const animalKinds=['chicken','duck','goose'];
const zoneKinds=['residential','planting','pasture'];
const taskKinds=['gather','craft','house',...zoneKinds];
const agricultureOptions=(x:any)=>
 (x.cropKind===undefined||(x.kind==='planting'&&cropKinds.includes(x.cropKind)))&&
 (x.animalKind===undefined||(x.kind==='pasture'&&[...animalKinds,'mixed'].includes(x.animalKind)));
const cropState=(x:any)=>record(x)&&cropKinds.includes(x.kind)&&['fallow','tilled','sown','seedling','growing','mature','harvested'].includes(x.stage)&&finite(x.growth)&&x.growth>=0&&x.growth<=1&&count(x.plantedTick)&&(x.harvestedTick===undefined||count(x.harvestedTick))&&count(x.cycles)&&(x.moisture===undefined||(finite(x.moisture)&&x.moisture>=0&&x.moisture<=1))&&(x.lastWateredTick===undefined||count(x.lastWateredTick));
const animalState=(x:any)=>record(x)&&animalKinds.includes(x.kind)&&finite(x.heading)&&['walk','peck','idle','flap'].includes(x.activity)&&count(x.phaseStartedTick)&&count(x.phaseUntilTick)&&x.phaseUntilTick>=x.phaseStartedTick&&finite(x.phase);
/** Corruption check, not authentication. A fast string checksum avoids hashing every frame. */
function checksum(s:string):string{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(16);}
function validateWorld(w:any):asserts w is World{
 const bad=()=>{throw Error('营地存档内容不完整');};
 if(!record(w)||w.schemaVersion!=='1.0.0'||typeof w.runId!=='string'||!w.runId||!count(w.tick)||!count(w.revision)||!finite(w.seed)||!finite(w.rngState)||!finite(w.daylight)||!finite(w.weatherProgress)||!list(w.residents)||!w.residents.length||w.residents.length>6||!list(w.objects)||!list(w.sounds)||!list(w.events))bad();
 const ids=new Set<string>();
 for(const r of w.residents){
  if(!record(r)||typeof r.id!=='string'||ids.has(r.id)||!point(r.position)||!['heading','hunger','fatigue','pain','inventory','nextReviewTick','observationSequence','knowledgeSequence'].every(k=>finite(r[k]))||!['name','background','personality','personalGoal','goal','visualSignature'].every(k=>typeof r[k]==='string')||!['plan','suspendedPlan','observations','memories','consumedObservationRefs','actionFeedback'].every(k=>list(r[k]))||!['known','familiar','bodyBands'].every(k=>record(r[k])))bad();
  if(r.water!==undefined&&(!finite(r.water)||r.water<0||r.water>6))bad();
  ids.add(r.id);if(r.character&&validateCharacterState(r.character,r.id))bad();
  for(const k of Object.values(r.known) as any[])if(!record(k)||!point(k.lastPosition)||typeof k.entityId!=='string'||typeof k.ref!=='string'||typeof k.description!=='string')bad();
  for(const p of [...r.plan,...r.suspendedPlan])if(!record(p)||!record(p.action)||typeof p.action.op!=='string'||!record(p.action.params)||!count(p.elapsedTicks)||!count(p.emittedChars)||typeof p.done!=='boolean')bad();
 }
 const objects=new Set<string>();for(const o of w.objects){
  if(!record(o)||typeof o.id!=='string'||objects.has(o.id)||!['tree','wall','rock','berry','board','pond','workbench','plot','house','crop','animal'].includes(o.kind)||!point(o.position)||!['width','height','depth'].every(k=>finite(o[k])&&o[k]>0)||!finite(o.resources)||o.resources<0||typeof o.appearance!=='string')bad();
  if(o.kind==='crop'?!cropState(o.crop):o.crop!==undefined)bad();
  if(o.kind==='animal'?!animalState(o.animal):o.animal!==undefined)bad();
  objects.add(o.id);
 }
 for(const s of w.sounds)if(!record(s)||!point(s.position)||typeof s.text!=='string'||!list(s.deliveredTo)||!finite(s.emittedTick))bad();
 for(const e of w.events)if(!record(e)||!count(e.tick)||typeof e.kind!=='string'||typeof e.text!=='string')bad();
 if(w.camp){if(!record(w.camp)||!list(w.camp.tasks)||!count(w.camp.sequence)||!count(w.camp.noticeVersion))bad();
  for(const t of w.camp.tasks)if(!record(t)||typeof t.id!=='string'||(t.kind!==undefined&&!taskKinds.includes(t.kind))||!agricultureOptions(t)||!count(t.amount)||!count(t.progress)||!list(t.acceptedBy)||typeof t.note!=='string'||!['open','done'].includes(t.status))bad();
  if(w.camp.stock&&!Object.values(w.camp.stock).every(n=>finite(n)&&(n as number)>=0))bad();
  if(w.camp.zones!==undefined){if(!list(w.camp.zones))bad();for(const z of w.camp.zones)if(!record(z)||(z.kind!==undefined&&!zoneKinds.includes(z.kind))||!agricultureOptions(z)||!record(z.bounds)||!['minX','maxX','minZ','maxZ'].every(k=>finite(z.bounds[k])))bad();}
 }
}
function validateState(data:any):asserts data is CampSaveState{
 validateWorld(data?.world);
 if(!list(data.queuedTasks)||data.queuedTasks.length>64||typeof data.selectedId!=='string'||typeof data.showSenses!=='boolean'||typeof data.needsDecision!=='boolean'||!record(data.settings))throw Error('营地存档设置不完整');
 if(data.queuedTasks.length){const probe=structuredClone(data.world);for(const task of data.queuedTasks){if(!record(task)||(task.kind!==undefined&&!taskKinds.includes(task.kind))||!agricultureOptions(task))throw Error('营地存档任务不完整');postTask(probe,task);}}
}
/** Shared packet validation for the browser database and the legacy synchronous slots. */
export function decodeCampSave(raw:string):CampSave{
 const packet=JSON.parse(raw),s=packet.data;if(checksum(JSON.stringify(s))!==packet.checksum||s.version!==1||!count(s.sequence)||s.sequence<1||!finite(s.savedAt))throw Error('存档校验失败');validateState(s);return s as CampSave;
}
/** Alternating atomic slots retain the previous good camp if a write fails or one slot is damaged. */
export class CampSaves{
 private sequence=0;private slot=-1;private storage:SaveStorage;
 constructor(storage:SaveStorage){this.storage=storage;}
 load(fallbackSettings:ControlSettings):{save:CampSave|null;warning:string;blocked:boolean}{
  let damaged=0,readFailed=false;const candidates:{slot:number;save:CampSave}[]=[];
  for(const [slot,key]of CAMP_SAVE_KEYS.entries()){
   let raw:string|null;try{raw=this.storage.getItem(key);}catch{readFailed=true;continue;}if(!raw)continue;
   try{candidates.push({slot,save:decodeCampSave(raw)});}catch{damaged++;}
  }
  candidates.sort((a,b)=>b.save.sequence-a.save.sequence);const latest=candidates[0];
  if(latest){this.sequence=latest.save.sequence;this.slot=latest.slot;latest.save.settings=controlSettings(latest.save.settings);return {save:latest.save,warning:damaged||readFailed?'一份存档无法读取，已恢复另一份完整存档。':'',blocked:false};}
  try{const raw=this.storage.getItem(LEGACY_CAMP_SAVE_KEY);if(raw){const old=JSON.parse(raw);validateWorld(old.world);if(old.commit?.afterHash!==hashCanonical(old.world))throw Error('旧检查点校验失败');
   const save:CampSave={version:1,sequence:0,savedAt:0,world:old.world,settings:controlSettings(fallbackSettings),queuedTasks:[],selectedId:old.world.residents[0].id,showSenses:false,needsDecision:false};return {save,warning:'已恢复旧版最近一次决策检查点，之后尚未保存的进度无法找回。',blocked:false};
  }}catch{damaged++;}
  return {save:null,warning:damaged?'存档校验失败，原数据已保留；点击“保存进度”才会用当前营地替换。':readFailed?'本机存档暂时无法读取，自动保存已暂停。':'',blocked:damaged>0||readFailed};
 }
 save(state:CampSaveState,savedAt=Date.now()):CampSave{
  validateState(state);const data:CampSave={...state,version:1,sequence:this.sequence+1,savedAt},raw=JSON.stringify(data),slot=this.slot===0?1:0;
  this.storage.setItem(CAMP_SAVE_KEYS[slot],`{"checksum":"${checksum(raw)}","data":${raw}}`);
  this.sequence=data.sequence;this.slot=slot;return data;
 }
}
