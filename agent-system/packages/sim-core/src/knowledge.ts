import type { Action, Decision, Memory, Observation } from '../../contracts/src/types.ts';
import type { KnowledgeEntry, Resident } from './domain.ts';

/** A reference has meaning only inside the owner's capability map. */
export function resolveKnownTarget(resident: Resident, ref: unknown): KnowledgeEntry | null {
  if (typeof ref !== 'string' || !Object.hasOwn(resident.known, ref)) return null;
  const entry = resident.known[ref];
  if (entry.ref !== ref) return null;
  return { ...entry, lastPosition: { ...entry.lastPosition } };
}

export function requireKnownTarget(resident: Resident, ref: unknown): KnowledgeEntry {
  const entry = resolveKnownTarget(resident, ref);
  // Identical errors for an existing global entity ID and a nonexistent ID.
  if (!entry) throw new Error('目标不在你的已知线索中。');
  return entry;
}

export function experiencedWhen(tick: number, fixedDtMs = 50): string {
  const seconds = Math.floor(tick * fixedDtMs / 1000);
  return `今天开始后${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export function rememberObservation(resident: Resident, observation: Observation): void {
  const ref = `memory_${observation.obsRef}`;
  if (resident.memories.some(memory => memory.ref === ref)) return;
  let text: string;
  let kind: Memory['kind'] = 'direct';
  if (observation.modality === 'visual') {
    text = `亲眼观察：${observation.detail.appearance.join('；')}（${observation.certainty === 'clear' ? '清楚' : '不完全确定'}）。`;
  } else if (observation.modality === 'auditory') {
    if (observation.detail.heardText) {
      kind = 'hearsay';
      text = `听到${observation.detail.recognizedSpeakerName ?? '一个未认出的人'}说：“${observation.detail.heardText}”。话语内容未经亲见确认。`;
    } else {
      text = '听到有人说话，但没有听清内容，也不知道其意图。';
    }
  } else {
    text = `自身感受：${observation.detail.bodyPart}，${observation.detail.sensation}，${observation.detail.intensity}。`;
  }
  resident.memories.push({ ref, kind, text, evidenceRefs: [observation.obsRef], experiencedWhen: observation.experiencedWhen });
}

/** Suggestions may add a belief/summary, never a direct observation. */
export function addModelMemories(resident: Resident, suggestions: Decision['memorySuggestions'], tick: number): void {
  const ownedSources = new Set([
    ...resident.observations.map(observation => observation.obsRef),
    ...resident.memories.map(memory => memory.ref),
  ]);
  for (const suggestion of suggestions) {
    if (!['belief', 'summary'].includes(suggestion.kind) || !suggestion.text.trim()) continue;
    if (!suggestion.evidenceRefs.length || suggestion.evidenceRefs.some(ref => !ownedSources.has(ref))) continue;
    const kind = suggestion.kind;
    const prefix = kind === 'belief' ? '个人推测，尚未证实：' : '个人摘要，原始来源及不确定性仍有效：';
    const ref = `memory_note_${resident.memories.length + 1}`;
    resident.memories.push({ ref, kind, text: prefix + suggestion.text.slice(0, 800), evidenceRefs: [...new Set(suggestion.evidenceRefs)], experiencedWhen: experiencedWhen(tick) });
    ownedSources.add(ref);
  }
}

const actionFields: Record<string, string[]> = {
  craft:['stationRef','recipeRef'],exchange:['stationRef','recipeRef'],withdraw:['storageRef','resource','amount'],build:['projectRef','stepRef'],
  haul:['sourceRef','destinationRef','amount'],
  read_notice:['noticeRef'],accept_task:['taskRef','evidenceRefs'],decline_task:['taskRef','reason'],eat:['foodRef','amount'],
  survey:['durationSimMs'], continue: [], walk: ['targetRef', 'gait'], look: ['targetRef'], listen: ['durationSimMs'],
  gather: ['targetRef', 'amount'], rest: ['placeRef', 'durationSimMs'],
  speak: ['text', 'volume', 'towardRef'], wait: ['durationSimMs', 'scope'],
  equip_item: ['itemRef', 'slot'], unequip_item: ['itemRef'],
};

/** A new DTO: never return plan/domain object aliases or arbitrary metadata. */
export function privateAction(action: Action): Action {
  const params: Record<string, any> = {};
  for (const key of actionFields[action.op] ?? []) {
    const value = action.params[key];
    if(Array.isArray(value)&&value.every(v=>typeof v==='string'))params[key]=[...value];
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') params[key] = value;
  }
  return { op: action.op, stage: action.stage, params };
}

export function privateObservation(observation: Observation): Observation {
  const detail = observation.detail;
  let safe: Record<string, any>;
  if (observation.modality === 'visual') {
    safe = { level: detail.level, relativeDirection: detail.relativeDirection, distanceBand: detail.distanceBand,
      appearance: [...detail.appearance], recognizedName: detail.recognizedName, knownRef: detail.knownRef };
  } else if (observation.modality === 'auditory') {
    safe = { soundKind: detail.soundKind, relativeDirection: detail.relativeDirection, distanceBand: detail.distanceBand,
      heardText: detail.heardText, recognizedSpeakerName: detail.recognizedSpeakerName, speakerKnownRef: detail.speakerKnownRef };
  } else {
    safe = { bodyPart: detail.bodyPart, sensation: detail.sensation, intensity: detail.intensity };
  }
  return { obsRef: observation.obsRef, experiencedWhen: observation.experiencedWhen, certainty: observation.certainty, modality: observation.modality, detail: safe };
}

export function privateMemory(memory: Memory): Memory {
  return { ref: memory.ref, kind: memory.kind, text: memory.text, evidenceRefs: [...memory.evidenceRefs], experiencedWhen: memory.experiencedWhen };
}
