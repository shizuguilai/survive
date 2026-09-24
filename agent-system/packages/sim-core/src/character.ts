/** Cosmetic and equipment state. All mutations are pure; caller commits only at a safe simulation tick. */
export type BodyShape = 'rounded'|'long';
export type HairStyle = 'bald'|'short'|'bob'|'ponytail'|'mohawk';
export type BeardStyle = 'none'|'stubble'|'moustache'|'full';
export type CharacterAppearance = {
  headSize:number; bodyLength:number; bodyWidth:number; handSize:number; bodyShape:BodyShape;
  skinColor:string; hairStyle:HairStyle; hairColor:string; beardStyle:BeardStyle; beardColor:string;
  clothingColor:string; trimColor:string;
};
export type EquipmentSlot = 'torso'|'head'|'leftHand'|'rightHand'|'back';
export type EquipmentCatalogItem = {
  id:string; label:string; kind:'clothing'|'headwear'|'weapon'|'backpack'; slot:'torso'|'head'|'hand'|'back';
  hands:0|1|2; inventoryUnits:number; extraCapacity:number; appearance:string; color:string;
};
/** Item instances have stable IDs and a single owner, including while equipped. */
export type EquipmentItem = {id:string;itemRef:string;catalogId:string;ownerId:string};
export type CharacterLoadout = Partial<Record<EquipmentSlot,string>>;
export type CharacterState = {
  schemaVersion:'1.0.0'; appearance:CharacterAppearance;
  inventory:{baseCapacity:number;items:EquipmentItem[]}; loadout:CharacterLoadout;
};
export type EquipmentAction = {type:'equip_item';itemRef:string;slot?:EquipmentSlot}|{type:'unequip_item';itemRef:string};
export type CharacterEditResult<R> = {ok:true;resident:R}|{ok:false;error:string};
export const EQUIPMENT_CATALOG:Readonly<Record<string,Readonly<EquipmentCatalogItem>>> = Object.freeze(Object.fromEntries([
  {id:'linen_tunic',label:'亚麻上衣',kind:'clothing',slot:'torso',hands:0,inventoryUnits:1,extraCapacity:0,appearance:'亚麻上衣',color:'#789e84'},
  {id:'travel_coat',label:'旅行外套',kind:'clothing',slot:'torso',hands:0,inventoryUnits:2,extraCapacity:0,appearance:'长旅行外套',color:'#a37c55'},
  {id:'brim_hat',label:'宽檐帽',kind:'headwear',slot:'head',hands:0,inventoryUnits:1,extraCapacity:0,appearance:'宽檐帽',color:'#a18659'},
  {id:'knife',label:'短刀',kind:'weapon',slot:'hand',hands:1,inventoryUnits:1,extraCapacity:0,appearance:'单手短刀',color:'#c2c9c5'},
  {id:'spear',label:'双手长矛',kind:'weapon',slot:'hand',hands:2,inventoryUnits:3,extraCapacity:0,appearance:'双手持长矛',color:'#a47b52'},
  {id:'satchel',label:'小背包',kind:'backpack',slot:'back',hands:0,inventoryUnits:1,extraCapacity:8,appearance:'小布背包',color:'#82755c'},
  {id:'expedition_pack',label:'远行背包',kind:'backpack',slot:'back',hands:0,inventoryUnits:2,extraCapacity:14,appearance:'大号远行背包',color:'#5f7363'},
].map(item=>[item.id,Object.freeze(item)]))) as Readonly<Record<string,Readonly<EquipmentCatalogItem>>>;
export const APPEARANCE_LIMITS = Object.freeze({headSize:[.7,1.4],bodyLength:[.65,1.55],bodyWidth:[.65,1.45],handSize:[.65,1.4]} as const);
export const HAIR_STYLES:readonly HairStyle[]=['bald','short','bob','ponytail','mohawk'];
export const BEARD_STYLES:readonly BeardStyle[]=['none','stubble','moustache','full'];
export const EQUIPMENT_SLOTS:readonly EquipmentSlot[]=['torso','head','leftHand','rightHand','back'];
const SKIN_COLORS=['#f0cfab','#d5aa80','#bc8a62','#986744','#694831'];
const HAIR_COLORS=['#302a25','#66503c','#b69865','#d4c6a5','#8b4932','#777b7c'];
const CLOTH_COLORS=['#4f8073','#cb8d54','#687a9a','#975e68','#8d9163','#78698e'];
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

/** Local seeded generator. Never reads or mutates World.rngState or Math.random. */
export function generateCharacterAppearance(seed:number):CharacterAppearance {
  let state=(Number.isFinite(seed)?seed:1)>>>0;
  const next=()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const pick=<T>(values:readonly T[]):T=>values[Math.floor(next()*values.length)]!;
  const hairColor=pick(HAIR_COLORS);
  return {headSize:Number((.9+next()*.3).toFixed(2)),bodyLength:Number((.85+next()*.4).toFixed(2)),bodyWidth:Number((.85+next()*.3).toFixed(2)),handSize:1,bodyShape:next()<.5?'rounded':'long',skinColor:pick(SKIN_COLORS),hairStyle:pick(HAIR_STYLES),hairColor,beardStyle:pick(BEARD_STYLES),beardColor:hairColor,clothingColor:pick(CLOTH_COLORS),trimColor:'#e2cfaa'};
}
export function characterSeed(residentId:string):number {let hash=2166136261;for(const c of residentId)hash=Math.imul(hash^c.charCodeAt(0),16777619);return hash>>>0;}
/** Explicit starter kit creation only. Editing cannot mint items. */
export function createCharacterState(residentId:string,seed=characterSeed(residentId)):CharacterState {
  const items=Object.keys(EQUIPMENT_CATALOG).map((catalogId,index)=>({id:`${residentId}:${catalogId}:starter`,itemRef:`item_${index+1}`,catalogId,ownerId:residentId}));
  return {schemaVersion:'1.0.0',appearance:generateCharacterAppearance(seed),inventory:{baseCapacity:6,items},loadout:{torso:items.find(i=>i.catalogId==='linen_tunic')!.id,back:items.find(i=>i.catalogId==='satchel')!.id}};
}
export function equippedItem(character:CharacterState,slot:EquipmentSlot):{item:EquipmentItem;definition:Readonly<EquipmentCatalogItem>}|null {
  const item=character.inventory.items.find(i=>i.id===character.loadout[slot]);const definition=item&&EQUIPMENT_CATALOG[item.catalogId];return item&&definition?{item,definition}:null;
}
export function characterInventoryUsage(character:CharacterState):{used:number;capacity:number} {
  const equipped=new Set(Object.values(character.loadout));
  return {used:character.inventory.items.filter(i=>!equipped.has(i.id)).reduce((n,i)=>n+(EQUIPMENT_CATALOG[i.catalogId]?.inventoryUnits??0),0),capacity:character.inventory.baseCapacity+(equippedItem(character,'back')?.definition.extraCapacity??0)};
}
export function validateAppearance(appearance:CharacterAppearance):string|null {
  if(!appearance||typeof appearance!=='object')return '角色外观缺失';
  const allowed=new Set(['headSize','bodyLength','bodyWidth','handSize','bodyShape','skinColor','hairStyle','hairColor','beardStyle','beardColor','clothingColor','trimColor']);
  if(Object.keys(appearance).some(k=>!allowed.has(k)))return '存在未知外观字段';
  for(const [field,[min,max]]of Object.entries(APPEARANCE_LIMITS)){const value=appearance[field as keyof typeof APPEARANCE_LIMITS];if(!Number.isFinite(value)||value<min||value>max)return `${field} 必须介于 ${min} 和 ${max}`;}
  if(!['rounded','long'].includes(appearance.bodyShape)||!HAIR_STYLES.includes(appearance.hairStyle)||!BEARD_STYLES.includes(appearance.beardStyle))return '造型类型不支持';
  for(const field of ['skinColor','hairColor','beardColor','clothingColor','trimColor'] as const)if(!/^#[0-9a-fA-F]{6}$/.test(appearance[field]))return `${field} 必须为六位十六进制颜色`;
  return null;
}
export function validateCharacterState(character:CharacterState,residentId:string):string|null {
  if(!character||typeof character!=='object')return '角色数据缺失';
  const appearanceError=validateAppearance(character.appearance);if(appearanceError)return appearanceError;
  if(character.schemaVersion!=='1.0.0'||!character.inventory||!Array.isArray(character.inventory.items)||!character.loadout||typeof character.loadout!=='object')return '角色数据版本或结构错误';
  if(!Number.isSafeInteger(character.inventory.baseCapacity)||character.inventory.baseCapacity<0||character.inventory.baseCapacity>1000)return '基础容量不合法';
  const ids=new Set<string>(),refs=new Set<string>();
  for(const item of character.inventory.items){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.itemRef!=='string'||!/^item_[1-9][0-9]*$/.test(item.itemRef)||refs.has(item.itemRef)||item.ownerId!==residentId||!Object.hasOwn(EQUIPMENT_CATALOG,item.catalogId))return '物品重复、归属不匹配或物品类型不存在';ids.add(item.id);refs.add(item.itemRef);}
  for(const [slot,id]of Object.entries(character.loadout)){
    if(!EQUIPMENT_SLOTS.includes(slot as EquipmentSlot)||typeof id!=='string')return '装备部位不合法';
    const found=equippedItem(character,slot as EquipmentSlot);if(!found)return '装备不在居民持有的物品中';
    const def=found.definition;if(def.slot==='hand'?!['leftHand','rightHand'].includes(slot):def.slot!==slot)return '物品与装备部位不匹配';
    const slots=Object.entries(character.loadout).filter(([,value])=>value===id).map(([key])=>key);
    if(def.hands===2){if(slots.length!==2||!slots.includes('leftHand')||!slots.includes('rightHand'))return '双手武器必须同时占用两只手';}
    else if(slots.length!==1)return '同一物品不能重复装备';
  }
  const {used,capacity}=characterInventoryUsage(character);if(used>capacity)return `收纳容量不足（需要 ${used}，可用 ${capacity}），所有物品均保留`;
  return null;
}
/** Called by the action executor only after a positive simulated duration, never at decision commit. */
export function applyEquipmentAction<R extends {id:string;character?:CharacterState}>(resident:R,action:EquipmentAction):CharacterEditResult<R> {
  if(!resident.character)return {ok:false,error:'角色数据尚未初始化'};
  const originalError=validateCharacterState(resident.character,resident.id);if(originalError)return {ok:false,error:originalError};
  const character=clone(resident.character);
  const item=character.inventory.items.find(i=>i.itemRef===action.itemRef&&i.ownerId===resident.id);
  if(!item)return {ok:false,error:'居民未持有该物品，无法凭空装备或操作他人私有物品'};
  const clearItem=(id:string)=>{for(const slot of EQUIPMENT_SLOTS)if(character.loadout[slot]===id)delete character.loadout[slot];};
  switch(action.type){
    case 'equip_item':{
      const def=EQUIPMENT_CATALOG[item.catalogId]!;
      const slot=action.slot??(def.slot==='hand'?'rightHand':def.slot);
      if(!EQUIPMENT_SLOTS.includes(slot)|| (def.slot==='hand'?!['leftHand','rightHand'].includes(slot):slot!==def.slot))return {ok:false,error:'物品与装备部位不匹配'};
      clearItem(item.id);
      if(def.hands===2){for(const hand of ['leftHand','rightHand'] as const){const prior=character.loadout[hand];if(prior)clearItem(prior);}character.loadout.leftHand=item.id;character.loadout.rightHand=item.id;}
      else {const prior=character.loadout[slot];if(prior)clearItem(prior);character.loadout[slot]=item.id;}
      break;
    }
    case 'unequip_item':if(!Object.values(character.loadout).includes(item.id))return {ok:false,error:'该物品已经收纳，无需卸下'};clearItem(item.id);break;
    default:return {ok:false,error:'装备动作类型不支持'};
  }
  const error=validateCharacterState(character,resident.id);if(error)return {ok:false,error};
  return {ok:true,resident:{...resident,character}};
}
/** Explicitly scoped to the owner: only use this private list in that resident's model context. */
export function listOwnEquipment(character:CharacterState,residentId:string):{itemRef:string;label:string;kind:string;equippedSlots:EquipmentSlot[];allowedSlots:EquipmentSlot[];hands:number}[] {
  if(validateCharacterState(character,residentId))return [];
  return character.inventory.items.filter(item=>item.ownerId===residentId).map(item=>{
    const def=EQUIPMENT_CATALOG[item.catalogId]!;
    return {itemRef:item.itemRef,label:def.label,kind:def.kind,equippedSlots:EQUIPMENT_SLOTS.filter(slot=>character.loadout[slot]===item.id),allowedSlots:def.slot==='hand'?['leftHand','rightHand']:[def.slot],hands:def.hands};
  });
}
/** Human-readable approximate names; original RGB values remain the rendering authority. */
function approximateColor(hex:string,skin=false):string {
  const palette:readonly (readonly [string,string])[]=skin
    ?[['白皙','#f0cfab'],['浅棕','#d5aa80'],['棕','#bc8a62'],['深棕','#986744'],['深棕','#694831']]
    :[['白色','#f5f2e9'],['黑色','#252525'],['灰色','#888888'],['棕色','#76513b'],['棕色','#a47b52'],['金色','#c6a457'],['金色','#d4c6a5'],['橙色','#dd8b43'],['橙色','#cb8d54'],['红色','#ad4c4c'],['蓝色','#557aab'],['绿色','#4f8073'],['绿色','#8d9163'],['紫色','#78698e']];
  const rgb=(value:string)=>{const n=Number.parseInt(value.slice(1),16);return [n>>16&255,n>>8&255,n&255];};
  const target=rgb(hex);let nearest=palette[0]![0],distance=Infinity;
  for(const [name,color]of palette){const sample=rgb(color),d=sample.reduce((sum,c,i)=>sum+(c-target[i]!)**2,0);if(d<distance){distance=d;nearest=name;}}
  return nearest;
}
/** Only externally visible facts. Does not reveal identity, inventory contents, capacity or ownership. */
export function publicCharacterSummary(character:CharacterState):string {
  const a=character.appearance;
  const hairLabels:Record<HairStyle,string>={bald:'光头',short:'短发',bob:'齐耳发',ponytail:'马尾',mohawk:'竖发'};
  const beardLabels:Record<BeardStyle,string>={none:'无胡须',stubble:'短胡茬',moustache:'八字胡',full:'络腮胡'};
  const visible=[`${approximateColor(a.skinColor,true)}肤色`,a.hairStyle==='bald'?'光头':`${approximateColor(a.hairColor)}${hairLabels[a.hairStyle]}`,beardLabels[a.beardStyle],`${a.bodyShape==='rounded'?'圆润':'修长'}身形`];
  const seen=new Set<string>();for(const slot of EQUIPMENT_SLOTS){const item=equippedItem(character,slot);if(item&&!seen.has(item.item.id)){seen.add(item.item.id);visible.push(`${slot==='torso'?approximateColor(a.clothingColor):''}${item.definition.appearance}`);}}
  return visible.join('，');
}
