import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectToStage} from '../apps/laya-client/src/map-camera.ts';
import {sceneryGroundDepth,sceneryOccludesResident,sceneryQuad} from '../apps/laya-client/src/scenery-occlusion.ts';

const viewport={x:292,y:68,width:988,height:578},frame={width:287,height:260,anchor:[143,247]},width=2.05;
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
test('A board fades only for a resident behind it, through every camera rotation and zoom',()=>{
 for(const yaw of [0,Math.PI/4,Math.PI/2,Math.PI,Math.PI*1.5])for(const zoom of [9,18,32])for(const y of [0,.45]){
  const camera={x:3,z:-4,zoom,yaw},board={x:1,y,z:2},screen=projectToStage(board,camera,viewport),scale=width*viewport.height/zoom/frame.width;
  const rect={x:screen.x-frame.anchor[0]*scale,y:screen.y-frame.anchor[1]*scale,width:frame.width*scale,height:frame.height*scale};
  const front={x:board.x+.65*Math.sin(yaw),y,z:board.z+.65*Math.cos(yaw)},back={x:board.x-.65*Math.sin(yaw),y,z:board.z-.65*Math.cos(yaw)};
  assert.equal(sceneryOccludesResident(board,rect,front,camera,viewport),false,'The board must remain opaque when the resident is in front');
  assert.equal(sceneryOccludesResident(board,rect,back,camera,viewport),true,'The resident behind the board must remain readable');
  assert.equal(sceneryOccludesResident(board,rect,{...back,x:back.x+3*Math.cos(yaw),z:back.z-3*Math.sin(yaw)},camera,viewport),false,'A resident beside the board does not trigger fading');
  assert.equal(sceneryOccludesResident(board,rect,board,camera,viewport),false,'Equal-depth anchors do not flicker between render modes');
  assert.ok(sceneryGroundDepth(front,camera)>sceneryGroundDepth(board,camera));
 }
});

test('Native upright scenery preserves painted size, anchors and atlas UVs at every camera yaw',()=>{
 const uv=[.1,.2,.3,.2,.3,.6,.1,.6],vertices=sceneryQuad(frame,width,uv);
 for(const yaw of [0,Math.PI/4,Math.PI/2,Math.PI])for(const zoom of [9,18,32]){
  const camera={x:-2,z:3,zoom,yaw},anchor={x:5,y:.4,z:-7},screen=projectToStage(anchor,camera,viewport),scale=width*viewport.height/zoom/frame.width;
  for(const [i,px,py]of [[0,0,0],[1,frame.width,0],[2,0,frame.height],[3,frame.width,frame.height]]){
   const x=vertices[i*5],y=vertices[i*5+1],z=vertices[i*5+2];
   const position={x:anchor.x+x*Math.cos(yaw)+z*Math.sin(yaw),y:anchor.y+y,z:anchor.z-x*Math.sin(yaw)+z*Math.cos(yaw)},projected=projectToStage(position,camera,viewport);
   close(projected.x,screen.x+(px-frame.anchor[0])*scale);close(projected.y,screen.y+(py-frame.anchor[1])*scale);
   close(sceneryGroundDepth(position,camera),sceneryGroundDepth(anchor,camera));
  }
 }
 assert.deepEqual(Array.from(vertices).filter((_,i)=>i%5>2).map(v=>Math.round(v*10)/10),[.1,.2,.3,.2,.1,.6,.3,.6]);
});

test('Pond art remains on the ground and rotates without moving its screen footprint',()=>{
 const vertices=sceneryQuad(frame,width,[0,0,1,0,1,1,0,1],true);
 for(const yaw of [0,Math.PI/4,Math.PI/2,Math.PI]){
  const camera={x:0,z:0,zoom:18,yaw},anchor={x:1,y:0,z:2},screen=projectToStage({...anchor,y:.012},camera,viewport),scale=width*viewport.height/18/frame.width;
  for(const [i,px,py]of [[0,0,0],[1,frame.width,0],[2,0,frame.height],[3,frame.width,frame.height]]){
   const x=vertices[i*5],y=vertices[i*5+1],z=vertices[i*5+2],projected=projectToStage({x:anchor.x+x*Math.cos(yaw)+z*Math.sin(yaw),y,z:anchor.z-x*Math.sin(yaw)+z*Math.cos(yaw)},camera,viewport);
   close(y,.012);close(projected.x,screen.x+(px-frame.anchor[0])*scale);close(projected.y,screen.y+(py-frame.anchor[1])*scale);
  }
 }
});
