import {boundedZoom} from './interaction.ts';

export type MapPoint={x:number;z:number};
export type ScreenPoint={x:number;y:number};
export type MapCamera={x:number;z:number;zoom:number;yaw?:number};
export type MapViewport={x:number;y:number;width:number;height:number};
export type MapTouch={id:number;pos:ScreenPoint};
export type MapPinch={ids:[number,number];distance:number;zoom:number;yaw:number;anchor:MapPoint};
export type MapFootprint={minX:number;maxX:number;minZ:number;maxZ:number;corners?:MapPoint[]};
export const MAP_HALF=28;
// The camera orbits its ground focus at height 28 and horizontal radius 20.
const TILT_SIN=28/Math.hypot(28,20),TILT_COS=20/Math.hypot(28,20);
const finite=(n:number,fallback:number)=>Number.isFinite(n)?n:fallback;
export function normalizedYaw(yaw=0):number{const turn=Math.PI*2;return ((finite(yaw,0)%turn)+turn)%turn;}
export function cameraExtent(zoom:number,v:MapViewport,yaw=0){const x=zoom*v.width/v.height/2,z=zoom/TILT_SIN/2,c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw));return {x:c*x+s*z,z:s*x+c*z};}
export function cameraEye(c:MapCamera){const yaw=normalizedYaw(c.yaw);return {x:c.x+20*Math.sin(yaw),y:28,z:c.z+20*Math.cos(yaw)};}
export function clampMapCamera(c:MapCamera,v:MapViewport):MapCamera{
 const edge=MAP_HALF-.5,yaw=normalizedYaw(c.yaw),unit=cameraExtent(1,v,yaw),maxZoom=Math.min(48,edge/unit.x,edge/unit.z);
 const zoom=Math.min(maxZoom,boundedZoom(finite(c.zoom,18))),extent=cameraExtent(zoom,v,yaw);
 return {zoom,yaw,x:Math.max(-edge+extent.x,Math.min(edge-extent.x,finite(c.x,0))),z:Math.max(-edge+extent.z,Math.min(edge-extent.z,finite(c.z,0)))};
}
/** Full precision stage coordinates; never invert a cached, integer-rounded render matrix. */
export function groundAtScreen(p:ScreenPoint,c:MapCamera,v:MapViewport):MapPoint{
 const scale=v.height/c.zoom,yaw=normalizedYaw(c.yaw),cos=Math.cos(yaw),sin=Math.sin(yaw),right=(p.x-v.x-v.width/2)/scale,down=(p.y-v.y-v.height/2)/(scale*TILT_SIN);
 return {x:c.x+right*cos+down*sin,z:c.z-right*sin+down*cos};
}
export function projectToStage(p:MapPoint&{y:number},c:MapCamera,v:MapViewport):ScreenPoint{
 const scale=v.height/c.zoom,yaw=normalizedYaw(c.yaw),cos=Math.cos(yaw),sin=Math.sin(yaw),dx=p.x-c.x,dz=p.z-c.z;
 return {x:v.x+v.width/2+(dx*cos-dz*sin)*scale,y:v.y+v.height/2+((dx*sin+dz*cos)*TILT_SIN-p.y*TILT_COS)*scale};
}
export function cameraFootprint(c:MapCamera,v:MapViewport):MapFootprint{const e=cameraExtent(c.zoom,v,normalizedYaw(c.yaw));return {minX:c.x-e.x,maxX:c.x+e.x,minZ:c.z-e.z,maxZ:c.z+e.z,corners:[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>groundAtScreen({x:v.x+x*v.width,y:v.y+y*v.height},c,v))};}
export function beginMapPinch(a:MapTouch,b:MapTouch,c:MapCamera,v:MapViewport):MapPinch{
 return {ids:[a.id,b.id],distance:Math.max(12,Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y)),zoom:c.zoom,yaw:normalizedYaw(c.yaw),anchor:groundAtScreen({x:(a.pos.x+b.pos.x)/2,y:(a.pos.y+b.pos.y)/2},c,v)};
}
export function moveMapPinch(p:MapPinch,points:MapTouch[],v:MapViewport):MapCamera|null{
 const a=points.find(t=>t.id===p.ids[0]),b=points.find(t=>t.id===p.ids[1]);if(!a||!b)return null;
 const mid={x:(a.pos.x+b.pos.x)/2,y:(a.pos.y+b.pos.y)/2},distance=Math.max(12,Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y));
 // Translating two fingers naturally changes their spacing a little. That is still a pan.
 const change=distance-p.distance,slop=Math.max(6,p.distance*.035),effective=p.distance+Math.sign(change)*Math.max(0,Math.abs(change)-slop);
 const zoom=p.zoom*p.distance/Math.max(12,effective),at=groundAtScreen(mid,{x:0,z:0,zoom,yaw:p.yaw},v);
 const desired={x:p.anchor.x-at.x,z:p.anchor.z-at.z,zoom,yaw:p.yaw},camera=clampMapCamera(desired,v);
 if(Math.abs(desired.x-camera.x)>1e-8||Math.abs(desired.z-camera.z)>1e-8||Math.abs(zoom-camera.zoom)>1e-8){
  // At an edge/zoom limit, rebase to the visible map so a reverse movement responds immediately.
  p.anchor=groundAtScreen(mid,camera,v);p.distance=distance;p.zoom=camera.zoom;
 }
 return camera;
}
export function worldToMinimap(p:MapPoint,size:number):ScreenPoint{return {x:(p.x+MAP_HALF)/(MAP_HALF*2)*size,y:(p.z+MAP_HALF)/(MAP_HALF*2)*size};}
export function minimapToWorld(p:ScreenPoint,size:number):MapPoint{return {x:(Math.max(0,Math.min(size,p.x))/size*2-1)*MAP_HALF,z:(Math.max(0,Math.min(size,p.y))/size*2-1)*MAP_HALF};}
