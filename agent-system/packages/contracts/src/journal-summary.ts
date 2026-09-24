/** Observer archive contracts. These never form part of a resident's brain context. */
export type JournalCategory='decision'|'action'|'speech'|'memory'|'world';
export type JournalEntry={id:string;runId:string;tick:number;residentId:string;category:JournalCategory;text:string;source?:string};
export type SummaryRequest={schemaVersion:'1.0.0';requestId:string;runId:string;residentId:string;residentName:string;entries:JournalEntry[]};
export type SummaryPoint={title:string;detail:string;kind:'progress'|'setback'|'plan'|'social'|'observation';evidenceIds:string[]};
export type SummaryContent={headline:string;overview:string;highlights:SummaryPoint[];nextFocus:{text:string;evidenceIds:string[]}[]};
export type SummaryResponse={requestId:string;runId:string;residentId:string;source:'REAL_MODEL';model:'glm-4.5-air';fromTick:number;throughTick:number;summary:SummaryContent};
export type SavedSummary={response:SummaryResponse;entries:JournalEntry[];createdAt:string};
export const SUMMARY_ENTRY_LIMIT=120;
const categories=['decision','action','speech','memory','world'];
function check(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
function record(v:any,keys:string[]){check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k)),'对象包含未知字段');}
function str(v:any,max:number){check(typeof v==='string'&&v.trim().length>0&&v.length<=max,'文本为空或过长');}
export function validateSummaryRequest(raw:unknown):SummaryRequest{
 const r=raw as SummaryRequest;record(r,['schemaVersion','requestId','runId','residentId','residentName','entries']);check(r.schemaVersion==='1.0.0','总结版本不匹配');
 for(const v of [r.requestId,r.runId,r.residentId])str(v,160);str(r.residentName,80);
 check(Array.isArray(r.entries)&&r.entries.length>0&&r.entries.length<=SUMMARY_ENTRY_LIMIT,'总结需要1至120条记录');const ids=new Set<string>();let last=-1;
 for(const e of r.entries){record(e,['id','runId','tick','residentId','category','text','source']);str(e.id,200);str(e.text,4000);check(e.runId===r.runId&&(e.residentId===r.residentId||e.residentId==='planner'),'总结不能混入另一居民或轮次的私人记录');check(Number.isSafeInteger(e.tick)&&e.tick>=last,'记录必须按模拟时间排序');last=e.tick;check(categories.includes(e.category),'记录类型无效');check(!ids.has(e.id),'证据标识重复');ids.add(e.id);if(e.source!==undefined)str(e.source,40);}
 check(new TextEncoder().encode(JSON.stringify(r)).byteLength<=220_000,'总结记录过大，请缩小范围');return structuredClone(r);
}
export function validateSummaryContent(raw:unknown,request:SummaryRequest):SummaryContent{
 const s=raw as SummaryContent;record(s,['headline','overview','highlights','nextFocus']);str(s.headline,80);str(s.overview,500);
 check(Array.isArray(s.highlights)&&s.highlights.length<=6,'关键点数量不合法');check(Array.isArray(s.nextFocus)&&s.nextFocus.length<=3,'待办数量不合法');
 const known=new Map(request.entries.map(e=>[e.id,e]));const refs=(ids:string[])=>{check(Array.isArray(ids)&&ids.length>=1&&ids.length<=5&&new Set(ids).size===ids.length,'每点需要1至5个不同证据');for(const id of ids)check(known.has(id),'总结引用了未提供的记录');};
 for(const p of s.highlights){record(p,['title','detail','kind','evidenceIds']);str(p.title,80);str(p.detail,600);check(['progress','setback','plan','social','observation'].includes(p.kind),'关键点类型无效');refs(p.evidenceIds);if(p.kind==='progress')check(p.evidenceIds.some(id=>known.get(id)!.category==='action'),'进展必须包含实际行动凭据，计划不能当成果');}
 for(const p of s.nextFocus){record(p,['text','evidenceIds']);str(p.text,300);refs(p.evidenceIds);}
 return structuredClone(s);
}
export function validateSummaryResponse(raw:unknown,request:SummaryRequest):SummaryResponse{
 const r=raw as SummaryResponse;record(r,['requestId','runId','residentId','source','model','fromTick','throughTick','summary']);check(r.requestId===request.requestId&&r.runId===request.runId&&r.residentId===request.residentId,'总结对应的居民或请求不匹配');check(r.source==='REAL_MODEL'&&r.model==='glm-4.5-air','拒绝非真实模型总结');check(r.fromTick===request.entries[0].tick&&r.throughTick===request.entries.at(-1)!.tick,'总结时间范围不匹配');return {...r,summary:validateSummaryContent(r.summary,request)};
}
