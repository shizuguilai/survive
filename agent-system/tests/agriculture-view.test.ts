import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {DEFAULT_MAP_ZOOM} from '../packages/sim-core/src/map-config.ts';

class Vector{x:number;y:number;z:number;constructor(x:number,y:number,z:number){Object.assign(this,{x,y,z});this.x=x;this.y=y;this.z=z;}}
(globalThis as any).Laya={stage:{mouseX:600,mouseY:350},Vector3:Vector,Rectangle:class{}};
const bundle=await build({entryPoints:['apps/laya-client/src/view.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {ObserverView}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=survive-agriculture-view.mjs').toString('base64'));
function fixture(){
 const v:any=Object.create(ObserverView.prototype),world=createCrewWorld(2);world.camp!.zones=[];
 const button=()=>({root:{visible:false,mouseEnabled:true,alpha:1},label:{text:''},set(text:string){this.label.text=text;}});
 const overlay={visible:false,clears:0,polygons:[] as any[][],pos(){},graphics:{clear(){overlay.clears++;overlay.polygons=[];},drawPoly(...args:any[]){overlay.polygons.push(args);},drawLine(){},drawCircle(){}}};
 const minimapCalls:any[][]=[];
 Object.assign(v,{state:{world,selectedId:world.residents[0].id,status:'PAUSED'},zoneOverlay:overlay,zoneRevision:'',zoneDrawing:false,showZones:false,zoneDraft:null,zoneStart:null,draftKind:'planting',draftCrop:'corn',draftAnimal:'goose',taskNote:{text:'test note'},drag:null,pinch:null,pendingPinch:null,suppressTap:false,sceneInput:{},sidebarCollapsed:true,offset:{x:0,z:0},zoom:32,yaw:0,camera:{transform:{lookAt(){}},orthographicVerticalSize:32},buttons:{zoneCancel:button(),zoneConfirm:button(),zoneToggle:button()},labels:{zoneHint:{text:'',visible:false}},minimap:{render(...args:any[]){minimapCalls.push(args);}},api:{onTask(){return true;}},positionLabels(){}});
 return {v,world,overlay,minimapCalls};
}

test('Planning temporarily shows each region type on both maps and restores the saved visibility preference',()=>{
 const {v,world,overlay,minimapCalls}=fixture();world.camp!.zones=[{id:'home',taskId:'home',bounds:{minX:-20,maxX:-14,minZ:-20,maxZ:-14}},{id:'farm',taskId:'farm',kind:'planting',bounds:{minX:20,maxX:26,minZ:-20,maxZ:-14}},{id:'birds',taskId:'birds',kind:'pasture',bounds:{minX:20,maxX:26,minZ:20,maxZ:26}}];
 const before=hashCanonical(world);v.drawZones();assert.equal(overlay.visible,false);
 v.beginZone();assert.equal(overlay.visible,true);assert.equal(minimapCalls.at(-1)![3],true);assert.equal(v.buttons.zoneToggle.root.mouseEnabled,false);
 assert.deepEqual(new Set(overlay.polygons.map(args=>args[3])),new Set(['rgba(174,133,204,0.10)','rgba(133,174,81,0.10)','rgba(221,174,93,0.10)']));
 const clears=overlay.clears;v.drawZones();assert.equal(overlay.clears,clears,'unchanged overlay uses its cached geometry');
 v.cancelZone();assert.equal(v.showZones,false);assert.equal(overlay.visible,false);assert.equal(minimapCalls.at(-1)![3],false);assert.equal(v.buttons.zoneToggle.root.mouseEnabled,true);
 v.showZones=true;v.beginZone();v.cancelZone();assert.equal(overlay.visible,true);assert.equal(minimapCalls.at(-1)![3],true);assert.equal(hashCanonical(world),before);
});

test('Typed confirmations retain chosen crop or poultry and keep rejected drafts available for correction',()=>{
 for(const kind of ['residential','planting','pasture']){
  const {v,world}=fixture(),submitted:any[]=[];world.objects=[];v.draftKind=kind;v.beginZone();v.zoneDraft={minX:35,maxX:kind==='residential'?41:39,minZ:35,maxZ:kind==='residential'?41:39};
  v.updateZoneHint();assert.equal(v.buttons.zoneConfirm.root.mouseEnabled,true);assert.equal(v.buttons.zoneConfirm.label.text,'确认'+({residential:'居住区',planting:'种植区',pasture:'畜牧区'} as any)[kind]);
  v.api.onTask=(draft:any)=>{submitted.push(draft);return false;};v.commitZone();assert.equal(v.zoneDrawing,true);assert.ok(v.zoneDraft);
  assert.deepEqual(submitted[0],{kind,resource:kind==='residential'?'wood':'food',amount:1,note:'test note',bounds:{...v.zoneDraft},...(kind==='planting'?{cropKind:'corn'}:kind==='pasture'?{animalKind:'goose'}:{})});
  v.api.onTask=()=>true;v.commitZone();assert.equal(v.zoneDrawing,false);assert.equal(v.zoneDraft,null);
 }
 const {v,world}=fixture();world.objects=[];v.draftKind='residential';assert.match(v.zoneError({minX:35,maxX:39,minZ:35,maxZ:39}),/6×6/);
 v.draftKind='planting';assert.equal(v.zoneError({minX:35,maxX:39,minZ:35,maxZ:39}),null);world.camp!.zones=[{id:'birds',taskId:'birds',kind:'pasture',bounds:{minX:35,maxX:39,minZ:35,maxZ:39}}];assert.match(v.zoneError({minX:35,maxX:39,minZ:35,maxZ:39}),/不同用途/);
});

test('Starting a replacement rectangle clears the old highlight and confirmation immediately while paused',()=>{
 const {v,world,overlay}=fixture();world.objects=[];v.beginZone();v.zoneDraft={minX:4,maxX:10,minZ:4,maxZ:10};v.drawZones();v.updateZoneHint();assert.ok(overlay.polygons.length);assert.equal(v.buttons.zoneConfirm.root.mouseEnabled,true);
 v.pointerDown({stageX:650,stageY:350});assert.equal(v.zoneDraft,null);assert.equal(overlay.polygons.length,0);assert.equal(v.buttons.zoneConfirm.root.mouseEnabled,false);
 v.pointerUp({stageX:650,stageY:350});assert.equal(overlay.polygons.length,0);assert.equal(v.zoneDrawing,true);
});

test('Returning to camp restores the wider default view',()=>{
 const {v,world}=fixture(),board=world.objects.find(o=>o.kind==='board')!;v.zoom=9;v.offset={x:35,z:35};v.focusCamp();assert.equal(v.zoom,DEFAULT_MAP_ZOOM);assert.deepEqual(v.offset,{x:board.position.x,z:board.position.z});
});
