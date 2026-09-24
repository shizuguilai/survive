export type Vec3 = { x: number; y: number; z: number };
export type Action = { op: string; stage: number; params: Record<string, any> };
export type Decision = {
  schemaVersion: '1.0.0'; decisionKind: 'continue'|'adjust'|'replace'|'suspend'|'cancel';
  goal: string; reasonBrief: string; actions: Action[]; nextReviewAfterSimMs: number;
  watch: {kind: string; knownRef: string|null}[];
  memorySuggestions: {kind:'belief'|'summary';text:string;evidenceRefs:string[]}[];
};
export type Observation = {obsRef:string;experiencedWhen:string;certainty:'uncertain'|'likely'|'clear';modality:'visual'|'auditory'|'bodily';detail:Record<string,any>};
export type Memory = {ref:string;kind:'direct'|'hearsay'|'belief'|'summary';text:string;evidenceRefs:string[];experiencedWhen:string};
export type CharacterContext = {
  schemaVersion:'1.0.0'; identity:{name:string;background:string;personality:string;personalGoal:string};
  experiencedWhen:string; body:{hunger:string;fatigue:string;pain:string};
  currentPlan:{goal:string;actions:Action[];progress:string};
  observations:Observation[]; memories:Memory[];
  knownTargets:{ref:string;description:string;lastObservedWhen:string}[];
  allowedActions:string[];
};
export type RequestMetadata = {runId:string;barrierId:string;agentId:string;requestId:string;generation:number;tick:number;snapshotHash:string;contextHash:string;schemaVersion:'1.0.0'};
export type BrainRequest = {metadata:RequestMetadata;context:CharacterContext};
export type BrainResponse = {metadata:RequestMetadata;decision:Decision;source:'REAL_MODEL'|'MOCK_TEST';model:string};
export interface BrainProvider { decide(request:BrainRequest, signal?:AbortSignal):Promise<BrainResponse>; }
