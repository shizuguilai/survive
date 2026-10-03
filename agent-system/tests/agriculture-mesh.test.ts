import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
const bundle=await build({entryPoints:['apps/laya-client/src/world-mesh.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {WorldMesh}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

class Vector{x:number;y:number;z:number;constructor(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;}}
let geometries:any[]=[],materials:any[]=[];
class Node{
 name:string;children:Node[]=[];active=true;geometry:any;destroyCalls=0;meshRenderer:any={};
 transform:any={localPosition:new Vector(0,0,0),localScale:new Vector(1,1,1),localRotationEuler:new Vector(0,0,0)};
 constructor(a:any,b?:string){this.name=b??a;this.geometry=b?a:null;}
 addChild(n:Node){this.children.push(n);}destroy(){this.destroyCalls++;}
}
class Material{destroyCalls=0;constructor(){materials.push(this);}destroy(){this.destroyCalls++;}}
function install(){
 geometries=[];materials=[];
 const primitive=(kind:string)=>(...size:number[])=>{const g={kind,size,destroyCalls:0,destroy(){this.destroyCalls++;}};geometries.push(g);return g;};
 (globalThis as any).Laya={Vector3:Vector,Sprite3D:Node,MeshSprite3D:Node,Color:class{r:number;g:number;b:number;a:number;constructor(r:number,g:number,b:number,a:number){this.r=r;this.g=g;this.b=b;this.a=a;}},UnlitMaterial:Material,RenderState:{CULL_FRONT:1},PrimitiveMesh:{createBox:primitive('box'),createSphere:primitive('sphere'),createCylinder:primitive('cylinder'),createCone:primitive('cone')}};
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
const snapshot=(node:Node)=>JSON.stringify(all(node).map(n=>({name:n.name,active:n.active,transform:n.transform,color:n.meshRenderer.sharedMaterial?.albedoColor})));
const crop=(kind='rice'):any=>({id:`crop-${kind}`,kind:'crop',position:{x:3,y:0,z:4},width:1.2,depth:1.2,height:.95,appearance:kind,resources:0,crop:{kind,stage:'seedling',growth:0,plantedTick:10,cycles:0}});
const animal=(kind='chicken'):any=>({id:`animal-${kind}`,kind:'animal',position:{x:3,y:0,z:4},width:.5,depth:.7,height:.6,appearance:kind,resources:0,animal:{kind,heading:0,activity:'walk',phaseStartedTick:10,phaseUntilTick:100,phase:1}});

test('Crop meshes leave joined soil to GardenGround and only show seeds or plants after actual work',()=>{
 install();const object=crop();Object.assign(object.crop,{stage:'fallow',moisture:0});const mesh=new WorldMesh(object),parts=all(mesh.node),plants=parts.filter(n=>n.name==='rice growth'),seeds=parts.filter(n=>n.name==='sown seed'),glints=parts.filter(n=>n.name==='paddy water glint');
 const geometryCount=geometries.length,before=hashCanonical(object);assert.equal(parts.some(n=>/planting bed|tilled earth|soil furrow|paddy bank|shallow rice paddy/.test(n.name)),false);assert.ok(plants.every(n=>!n.active));assert.ok(seeds.every(n=>!n.active));assert.ok(glints.every(n=>!n.active));assert.equal(hashCanonical(object),before);
 object.crop.stage='tilled';mesh.update(object,20);assert.ok(plants.every(n=>!n.active));assert.ok(seeds.every(n=>!n.active));assert.ok(glints.every(n=>!n.active));
 object.crop.stage='sown';mesh.update(object,30);assert.ok(seeds.every(n=>n.active));assert.ok(plants.every(n=>!n.active));assert.ok(glints.every(n=>!n.active));
 Object.assign(object.crop,{stage:'seedling',moisture:1,lastWateredTick:40});mesh.update(object,40);assert.ok(plants.every(n=>n.active));assert.ok(seeds.every(n=>!n.active));assert.ok(glints.every(n=>n.active));
 const leaf=parts.find(n=>n.name==='rice blade')!,wet=leaf.meshRenderer.sharedMaterial.albedoColor;object.crop.moisture=0;mesh.update(object,45);assert.ok(glints.every(n=>!n.active));assert.notDeepEqual(leaf.meshRenderer.sharedMaterial.albedoColor,wet);
 const frame=snapshot(mesh.node);mesh.update(object,45);assert.equal(snapshot(mesh.node),frame);assert.deepEqual(all(mesh.node),parts);assert.equal(geometries.length,geometryCount);mesh.dispose();
});

test('Crop growth, golden ripeness and brief harvest flecks update without rebuilding or mutating world state',()=>{
 install();const object=crop(),mesh=new WorldMesh(object),parts=all(mesh.node),growth=parts.find(n=>n.name==='rice growth')!,head=parts.find(n=>n.name==='drooping rice panicle')!,initialScale=growth.transform.localScale.y,created=geometries.length;
 assert.equal(head.active,false);assert.ok(parts.filter(n=>n.geometry).length<=36);
 object.crop.stage='growing';object.crop.growth=.65;mesh.update(object,70);assert.ok(growth.transform.localScale.y>initialScale);assert.equal(head.active,true);
 const kernels=parts.find(n=>n.name==='hanging rice kernels')!,green=kernels.meshRenderer.sharedMaterial.albedoColor;object.crop.stage='mature';object.crop.growth=1;object.resources=5;mesh.update(object,100);assert.notDeepEqual(kernels.meshRenderer.sharedMaterial.albedoColor,green);
 const matureHeight=growth.transform.localScale.y;object.crop.stage='harvested';object.crop.harvestedTick=101;object.crop.growth=0;object.resources=0;
 const before=hashCanonical(object);mesh.update(object,103);assert.equal(head.active,false);assert.ok(growth.transform.localScale.y<matureHeight/3);assert.ok(parts.some(n=>n.name==='harvest grain fleck'&&n.active));
 const frame=snapshot(mesh.node);mesh.update(object,103);assert.equal(snapshot(mesh.node),frame);mesh.update(object,130);assert.equal(parts.some(n=>n.name==='harvest grain fleck'&&n.active),false);
 assert.equal(hashCanonical(object),before);assert.deepEqual(all(mesh.node),parts);assert.equal(geometries.length,created);mesh.dispose();
});

test('Each plant has its own silhouette and all poultry poses freeze on the same simulation tick',()=>{
 install();const variants=[['rice','drooping rice panicle'],['wheat','wheat grain head'],['corn','corn cob'],['carrot','orange carrot shoulder']];
 for(const [kind,part] of variants){const mesh=new WorldMesh(crop(kind));assert.ok(all(mesh.node).some(n=>n.name===part));assert.ok(all(mesh.node).filter(n=>n.geometry).length<=36);mesh.dispose();}
 for(const kind of ['chicken','duck','goose']){
  const object=animal(kind),mesh=new WorldMesh(object),parts=all(mesh.node),before=hashCanonical(object);mesh.update(object,12);const frame=snapshot(mesh.node);mesh.update(object,12);assert.equal(snapshot(mesh.node),frame);mesh.update(object,15);assert.notEqual(snapshot(mesh.node),frame);assert.equal(hashCanonical(object),before);
  const legs=parts.filter(n=>n.name.startsWith('poultry leg'));assert.equal(legs.length,2);assert.equal(legs[0].transform.localRotationEuler.x,-legs[1].transform.localRotationEuler.x);
  object.animal.activity='peck';mesh.update(object,16);assert.ok(parts.find(n=>n.name==='poultry head and neck')!.transform.localRotationEuler.x>0);
  object.animal.activity='flap';mesh.update(object,17);assert.ok(Math.abs(parts.find(n=>n.name==='poultry wing -1')!.transform.localRotationEuler.z)>5);
  object.position.x=7;object.animal.heading=Math.PI/2;mesh.update(object,17);assert.equal(mesh.node.transform.position.x,7);assert.equal(mesh.node.transform.rotationEuler.y,0);
  assert.ok(parts.some(n=>n.name===({chicken:'red chicken comb',duck:'broad duck bill',goose:'long goose neck'} as Record<string,string>)[kind]));assert.ok(parts.filter(n=>n.geometry).length<=30);mesh.dispose();
 }
});

test('Natural crop clusters keep broad multitone leaves and stable per-field variation',()=>{
 install();
 for(const kind of ['rice','wheat','corn','carrot']){
  const object=crop(kind);Object.assign(object.crop,{stage:'mature',growth:1,moisture:1});
  const first=new WorldMesh(object),same=new WorldMesh(object),other=new WorldMesh({...object,id:object.id+'-next'});
  const leaves=all(first.node).filter(n=>/blade|broad corn leaf|carrot.*leaf/.test(n.name));
  assert.ok(leaves.length>=8);assert.ok(new Set(leaves.map(n=>JSON.stringify(n.meshRenderer.sharedMaterial.albedoColor))).size>=3);
  assert.ok(leaves.every(n=>n.transform.localScale.x>=.05));
  assert.equal(snapshot(first.node),snapshot(same.node));
  const poses=(m:any)=>all(m.node).filter(n=>n.name.endsWith(' growth')).map(n=>n.transform);
  assert.notDeepEqual(poses(first),poses(other));
  assert.ok(poses(first).every(p=>Math.abs(p.localPosition.x)<.3&&Math.abs(p.localPosition.z)<.3));
  first.dispose();same.dispose();other.dispose();
 }
});

test('Shared agriculture resources survive another object disposal and are released exactly once',()=>{
 install();const first=new WorldMesh(crop()),second=new WorldMesh(animal()),initial=geometries.length;
 assert.ok(initial<=4);first.dispose();first.dispose();assert.equal(first.node.destroyCalls,1);assert.ok(geometries.every(g=>g.destroyCalls===0));assert.ok(materials.every(m=>m.destroyCalls===0));
 second.update(animal(),20);const frame=snapshot(second.node);second.dispose();second.dispose();second.update(animal(),30);assert.equal(snapshot(second.node),frame);assert.equal(second.node.destroyCalls,1);assert.ok(geometries.every(g=>g.destroyCalls===1));assert.ok(materials.every(m=>m.destroyCalls===1));
});
