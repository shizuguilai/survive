import type {World} from '../../../packages/sim-core/src/domain.ts';
import type {JournalCategory,JournalEntry} from '../../../packages/contracts/src/journal-summary.ts';
export type {JournalCategory,JournalEntry} from '../../../packages/contracts/src/journal-summary.ts';
export const JOURNAL_LIMIT=2000;
const categories:JournalCategory[]=['decision','action','speech','memory','world'];
/** Observer-only archive. It is never read by perception or sent to the brain. */
export class ResidentJournal{
 rows:JournalEntry[]=[];version=0;
 private runId='';private eventCursor=0;private seen=new Map<string,string>();private sequence=0;
 constructor(saved?:unknown){
  if(Array.isArray(saved))this.rows=saved.filter((r:any)=>r&&typeof r.id==='string'&&typeof r.runId==='string'&&typeof r.residentId==='string'&&Number.isSafeInteger(r.tick)&&r.tick>=0&&categories.includes(r.category)&&typeof r.text==='string'&&r.text.length<=4000).slice(-JOURNAL_LIMIT);
 }
 collect(world:World):void{
  if(this.runId!==world.runId){this.runId=world.runId;this.eventCursor=0;this.seen.clear();}
  let changed=false;
  const existingIds=new Set(this.rows.map(row=>row.id));
  const add=(row:Omit<JournalEntry,'id'|'runId'>)=>{let id:string;do{id=`${world.runId}:${++this.sequence}`;}while(existingIds.has(id));existingIds.add(id);this.rows.push({...row,id,runId:world.runId});changed=true;};
  for(let i=this.eventCursor;i<world.events.length;i++){
   const e=world.events[i];
   // Action receipts below contain the actual target/result, unlike the legacy op-only event.
   if(e.kind==='action_completed'||e.kind==='action_failed'||e.kind==='craft'||e.kind==='exchange'||e.kind==='construction')continue;
   add({tick:e.tick,residentId:e.agentId,category:e.kind==='decision'?'decision':e.kind==='speech_fragment'?'speech':'world',text:e.text,source:e.source});
  }
  this.eventCursor=world.events.length;
  for(const r of world.residents)for(const memory of r.memories){
   const key=`${r.id}:${memory.ref}`;if(this.seen.get(key)===memory.text)continue;this.seen.set(key,memory.text);
   // Spoken text is already captured as chronological, actually emitted fragments.
   if(memory.ref.startsWith('memory_spoken_'))continue;
   const action=memory.ref.startsWith('memory_action_')||memory.ref.startsWith('memory_task_');
   add({tick:world.tick,residentId:r.id,category:action?'action':'memory',text:memory.text});
  }
  if(changed){this.rows=this.rows.slice(-JOURNAL_LIMIT);this.version++;}
 }
}
export function selectJournal(rows:JournalEntry[],residentId:string,category:JournalCategory|'all',runId?:string,maxTick=Infinity):JournalEntry[]{
 return rows.filter(r=>(r.residentId===residentId||r.residentId==='planner')&&(category==='all'||r.category===category)&&(!runId||r.runId===runId)&&(r.tick<=maxTick)).slice().reverse();
}
export function journalTime(tick:number):string{const s=Math.floor(tick/20);return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;}
export const JOURNAL_LABELS:Record<JournalCategory,string>={decision:'计划 · 尚未执行',action:'实际行动',speech:'已说出口',memory:'私人记忆',world:'营地公告'};
export function readableAction(text:string):string{
 const names:Record<string,string>={read_notice:'阅读公告/配方',accept_task:'接取目标',decline_task:'拒绝目标',gather:'采集',walk:'移动',look:'观察',listen:'聆听',wait:'等待',rest:'休息',eat:'进食',haul:'存入仓储',withdraw:'领取材料',craft:'制作',exchange:'置换',build:'施工',speak:'说话',continue:'继续当前计划',equip_item:'装备物品',unequip_item:'收起装备'};
 return text.replace(/\b[a-z_]+\b/g,word=>names[word]??word);
}
