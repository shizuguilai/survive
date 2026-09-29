import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
// Exercise the shipped gesture handlers with Laya's observed TouchInfo event shape.
(globalThis as any).Laya={stage:{mouseX:600,mouseY:350}};
const bundle=await build({entryPoints:['apps/laya-client/src/view.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {ObserverView}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function viewFixture(){
 const v:any=Object.create(ObserverView.prototype),w=createCrewWorld(2);
 w.residents.forEach(r=>r.position={x:600,y:0,z:0});
 Object.assign(v,{zoom:18,camera:{},offset:{x:0,z:0},sceneInput:{},pinch:null,suppressTap:false,drag:null,zoneDrawing:false,sidebarCollapsed:true,state:{world:w,selectedId:w.residents[0].id},api:{onSelect:(id:string)=>v.state.selectedId=id},groundAt:(x:number,y:number)=>({x,z:y}),project:(p:any)=>({x:p.x,y:350-p.y*20}),positionLabels:()=>{},moveCamera:()=>{},layoutInspector:()=>{}});
 return v;
}
test('A complete two-finger pinch and release never becomes a character tap',()=>{
 const v=viewFixture(),a={touchId:11,began:true,pos:{x:500,y:350},downTargets:[v.sceneInput]},b={touchId:12,began:true,pos:{x:600,y:350},downTargets:[v.sceneInput]};
 v.pointerDown({touchId:11,touches:[a],stageX:500,stageY:350});v.pointerDown({touchId:12,touches:[a,b],stageX:600,stageY:350});
 b.pos.x=700;v.pointerMove({touchId:12,touches:[a,b],stageX:700,stageY:350});v.flushPinch();assert.ok(v.zoom>=9&&v.zoom<10);
 v.pointerUp({touchId:12,touches:[a,b],stageX:700,stageY:350});assert.equal(v.drag,null);
 v.pointerUp({touchId:11,touches:[a],stageX:600,stageY:330});assert.equal(v.state.selectedId,'resident-a');assert.equal(v.suppressTap,false);assert.equal(v.drag,null);
});
test('Repeated scene taps cycle overlapping people, open details, and slow drags do not select',()=>{
 const v=viewFixture(),e={stageX:600,stageY:330};v.pointerDown(e);v.pointerUp(e);assert.equal(v.state.selectedId,'resident-b');assert.equal(v.sidebarCollapsed,false);
 v.pointerDown(e);v.pointerUp(e);assert.equal(v.state.selectedId,'resident-a');
 v.pointerDown(e);for(let i=1;i<=6;i++)v.pointerMove({...e,stageX:600+i*2});v.pointerUp({...e,stageX:612});assert.equal(v.state.selectedId,'resident-a');
 v.state.world.objects=[{id:'clicked-tree',kind:'tree',position:{x:900,y:0,z:0},height:4,width:1}];const tree={stageX:900,stageY:300};v.pointerDown(tree);v.pointerUp(tree);assert.equal(v.selectedObject,'clicked-tree');
});
