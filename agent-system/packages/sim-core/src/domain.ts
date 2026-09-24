import type {Action,Decision,Memory,Observation,Vec3} from '../../contracts/src/types.ts';
import type {CharacterState} from './character.ts';
export type KnowledgeEntry = {ref:string;entityId:string;description:string;lastPosition:Vec3;lastSeenTick:number;visible:boolean;recognizedName:string|null};
export type ActionProgress = {action:Action;elapsedTicks:number;startedTick:number|null;emittedChars:number;done:boolean;targetPosition?:Vec3};
export type Resident = {
  character?:CharacterState;
  id:string;name:string;background:string;personality:string;personalGoal:string;position:Vec3;heading:number;
  hunger:number;fatigue:number;pain:number;inventory:number;
  known:Record<string,KnowledgeEntry>;familiar:Record<string,string>;observations:Observation[];memories:Memory[];
  observationSequence:number;knowledgeSequence:number;consumedObservationRefs:string[];
  goal:string;plan:ActionProgress[];suspendedPlan:ActionProgress[];nextReviewTick:number;lastDecision:Decision|null;
  bodyBands:Record<string,string>;visualSignature:string;actionFeedback:string[];
};
export type WorldObject = {id:string;kind:'tree'|'wall';position:Vec3;width:number;height:number;depth:number;appearance:string;resources:number};
export type SoundFragment = {id:string;sourceId:string;position:Vec3;heading:number;text:string;volume:'whisper'|'normal'|'shout';emittedTick:number;deliveredTo:string[]};
export type World = {schemaVersion:'1.0.0';runId:string;tick:number;revision:number;seed:number;rngState:number;residents:Resident[];objects:WorldObject[];sounds:SoundFragment[];daylight:number;weatherProgress:number;events:{tick:number;kind:string;agentId:string;text:string}[]};
export type SensoryOverlay = {agentId:string;tick:number;eye:Vec3;heading:number;visionRange:number;fovDegrees:number;visionPolygon:Vec3[];hearingRadii:{label:string;radius:number}[];visibleRefs:string[];lastKnown:{ref:string;position:Vec3;tick:number;description:string}[];observations:Observation[]};
