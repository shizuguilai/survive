import type {WorldObject} from './domain.ts';

export const HOME_DESIGNS=[
 {id:'cedar',name:'杉木小屋',width:4,depth:3,growX:1.5,growZ:1.5,cost:1,wall:'#c2a06c',trim:'#80613f',roof:'#697b58',floor:'#ba9569',blanket:'#75948c',pitch:24,across:'width',bedSide:-1,backBed:false,shutters:false},
 {id:'ochre',name:'暖瓦平房',width:4.8,depth:3.6,growX:1.4,growZ:1.1,cost:1.35,wall:'#dfc7a0',trim:'#996b4b',roof:'#a66449',floor:'#c5a97c',blanket:'#c68a59',pitch:19,across:'depth',bedSide:1,backBed:true,shutters:true},
 {id:'slate',name:'灰瓦长屋',width:3.6,depth:4.4,growX:1,growZ:1.4,cost:1.25,wall:'#adb4aa',trim:'#667270',roof:'#566d7f',floor:'#b6a083',blanket:'#7089ad',pitch:32,across:'width',bedSide:-1,backBed:true,shutters:true},
 {id:'moss',name:'青檐宽屋',width:5,depth:3.8,growX:1.6,growZ:.9,cost:1.5,wall:'#bdc6ad',trim:'#596e60',roof:'#417e73',floor:'#bda575',blanket:'#a5ad6c',pitch:22,across:'depth',bedSide:1,backBed:false,shutters:false},
 {id:'brick',name:'砖红小筑',width:3.6,depth:3,growX:1.3,growZ:1.1,cost:.9,wall:'#c39579',trim:'#7b594a',roof:'#864f48',floor:'#b98f66',blanket:'#b1747d',pitch:30,across:'width',bedSide:-1,backBed:false,shutters:true},
 {id:'chalk',name:'浅墙雅舍',width:4.4,depth:4.2,growX:1.2,growZ:1.3,cost:1.4,wall:'#deddd0',trim:'#797679',roof:'#656470',floor:'#bcad95',blanket:'#9d8eaf',pitch:27,across:'depth',bedSide:1,backBed:true,shutters:false},
] as const;
export type HomeDesignId=typeof HOME_DESIGNS[number]['id'];
/** Stable preferences: no renderer randomization or changes to the world RNG. */
export function preferredHome(id:string):typeof HOME_DESIGNS[number]{
 const named=/^resident-([a-f])$/.exec(id);let n=named?named[1].charCodeAt(0)-97:0;
 if(!named)for(const c of id)n=(Math.imul(n,31)+c.charCodeAt(0))>>>0;
 return HOME_DESIGNS[n%HOME_DESIGNS.length];
}
export function homeDesign(id?:string,owner='resident-a'){return HOME_DESIGNS.find(d=>d.id===id)??preferredHome(owner);}
export function designedHomeSize(level=1,design?:string){const d=design?homeDesign(design):HOME_DESIGNS[0],n=Math.max(0,level-1);return {width:Number((d.width+n*d.growX).toFixed(1)),depth:Number((d.depth+n*d.growZ).toFixed(1))};}
export function homeLayout(h:Pick<WorldObject,'width'|'depth'|'homeDesign'|'ownerId'>){const d=h.homeDesign?homeDesign(h.homeDesign):HOME_DESIGNS[0],side=d.bedSide,hw=h.width/2,hd=h.depth/2;return {bed:{x:side*(hw-.82),z:d.backBed?-hd+1.18:-.13},cabinet:{x:-side*(hw-.68),z:-hd+.6},lamp:{x:-side*(hw-.63),z:hd-.54},mop:{x:-side*(hw-.29),z:.16},side};}
export function homeHeight(h:Pick<WorldObject,'width'|'depth'|'homeDesign'|'ownerId'>){const d=homeDesign(h.homeDesign,h.ownerId);return 2.5+Math.tan(d.pitch*Math.PI/180)*(d.across==='depth'?h.depth:h.width)/2+.95;}
