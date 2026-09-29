import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {HOME_DESIGNS,homeLayout,homeHeight} from '../packages/sim-core/src/home-design.ts';
const bundle=await build({entryPoints:['apps/laya-client/src/world-mesh.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {WorldMesh}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
class Vector{ x:number;y:number;z:number;constructor(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;} }
class Node{
 name:string;children:Node[]=[];active=true;geometry:any;meshRenderer:any={};transform:any={localScale:new Vector(1,1,1),localRotationEuler:new Vector(0,0,0)};
 constructor(a:any,b?:string){this.name=b??a;this.geometry=b?a:null;}addChild(n:Node){this.children.push(n);}destroy(){}
}
class Material{static RENDERMODE_TRANSPARENT=2;destroy(){} }
const primitive=(kind:string)=>(...size:number[])=>({kind,size,destroy(){}});
(globalThis as any).Laya={Vector3:Vector,Sprite3D:Node,MeshSprite3D:Node,Color:class{r:number;g:number;b:number;a:number;constructor(r:number,g:number,b:number,a:number){Object.assign(this,{r,g,b,a});this.r=r;this.g=g;this.b=b;this.a=a;}},BlinnPhongMaterial:Material,UnlitMaterial:Material,RenderState:{CULL_FRONT:1},PrimitiveMesh:{createBox:primitive('box'),createSphere:primitive('sphere'),createCylinder:primitive('cylinder'),createCone:primitive('cone')}};
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
test('Chopped trees have only a small stump contact shadow; leaning tree growth never tilts the ground shadow',()=>{
 const w=createCrewWorld(2),tree=w.objects.find(o=>o.kind==='tree')!,before=hashCanonical(w),full=new WorldMesh(tree),cut=new WorldMesh({...tree,resources:0}),lean=new WorldMesh({...tree,resources:1});
 const shadow=(mesh:any)=>mesh.node.children.find((n:Node)=>n.name==='contact shadow');
 assert.ok(shadow(cut).geometry.size[0]<shadow(full).geometry.size[0]/3);assert.equal(shadow(cut).transform.localPosition.x,0);
 assert.ok(all(cut.node).some(n=>n.name==='stump cut surface'));assert.ok(!all(cut.node).some(n=>n.name.includes('crown')));
 assert.equal(lean.node.transform.localRotationEuler.z,0);assert.equal(shadow(lean).transform.localRotationEuler.z,0);assert.equal(lean.node.children.find((n:Node)=>n.name==='tree growth').transform.localRotationEuler.z,16);
 assert.equal(hashCanonical(w),before);
});
test('The lamp has a stand, framed transparent lantern, hood and night bulb; no solid floor light disk',()=>{
 const object={id:'home',kind:'house',position:{x:0,y:0,z:0},width:4,depth:3,height:3,resources:0,buildStage:3,furniture:{lamp:true}},mesh=new WorldMesh(object),parts=all(mesh.node),find=(name:string)=>parts.find(n=>n.name===name)!;
 for(const name of ['lamp foot','lamp stem','lantern glass','lantern frame post','lantern hood'])assert.ok(find(name));
 assert.equal(parts.some(n=>n.name==='lamp pool'),false);assert.equal(find('lantern hood').geometry.kind,'cone');assert.equal(find('lantern glass').meshRenderer.sharedMaterial.renderMode,2);
 mesh.setNight(false);assert.equal(find('lamp glow').active,false);mesh.setNight(true);assert.equal(find('lamp glow').active,true);assert.ok(find('lantern glass').meshRenderer.sharedMaterial.albedoColor.a<.5);
 mesh.setRoofVisible(false);assert.equal(find('lamp stem').active,true);assert.equal(find('sloping roof').active,false);
});
test('Personal houses have distinct native roof shapes, colors and furniture positions matching the simulation',()=>{
 const colors=new Set<string>(),shapes=new Set<string>();
 for(const d of HOME_DESIGNS){const object={id:'home-'+d.id,kind:'house' as const,homeDesign:d.id,position:{x:0,y:0,z:0},width:d.width,depth:d.depth,height:4,appearance:'home',resources:0,buildStage:3,furniture:{bed:true,cabinet:true,lamp:true,mop:true}},before=hashCanonical(object),mesh=new WorldMesh(object),parts=all(mesh.node),find=(name:string)=>parts.find(n=>n.name===name)!;
  const roof=find('sloping roof'),frame=find('roof frame'),bed=find('bed mattress'),cabinet=find('personal cabinet'),layout=homeLayout(object);
  colors.add(JSON.stringify(roof.meshRenderer.sharedMaterial.albedoColor));shapes.add(JSON.stringify([roof.geometry.size,roof.transform.localRotationEuler,frame.transform.localRotationEuler]));
  assert.equal(Math.abs(roof.transform.localRotationEuler.z),d.pitch);assert.equal(frame.transform.localRotationEuler.y,d.across==='depth'?90:0);
  assert.equal(bed.transform.localPosition.x,layout.bed.x);assert.equal(bed.transform.localPosition.z,layout.bed.z);assert.equal(cabinet.transform.localPosition.x,layout.cabinet.x);assert.equal(find('lamp foot').transform.localPosition.z,layout.lamp.z);
  assert.equal(parts.some(n=>n.name==='window shutter'),d.shutters);assert.ok(find('chimney cap').transform.localPosition.y+.065<homeHeight(object));
  mesh.setRoofVisible(false);for(const p of parts.filter(n=>/sloping roof|roof ridge|roof shingle seam|chimney/.test(n.name)))assert.equal(p.active,false);assert.equal(bed.active,true);assert.equal(hashCanonical(object),before);
 }
 assert.equal(colors.size,6);assert.equal(shapes.size,6);
});
