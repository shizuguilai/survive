import {validateSchema} from './validation.ts';
export type ControlMode='commander'|'independent'|'local';
export type ControlSettings={mode:ControlMode;fallback:boolean;residents:2|4|6;phaseUnits:4|8;reviewSeconds:30|60|120};
export const DEFAULT_CONTROL:ControlSettings={mode:'commander',fallback:true,residents:4,phaseUnits:4,reviewSeconds:30};
export function controlSettings(v:any):ControlSettings{return {mode:['commander','independent','local'].includes(v?.mode)?v.mode:DEFAULT_CONTROL.mode,fallback:typeof v?.fallback==='boolean'?v.fallback:DEFAULT_CONTROL.fallback,residents:[2,4,6].includes(v?.residents)?v.residents:4,phaseUnits:[4,8].includes(v?.phaseUnits)?v.phaseUnits:4,reviewSeconds:[30,60,120].includes(v?.reviewSeconds)?v.reviewSeconds:DEFAULT_CONTROL.reviewSeconds};}
export type CommandReport={residentId:string;name:string;body:string;working:string;recentResults:string[];knownLandmarks:string[];options:{id:string;label:string}[]};
export type CommandRequest={requestId:string;runId:string;tick:number;phaseUnits:number;tasks:{id:string;title:string;progress:number;amount:number}[];stock:{wood:number;stone:number;food:number};reports:CommandReport[]};
export type CommandPlan={summary:string;assignments:{residentId:string;objective:string}[]};
export type CommandResponse={requestId:string;source:'REAL_MODEL';model:'glm-4.5-air';plan:CommandPlan};
export interface CommandProvider{plan(request:CommandRequest,signal?:AbortSignal):Promise<CommandResponse>;}
const str={type:'string',minLength:1,maxLength:500},id={...str,maxLength:160};
const obj=(properties:any)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const list=(items:any,maxItems:number)=>({type:'array',items,maxItems});
export function validateCommandRequest(v:unknown):CommandRequest{
 validateSchema(v,obj({requestId:id,runId:id,tick:{type:'integer',minimum:0},phaseUnits:{enum:[4,8]},tasks:list(obj({id,title:str,progress:{type:'integer',minimum:0},amount:{type:'integer',minimum:1}}),6),stock:obj({wood:{type:'integer',minimum:0},stone:{type:'integer',minimum:0},food:{type:'integer',minimum:0}}),reports:{...list(obj({residentId:id,name:str,body:str,working:str,recentResults:list(str,4),knownLandmarks:list(str,16),options:{...list(obj({id,label:str}),12),minItems:1}}),6),minItems:1}}));
 const r=v as CommandRequest;if(new Set(r.reports.map(x=>x.residentId)).size!==r.reports.length)throw Error('Duplicate resident report');return r;
}
export function validateCommandPlan(v:unknown,r:CommandRequest):CommandPlan{
 validateSchema(v,obj({summary:str,assignments:{...list(obj({residentId:id,objective:id}),6),minItems:1}}));const p=v as CommandPlan;
 if(p.assignments.length!==r.reports.length||new Set(p.assignments.map(a=>a.residentId)).size!==r.reports.length)throw Error('Every resident needs exactly one assignment');
 for(const a of p.assignments)if(!r.reports.find(x=>x.residentId===a.residentId)?.options.some(o=>o.id===a.objective))throw Error('Assignment must select this resident’s offered objective');return p;
}
