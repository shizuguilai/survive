import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyEquipmentAction,characterInventoryUsage,createCharacterState,generateCharacterAppearance,listOwnEquipment,publicCharacterSummary,validateAppearance,validateCharacterState} from '../packages/sim-core/src/character.ts';
import type {EquipmentAction,CharacterState} from '../packages/sim-core/src/character.ts';
import {CharacterMesh} from '../apps/laya-client/src/character-mesh.ts';
const make=(id='A')=>({id,character:createCharacterState(id)});
const item=(c:CharacterState,catalogId:string)=>c.inventory.items.find(i=>i.catalogId===catalogId)!.id;
const ref=(c:CharacterState,catalogId:string)=>c.inventory.items.find(i=>i.catalogId===catalogId)!.itemRef;
const refForId=(c:CharacterState,id:string)=>c.inventory.items.find(i=>i.id===id)!.itemRef;
const applied=<R extends {id:string;character:CharacterState}>(resident:R,action:EquipmentAction):R=>{const result=applyEquipmentAction(resident,action);if(!result.ok)assert.fail(result.error);return result.resident;};

test('cosmetic generation is seed reproducible and does not consume simulation or ambient RNG',()=>{
  const world={rngState:12345};const ambient=Math.random;Math.random=()=>{throw Error('ambient RNG must not be called');};
  try {assert.deepEqual(generateCharacterAppearance(42),generateCharacterAppearance(42));assert.notDeepEqual(generateCharacterAppearance(42),generateCharacterAppearance(43));assert.equal(world.rngState,12345);for(let seed=0;seed<100;seed++)assert.equal(validateAppearance(generateCharacterAppearance(seed)),null);}finally{Math.random=ambient;}
});
test('residents start dressed and each item has a unique private owner',()=>{
  const a=make('A'),b=make('B');assert.ok(a.character.loadout.torso);assert.ok(a.character.loadout.back);assert.equal(validateCharacterState(a.character,'A'),null);
  const aIds=new Set(a.character.inventory.items.map(i=>i.id));assert.ok(b.character.inventory.items.every(i=>!aIds.has(i.id)&&i.ownerId==='B'));
  assert.deepEqual(listOwnEquipment(a.character,'B'),[]);
});
test('cannot equip a foreign or invented item and rejection leaves state byte-for-byte unchanged',()=>{
  const a=make(),b=make('B'),before=JSON.stringify(a);
  for(const itemRef of ['invented',item(b.character,'knife')])assert.equal(applyEquipmentAction(a,{type:'equip_item',itemRef}).ok,false);
  assert.equal(JSON.stringify(a),before);
});
test('model references are owner-local, opaque, stable after reorder/removal, and reject global IDs',()=>{
  const a=make(),knifeRef=ref(a.character,'knife'),spearRef=ref(a.character,'spear');
  assert.equal(applyEquipmentAction(a,{type:'equip_item',itemRef:item(a.character,'knife')}).ok,false);
  a.character.inventory.items.reverse();
  assert.equal(ref(a.character,'knife'),knifeRef);assert.equal(ref(a.character,'spear'),spearRef);
  a.character.inventory.items=a.character.inventory.items.filter(i=>i.itemRef!==knifeRef);
  assert.equal(applyEquipmentAction(a,{type:'equip_item',itemRef:knifeRef}).ok,false);
  const next=applied(a,{type:'equip_item',itemRef:spearRef});assert.equal(next.character.loadout.leftHand,item(next.character,'spear'));
  const refs=listOwnEquipment(next.character,'A');assert.ok(refs.every(i=>/^item_[1-9][0-9]*$/.test(i.itemRef)));
  assert.ok(refs.every(i=>!JSON.stringify(i).includes(':starter')));
});
test('changing clothes is atomic, conserves every item and preserves the source resident',()=>{
  const a=make(),before=JSON.stringify(a),old=a.character.loadout.torso;
  const next=applied(a,{type:'equip_item',itemRef:ref(a.character,'travel_coat')});
  assert.equal(next.character.loadout.torso,item(a.character,'travel_coat'));assert.equal(JSON.stringify(a),before);
  assert.deepEqual(next.character.inventory.items,a.character.inventory.items);assert.ok(next.character.inventory.items.some(i=>i.id===old));assert.equal(validateCharacterState(next.character,'A'),null);
});
test('double handed spear occupies both hands; replacing one hand fully stows it',()=>{
  let a=make();a=applied(a,{type:'equip_item',itemRef:ref(a.character,'spear')});
  assert.equal(a.character.loadout.leftHand,item(a.character,'spear'));assert.equal(a.character.loadout.rightHand,item(a.character,'spear'));
  a=applied(a,{type:'equip_item',itemRef:ref(a.character,'knife'),slot:'leftHand'});
  assert.equal(a.character.loadout.leftHand,item(a.character,'knife'));assert.equal(a.character.loadout.rightHand,undefined);
  assert.equal(validateCharacterState(a.character,'A'),null);assert.equal(a.character.inventory.items.length,7);
});
test('a single hand item can move hands without duplication, and unsupported slots are rejected',()=>{
  let a=make();a=applied(a,{type:'equip_item',itemRef:ref(a.character,'knife')});
  a=applied(a,{type:'equip_item',itemRef:ref(a.character,'knife'),slot:'leftHand'});
  assert.equal(a.character.loadout.rightHand,undefined);assert.equal(a.character.loadout.leftHand,item(a.character,'knife'));
  assert.equal(applyEquipmentAction(a,{type:'equip_item',itemRef:ref(a.character,'brim_hat'),slot:'back'}).ok,false);
});
test('removing an overfull backpack fails without deleting or unequipping anything',()=>{
  const a=make(),before=JSON.stringify(a);const result=applyEquipmentAction(a,{type:'unequip_item',itemRef:refForId(a.character,a.character.loadout.back!)});
  assert.equal(result.ok,false);if(!result.ok)assert.match(result.error,/容量不足/);assert.equal(JSON.stringify(a),before);
});
test('changing to a smaller backpack fails atomically if capacity cannot hold belongings',()=>{
  let a=make();a=applied(a,{type:'equip_item',itemRef:ref(a.character,'expedition_pack')});
  for(let n=0;n<7;n++)a.character.inventory.items.push({id:`A:extra:${n}`,itemRef:`item_${n+8}`,catalogId:'linen_tunic',ownerId:'A'});
  assert.equal(validateCharacterState(a.character,'A'),null);const before=JSON.stringify(a);
  assert.equal(applyEquipmentAction(a,{type:'equip_item',itemRef:ref(a.character,'satchel')}).ok,false);assert.equal(JSON.stringify(a),before);
});
test('empty backpack can be removed and retained in carried inventory',()=>{
  const a=make();a.character.inventory.items=a.character.inventory.items.filter(i=>[a.character.loadout.back,a.character.loadout.torso].includes(i.id));
  const next=applied(a,{type:'unequip_item',itemRef:refForId(a.character,a.character.loadout.back!)});assert.equal(next.character.loadout.back,undefined);assert.equal(next.character.inventory.items.length,2);assert.deepEqual(characterInventoryUsage(next.character),{used:1,capacity:6});
});
test('state validator rejects duplicated ownership, half equipped two hand item and unknown catalog entries',()=>{
  const duplicate=make();duplicate.character.inventory.items.push({...duplicate.character.inventory.items[0]!});assert.match(validateCharacterState(duplicate.character,'A')!,/重复/);
  const half=make();half.character.loadout.leftHand=item(half.character,'spear');assert.match(validateCharacterState(half.character,'A')!,/双手/);
  const foreign=make();foreign.character.inventory.items[0]!.ownerId='B';assert.match(validateCharacterState(foreign.character,'A')!,/归属/);
  const unknown=make();unknown.character.inventory.items[0]!.catalogId='__proto__';assert.match(validateCharacterState(unknown.character,'A')!,/不存在/);
});
test('public appearance never reveals hidden bag contents, private item refs or capacities',()=>{
  const a=make(),summary=publicCharacterSummary(a.character);
  assert.match(summary,/亚麻上衣/);assert.match(summary,/小布背包/);assert.doesNotMatch(summary,/短刀|长矛|旅行外套|远行背包|starter|容量/);
  const own=listOwnEquipment(a.character,'A');assert.ok(own.some(i=>i.label==='双手长矛'));assert.ok(own.every(i=>/^item_[1-9][0-9]*$/.test(i.itemRef)));assert.ok(own.every(i=>!i.itemRef.includes('A')));
  const armed=applied(a,{type:'equip_item',itemRef:ref(a.character,'spear')});assert.match(publicCharacterSummary(armed.character),/双手持长矛/);
});
test('visible appearance uses concise natural Chinese colors without changing stored render colors',()=>{
  const a=make();Object.assign(a.character.appearance,{skinColor:'#d5aa80',hairStyle:'bob',hairColor:'#d4c6a5',beardStyle:'full',clothingColor:'#cb8d54'});
  const before=JSON.stringify(a.character),summary=publicCharacterSummary(a.character);
  assert.match(summary,/浅棕肤色/);assert.match(summary,/金色齐耳发/);assert.match(summary,/络腮胡/);assert.match(summary,/橙色亚麻上衣/);assert.doesNotMatch(summary,/#|[0-9a-f]{6}/i);
  assert.ok([...summary].length<=100);assert.equal(JSON.stringify(a.character),before);
  for(let seed=0;seed<100;seed++){
    const c=createCharacterState('A',seed);c.appearance.clothingColor='#18aecf';
    const text=publicCharacterSummary(c);assert.ok([...text].length<=100);assert.doesNotMatch(text,/#/);
  }
});
test('invalid sizes and colors cannot enter character state',()=>{
  const a=generateCharacterAppearance(1);assert.ok(validateAppearance({...a,headSize:NaN}));assert.ok(validateAppearance({...a,headSize:99}));assert.ok(validateAppearance({...a,skinColor:'url(secret)'}));
});

test('native mesh is stable across motion, rebuilds only on visible change, and releases owned resources',()=>{
  const resources:{destroyed:boolean;destroy():void}[]=[];let creations=0;
  class Node {name:string;children:any[]=[];transform:any={};meshRenderer:any={};destroyed=false;constructor(arg:any,name=''){this.name=typeof arg==='string'?arg:name;}addChild(n:any){this.children.push(n);return n;}destroy(){this.destroyed=true;for(const c of this.children)c.destroy();}}
  class Vector {x:number;y:number;z:number;w:number;constructor(x=0,y=0,z=0,w=0){this.x=x;this.y=y;this.z=z;this.w=w;}}
  class Material {destroyed=false;destroy(){this.destroyed=true;}constructor(){resources.push(this);}}
  const geometry=()=>{creations++;const resource={destroyed:false,destroy(){this.destroyed=true;}};resources.push(resource);return resource;};
  const prior=(globalThis as any).Laya;
  (globalThis as any).Laya={Sprite3D:Node,MeshSprite3D:Node,Vector3:Vector,Color:Vector,BlinnPhongMaterial:Material,PrimitiveMesh:{createSphere:geometry,createCapsule:geometry,createCylinder:geometry,createBox:geometry}};
  try{
    const resident:any={...make(),name:'居民A',position:{x:1,y:0,z:2},heading:0};const mesh=new CharacterMesh(resident);const initialCreations=creations;
    for(let n=0;n<50;n++){resident.position.x++;mesh.update(resident);}assert.equal(creations,initialCreations);assert.equal(mesh.node.transform.position.x,51);
    const firstResources=[...resources];resident.character.appearance.hairStyle=resident.character.appearance.hairStyle==='bald'?'bob':'bald';mesh.update(resident);
    assert.ok(creations>initialCreations);assert.ok(firstResources.every(r=>r.destroyed));mesh.dispose();assert.ok(resources.every(r=>r.destroyed));assert.equal(mesh.node.destroyed,true);mesh.dispose();
  }finally{(globalThis as any).Laya=prior;}
});
