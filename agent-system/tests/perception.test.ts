import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../packages/sim-core/src/world.ts';
import { buildContext, getOverlay, samplePerception } from '../packages/sim-core/src/perception.ts';
import { addModelMemories, privateAction, requireKnownTarget, resolveKnownTarget } from '../packages/sim-core/src/knowledge.ts';
import { createCharacterState, applyEquipmentAction } from '../packages/sim-core/src/character.ts';
import { validateCharacterContext, validateObservation } from '../packages/contracts/src/validation.ts';
import type { World, SoundFragment } from '../packages/sim-core/src/domain.ts';

function scene(): World {
  const world = createWorld({ runId: 'test-private-perception', seed: 42 });
  world.objects = [];
  for (const resident of world.residents) resident.character = undefined;
  return world;
}
function fragment(world: World, text = '你好呀', overrides: Partial<SoundFragment> = {}): SoundFragment {
  const speaker = world.residents[1];
  return { id: 'sound-secret-id', sourceId: speaker.id, position: { ...speaker.position }, heading: speaker.heading, text, volume: 'normal', emittedTick: world.tick, deliveredTo: [], ...overrides };
}
function wall(world: World, height = 3): void {
  world.objects.push({ id: 'wall-secret-id', kind: 'wall', position: { x: 0, y: 0, z: 0 }, width: .3, height, depth: 8, appearance: '一面墙', resources: 0 });
}

test('P01/P02: front/behind/range and three-point occlusion control identity disclosure', () => {
  const world = scene(), observer = world.residents[0], target = world.residents[1];
  observer.position.x = -2; target.position.x = 2; wall(world, 1.5);
  samplePerception(world);
  const known = Object.values(observer.known).find(entry => entry.entityId === target.id)!;
  const partial = observer.observations.find(observation => observation.detail.knownRef === known.ref)!;
  assert.equal(partial.detail.level, 'detected'); assert.equal(partial.detail.recognizedName, null);
  world.objects = []; world.tick = 4; samplePerception(world);
  assert.equal(observer.observations.filter(observation => observation.detail.knownRef === known.ref).at(-1)!.detail.level, 'recognized');
  target.position = { x: -6, y: 0, z: 0 }; world.tick = 8; samplePerception(world);
  assert.equal(known.visible, false);
  target.position = { x: 50, y: 0, z: 0 }; world.tick = 12; samplePerception(world);
  assert.equal(known.visible, false);
  for (const observation of observer.observations) validateObservation(observation);
});

test('P02: unfamiliar visible resident is anonymous, even when engine knows their name', () => {
  const world = scene(), observer = world.residents[0]; observer.familiar = {};
  world.residents[1].name = '隐藏姓名_不许泄露'; samplePerception(world);
  const visual = observer.observations.find(observation => observation.modality === 'visual')!;
  assert.equal(visual.detail.level, 'described'); assert.equal(visual.detail.recognizedName, null);
  assert.ok(!JSON.stringify(buildContext(world, observer)).includes('隐藏姓名_不许泄露'));
});

test('P03: last-known target capability stays at the last seen point while hidden', () => {
  const world = scene(), observer = world.residents[0], target = world.residents[1];
  samplePerception(world);
  const known = Object.values(observer.known).find(entry => entry.entityId === target.id)!;
  const lastPosition = { ...known.lastPosition }, lastTick = known.lastSeenTick;
  wall(world); target.position.x = 9; world.tick = 4; samplePerception(world);
  target.position.z = 3; world.tick = 8; samplePerception(world);
  assert.deepEqual(resolveKnownTarget(observer, known.ref)!.lastPosition, lastPosition);
  assert.equal(known.lastSeenTick, lastTick); assert.equal(known.visible, false);
  const overlay = getOverlay(world, observer);
  assert.deepEqual(overlay.lastKnown.find(entry => entry.ref === known.ref)!.position, lastPosition);
});

test('K01: hidden names, inventory, private memories and positions do not change final context bytes', () => {
  const a = scene(); a.residents[1].position = { x: -30, y: 0, z: 0 };
  const b = structuredClone(a);
  b.residents[1].name = '秘密名'; b.residents[1].inventory = 987654;
  b.residents[1].position = { x: -90, y: 0, z: 9 };
  b.residents[1].memories.push({ ref: 'secret_other_memory', kind: 'belief', text: '私下计划', evidenceRefs: [], experiencedWhen: '很久前' });
  b.rngState = 90909;
  samplePerception(a); samplePerception(b);
  assert.equal(JSON.stringify(buildContext(a, a.residents[0])), JSON.stringify(buildContext(b, b.residents[0])));
});

test('K02: guessed global IDs and unknown references return identical capability errors', () => {
  const world = scene(), observer = world.residents[0]; samplePerception(world);
  assert.equal(resolveKnownTarget(observer, world.residents[1].id), null);
  let first = '', second = '';
  try { requireKnownTarget(observer, world.residents[1].id); } catch (error) { first = (error as Error).message; }
  try { requireKnownTarget(observer, 'nonexistent'); } catch (error) { second = (error as Error).message; }
  assert.equal(first, second);
  assert.equal(resolveKnownTarget(observer, '__proto__'), null);
  const bytes = JSON.stringify(buildContext(world, observer));
  for (const entity of [...world.residents, ...world.objects]) assert.ok(!bytes.includes(entity.id), entity.id);
});

test('P04/P05: walls attenuate speech without smuggling unheard text into memories or payload', () => {
  const world = scene(), observer = world.residents[0]; wall(world);
  world.sounds.push(fragment(world, '墙后秘密完整台词_不能泄露'));
  world.tick = 1; samplePerception(world);
  const sound = observer.observations.find(observation => observation.modality === 'auditory')!;
  assert.ok(sound); assert.equal(sound.detail.heardText, null); assert.equal(sound.detail.recognizedSpeakerName, null);
  const bytes = JSON.stringify(buildContext(world, observer));
  assert.ok(!bytes.includes('墙后秘密完整台词')); assert.ok(!bytes.includes('sound-secret-id'));
  validateCharacterContext(buildContext(world, observer));
});

test('P05: familiar voice recognition is thresholded; unknown clear speech remains anonymous', () => {
  const world = scene(), observer = world.residents[0]; observer.familiar = {};
  world.sounds.push(fragment(world)); world.tick = 1; samplePerception(world);
  const sound = observer.observations.find(observation => observation.modality === 'auditory')!;
  assert.equal(sound.detail.heardText, '你好呀'); assert.equal(sound.detail.recognizedSpeakerName, null);
  assert.equal(sound.detail.speakerKnownRef, null);
});

test('P06/TM09: emitted fragments arrive on positive ticks once; future and out-of-range suffixes do not', () => {
  const world = scene(), observer = world.residents[0];
  world.sounds.push(fragment(world, '早上好'));
  samplePerception(world);
  assert.equal(observer.observations.filter(observation => observation.modality === 'auditory').length, 0);
  world.tick = 1; samplePerception(world);
  assert.equal(observer.observations.filter(observation => observation.modality === 'auditory').length, 1);
  samplePerception(world); world.tick = 2; samplePerception(world);
  assert.equal(observer.observations.filter(observation => observation.modality === 'auditory').length, 1);
  observer.position.x = -100;
  world.sounds.push(fragment(world, '还没说的秘密后半句', { id: 'later' }));
  for (let i = 3; i <= 9; i++) { world.tick = i; samplePerception(world); }
  observer.position.x = -1; world.tick = 10; samplePerception(world);
  const payload = JSON.stringify(buildContext(world, observer));
  assert.ok(payload.includes('早上好')); assert.ok(!payload.includes('秘密后半句'));
});

test('D02: self speech and simultaneous loud speech mask incoming intelligibility', () => {
  const world = scene(), observer = world.residents[0];
  world.sounds.push(fragment(world, '被盖住的口令'));
  world.sounds.push(fragment(world, '正在大声说话', { id: 'self-sound', sourceId: observer.id, position: { ...observer.position }, volume: 'shout' }));
  world.tick = 1; samplePerception(world);
  const bytes = JSON.stringify(buildContext(world, observer));
  assert.ok(!bytes.includes('被盖住的口令'));
});

test('P07/P08: first mild pain wakes once and never includes an unseen cause', () => {
  const world = scene(), observer = world.residents[0]; samplePerception(world);
  observer.pain = .02; world.tick = 1;
  assert.ok(samplePerception(world).includes(observer.id));
  const body = observer.observations.at(-1)!;
  assert.equal(body.modality, 'bodily'); assert.equal(body.detail.sensation, 'pain');
  assert.deepEqual(Object.keys(body.detail).sort(), ['bodyPart', 'intensity', 'sensation']);
  world.tick = 2; assert.ok(!samplePerception(world).includes(observer.id));
  validateObservation(body);
});

test('K05: summary preserves hearsay source and cannot create direct memories or foreign evidence', () => {
  const world = scene(), observer = world.residents[0];
  world.sounds.push(fragment(world, '仓库着火了')); world.tick = 1; samplePerception(world);
  const original = observer.memories.find(memory => memory.kind === 'hearsay')!;
  addModelMemories(observer, [{ kind: 'summary', text: '仓库着火', evidenceRefs: [original.ref] }, { kind: 'belief', text: '无合法依据', evidenceRefs: ['another_person_memory'] }], 1);
  const context = buildContext(world, observer);
  const summary = context.memories.find(memory => memory.kind === 'summary')!;
  assert.ok(summary.text.includes('原始来源')); assert.deepEqual(summary.evidenceRefs, [original.ref]);
  assert.equal(context.memories.find(memory => memory.ref === original.ref)!.kind, 'hearsay');
  assert.ok(!JSON.stringify(context).includes('无合法依据'));
});

test('K06/V01: repeated overlays do not mutate world/RNG/context and actual walls clip the sector', () => {
  const world = scene(), observer = world.residents[0]; wall(world); samplePerception(world);
  const before = JSON.stringify(world), contextBefore = JSON.stringify(buildContext(world, observer));
  for (let i = 0; i < 20; i++) {
    const overlay = getOverlay(world, observer);
    const centerRay = overlay.visionPolygon[37];
    assert.ok(centerRay.x <= -.15 + 1e-7);
    overlay.lastKnown.push({ ref: 'ui-only', position: { x: 90, y: 0, z: 90 }, tick: 0, description: 'UI' });
  }
  assert.equal(JSON.stringify(world), before);
  assert.equal(JSON.stringify(buildContext(world, observer)), contextBefore);
});

test('current plan whitelist retains real contract target, duration, nullable recipient and equipment refs', () => {
  const world = scene(), observer = world.residents[0]; samplePerception(world);
  const targetRef = Object.keys(observer.known)[0];
  const actions = [
    { op: 'walk', stage: 0, params: { targetRef, gait: 'walk' } },
    { op: 'speak', stage: 0, params: { text: '你好', volume: 'normal', towardRef: null } },
    { op: 'rest', stage: 1, params: { placeRef: targetRef, durationSimMs: 1000 } },
    { op: 'wait', stage: 2, params: { durationSimMs: 1000, scope: 'hands' } },
  ];
  observer.plan = actions.map(action => ({ action, elapsedTicks: 0, startedTick: null, emittedChars: 0, done: false }));
  const context = buildContext(world, observer); validateCharacterContext(context);
  assert.deepEqual(context.currentPlan.actions, actions);
  assert.deepEqual(privateAction({ op: 'equip_item', stage: 0, params: { itemRef: 'item_1', slot: 'torso', internalId: 'secret' } }).params, { itemRef: 'item_1', slot: 'torso' });
});

test('self equipment is private; visible outfit changes wake observers without revealing bag contents', () => {
  const world = scene(), observer = world.residents[0], target = world.residents[1];
  observer.character = createCharacterState(observer.id); target.character = createCharacterState(target.id);
  samplePerception(world);
  const own = buildContext(world, target), foreign = buildContext(world, observer);
  assert.ok(own.knownTargets.some(item => item.ref === 'item_5' && item.description.includes('双手长矛')));
  assert.ok(foreign.knownTargets.some(item => item.ref === 'item_5')); // observer owns their own scoped kit
  const targetVisual = observer.observations.find(item => item.detail.recognizedName === target.name)!;
  assert.ok(!JSON.stringify(targetVisual).includes('双手长矛'));
  const changed = applyEquipmentAction(target, { type: 'equip_item', itemRef: 'item_5' });
  assert.ok(changed.ok); if (!changed.ok) return;
  target.character = changed.resident.character;
  world.tick = 4; assert.ok(samplePerception(world).includes(observer.id));
  assert.ok(observer.observations.at(-1)!.detail.appearance.join('').includes('长矛'));
  const bytes = JSON.stringify(buildContext(world, observer));
  assert.ok(!bytes.includes(':starter')); assert.ok(!bytes.includes(target.id));
});
