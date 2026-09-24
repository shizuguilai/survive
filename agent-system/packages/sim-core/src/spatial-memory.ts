import type {Resident,WorldObject} from './domain.ts';
import type {Vec3,SpatialMemoryContext} from '../../contracts/src/types.ts';
import {experiencedWhen} from './knowledge.ts';
export const MAP_CELL_SIZE=2,MAP_CELL_LIMIT=256,MAP_TRAIL_LIMIT=64;
export type MapKind=WorldObject['kind']|'person';
export type MapCell={x:number;z:number;seenTick:number;visitedTick?:number;blocked?:boolean};
export type MapLandmark={knownRef:string;kind:MapKind;x:number;z:number;seenTick:number;state:'remembered'|'depleted'};
export type SpatialMemory={origin:Vec3;cellSize:number;cells:Record<string,MapCell>;trail:{x:number;z:number}[];landmarks:Record<string,MapLandmark>};
function memory(r:Resident):SpatialMemory{return r.spatialMemory??=( {origin:{...r.position},cellSize:MAP_CELL_SIZE,cells:{},trail:[],landmarks:{}} );}
function cellFor(m:SpatialMemory,p:Vec3){return {x:Math.floor((p.x-m.origin.x)/m.cellSize),z:Math.floor((p.z-m.origin.z)/m.cellSize)};}
function keepBounded(m:SpatialMemory){const entries=Object.entries(m.cells);if(entries.length>MAP_CELL_LIMIT){entries.sort((a,b)=>Math.max(a[1].seenTick,a[1].visitedTick??-1)-Math.max(b[1].seenTick,b[1].visitedTick??-1));for(const [key]of entries.slice(0,entries.length-MAP_CELL_LIMIT))delete m.cells[key];}}
/** Proprioception and actual traversal, never a planned destination or hidden world state. */
export function rememberFootstep(r:Resident,tick:number):void{
 const m=memory(r),p=cellFor(m,r.position),key=`${p.x},${p.z}`,last=m.trail.at(-1);
 if(!last||last.x!==p.x||last.z!==p.z){m.cells[key]={...m.cells[key],...p,seenTick:tick,visitedTick:tick,blocked:false};m.trail.push(p);m.trail=m.trail.slice(-MAP_TRAIL_LIMIT);keepBounded(m);}
}
/** Called only after a sensory ray or collision really reveals the cell. */
export function rememberMapCell(r:Resident,p:Vec3,tick:number,blocked=false):void{
 const m=memory(r),cell=cellFor(m,p),key=`${cell.x},${cell.z}`;m.cells[key]={...m.cells[key],...cell,seenTick:tick,...(blocked?{blocked:true}:{})};keepBounded(m);
}
/** Must be called only for a visually identified personal knownRef, not the global object list. */
export function rememberLandmark(r:Resident,knownRef:string,kind:MapKind,p:Vec3,tick:number,depleted=false):void{
 const m=memory(r),cell=cellFor(m,p);m.landmarks[knownRef]={knownRef,kind,...cell,seenTick:tick,state:depleted?'depleted':'remembered'};rememberMapCell(r,p,tick,kind==='wall');
 const entries=Object.entries(m.landmarks);if(entries.length>64){entries.sort((a,b)=>a[1].seenTick-b[1].seenTick);for(const [key]of entries.slice(0,entries.length-64))delete m.landmarks[key];}
}
export function rememberedCellCenter(r:Resident,x:number,z:number):Vec3|null{
 const m=r.spatialMemory;if(!m)return null;return {x:m.origin.x+(x+.5)*m.cellSize,y:r.position.y,z:m.origin.z+(z+.5)*m.cellSize};
}
/** Coordinates are coarse cells relative to this resident's own starting point, not world coordinates. */
export function buildSpatialContext(r:Resident):SpatialMemoryContext|undefined{
 const m=r.spatialMemory;if(!m)return undefined;
 return {frame:'personal_start_relative',cellSize:m.cellSize,currentCell:cellFor(m,r.position),cells:Object.values(m.cells).map(c=>({x:c.x,z:c.z,state:c.blocked?'blocked':c.visitedTick!==undefined?'visited':'seen'})),trail:m.trail.map(c=>({...c})),landmarks:Object.values(m.landmarks).map(l=>({knownRef:l.knownRef,kind:l.kind,x:l.x,z:l.z,state:l.state,lastObservedWhen:experiencedWhen(l.seenTick)}))};
}
