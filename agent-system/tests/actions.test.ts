import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../packages/sim-core/src/world.ts';
import {applyDecision,stepActions,validateActionConcurrency} from '../packages/sim-core/src/actions.ts';
import {samplePerception} from '../packages/sim-core/src/perception.ts';
import {applyEquipmentAction} from '../packages/sim-core/src/character.ts';
import type {Action,Decision} from '../packages/contracts/src/types.ts';
const decide=(actions:Action[],decisionKind:Decision['decisionKind']='replace'):Decision=>({schemaVersion:'1.0.0',decisionKind,goal:'测试选择',reasonBrief:'测试显式计划',actions,nextReviewAfterSimMs:10000,watch:[],memorySuggestions:[]});
const tick=(world:ReturnType<typeof createWorld>)=>{const next=world.tick+1;const due=stepActions(world,next);world.tick=next;return due;};

test('A01: model intention commit changes neither position nor resources nor spoken text',()=>{
  const world=createWorld({runId:'action-intent'});const a=world.residents[0];const position={...a.position};applyDecision(a,decide([{op:'speak',stage:0,params:{text:'早上好。',volume:'normal',towardRef:null}}]),0);
  assert.deepEqual(a.position,position);assert.equal(a.plan[0].elapsedTicks,0);assert.equal(world.sounds.length,0);tick(world);assert.equal(a.plan[0].elapsedTicks,1);assert.equal(world.sounds.length,0);
});

test('P06/A01: speech only releases physically emitted four-character fragments',()=>{
  const world=createWorld({runId:'speech-fragments'}),a=world.residents[0];applyDecision(a,decide([{op:'speak',stage:0,params:{text:'早上你好后半句话',volume:'normal',towardRef:null}}]),0);
  for(let n=0;n<19;n++)tick(world);assert.equal(world.sounds.length,0);tick(world);assert.equal(world.sounds[0].text,'早上你好');assert.equal(world.sounds[0].emittedTick,20);
  assert.equal(JSON.stringify(world.sounds).includes('后半句话'),false);for(let n=0;n<20;n++)tick(world);assert.equal(world.sounds.map(s=>s.text).join(''),'早上你好后半句话');
});

test('A02: body conflict rejected but locomotion and speech can run together',()=>{
  const speak={op:'speak',stage:0,params:{text:'你好',volume:'normal',towardRef:null}};
  assert.throws(()=>validateActionConcurrency([speak,speak]),/body channel/);
  assert.throws(()=>validateActionConcurrency([{op:'gather',stage:0,params:{}},{op:'walk',stage:0,params:{}}]),/body channel/);
  assert.doesNotThrow(()=>validateActionConcurrency([speak,{op:'walk',stage:0,params:{}}]));
  assert.throws(()=>validateActionConcurrency([{op:'build',stage:0,params:{}},{op:'walk',stage:0,params:{}}]),/body channel/);
  assert.throws(()=>validateActionConcurrency([{op:'teleport',stage:0,params:{}}]),/not implemented/);
});

test('A03: suspend and true continue preserve elapsed work instead of replacing its progress',()=>{
  const world=createWorld({runId:'suspend-resume'}),a=world.residents[0];applyDecision(a,decide([{op:'wait',stage:0,params:{durationSimMs:10000,scope:'locomotion'}}]),0);
  for(let n=0;n<8;n++)tick(world);applyDecision(a,decide([{op:'listen',stage:0,params:{durationSimMs:50}}],'suspend'),world.tick);tick(world);
  applyDecision(a,decide([{op:'continue',stage:0,params:{}}],'continue'),world.tick);assert.equal(a.plan[0].elapsedTicks,8);assert.equal(a.plan[0].action.op,'wait');tick(world);assert.equal(a.plan[0].elapsedTicks,9);
});

test('K03: a personally known position is navigated; actual hidden wall only stops at collision',()=>{
  const world=createWorld({runId:'collision'}),a=world.residents[0];world.residents=[a];a.known.k1={ref:'k1',entityId:'tree-west',description:'记得的树',lastPosition:{x:4,y:0,z:0},lastSeenTick:0,visible:false,recognizedName:null};
  world.objects=[{id:'hidden-wall',kind:'wall',position:{x:0,y:0,z:0},width:.5,height:3,depth:4,resources:0,appearance:'墙'}];
  applyDecision(a,decide([{op:'walk',stage:0,params:{targetRef:'k1',gait:'walk'}}]),0);tick(world);assert.ok(a.position.x>-1);for(let n=0;n<20&&!a.plan[0].done;n++)tick(world);
  assert.ok(a.position.x<0);assert.ok(a.actionFeedback.some(text=>text.includes('受阻')));assert.equal(a.known.k1.lastPosition.x,4);
});

test('A01: finite shared tree resource is never duplicated',()=>{
  const world=createWorld({runId:'shared-resource'});const tree=world.objects[0];tree.position={x:0,y:0,z:0};tree.resources=1;
  for(const a of world.residents){a.known.tree={ref:'tree',entityId:tree.id,description:'树',lastPosition:{...tree.position},lastSeenTick:0,visible:true,recognizedName:null};applyDecision(a,decide([{op:'gather',stage:0,params:{targetRef:'tree',amount:1}}]),0);}
  for(let i=0;i<20;i++)tick(world);assert.equal(tree.resources,0);assert.equal(world.residents.reduce((n,r)=>n+r.inventory,0),1);assert.equal(world.residents.filter(r=>r.actionFeedback.length>0).length,1);
});

test('equipment: only a model intent plus one positive simulated second changes clothing',()=>{
  const world=createWorld({runId:'clothing'}),a=world.residents[0];const original=a.character!.loadout.torso;
  applyDecision(a,decide([{op:'equip_item',stage:0,params:{itemRef:'item_2'}}]),0);assert.equal(a.character!.loadout.torso,original);
  for(let i=0;i<19;i++)tick(world);assert.equal(a.character!.loadout.torso,original);tick(world);assert.notEqual(a.character!.loadout.torso,original);assert.equal(a.plan[0].done,true);
});

test('equipment: foreign item failure leaves all equipment and ownership unchanged',()=>{
  const world=createWorld({runId:'clothing-owned'}),a=world.residents[0];const before=JSON.stringify(a.character);applyDecision(a,decide([{op:'equip_item',stage:0,params:{itemRef:world.residents[1].character!.inventory.items[1].id}}]),0);
  for(let i=0;i<20;i++)tick(world);assert.equal(JSON.stringify(a.character),before);assert.ok(a.actionFeedback.length>0);
});
