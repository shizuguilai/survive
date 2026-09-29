import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {clampMapCamera,groundAtScreen,projectToStage,cameraFootprint,beginMapPinch,moveMapPinch,worldToMinimap,minimapToWorld} from '../apps/laya-client/src/map-camera.ts';
const viewport={x:0,y:84,width:1280,height:570};
const approx=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('Map projection is exact between input events without a refreshed renderer, for both sidebar layouts',()=>{
 for(const left of [0,292])for(const zoom of [9,18,24]){
  const v={...viewport,x:left,width:1280-left},c={x:2,z:-7,zoom};
  for(const p of [{x:0,z:0},{x:-12.3,z:5.9},{x:13.7,z:-16.2}]){const screen=projectToStage({...p,y:0},c,v),q=groundAtScreen(screen,c,v);approx(q.x,p.x);approx(q.z,p.z);}
  const focus=projectToStage({x:2,y:0,z:-7},c,v);approx(focus.x,left+(1280-left)/2);approx(focus.y,369);
  const raised=projectToStage({x:2,y:2,z:-7},c,v);assert.ok(raised.y<focus.y);
 }
});
test('All pan and zoom limits keep the entire visible ground within the terrain, including malformed values',()=>{
 for(const left of [0,292])for(const zoom of [NaN,Infinity,1,9,18,48,1000])for(const x of [-1e6,0,1e6])for(const z of [-1e6,0,1e6]){
  const v={...viewport,x:left,width:1280-left},c=clampMapCamera({x,z,zoom},v),b=cameraFootprint(c,v);
  assert.ok(Object.values(c).every(Number.isFinite));assert.ok(b.minX>=-27.50001&&b.maxX<=27.50001&&b.minZ>=-27.50001&&b.maxZ<=27.50001);
 }
});
test('Two-finger translation keeps scale, spacing jitter is ignored, and real pinching preserves the point under the fingers',()=>{
 const c={x:0,z:0,zoom:18},a={id:1,pos:{x:450,y:350}},b={id:2,pos:{x:650,y:350}},p=beginMapPinch(a,b,c,viewport);
 const moved=moveMapPinch(p,[{...a,pos:{x:500,y:380}},{...b,pos:{x:702,y:380}}],viewport)!;assert.equal(moved.zoom,18);
 const mid={x:601,y:380},anchor=groundAtScreen(mid,moved,viewport);approx(anchor.x,p.anchor.x);approx(anchor.z,p.anchor.z);
 const enlarged=moveMapPinch(p,[{...a,pos:{x:400,y:350}},{...b,pos:{x:700,y:350}}],viewport)!;assert.ok(enlarged.zoom<18);const point=groundAtScreen({x:550,y:350},enlarged,viewport);approx(point.x,p.anchor.x);approx(point.z,p.anchor.z);
 const shrunk=moveMapPinch(p,[{...a,pos:{x:490,y:350}},{...b,pos:{x:610,y:350}}],viewport)!;assert.ok(shrunk.zoom>18);
});
test('At the map boundary the camera responds immediately to a reversed drag',()=>{
 const a={id:1,pos:{x:450,y:350}},b={id:2,pos:{x:650,y:350}},p=beginMapPinch(a,b,{x:0,z:0,zoom:18},viewport);
 const edge=moveMapPinch(p,[{...a,pos:{x:2450,y:350}},{...b,pos:{x:2650,y:350}}],viewport)!;
 const back=moveMapPinch(p,[{...a,pos:{x:2440,y:350}},{...b,pos:{x:2640,y:350}}],viewport)!;assert.ok(back.x>edge.x);assert.equal(back.zoom,edge.zoom);
});
test('Minimap positions round-trip and dragging beyond it clamps to the map',()=>{
 for(const p of [{x:0,z:0},{x:28,z:-28},{x:-7,z:19}]){const q=minimapToWorld(worldToMinimap(p,176),176);approx(p.x,q.x);approx(p.z,q.z);}
 assert.deepEqual(minimapToWorld({x:-500,y:500},176),{x:-28,z:28});
});

const L:any={stage:{mouseX:0,mouseY:0},Vector3:class{x:number;y:number;z:number;constructor(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;}}};(globalThis as any).Laya=L;
const bundle=await build({entryPoints:['apps/laya-client/src/view.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {ObserverView}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function view(){const v:any=Object.create(ObserverView.prototype);Object.assign(v,{zoom:9,offset:{x:0,z:0},sidebarCollapsed:true,pinch:null,pendingPinch:null,suppressTap:false,drag:null,zoneDrawing:false,sceneInput:{},camera:{transform:{lookAt(){}},orthographicVerticalSize:9},state:{world:createCrewWorld(2),selectedId:'resident-a'},positionLabels(){}});return v;}
const touch=(v:any,id:number,x:number,y=350)=>({touchId:id,began:true,pos:{x,y},downTargets:[v.sceneInput]});
test('Real view handlers batch per-finger events: parallel movement at minimum zoom never ratchets scale or drifts',()=>{
 const v=view(),a=touch(v,1,500),b=touch(v,2,700),before=hashCanonical(v.state.world);
 v.pointerDown({touchId:1,touches:[a],stageX:500,stageY:350});v.pointerDown({touchId:2,touches:[a,b]});
 a.pos.x-=40;v.pointerMove({touchId:1,touches:[a,b]});assert.equal(v.zoom,9);
 b.pos.x-=40;v.pointerMove({touchId:2,touches:[a,b]});v.flushPinch();assert.equal(v.zoom,9);approx(v.offset.x,40*9/570);
 const offset={...v.offset};for(let n=0;n<50;n++){v.pointerMove({touchId:1,touches:[a,b]});v.flushPinch();}assert.deepEqual(v.offset,offset);assert.equal(hashCanonical(v.state.world),before);
});
test('A third finger cannot replace the gesture pair; lifting a finger cannot become a pan or tap',()=>{
 const v=view(),a=touch(v,1,500),b=touch(v,2,700),extra=touch(v,3,1050);
 v.pointerDown({touchId:1,touches:[a]});v.pointerDown({touchId:2,touches:[a,b]});v.pointerDown({touchId:3,touches:[extra,b,a]});
 extra.pos.x=1200;v.pointerMove({touchId:3,touches:[extra,b,a]});v.flushPinch();assert.equal(v.zoom,9);assert.deepEqual(v.offset,{x:0,z:0});
 v.pointerUp({touchId:3,touches:[extra,b,a]});assert.ok(v.pinch);
 b.began=false;v.pointerUp({touchId:2,touches:[a,b]});assert.equal(v.pinch,null);assert.equal(v.drag,null);
 a.pos.x+=100;v.pointerMove({touchId:1,touches:[a],stageX:a.pos.x,stageY:350});assert.deepEqual(v.offset,{x:0,z:0});
 a.began=false;v.pointerUp({touchId:1,touches:[a]});assert.equal(v.suppressTap,false);
 v.pointerDown({stageX:600,stageY:350});v.pointerMove({stageX:620,stageY:350});assert.ok(v.offset.x<0);
});
test('A touch starting on another UI control cannot move or release a single-finger world drag',()=>{
 const v=view(),a=touch(v,1,500);
 v.pointerDown({touchId:1,touches:[a],stageX:500,stageY:350});
 v.pointerMove({touchId:2,touches:[a],stageX:1100,stageY:550});v.pointerUp({touchId:2,touches:[a]});
 assert.deepEqual(v.offset,{x:0,z:0});assert.ok(v.drag);
 v.pointerMove({touchId:1,touches:[a],stageX:520,stageY:350});assert.ok(v.offset.x<0);
});
