import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {clampMapCamera,groundAtScreen,projectToStage,focusMapCamera,cameraFootprint,beginMapPinch,moveMapPinch,worldToMinimap,minimapToWorld} from '../apps/laya-client/src/map-camera.ts';
import {MAP_HALF,DEFAULT_MAP_ZOOM,MAX_MAP_ZOOM} from '../packages/sim-core/src/map-config.ts';
const viewport={x:0,y:84,width:1280,height:570};
const approx=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('Map projection is exact between input events without a refreshed renderer, for both sidebar layouts',()=>{
 for(const yaw of Array.from({length:8},(_,i)=>i*Math.PI/4))for(const left of [0,292])for(const zoom of [9,18,24]){
  const v={...viewport,x:left,width:1280-left},c={x:2,z:-7,zoom,yaw};
  for(const p of [{x:0,z:0},{x:-12.3,z:5.9},{x:13.7,z:-16.2}]){const screen=projectToStage({...p,y:0},c,v),q=groundAtScreen(screen,c,v);approx(q.x,p.x);approx(q.z,p.z);}
  const focus=projectToStage({x:2,y:0,z:-7},c,v);approx(focus.x,left+(1280-left)/2);approx(focus.y,369);
  const raised=projectToStage({x:2,y:2,z:-7},c,v);assert.ok(raised.y<focus.y);
 }
});
test('Focusing a resident places their raised head in the clear map area at every camera rotation',()=>{
 for(const yaw of Array.from({length:8},(_,i)=>i*Math.PI/4))for(const left of [0,292])for(const zoom of [9,18,24,32]){
  const v={x:left,y:68,width:1280-left,height:578},c={x:0,z:0,zoom,yaw},head={x:2,y:2.25,z:-4},target={x:(left+1013)/2,y:418};
  const focused=focusMapCamera(head,c,v,target),screen=projectToStage(head,focused,v);
  assert.ok(screen.x>left+30&&screen.x<1013-30&&screen.y>190&&screen.y<646-50,'The head must remain clear of inspector, controls, stock and minimap');
  if(left===292||zoom<32){approx(screen.x,target.x);approx(screen.y,target.y);}approx(focused.zoom,zoom);approx(focused.yaw!,yaw);
 }
});
test('Focusing a resident near the terrain edge obeys the existing camera bounds',()=>{
 for(const yaw of [0,Math.PI/4,Math.PI,Math.PI*1.5]){
  const c=focusMapCamera({x:47,y:2,z:-47},{x:0,z:0,zoom:18,yaw},viewport,{x:652.5,y:418}),b=cameraFootprint(c,viewport);
  assert.ok(b.minX>=-47.500001&&b.maxX<=47.500001&&b.minZ>=-47.500001&&b.maxZ<=47.500001);assert.equal(c.zoom,18);
 }
});
test('All pan and zoom limits keep the entire visible ground within the terrain, including malformed values',()=>{
 for(const yaw of [NaN,...Array.from({length:8},(_,i)=>i*Math.PI/4)])for(const left of [0,292])for(const zoom of [NaN,Infinity,1,9,18,DEFAULT_MAP_ZOOM,MAX_MAP_ZOOM,1000])for(const x of [-1e6,0,1e6])for(const z of [-1e6,0,1e6]){
  const v={...viewport,x:left,width:1280-left},c=clampMapCamera({x,z,zoom,yaw},v),b=cameraFootprint(c,v);
  const edge=MAP_HALF-.5+.00001;
  assert.ok(Object.values(c).every(Number.isFinite));assert.ok(b.minX>=-edge&&b.maxX<=edge&&b.minZ>=-edge&&b.maxZ<=edge);
  for(const p of b.corners!){assert.ok(Math.abs(p.x)<=edge&&Math.abs(p.z)<=edge);}
 }
});
test('The wider default reveals more land and the expanded map supports views beyond the old edge',()=>{
 const current=clampMapCamera({x:0,z:0,zoom:DEFAULT_MAP_ZOOM},viewport),old=cameraFootprint({x:0,z:0,zoom:20},viewport),visible=cameraFootprint(current,viewport);
 assert.equal(current.zoom,32);assert.ok((visible.maxX-visible.minX)>(old.maxX-old.minX)*1.5);
 const edge=clampMapCamera({x:100,z:100,zoom:9},viewport);assert.ok(edge.x>28&&edge.z>28);
 const square={x:0,y:0,width:600,height:600};assert.equal(clampMapCamera({x:0,z:0,zoom:MAX_MAP_ZOOM},square).zoom,MAX_MAP_ZOOM);
});
test('Two-finger translation keeps scale, spacing jitter is ignored, and real pinching preserves the point under the fingers',()=>{
 for(const yaw of Array.from({length:8},(_,i)=>i*Math.PI/4)){
 const c={x:0,z:0,zoom:18,yaw},a={id:1,pos:{x:450,y:350}},b={id:2,pos:{x:650,y:350}},p=beginMapPinch(a,b,c,viewport);
 const moved=moveMapPinch(p,[{...a,pos:{x:500,y:380}},{...b,pos:{x:702,y:380}}],viewport)!;assert.equal(moved.zoom,18);
 const mid={x:601,y:380},anchor=groundAtScreen(mid,moved,viewport);approx(anchor.x,p.anchor.x);approx(anchor.z,p.anchor.z);
 const enlarged=moveMapPinch(p,[{...a,pos:{x:400,y:350}},{...b,pos:{x:700,y:350}}],viewport)!;assert.ok(enlarged.zoom<18);const point=groundAtScreen({x:550,y:350},enlarged,viewport);approx(point.x,p.anchor.x);approx(point.z,p.anchor.z);
 const shrunk=moveMapPinch(p,[{...a,pos:{x:490,y:350}},{...b,pos:{x:610,y:350}}],viewport)!;assert.ok(shrunk.zoom>18);
 }
});
test('At the map boundary the camera responds immediately to a reversed drag',()=>{
 const a={id:1,pos:{x:450,y:350}},b={id:2,pos:{x:650,y:350}},p=beginMapPinch(a,b,{x:0,z:0,zoom:18},viewport);
 const edge=moveMapPinch(p,[{...a,pos:{x:2450,y:350}},{...b,pos:{x:2650,y:350}}],viewport)!;
 const back=moveMapPinch(p,[{...a,pos:{x:2440,y:350}},{...b,pos:{x:2640,y:350}}],viewport)!;assert.ok(back.x>edge.x);assert.equal(back.zoom,edge.zoom);
});
test('Minimap positions round-trip and dragging beyond it clamps to the map',()=>{
 for(const p of [{x:0,z:0},{x:MAP_HALF,z:-MAP_HALF},{x:-7,z:19},{x:43,z:-37}]){const q=minimapToWorld(worldToMinimap(p,176),176);approx(p.x,q.x);approx(p.z,q.z);}
 assert.deepEqual(minimapToWorld({x:-500,y:500},176),{x:-MAP_HALF,z:MAP_HALF});
});

const L:any={stage:{mouseX:0,mouseY:0},Vector3:class{x:number;y:number;z:number;constructor(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;}}};(globalThis as any).Laya=L;
const bundle=await build({entryPoints:['apps/laya-client/src/view.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {ObserverView}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function view(){const v:any=Object.create(ObserverView.prototype);Object.assign(v,{zoom:9,offset:{x:0,z:0},sidebarCollapsed:true,pinch:null,pendingPinch:null,suppressTap:false,drag:null,zoneDrawing:false,sceneInput:{},camera:{transform:{lookAt(){}},orthographicVerticalSize:9},state:{world:createCrewWorld(2),selectedId:'resident-a'},positionLabels(){}});return v;}
const touch=(v:any,id:number,x:number,y=350)=>({touchId:id,began:true,pos:{x,y},downTargets:[v.sceneInput]});
test('Offline planning errors are described as local errors while remote cognition retains its connection status',()=>{
 const v=view();assert.equal(v.humanStatus('ERROR_PAUSED','LOCAL_ALGORITHM'),'本地规划异常 · 已暂停');assert.equal(v.humanStatus('ERROR','LOCAL_ALGORITHM'),'本地规划异常 · 已暂停');assert.equal(v.humanStatus('ERROR_PAUSED','REAL_MODEL'),'认知请求失败 · 世界保持冻结');
});
test('Inspector selection focuses even the already selected resident, cancels stale gestures, and leaves manual pan free',()=>{
 const v=view(),r=v.state.world.residents[1],headHeight=2.3;r.position={x:4,y:0,z:-3};
 Object.assign(v,{sidebarCollapsed:false,zoom:18,yaw:Math.PI/4,selectedObject:'board',senseRevision:'old selection',residents:new Map([[r.id,{height:headHeight}]]),api:{onSelect(id:string){v.state.selectedId=id;}}});
 const before=hashCanonical(v.state.world);v.drag={x:1,y:2};v.pinch={};v.pendingPinch=[];v.suppressTap=true;
 v.selectIndex(1);assert.equal(v.state.selectedId,r.id);assert.equal(v.selectedObject,null);assert.equal(v.senseRevision,'');assert.equal(v.drag,null);assert.equal(v.pinch,null);assert.equal(v.pendingPinch,null);assert.equal(v.suppressTap,false);
 const screen=v.project({...r.position,y:headHeight});approx(screen.x,652.5);approx(screen.y,418);assert.equal(v.zoom,18);assert.equal(v.yaw,Math.PI/4);
 const focused={...v.offset};v.pointerDown({stageX:650,stageY:350});v.pointerMove({stageX:690,stageY:350});assert.notDeepEqual(v.offset,focused);
 v.selectIndex(1);approx(v.offset.x,focused.x);approx(v.offset.z,focused.z);assert.equal(hashCanonical(v.state.world),before);
});
test('Selecting a character in the scene keeps their screen anchor when the inspector opens',()=>{
 const v=view(),r=v.state.world.residents[0];r.position={x:-2,y:0,z:0};v.state.world.residents[1].position={x:7,y:0,z:3};
 Object.assign(v,{yaw:Math.PI/4,residents:new Map([[r.id,{height:2.1}]]),api:{onSelect(id:string){v.state.selectedId=id;}},layoutInspector(){v.moveCamera();},focusResident(){assert.fail('Map taps should keep the under-finger anchor');}});
 const head={...r.position,y:2.1},screen=v.project(head);v.pointerDown({stageX:screen.x,stageY:screen.y});v.pointerUp({stageX:screen.x,stageY:screen.y});
 assert.equal(v.sidebarCollapsed,false);assert.equal(v.state.selectedId,r.id);const after=v.project(head);approx(after.x,screen.x);approx(after.y,screen.y);
});
test('Real view handlers batch per-finger events: parallel movement at minimum zoom never ratchets scale or drifts',()=>{
 const v=view(),a=touch(v,1,500),b=touch(v,2,700),before=hashCanonical(v.state.world);
 v.pointerDown({touchId:1,touches:[a],stageX:500,stageY:350});v.pointerDown({touchId:2,touches:[a,b]});
 a.pos.x-=40;v.pointerMove({touchId:1,touches:[a,b]});assert.equal(v.zoom,9);
 b.pos.x-=40;v.pointerMove({touchId:2,touches:[a,b]});v.flushPinch();assert.equal(v.zoom,9);approx(v.offset.x,40*9/578);
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
test('Rotating the actual view orbits the camera and preserves screen-relative drag without changing the world',()=>{
 const v=view(),before=hashCanonical(v.state.world);v.setYaw(Math.PI/2);
 approx(v.camera.transform.position.x,20);approx(v.camera.transform.position.z,0);
 const ground={x:2,y:0,z:-3},p=v.project(ground),q=v.groundAt(p.x,p.y);approx(q.x,2);approx(q.z,-3);
 v.pointerDown({stageX:600,stageY:350});v.pointerMove({stageX:620,stageY:350});approx(v.offset.x,0);approx(v.offset.z,20*9/578);
 v.setYaw(0);approx(v.yaw,0);assert.equal(hashCanonical(v.state.world),before);
});
test('Landmark labels stay fixed when a resident walks through them, and published tasks retain every entry and scroll offset',()=>{
 const v=view(),w=v.state.world,board=w.objects.find((o:any)=>o.kind==='board'),label:any={pos(x:number,y:number){this.x=x;this.y=y;}};
 Object.assign(v,{art:{render(){},residentTop(){return null;}},objects:new Map(),residents:new Map(),nameLabels:new Map(),placeLabels:new Map([[board.id,label]]),drawMinimap(){},drawZones(){},positionBubbles(){}});
 ObserverView.prototype.positionLabels.call(v);const location={x:label.x,y:label.y};w.residents[0].position={...board.position,z:board.position.z+1};ObserverView.prototype.positionLabels.call(v);assert.deepEqual({x:label.x,y:label.y},location);
 const seed=w.camp.tasks[0];w.camp.tasks=Array.from({length:20},(_,i)=>({...seed,id:'target-'+i,note:'目标说明'+i+'，完整说明不应被截断。'.repeat(5)}));
 const body={text:'',scrollY:85};Object.assign(v,{labels:{taskList:body},taskScroll:{set(y:number){body.scrollY=y;}}});v.renderTaskList(v.state);
 assert.ok(body.text.includes('目标说明0，'));assert.ok(body.text.includes('目标说明19，'));assert.equal(body.scrollY,85);
 const text=body.text;w.camp.tasks[0].progress++;v.renderTaskList(v.state);assert.notEqual(body.text,text);assert.equal(body.scrollY,85);
});
