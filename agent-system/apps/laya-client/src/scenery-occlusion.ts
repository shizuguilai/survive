import {normalizedYaw,projectToStage,type MapCamera,type MapViewport} from './map-camera.ts';

type Position={x:number;y:number;z:number};
export type SceneryRect={x:number;y:number;width:number;height:number};
export type SceneryFrame={width:number;height:number;anchor:readonly number[]};
// Match the orthographic observer camera's height 28 / ground radius 20.
const TILT_SIN=28/Math.hypot(28,20),TILT_COS=20/Math.hypot(28,20);

/** Ground depth increases toward the camera; raised heads never reverse this order. */
export function sceneryGroundDepth(position:Position,camera:MapCamera):number{
 const yaw=normalizedYaw(camera.yaw);return position.x*Math.sin(yaw)+position.z*Math.cos(yaw);
}

/** Only scenery in front of an overlapping body may become translucent. */
export function sceneryOccludesResident(position:Position,rect:SceneryRect,resident:Position,camera:MapCamera,viewport:MapViewport,height=1.95):boolean{
 if(sceneryGroundDepth(resident,camera)>=sceneryGroundDepth(position,camera)-.01)return false;
 const unit=viewport.height/camera.zoom,foot=projectToStage(resident,camera,viewport),head=projectToStage({...resident,y:resident.y+height},camera,viewport),radius=.55*unit;
 return foot.x+radius>rect.x&&foot.x-radius<rect.x+rect.width&&foot.y>rect.y&&head.y<rect.y+rect.height;
}

/**
 * Local vertices for native, depth-tested painted scenery. Upright quads remain
 * vertical in the world, so a resident in front stays in front from feet to head.
 * Their stretched world height preserves the original 2D image exactly. The
 * node rotates around Y with camera yaw; ground art uses the same projection.
 */
export function sceneryQuad(frame:SceneryFrame,width:number,uv:readonly number[],flat=false):Float32Array{
 const scale=width/frame.width,vertices:number[]=[];
 for(const [x,y,corner]of [[0,0,0],[frame.width,0,1],[0,frame.height,3],[frame.width,frame.height,2]]){
  const right=(x-frame.anchor[0])*scale,down=(y-frame.anchor[1])*scale;
  vertices.push(right,flat?.012:-down/TILT_COS,flat?down/TILT_SIN:0,uv[corner*2],uv[corner*2+1]);
 }
 return new Float32Array(vertices);
}
