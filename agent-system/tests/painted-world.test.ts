import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {HOME_DESIGNS} from '../packages/sim-core/src/home-design.ts';

const bundle=await build({entryPoints:['apps/laya-client/src/painted-world.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {PaintedWorld,loadCampArt}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
class Sprite{
 children:Sprite[]=[];graphics={clear(){},drawEllipse(){}};x=0;y=0;width=0;height=0;
 addChild(child:Sprite){this.children.push(child);}
 pos(x:number,y:number){this.x=x;this.y=y;}
 size(width:number,height:number){this.width=width;this.height=height;}
 destroy(){}
}
class NativeSprite extends Sprite{transform:any={};meshRenderer:any={};meshFilter:any={};}
class Material{static RENDERMODE_CUTOUT=1;static RENDERMODE_TRANSPARENT=2;destroy(){}}
const engine=()=>({Sprite,Text:Sprite,Sprite3D:NativeSprite,MeshSprite3D:NativeSprite,UnlitMaterial:Material,RenderState:{CULL_NONE:0},Color:class{},Vector3:class{},PrimitiveMesh:{_createMesh(){return {};}},VertexMesh:{getVertexDeclaration(){return {};}},Rectangle:class{},Loader:{IMAGE:'image'},loader:{async load(){return {};}},Texture:{createFromTexture(){return {uv:[0,0,1,0,1,1,0,1],bitmap:{}};}}});

test('Painted scenery never replaces house geometry when roofs or camera angles change',async()=>{
 const previous=(globalThis as any).Laya;
 (globalThis as any).Laya=engine();
 try{
  await loadCampArt();const painted=new PaintedWorld(),world=createCrewWorld(2);
  world.residents=[];
  world.objects=HOME_DESIGNS.flatMap(design=>[1,2,3].map(buildStage=>({id:`house-${design.id}-${buildStage}`,kind:'house' as const,position:{x:0,y:0,z:0},width:design.width,depth:design.depth,height:4,appearance:'home',resources:0,homeDesign:design.id,buildStage})));
  world.objects.push({id:'painted-tree',kind:'tree',position:{x:8,y:0,z:8},width:1,depth:1,height:3,appearance:'tree',resources:8});
  for(const yaw of [0,.001,Math.PI/2,Math.PI])for(const roofs of [true,false,true]){
   painted.render(world,{x:0,z:0,zoom:18,yaw},{x:0,y:0,width:900,height:600},roofs);
   for(const house of world.objects.filter(o=>o.kind==='house'))assert.equal(painted.hasObject(house.id),false,`${house.id}, yaw ${yaw}, roofs ${roofs}`);
   assert.equal(painted.hasObject('painted-tree'),true);
  }
 }finally{(globalThis as any).Laya=previous;}
});

test('The real painted renderer keeps front scenery opaque and reuses native meshes when its resident moves behind it',async()=>{
 const previous=(globalThis as any).Laya;(globalThis as any).Laya=engine();
 try{
  await loadCampArt();const painted=new PaintedWorld(),world=createCrewWorld(2),resident=world.residents[0],board=world.objects.find(o=>o.kind==='board')!;
  world.objects=[board];world.residents=[resident];const viewport={x:0,y:68,width:1280,height:578};
  for(const yaw of [0,Math.PI/4,Math.PI/2,Math.PI]){
   const camera={x:0,z:0,zoom:18,yaw};resident.position={...board.position,x:board.position.x+.65*Math.sin(yaw),z:board.position.z+.65*Math.cos(yaw)};
   painted.render(world,camera,viewport,false);const item=painted.sprites.get(board.id),mesh=item.root.meshFilter.sharedMesh;
   assert.equal(item.image.alpha,1);assert.equal(item.material.renderMode,Material.RENDERMODE_CUTOUT);assert.equal(painted.node.children[0],item.root);assert.equal(painted.root.children.length,0,'Painted scenery must not cover native residents through a 2D overlay');
   resident.position={...board.position,x:board.position.x-.65*Math.sin(yaw),z:board.position.z-.65*Math.cos(yaw)};painted.render(world,camera,viewport,false);
   assert.equal(item.image.alpha,.3);assert.equal(item.material.renderMode,Material.RENDERMODE_TRANSPARENT);assert.equal(item.root.meshFilter.sharedMesh,mesh);
   resident.position={...board.position,x:board.position.x+3*Math.cos(yaw),z:board.position.z-3*Math.sin(yaw)};painted.render(world,camera,viewport,false);
   assert.equal(item.image.alpha,1);assert.equal(item.material.renderMode,Material.RENDERMODE_CUTOUT);assert.equal(item.root.meshFilter.sharedMesh,mesh);
  }
 }finally{(globalThis as any).Laya=previous;}
});

test('Harvesting removes painted berries while the leafy bush retains its size and native-rendering identity',async()=>{
 const previous=(globalThis as any).Laya;(globalThis as any).Laya=engine();
 try{
  await loadCampArt();const painted=new PaintedWorld(),world=createCrewWorld(2),berry=world.objects.find(o=>o.kind==='berry')!;
  world.objects=[berry];world.residents=[];const camera={x:0,z:0,zoom:18},viewport={x:0,y:68,width:1280,height:578};let node:any,fullWidth=0;
  for(const resources of [12,6,1,0,12]){
   berry.resources=resources;painted.render(world,camera,viewport,false);const item=painted.sprites.get(berry.id);
   assert.equal(painted.hasObject(berry.id),true,'Depleted berries must never expose the primitive fallback');
   assert.equal(item.frame,resources?'berryBush':'berryBushEmpty');assert.equal(item.image.alpha,1);
   if(!node){node=item.root;fullWidth=item.image.width;}assert.equal(item.root,node);assert.ok(Math.abs(item.image.width-fullWidth)<1e-8);
  }
 }finally{(globalThis as any).Laya=previous;}
});
