import decisionSchema from '../schemas/agent-decision.schema.json' with {type:'json'};
import observationSchema from '../schemas/private-observation.schema.json' with {type:'json'};
import type {BrainRequest, CharacterContext, Decision, Observation} from './types.ts';
import {hashCanonical} from './canonical.ts';

export class ContractError extends Error {
  code = 'CONTRACT_INVALID';
  constructor(message: string) { super(message); this.name = 'ContractError'; }
}
type Schema = Record<string, any>;
const fail = (path: string, reason: string): never => { throw new ContractError(`${path}: ${reason}`); };
/** Implements every validation keyword used by the shipped, closed DTO schemas. */
export function validateSchema(value: unknown, schema: Schema, path = '$'): void {
  if (schema.oneOf) {
    let successes = 0;
    for (const variant of schema.oneOf) { try { validateSchema(value, variant, path); successes++; } catch (error) { if (!(error instanceof ContractError)) throw error; } }
    if (successes !== 1) fail(path, 'must match exactly one allowed shape');
  }
  if (schema.anyOf && !schema.anyOf.some((variant:Schema) => { try {validateSchema(value,variant,path);return true;} catch(error) {if (!(error instanceof ContractError)) throw error;return false;} })) fail(path, 'invalid allowed value');
  if ('const' in schema && value !== schema.const) fail(path, 'invalid constant');
  if (schema.enum && !schema.enum.includes(value)) fail(path, 'outside allowed values');
  const matches: Record<string, boolean> = {
    object: value !== null && typeof value === 'object' && !Array.isArray(value), array: Array.isArray(value),
    string: typeof value === 'string', number: typeof value === 'number' && Number.isFinite(value),
    integer: typeof value === 'number' && Number.isSafeInteger(value), boolean: typeof value === 'boolean', null: value === null
  };
  if (schema.type && !matches[schema.type]) fail(path, `expected ${schema.type}`);
  if (typeof value === 'string') {
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) fail(path, 'text length outside range');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(path, 'invalid reference format');
  }
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) fail(path, 'number outside range');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail(path, 'array length outside range');
    if (schema.items) value.forEach((item,index) => validateSchema(item,schema.items,`${path}[${index}]`));
  }
  if (matches.object) {
    const object = value as Record<string, unknown>;
    if (Object.getPrototypeOf(object) !== Object.prototype) fail(path, 'plain object required');
    for (const key of schema.required ?? []) if (!Object.hasOwn(object,key)) fail(`${path}.${key}`, 'required');
    for (const key of Object.keys(object)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail(path, 'unsafe property');
      if (Object.hasOwn(schema.properties ?? {}, key)) validateSchema(object[key],schema.properties[key],`${path}.${key}`);
      else if (schema.additionalProperties === false) fail(path, 'unexpected property');
    }
  }
}
const text = (maxLength=1000):Schema => ({type:'string',minLength:1,maxLength});
const ref:Schema={type:'string',minLength:1,maxLength:80,pattern:'^[A-Za-z0-9_-]+$'};
const object = (properties:Record<string,Schema>):Schema=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const array = (items:Schema,maxItems:number):Schema=>({type:'array',items,minItems:0,maxItems});
const actionSchema = decisionSchema.properties.actions.items;
const contextSchema = object({
  schemaVersion:{const:'1.0.0'}, identity:object({name:text(80),background:text(2000),personality:text(1000),personalGoal:text(1000)}),
  experiencedWhen:text(80), body:object({hunger:text(120),fatigue:text(120),pain:text(120)}),
  currentPlan:object({goal:{type:'string',maxLength:300},actions:array(actionSchema,16),progress:{type:'string',maxLength:2000}}),
  observations:array(observationSchema,128),
  memories:array(object({ref,kind:{enum:['direct','hearsay','belief','summary']},text:text(2000),evidenceRefs:array(ref,64),experiencedWhen:text(80)}),128),
  knownTargets:array(object({ref,description:text(1000),lastObservedWhen:text(80)}),128),
  allowedActions:{type:'array',items:{enum:decisionSchema.properties.actions.items.oneOf.map(a=>a.properties.op.const)},minItems:1,maxItems:24}
});
const metadataSchema=object({runId:ref,barrierId:ref,agentId:ref,requestId:ref,generation:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},tick:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},snapshotHash:text(100),contextHash:text(100),schemaVersion:{const:'1.0.0'}});
export function validateObservation(value:unknown):Observation { validateSchema(value,observationSchema);return value as Observation; }
export function validateCharacterContext(value: unknown): CharacterContext {
  validateSchema(value,contextSchema);
  const context=value as CharacterContext;
  const unique = (refs:string[],path:string)=>{if(new Set(refs).size!==refs.length)fail(path,'duplicate reference');};
  unique(context.observations.map(o=>o.obsRef),'$.observations');unique(context.memories.map(m=>m.ref),'$.memories');unique(context.knownTargets.map(t=>t.ref),'$.knownTargets');
  const known = new Set(context.knownTargets.map(t=>t.ref));
  for (const observation of context.observations) for (const key of ['knownRef','speakerKnownRef']) {
    const target=observation.detail[key];if(target!==undefined && target!==null && !known.has(target))fail('$.observations','unknown personal reference');
  }
  return context;
}
export function validateBrainRequest(value: unknown): BrainRequest {
  validateSchema(value,object({metadata:metadataSchema,context:contextSchema}));
  const request=value as BrainRequest;validateCharacterContext(request.context);
  if(request.metadata.contextHash!==hashCanonical(request.context))fail('$.metadata.contextHash','context fingerprint mismatch');
  return request;
}
const channels:Record<string,string[]>={craft:['hands','locomotion'],exchange:['hands','locomotion'],withdraw:['hands','locomotion'],walk:['locomotion'],look:['head'],listen:['hearing'],gather:['hands','locomotion'],haul:['hands','locomotion'],build:['hands','locomotion'],eat:['hands','mouth'],rest:['locomotion','hands'],speak:['mouth'],read_notice:['head'],write_notice:['hands'],propose_project:['mouth'],accept_task:[],decline_task:[],continue:[],equip_item:['hands'],unequip_item:['hands']};
export function validateDecision(value: unknown, context: CharacterContext): Decision {
  validateSchema(value,decisionSchema);
  const decision=value as Decision;
  const known=new Set(context.knownTargets.map(t=>t.ref));
  const evidence=new Set([...context.observations.map(o=>o.obsRef),...context.memories.map(m=>m.ref)]);
  const validateEvidence=(refs:string[])=>{for(const id of refs)if(!evidence.has(id))fail('$.evidenceRefs','reference is not in personal evidence');};
  const occupied=new Set<string>();
  let previousStage=-1;
  for(const action of decision.actions){
    if(!context.allowedActions.includes(action.op))fail('$.actions','action not available to this resident');
    if(action.stage<previousStage)fail('$.actions','stages must be ordered');previousStage=action.stage;
    for(const [key,target] of Object.entries(action.params)){
      if(key.endsWith('Ref') && target!==null && !known.has(target as string))fail('$.actions.params','reference is not in personal known targets');
      if(key==='evidenceRefs')validateEvidence(target as string[]);
    }
    for(const channel of action.op==='wait'?[action.params.scope]:channels[action.op]??[]){
      const lock=`${action.stage}:${channel}`;
      if(occupied.has(lock))fail('$.actions','body channel conflict within stage');occupied.add(lock);
    }
    if(action.op==='continue' && (!context.currentPlan.actions.length || decision.actions.length!==1))fail('$.actions','continue requires an existing plan and must stand alone');
  }
  if(decision.decisionKind==='continue' && (decision.actions.length!==1||decision.actions[0].op!=='continue'))fail('$.decisionKind','continue must retain the existing plan using exactly one action {"op":"continue","stage":0,"params":{}}; do not repeat the original walk/speak actions');
  for(const watch of decision.watch)if(watch.knownRef!==null&&!known.has(watch.knownRef))fail('$.watch','unknown personal reference');
  for(const memory of decision.memorySuggestions)validateEvidence(memory.evidenceRefs);
  return decision;
}
