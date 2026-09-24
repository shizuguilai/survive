import {SUMMARY_ENTRY_LIMIT,validateSummaryRequest,validateSummaryResponse,type JournalEntry,type SummaryRequest,type SavedSummary} from '../../../packages/contracts/src/journal-summary.ts';
/** Choose one resident and one run. Sorting and bounding never edits simulation state. */
export function summaryInput(rows:JournalEntry[],residentId:string,residentName:string,currentRunId:string,allRuns:boolean,maxTick=Infinity):SummaryRequest|null{
 const own=rows.filter(e=>e.residentId===residentId&&e.tick<=maxTick&&(allRuns||e.runId===currentRunId));
 const runId=own.some(e=>e.runId===currentRunId)?currentRunId:own.at(-1)?.runId;if(!runId)return null;
 const eligible=rows.filter(e=>e.runId===runId&&(e.residentId===residentId||e.residentId==='planner')&&e.tick<=maxTick).sort((a,b)=>a.tick-b.tick);
 // Repetitive sensory memories must not crowd actual outcomes out of the input.
 const chosen=new Map<string,JournalEntry>();
 for(const e of eligible.filter(e=>['action','decision','world'].includes(e.category)).slice(-80))chosen.set(e.id,e);
 for(const e of eligible.filter(e=>e.category==='speech').slice(-20))chosen.set(e.id,e);
 for(const e of eligible.filter(e=>e.category==='memory').slice(-20))chosen.set(e.id,e);
 for(const e of eligible.slice().reverse()){if(chosen.size>=SUMMARY_ENTRY_LIMIT)break;chosen.set(e.id,e);}
 const selected=[...chosen.values()].sort((a,b)=>a.tick-b.tick);
 // Respect the HTTP byte limit even for very long action receipts.
 while(selected.length>1&&new TextEncoder().encode(JSON.stringify(selected)).length>210_000)selected.shift();
 return selected.length?validateSummaryRequest({schemaVersion:'1.0.0',requestId:crypto.randomUUID(),runId,residentId,residentName,entries:selected}):null;
}
export function restoreSummaries(raw:unknown):SavedSummary[]{
 if(!Array.isArray(raw))return [];const out:SavedSummary[]=[];
 for(const v of raw.slice(-40)){try{const r=v.response;const request=validateSummaryRequest({schemaVersion:'1.0.0',requestId:r.requestId,runId:r.runId,residentId:r.residentId,residentName:'档案居民',entries:v.entries});const response=validateSummaryResponse(r,request);if(typeof v.createdAt==='string')out.push({response,entries:request.entries,createdAt:v.createdAt});}catch{}}
 return out;
}
export function latestSummary(saved:SavedSummary[],residentId:string,runId:string,maxTick=Infinity):SavedSummary|undefined{
 return saved.filter(s=>s.response.residentId===residentId&&s.response.runId===runId&&s.response.throughTick<=maxTick).at(-1);
}
