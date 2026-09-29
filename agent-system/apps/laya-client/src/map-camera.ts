import {boundedZoom} from './interaction.ts';

export type MapPoint={x:number;z:number};
export type ScreenPoint={x:number;y:number};
export type MapCamera={x:number;z:number;zoom:number};
export type MapViewport={x:number;y:number;width:number;height:number};
export type MapTouch={id:number;pos:ScreenPoint};
export type MapPinch={ids:[number,number];distance:number;zoom:number;anchor:MapPoint};
export const MAP_HALF=28;
// Matches the fixed orthographic camera at (x,28,z+20), looking at (x,0,z).
const TILT_SIN=28/Math.hypot(28,20),TILT_COS=20/Math.hypot(28,20);
const finite=(n:number,fallback:number)=>Number.isFinite(n)?n:fallback;
export function cameraExtent(zoom:number,v:MapViewport){return {x:zoom*v.width/v.height/2,z:zoom/TILT_SIN/2};}
export function clampMapCamera(c:MapCamera,v:MapViewport):MapCamera{
 const edge=MAP_HALF-.5,maxZoom=Math.min(48,edge*2*v.height/v.width,edge*2*TILT_SIN);
 const zoom=Math.min(maxZoom,boundedZoom(finite(c.zoom,18))),extent=cameraExtent(zoom,v);
 return {zoom,x:Math.max(-edge+extent.x,Math.min(edge-extent.x,finite(c.x,0))),z:Math.max(-edge+extent.z,Math.min(edge-extent.z,finite(c.z,0)))};
}
/** Full precision stage coordinates; never invert a cached, integer-rounded render matrix. */
export function groundAtScreen(p:ScreenPoint,c:MapCamera,v:MapViewport):MapPoint{
 const scale=v.height/c.zoom;return {x:c.x+(p.x-v.x-v.width/2)/scale,z:c.z+(p.y-v.y-v.height/2)/(scale*TILT_SIN)};
}
export function projectToStage(p:MapPoint&{y:number},c:MapCamera,v:MapViewport):ScreenPoint{
 const scale=v.height/c.zoom;return {x:v.x+v.width/2+(p.x-c.x)*scale,y:v.y+v.height/2+((p.z-c.z)*TILT_SIN-p.y*TILT_COS)*scale};
}
export function cameraFootprint(c:MapCamera,v:MapViewport){const e=cameraExtent(c.zoom,v);return {minX:c.x-e.x,maxX:c.x+e.x,minZ:c.z-e.z,maxZ:c.z+e.z};}
export function beginMapPinch(a:MapTouch,b:MapTouch,c:MapCamera,v:MapViewport):MapPinch{
 return {ids:[a.id,b.id],distance:Math.max(12,Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y)),zoom:c.zoom,anchor:groundAtScreen({x:(a.pos.x+b.pos.x)/2,y:(a.pos.y+b.pos.y)/2},c,v)};
}
export function moveMapPinch(p:MapPinch,points:MapTouch[],v:MapViewport):MapCamera|null{
 const a=points.find(t=>t.id===p.ids[0]),b=points.find(t=>t.id===p.ids[1]);if(!a||!b)return null;
 const mid={x:(a.pos.x+b.pos.x)/2,y:(a.pos.y+b.pos.y)/2},distance=Math.max(12,Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y));
 // Translating two fingers naturally changes their spacing a little. That is still a pan.
 const change=distance-p.distance,slop=Math.max(6,p.distance*.035),effective=p.distance+Math.sign(change)*Math.max(0,Math.abs(change)-slop);
 const zoom=p.zoom*p.distance/Math.max(12,effective),at=groundAtScreen(mid,{x:0,z:0,zoom},v);
 const desired={x:p.anchor.x-at.x,z:p.anchor.z-at.z,zoom},camera=clampMapCamera(desired,v);
 if(Math.abs(desired.x-camera.x)>1e-8||Math.abs(desired.z-camera.z)>1e-8||Math.abs(zoom-camera.zoom)>1e-8){
  // At an edge/zoom limit, rebase to the visible map so a reverse movement responds immediately.
  p.anchor=groundAtScreen(mid,camera,v);p.distance=distance;p.zoom=camera.zoom;
 }
 return camera;
}
export function worldToMinimap(p:MapPoint,size:number):ScreenPoint{return {x:(p.x+MAP_HALF)/(MAP_HALF*2)*size,y:(p.z+MAP_HALF)/(MAP_HALF*2)*size};}
export function minimapToWorld(p:ScreenPoint,size:number):MapPoint{return {x:(Math.max(0,Math.min(size,p.x))/size*2-1)*MAP_HALF,z:(Math.max(0,Math.min(size,p.y))/size*2-1)*MAP_HALF};}
