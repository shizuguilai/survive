import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GardenGround,gardenLayout,gardenGeometry,gardenBedDistance} from '../apps/laya-client/src/garden-ground.ts';
import type {WorldObject} from '../packages/sim-core/src/domain.ts';
const field=(columns=6,rows=6):{objects:WorldObject[]}=>({objects:Array.from({length:columns*rows},(_,i)=>({id:`crop-${i}`,zoneId:'garden',kind:'crop',position:{x:i%columns*2,y:0,z:Math.floor(i/columns)*2},width:1.2,depth:1.2,height:.2,appearance:'',resources:0,crop:{kind:'rice',stage:'tilled',growth:0,plantedTick:0,cycles:0,moisture:0}}))});

test('Prepared neighbors form broad continuous beds with open paths, while reserved ground stays meadow',()=>{
 const world=field(),before=JSON.stringify(world),beds=gardenLayout(world);assert.equal(beds.length,6);assert.ok(beds.every(b=>b.cells.length===6));
 const first=beds.find(b=>b.cells.some(c=>c.object.id==='crop-0'))!;
 for(let x=0;x<=4;x+=.2)assert.ok(gardenBedDistance(first,x,1)<0,`interior soil must be connected at ${x}`);
 assert.ok(beds.every(b=>gardenBedDistance(b,5,1)>.02),'vertical lane stays free of cultivated soil');assert.ok(beds.every(b=>gardenBedDistance(b,2,3)>.02),'horizontal lane stays free of cultivated soil');
 world.objects[7].crop!.stage='fallow';const partial=gardenLayout(world);assert.ok(partial.every(b=>gardenBedDistance(b,2,2)>0),'an untilled cell cannot acquire its own soil from neighbors');
 for(const object of world.objects)object.crop!.stage='fallow';assert.deepEqual(gardenLayout(world),[]);assert.equal(JSON.parse(before).objects.length,world.objects.length);
});

test('Rounded geometry is deterministic, finite, below crop details and uses safe 16-bit batches',()=>{
 const world=field(),before=JSON.stringify(world),layout=gardenLayout(world),geometry=gardenGeometry(layout);assert.deepEqual(geometry,gardenGeometry(layout));assert.equal(JSON.stringify(world),before);
 assert.ok(geometry.soil.length&&geometry.border.length&&geometry.fringe.length);
 for(const batches of Object.values(geometry))for(const batch of batches){assert.equal(batch.vertices.length%12,0);assert.ok(batch.vertices.length/12<=60000);assert.ok(batch.vertices.every(Number.isFinite));assert.ok(batch.indices.every(i=>Number.isInteger(i)&&i>=0&&i<batch.vertices.length/12));for(let i=1;i<batch.vertices.length;i+=12)assert.ok(batch.vertices[i]<.06);}
 const smaller=field(1,1);assert.equal(gardenLayout(smaller).length,1);smaller.objects[0].crop!.stage='harvested';assert.equal(gardenLayout(smaller).length,1);
});

test('Non-power-of-two soil uses normalized tiled UVs without smearing across negative-coordinate seams',()=>{
 const world=field();for(const object of world.objects){object.position.x-=11.1;object.position.z-=7.3;}const {soil}=gardenGeometry(gardenLayout(world));
 for(const batch of soil){for(let i=0;i<batch.vertices.length;i+=12){assert.ok(batch.vertices[i+10]>=0&&batch.vertices[i+10]<=1);assert.ok(batch.vertices[i+11]>=0&&batch.vertices[i+11]<=1);}
  for(let i=0;i<batch.indices.length;i+=3){const origins=batch.indices.slice(i,i+3).map(index=>{const offset=index*12;return [batch.vertices[offset]-batch.vertices[offset+10]*4.5,batch.vertices[offset+2]-batch.vertices[offset+11]*4.5];});assert.ok(origins.every(p=>Math.abs(p[0]-origins[0][0])<1e-7&&Math.abs(p[1]-origins[0][1])<1e-7),'every triangle belongs to one texture tile');}
 }
});

class Node{children:Node[]=[];meshRenderer:any={};destroyCalls=0;name:any;other?:string;constructor(name:any,other?:string){this.name=name;this.other=other;}addChild(node:Node){this.children.push(node);}destroy(){this.destroyCalls++;}}
class Color{r:number;g:number;b:number;a:number;constructor(r:number,g:number,b:number,a:number){this.r=r;this.g=g;this.b=b;this.a=a;}}
let meshes:any[]=[],materials:any[]=[];
function install(){meshes=[];materials=[];(globalThis as any).Laya={Sprite3D:Node,MeshSprite3D:Node,Color,RenderState:{CULL_NONE:0},UnlitMaterial:class{destroyCalls=0;constructor(){materials.push(this);}destroy(){this.destroyCalls++;}},VertexMesh:{getVertexDeclaration:(s:string)=>s},PrimitiveMesh:{_createMesh:(_d:any,vertices:Float32Array,indices:Uint16Array)=>{const mesh={vertices,indices,destroyCalls:0,destroy(){this.destroyCalls++;}};meshes.push(mesh);return mesh;}}};}
test('Tick, growth and gradual drying reuse terrain; new tilling and watering change only the necessary meshes',()=>{
 install();const world=field(3,2);for(const object of world.objects)object.crop!.stage='fallow';const ground=new GardenGround();ground.update(world);assert.equal(meshes.length,0);
 world.objects[0].crop!.stage='tilled';ground.update(world);const initial=meshes.length,base=meshes.slice();assert.ok(initial>0);
 Object.assign(world.objects[0].crop!,{stage:'seedling',moisture:1,growth:.1,lastWateredTick:20});ground.update(world);assert.equal(meshes.length,initial+1);assert.ok(base.every(m=>m.destroyCalls===0));
 for(let i=0;i<20;i++){world.objects[0].crop!.growth+=.005;world.objects[0].crop!.moisture!-=.001;ground.update(structuredClone(world));}assert.equal(meshes.length,initial+1);
 const oldWet=meshes.at(-1);world.objects[0].crop!.moisture=0;ground.update(structuredClone(world));assert.equal(oldWet.destroyCalls,1);assert.ok(base.every(m=>m.destroyCalls===0));
 world.objects[1].crop!.stage='tilled';ground.update(world);assert.ok(base.every(m=>m.destroyCalls===1));
 const texture={bitmap:{}};ground.setSoilTexture(texture);assert.equal((texture.bitmap as any).wrapModeU,0);const created=meshes.length;ground.update(world);assert.equal(meshes.length,created);
 ground.dispose();ground.dispose();ground.update(world);assert.ok(meshes.every(m=>m.destroyCalls===1));assert.ok(materials.every(m=>m.destroyCalls===1));assert.equal(ground.node.destroyCalls,1);
});
