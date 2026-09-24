import defaults from '../defaults.json' with { type: 'json' };
import type { CharacterContext, Observation, Vec3 } from '../../contracts/src/types.ts';
import type { KnowledgeEntry, Resident, SensoryOverlay, SoundFragment, World, WorldObject } from './domain.ts';
import { experiencedWhen, privateAction, privateMemory, privateObservation, rememberObservation } from './knowledge.ts';
import {skillLevel} from './recipes.ts';
import { listOwnEquipment, publicCharacterSummary } from './character.ts';

const DT = defaults.simulation.fixedDtMs;
const VISION = defaults.vision;
const HEARING = defaults.hearing;
const SCAN_TICKS = Math.max(1, Math.round(VISION.scanEverySimMs / DT));
// Only observed absence counts; brief turns/occlusion stay in the same encounter.
const ENCOUNTER_ABSENCE_TICKS = Math.ceil(2000 / DT);
const DIRECTIONS = ['front', 'front_right', 'right', 'back_right', 'back', 'back_left', 'left', 'front_left'];
const ALLOWED = ['continue', 'walk', 'look', 'listen', 'gather', 'rest', 'speak', 'wait', 'equip_item', 'unequip_item'];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const planarDistance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const angleDifference = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const eyePosition = (resident: Resident): Vec3 => ({ x: resident.position.x, y: resident.position.y + 1.6, z: resident.position.z });
const distanceBand = (distance: number) => distance < 3 ? 'near' : distance < 7 ? 'medium' : 'far';

function direction(resident: Resident, target: Vec3): string {
  const angle = angleDifference(Math.atan2(target.z - resident.position.z, target.x - resident.position.x) - resident.heading);
  return DIRECTIONS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}

/** Segment/AABB intersection. Positions use y as the object's ground/base. */
function intersectsBox(start: Vec3, end: Vec3, object: WorldObject): number | null {
  const min = { x: object.position.x - object.width / 2, y: object.position.y, z: object.position.z - object.depth / 2 };
  const max = { x: object.position.x + object.width / 2, y: object.position.y + object.height, z: object.position.z + object.depth / 2 };
  let entry = 0, exit = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-10) {
      if (start[axis] < min[axis] || start[axis] > max[axis]) return null;
    } else {
      const a = (min[axis] - start[axis]) / delta, b = (max[axis] - start[axis]) / delta;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (entry > exit) return null;
    }
  }
  return entry < 1 - 1e-7 && exit > 1e-7 ? Math.max(entry, 0) : null;
}

function wallHits(world: World, start: Vec3, end: Vec3, exceptId?: string): WorldObject[] {
  return world.objects.filter(object => object.kind === 'wall' && object.id !== exceptId && intersectsBox(start, end, object) !== null);
}

type VisualCandidate = { id: string; position: Vec3; height: number; appearance: string; resident: boolean };

function visibleFraction(world: World, observer: Resident, candidate: VisualCandidate): number {
  const distance = planarDistance(observer.position, candidate.position);
  if (distance > VISION.rangeWorldUnits || distance < 1e-7) return 0;
  const horizontal = Math.abs(angleDifference(Math.atan2(candidate.position.z - observer.position.z, candidate.position.x - observer.position.x) - observer.heading));
  if (horizontal > VISION.horizontalFovDegrees * Math.PI / 360) return 0;
  const eye = eyePosition(observer);
  let visible = 0;
  for (const factor of [0.1, 0.55, 0.95]) {
    const sample = { ...candidate.position, y: candidate.position.y + candidate.height * factor };
    if (Math.abs(Math.atan2(sample.y - eye.y, distance)) > VISION.verticalFovDegrees * Math.PI / 360) continue;
    if (!wallHits(world, eye, sample, candidate.id).length) visible++;
  }
  return visible / 3;
}

function appendObservation(world: World, resident: Resident, modality: Observation['modality'], detail: Observation['detail'], certainty: Observation['certainty']): void {
  const observation: Observation = { obsRef: `observation_${++resident.observationSequence}`, experiencedWhen: experiencedWhen(world.tick, DT), modality, detail, certainty };
  resident.observations.push(observation);
  rememberObservation(resident, observation);
}

function knownForEntity(resident: Resident, id: string): KnowledgeEntry | undefined {
  return Object.values(resident.known).find(entry => entry.entityId === id);
}

function vision(world: World, resident: Resident): boolean {
  const wasVisible = Object.values(resident.known).filter(entry => entry.visible);
  for (const entry of wasVisible) entry.visible = false;
  const candidates: VisualCandidate[] = [
    ...world.residents.filter(other => other.id !== resident.id).map(other => ({ id: other.id, position: other.position, height: 1.8, appearance: other.character ? publicCharacterSummary(other.character) : '一个人', resident: true })),
    ...world.objects.map(object => ({ id: object.id, position: object.position, height: object.height, appearance: (object.appearance+(object.resourceKind&&object.resources<=0?'；已经采空':'')).slice(0, 120), resident: false })),
  ];
  const percepts: { entry: KnowledgeEntry; person: boolean; entered: boolean; detail: Record<string, any>; certainty: Observation['certainty'] }[] = [];
  for (const candidate of candidates) {
    const fraction = visibleFraction(world, resident, candidate);
    if (!fraction || world.daylight <= 0.03) continue;
    const distance = planarDistance(resident.position, candidate.position);
    const described = fraction >= 2 / 3 && distance <= VISION.rangeWorldUnits * 0.75 && world.daylight >= 0.25;
    const familiarName = Object.hasOwn(resident.familiar, candidate.id) ? resident.familiar[candidate.id] : null;
    const recognizedName = candidate.resident && described && distance <= 5 && world.daylight >= 0.4 ? familiarName : null;
    const level = recognizedName ? 'recognized' : described ? 'described' : 'detected';
    const appearance = recognizedName ? [`你认出了${recognizedName}`, candidate.appearance] : described ? [candidate.appearance] : ['一个不太清晰的轮廓'];
    let entry = knownForEntity(resident, candidate.id);
    const entered = !entry || (!wasVisible.includes(entry) && world.tick - entry.lastSeenTick >= ENCOUNTER_ABSENCE_TICKS);
    if (!entry) {
      const ref = `known_${++resident.knowledgeSequence}`;
      entry = { ref, entityId: candidate.id, description: appearance.join('；'), lastPosition: { ...candidate.position }, lastSeenTick: world.tick, visible: true, recognizedName };
      resident.known[ref] = entry;
    }
    entry.description = appearance.join('；');
    entry.lastPosition = { ...candidate.position };
    entry.lastSeenTick = world.tick;
    entry.visible = true;
    entry.recognizedName = recognizedName;
    percepts.push({ entry, person: candidate.resident, entered, detail: { level, relativeDirection: direction(resident, candidate.position), distanceBand: distanceBand(distance), appearance, recognizedName, knownRef: entry.ref }, certainty: level === 'detected' ? 'uncertain' : 'clear' });
  }
  const signature = JSON.stringify(percepts.map(percept => percept.detail));
  let changed = false;
  const executing=resident.plan.some(p=>!p.done);
  const watched=(ref:string)=>resident.lastDecision?.watch.some(w=>['visual_enter','known_person_seen'].includes(w.kind)&&(w.knownRef===null||w.knownRef===ref));
  if (signature !== resident.visualSignature) {
    const oldDetails: Record<string, any>[] = (() => { try { return JSON.parse(resident.visualSignature || '[]'); } catch { return []; } })();
    for (const percept of percepts) {
      const previous = oldDetails.find(detail => detail.knownRef === percept.entry.ref);
      if (JSON.stringify(previous) !== JSON.stringify(percept.detail)) {
        appendObservation(world, resident, 'visual', percept.detail, percept.certainty);
        // Retinal changes still enter personal perception. They do not, by themselves,
        // require a new decision in the middle of a model-authored action.
        const person=percept.person;
        const meaningChanged=!previous||previous.level!==percept.detail.level||previous.recognizedName!==percept.detail.recognizedName||JSON.stringify(previous.appearance)!==JSON.stringify(percept.detail.appearance);
        const activeTarget=resident.plan.some(p=>!p.done&&Object.entries(p.action.params).some(([key,value])=>key.endsWith('Ref')&&value===percept.entry.ref));
        const targetContentChanged=activeTarget&&previous&&percept.detail.level!=='detected'&&JSON.stringify(previous.appearance)!==JSON.stringify(percept.detail.appearance);
        if(person ? percept.entered : !executing||meaningChanged&&(targetContentChanged||watched(percept.entry.ref)))changed=true;
      }
    }
    for (const entry of wasVisible.filter(entry => !entry.visible)) {
      appendObservation(world, resident, 'visual', {
        level: entry.recognizedName ? 'recognized' : 'detected', relativeDirection: direction(resident, entry.lastPosition),
        distanceBand: distanceBand(planarDistance(resident.position, entry.lastPosition)),
        appearance: [`先前看到的${entry.description}已离开视野；仅记得最后看到的位置。`.slice(0, 120)], recognizedName: entry.recognizedName, knownRef: entry.ref,
      }, 'uncertain');
      if(!world.residents.some(r=>r.id===entry.entityId)&&(!executing||watched(entry.ref)))changed=true;
    }
    resident.visualSignature = signature;
  }
  return changed;
}

function soundStrength(world: World, resident: Resident, sound: SoundFragment): number {
  const distance = planarDistance(resident.position, sound.position);
  const sourceLevel = HEARING.referenceSourceLevels[sound.volume];
  const end = eyePosition(resident), start = { ...sound.position, y: sound.position.y + 1.5 };
  const transmission = HEARING.transmission.woodenWall ** wallHits(world, start, end).length;
  return sourceLevel / (1 + (distance / HEARING.referenceDistanceWorldUnits) ** 2) * transmission;
}

function hearing(world: World, resident: Resident): boolean {
  let changed = false;
  for (const sound of world.sounds) {
    if (sound.sourceId === resident.id || sound.deliveredTo.includes(resident.id)) continue;
    const distance = planarDistance(resident.position, sound.position);
    const travelTicks = Math.max(HEARING.minimumDeliveryTicks, Math.ceil(distance / HEARING.propagationSpeedWorldUnitsPerSimSecond * 1000 / DT));
    if (world.tick < sound.emittedTick + travelTicks) continue;
    // A passed fragment is never recovered by approaching its historical source.
    sound.deliveredTo.push(resident.id);
    if (world.tick > sound.emittedTick + travelTicks) continue;
    const strength = soundStrength(world, resident, sound);
    const overlappingSources = new Map<string, number>();
    for (const other of world.sounds) {
      if (other.id === sound.id || other.sourceId === sound.sourceId || Math.abs(other.emittedTick - sound.emittedTick) > 4) continue;
      // Self speech masks incoming speech too; listener identity grants no bypass.
      if (other.emittedTick >= world.tick) continue;
      overlappingSources.set(other.sourceId, Math.max(overlappingSources.get(other.sourceId) ?? 0, soundStrength(world, resident, other)));
    }
    const interference = [...overlappingSources.values()].reduce((sum, value) => sum + value, 0);
    const masking = clamp(1 / (1 + 4 * interference), HEARING.maskingRange[0], HEARING.maskingRange[1]);
    const audibility = strength * masking;
    if (audibility < HEARING.detectThreshold) continue;
    const heardText = audibility >= HEARING.comprehendThreshold ? sound.text.slice(0, 300) : null;
    const name = Object.hasOwn(resident.familiar, sound.sourceId) && audibility >= HEARING.recognizeVoiceThreshold ? resident.familiar[sound.sourceId] : null;
    const known = name ? knownForEntity(resident, sound.sourceId) : undefined;
    appendObservation(world, resident, 'auditory', {
      soundKind: 'speech', relativeDirection: direction(resident, sound.position), distanceBand: distanceBand(distance),
      heardText, recognizedSpeakerName: name, speakerKnownRef: known?.ref ?? null,
    }, heardText ? 'clear' : 'uncertain');
    // One wake per actually heard utterance, even if a later chunk becomes clear,
    // mentions our name, or ends the sentence. No unheard future text is exposed.
    const key=sound.utteranceId??sound.id;
    const first=!resident.heardUtteranceKeys?.includes(key);
    if(first){resident.heardUtteranceKeys=[...(resident.heardUtteranceKeys??[]),key];changed=true;}
  }
  // Retain keys while any fragment of that utterance is still physically active.
  // A bounded tail covers the normal gaps between emitted fragments.
  if((resident.heardUtteranceKeys?.length??0)>64){
    const active=new Set(world.sounds.map(sound=>sound.utteranceId??sound.id));
    resident.heardUtteranceKeys=resident.heardUtteranceKeys!.filter((key,i,keys)=>i>=keys.length-64||active.has(key));
  }
  return changed;
}

function bodyBand(value: number, sense?: string): string { return value <= 0 || (sense !== 'pain' && value < 0.2) ? '舒适' : value < 0.5 ? '轻微' : value < 0.8 ? '明显' : '严重'; }

function bodily(world: World, resident: Resident): boolean {
  let changed = false;
  for (const sense of ['hunger', 'fatigue', 'pain'] as const) {
    const band = bodyBand(resident[sense], sense);
    if (resident.bodyBands[sense] !== band) {
      if (band !== '舒适') {
        appendObservation(world, resident, 'bodily', { bodyPart: sense === 'hunger' ? '腹部' : '身体', sensation: sense, intensity: band === '轻微' ? 'mild' : band === '明显' ? 'noticeable' : 'severe' }, 'clear');
        changed = true;
      }
      resident.bodyBands[sense] = band;
    }
  }
  const healthBand=(resident.health??100)<30?'severe':(resident.health??100)<70?'noticeable':'healthy';
  if(resident.bodyBands.health!==healthBand){resident.bodyBands.health=healthBand;if(healthBand!=='healthy'){appendObservation(world,resident,'bodily',{bodyPart:'身体',sensation:'pain',intensity:healthBand},'clear');changed=true;}}
  return changed;
}

/** Called only at startup or after a positive authoritative simulation tick. */
export function samplePerception(world: World): string[] {
  const due: string[] = [];
  for (const resident of world.residents) {
  for(const kind of ['wood','stone','food'] as const){if(!resident.supplies?.[kind])continue;const id=`supply-${kind}-${resident.id}`;let entry=Object.values(resident.known).find(k=>k.entityId===id);if(!entry){const ref=`known_${++resident.knowledgeSequence}`;entry={ref,entityId:id,description:'',lastPosition:{...resident.position},lastSeenTick:world.tick,visible:false,recognizedName:null};resident.known[ref]=entry;}entry.description=`自己携带的${kind==='wood'?'木材':kind==='stone'?'石料':'可食浆果'}${resident.supplies[kind]}份；可haul到公告板旁的公共仓储${kind==='food'?'，也可eat':''}`;entry.lastPosition={...resident.position};entry.lastSeenTick=world.tick;}
    const visual = world.tick % SCAN_TICKS === 0 || !resident.visualSignature ? vision(world, resident) : false;
    const auditory = hearing(world, resident);
    const body = bodily(world, resident);
    if (visual || auditory || body) due.push(resident.id);
  }
  return due;
}

/** Whitelist construction is deliberate: do not stringify/filter World. */
export function buildContext(world: World, resident: Resident): CharacterContext {
  const observations = resident.observations.slice(-24);
  const recentActions=resident.memories.filter(m=>m.ref.startsWith('memory_spoken_')||m.ref.startsWith('memory_action_')||m.ref.startsWith('memory_task_')).slice(-10);
  const selectedMemories = [...new Map([...resident.memories.slice(-24),...recentActions].map(m=>[m.ref,m])).values()];
  // Preserve source chains for summaries; do not turn absent evidence into facts.
  const selectedRefs = new Set(selectedMemories.map(memory => memory.ref));
  for (let index = 0; index < selectedMemories.length; index++) {
    for (const sourceRef of selectedMemories[index].evidenceRefs) {
      const source = resident.memories.find(memory => memory.ref === sourceRef);
      if (source && !selectedRefs.has(source.ref)) { selectedMemories.push(source); selectedRefs.add(source.ref); }
      const observation = resident.observations.find(item => item.obsRef === sourceRef);
      if (observation && !observations.some(item => item.obsRef === sourceRef)) observations.push(observation);
    }
  }
  return {
    schemaVersion: '1.0.0',
    identity: { name: resident.name, background: resident.background, personality: resident.personality, personalGoal: resident.personalGoal },
    experiencedWhen: experiencedWhen(world.tick, DT),
    body: { hunger: bodyBand(resident.hunger, 'hunger'), fatigue: bodyBand(resident.fatigue, 'fatigue'), pain: bodyBand(resident.pain, 'pain')+`；自身生命${Math.round(resident.health??100)}/100${(resident.health??100)<30?'，虚弱，行动缓慢':''}` },
    currentPlan: { goal: ((resident.plan.length&&!resident.plan.some(p=>!p.done)?'（计划已完成，需要考虑后续行动）':'')+resident.goal).slice(0,300), actions: resident.plan.filter(progress=>!progress.done).map(progress => privateAction(progress.action)), progress: (resident.plan.length ? `${resident.plan.filter(progress => progress.done).length}/${resident.plan.length}项行动完成` : '尚无行动计划') + (resident.supplies?`；自己携带：木材${resident.supplies.wood??0}、石料${resident.supplies.stone??0}、浆果${resident.supplies.food??0}，容量30。自身熟练度：采集${skillLevel(resident.skills?.gathering)}级，加工${skillLevel(resident.skills?.crafting)}级，建造${skillLevel(resident.skills?.construction)}级。`:'') + (resident.actionFeedback.length ? `；最近自身行动反馈：${resident.actionFeedback.slice(-3).join('；')}` : '') },
    observations: observations.map(privateObservation), memories: selectedMemories.map(privateMemory),
    knownTargets: [
      ...Object.values(resident.known).filter(entry=>!entry.entityId.startsWith('supply-')).map(entry => ({ ref: entry.ref, description: `${entry.description}；距其最后已知位置约${planarDistance(resident.position,entry.lastPosition).toFixed(1)}米；${entry.visible ? '目前可见' : '仅最后已知，当前位置未知'}`, lastObservedWhen: experiencedWhen(entry.lastSeenTick, DT) })),
      ...Object.values(resident.known).filter(entry=>(['wood','stone','food'] as const).some(kind=>entry.entityId===`supply-${kind}-${resident.id}`&&resident.supplies?.[kind])).map(entry=>({ref:entry.ref,description:entry.description,lastObservedWhen:experiencedWhen(world.tick,DT)})),
      ...(resident.character ? listOwnEquipment(resident.character, resident.id).map(item => ({
        ref: item.itemRef,
        description: `自己持有：${item.label}；${item.equippedSlots.length ? `当前穿戴/持握于 ${item.equippedSlots.join('、')}` : '目前收纳，未装备'}；可装备位置 ${item.allowedSlots.join('、')}；需要${item.hands}只手。`,
        lastObservedWhen: experiencedWhen(world.tick, DT),
      })) : []),
    ],
    allowedActions: [...ALLOWED,...(world.camp?['read_notice','accept_task','decline_task','haul','withdraw','build',...(Object.values(resident.known).some(k=>k.entityId.startsWith('recipe:'))?['craft','exchange']:[]),...(resident.supplies?.food?['eat']:[])]:[])].filter(action => resident.character || !['equip_item', 'unequip_item'].includes(action)),
  };
}

/** Read-only render DTO. Rays terminate at actual walls; no random sampling. */
export function getOverlay(world: World, resident: Resident): SensoryOverlay {
  const eye = eyePosition(resident);
  const halfFov = VISION.horizontalFovDegrees * Math.PI / 360;
  const polygon: Vec3[] = [{ ...resident.position }];
  for (let index = 0; index <= 72; index++) {
    const angle = resident.heading - halfFov + 2 * halfFov * index / 72;
    const end = { x: eye.x + Math.cos(angle) * VISION.rangeWorldUnits, y: eye.y, z: eye.z + Math.sin(angle) * VISION.rangeWorldUnits };
    let fraction = 1;
    for (const wall of world.objects.filter(object => object.kind === 'wall')) {
      const hit = intersectsBox(eye, end, wall);
      if (hit !== null) fraction = Math.min(fraction, hit);
    }
    polygon.push({ x: eye.x + (end.x - eye.x) * fraction, y: resident.position.y, z: eye.z + (end.z - eye.z) * fraction });
  }
  return {
    agentId: resident.id, tick: world.tick, eye, heading: resident.heading, visionRange: VISION.rangeWorldUnits, fovDegrees: VISION.horizontalFovDegrees,
    visionPolygon: polygon,
    hearingRadii: (['whisper', 'normal', 'shout'] as const).map(volume => ({ label: `${volume === 'whisper' ? '低声' : volume === 'normal' ? '普通说话' : '呼喊'}参考环（无墙、无噪声）`, radius: HEARING.referenceDistanceWorldUnits * Math.sqrt(HEARING.referenceSourceLevels[volume] / HEARING.detectThreshold - 1) })),
    visibleRefs: Object.values(resident.known).filter(entry => entry.visible).map(entry => entry.ref),
    lastKnown: Object.values(resident.known).filter(entry => !entry.visible).map(entry => ({ ref: entry.ref, position: { ...entry.lastPosition }, tick: entry.lastSeenTick, description: entry.description })),
    observations: resident.observations.slice(-12).map(privateObservation),
  };
}
