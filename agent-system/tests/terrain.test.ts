import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {MAP_HALF,MAP_SIZE} from '../packages/sim-core/src/map-config.ts';

const bundle=await build({stdin:{contents:"export {createTerrain} from './apps/laya-client/src/terrain.ts'; export {loadCampArt} from './apps/laya-client/src/painted-world.ts';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {createTerrain,loadCampArt}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
type Mesh={declaration:string;vertices:Float32Array;indices:Uint16Array};
class Node{children:Node[]=[];meshRenderer:any={};mesh?:Mesh|string;name?:string;constructor(mesh?:Mesh|string,name?:string){this.mesh=mesh;this.name=name;}addChild(node:Node){this.children.push(node);}}
const meshes=(node:Node):Mesh[]=>[...(typeof node.mesh==='object'?[node.mesh]:[]),...node.children.flatMap(meshes)];
const maxIndex=(mesh:Mesh)=>mesh.indices.reduce((max,value)=>Math.max(max,value),0);
const bounds=(mesh:Mesh)=>{const stride=mesh.declaration.endsWith('COLOR')?10:8;let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(let i=0;i<mesh.vertices.length;i+=stride){minX=Math.min(minX,mesh.vertices[i]);maxX=Math.max(maxX,mesh.vertices[i]);minZ=Math.min(minZ,mesh.vertices[i+2]);maxZ=Math.max(maxZ,mesh.vertices[i+2]);}return {minX,maxX,minZ,maxZ};};

test('Expanded terrain covers every ground cell without overflowing native mesh indices, including missing artwork',async()=>{
 const previous=(globalThis as any).Laya;
 const L={Sprite3D:Node,MeshSprite3D:Node,UnlitMaterial:class{},Color:class{},RenderState:{CULL_NONE:0},VertexMesh:{getVertexDeclaration:(value:string)=>value},PrimitiveMesh:{_createMesh:(declaration:string,vertices:Float32Array,indices:Uint16Array)=>({declaration,vertices,indices})},Loader:{IMAGE:'image'},loader:{async load(){return {bitmap:{}};}},Texture:{createFromTexture(){return {};}}};
 (globalThis as any).Laya=L;
 try{
  const fallback=meshes(createTerrain(L));assert.ok(fallback.length>1,'fallback meadow must split before Uint16 overflow');
  const cells=new Set<string>();
  for(const mesh of fallback){
   const count=mesh.vertices.length/10;assert.ok(count<65535);assert.equal(maxIndex(mesh),count-1);assert.ok(mesh.indices.every(index=>index<count));
   for(let i=0;i<mesh.vertices.length;i+=40)if(Math.abs(mesh.vertices[i+1]+.065)<1e-6)cells.add(`${mesh.vertices[i]},${mesh.vertices[i+2]}`);
  }
  assert.equal(cells.size,MAP_SIZE*MAP_SIZE);for(let x=-MAP_HALF;x<MAP_HALF;x++)for(let z=-MAP_HALF;z<MAP_HALF;z++)assert.ok(cells.has(`${x},${z}`));
  await loadCampArt();const painted=meshes(createTerrain(L)),grass=painted.find(mesh=>mesh.declaration.endsWith('UV'))!;assert.ok(grass);
  assert.deepEqual(bounds(grass),{minX:-MAP_HALF,maxX:MAP_HALF,minZ:-MAP_HALF,maxZ:MAP_HALF});assert.equal(maxIndex(grass),grass.vertices.length/8-1);
  let area=0;for(let i=0;i<grass.vertices.length;i+=32)area+=(grass.vertices[i+8]-grass.vertices[i])*(grass.vertices[i+18]-grass.vertices[i+2]);assert.equal(area,MAP_SIZE*MAP_SIZE);
 }finally{(globalThis as any).Laya=previous;}
});
