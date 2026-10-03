import {MAX_MAP_ZOOM} from '../../../packages/sim-core/src/map-config.ts';
export const boundedZoom=(value:number)=>Math.max(9,Math.min(MAX_MAP_ZOOM,value));
export const pinchZoom=(initialZoom:number,initialDistance:number,distance:number)=>boundedZoom(initialZoom*Math.max(12,initialDistance)/Math.max(12,distance));
/** Stable hit order lets taps cycle stacked residents without relying on draw order. */
export function cycleHit(candidates:{id:string;distance:number}[],selected:string):string|null{
  const hits=[...candidates].sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
  if(!hits.length)return null;const current=hits.findIndex(h=>h.id===selected);
  return hits[(current+1)%hits.length].id;
}
