import type {ResourceKind} from './domain.ts';
export type Recipe={id:string;label:string;kind:'craft'|'exchange';cost:Partial<Record<ResourceKind,number>>;item?:'stone_axe'|'stone_hoe';output?:Partial<Record<ResourceKind,number>>;durationMs:number;effect:string};
export const RECIPES:readonly Recipe[]=[
 {id:'stone_axe',label:'石斧',kind:'craft',cost:{wood:2,stone:3},item:'stone_axe',durationMs:3000,effect:'本人装备到手后，伐木每份由1秒缩短为0.6秒'},
 {id:'stone_hoe',label:'石锄',kind:'craft',cost:{wood:2,stone:2},item:'stone_hoe',durationMs:3000,effect:'本人装备到手后，浆果采收每份由1秒缩短为0.6秒'},
 {id:'wood_to_stone',label:'木材换石料',kind:'exchange',cost:{wood:3},output:{stone:2},durationMs:1000,effect:'3木材 → 2石料'},
 {id:'stone_to_wood',label:'石料换木材',kind:'exchange',cost:{stone:3},output:{wood:2},durationMs:1000,effect:'3石料 → 2木材'},
 {id:'wood_to_food',label:'木材换口粮',kind:'exchange',cost:{wood:2},output:{food:2},durationMs:1000,effect:'2木材 → 2浆果'},
];
export const HOUSE_STEPS=[
 {id:'foundation',label:'地基',cost:{wood:2,stone:4},durationMs:4000},
 {id:'walls',label:'墙体',cost:{wood:8,stone:2},durationMs:6000},
 {id:'roof',label:'屋顶',cost:{wood:2,stone:2},durationMs:4000},
] as const;
export const BUILD_SITES=[{id:'east',label:'东侧居住地块',x:7,z:0},{id:'north',label:'北侧居住地块',x:0,z:-8},{id:'west',label:'西侧居住地块',x:-7,z:0}] as const;
export const materialText=(values:Partial<Record<ResourceKind,number>>)=>Object.entries(values).map(([k,n])=>`${n}${k==='wood'?'木材':k==='stone'?'石料':'浆果'}`).join(' + ');
export const taskTitle=(task:{kind?:string;resource?:ResourceKind;amount:number;recipeId?:string})=>task.kind==='house'?'建造一间木石小屋':task.kind==='craft'?`制作${RECIPES.find(r=>r.id===task.recipeId)?.label??'工具'}${task.amount}件`:`采集${task.resource==='wood'?'木材':task.resource==='stone'?'石料':'浆果'}${task.amount}份`;
export const skillLevel=(xp=0)=>Math.min(5,Math.floor(xp/3));
