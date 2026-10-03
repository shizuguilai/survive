import {grassTexture} from './painted-world.ts';
import {MAP_HALF} from '../../../packages/sim-core/src/map-config.ts';
/** Native terrain is generated once and batched within WebGL's 16-bit index limit. */
export function createTerrain(L:any):any{
 let v:number[]=[],indices:number[]=[];const batches:{vertices:number[];indices:number[]}[]=[];
 const flush=()=>{if(v.length)batches.push({vertices:v,indices});v=[];indices=[];};
 const color=(hex:string)=>{const n=parseInt(hex.slice(1),16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1];};
 const quad=(x:number,z:number,w:number,d:number,hex:string,y=0)=>{if(v.length/10+4>65532)flush();const base=v.length/10,c=color(hex);for(const [dx,dz]of [[0,0],[w,0],[0,d],[w,d]])v.push(x+dx,y,z+dz,0,1,0,...c);indices.push(base+2,base,base+3,base,base+1,base+3);};
 const rand=(x:number,z:number)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);};
 const grass=['#9cb95e','#a0bf61','#9dbc60','#9aba5e','#a1be61'];
 const soil=['#dfbb7f','#dfb97a','#ddba7d','#e2bd81'];
 const texture=grassTexture();
 for(let x=-MAP_HALF;x<MAP_HALF;x++)for(let z=-MAP_HALF;z<MAP_HALF;z++){
  const r=rand(x,z),path=Math.abs(z)<1.4&&Math.abs(x)<13||Math.abs(x)<1.2&&z>-8&&z<9;
  const bare=path;
  const c=(bare?soil:grass)[Math.floor(r*(bare?soil.length:grass.length))];if(bare||!texture)quad(x,z,1,1,c,-.065);
  if(bare){if(r>.35)quad(x+.12+r*.3,z+.22,.28,.026,'#d1aa70',-.060);if(r>.77)quad(x+.62,z+.67,.055,.055,'#ecd09b',-.056);}
  else if(!texture){
   if(r>.3){quad(x+.18,z+.3,.025,.15,'#52623b',-.06);quad(x+.22,z+.4,.11,.027,'#58683c',-.059);}
   if(r>.69){quad(x+.67,z+.64,.025,.17,'#a2a16b',-.057);quad(x+.7,z+.61,.026,.14,'#8d945c',-.056);}
  }
 }
 // Dry-laid paving is a readable landmark at the communal notice board.
 for(let x=-2;x<3;x++)for(let z=-1;z<2;z++){quad(x*.6-.1,z*.55+.15,.56,.51,(x+z)%2?'#b2a68b':'#a69b80',-.05);quad(x*.6-.1,z*.55+.15,.56,.025,'#706b56',-.048);}
 flush();const group=new L.Sprite3D('Painted meadow terrain');
 const mat=new L.UnlitMaterial();mat.albedoColor=new L.Color(1,1,1,1);mat.enableVertexColor=true;mat.cull=L.RenderState.CULL_NONE;
 for(const batch of batches){const mesh=L.PrimitiveMesh._createMesh(L.VertexMesh.getVertexDeclaration('POSITION,NORMAL,COLOR'),new Float32Array(batch.vertices),new Uint16Array(batch.indices));const node=new L.MeshSprite3D(mesh,'Batched illustrated terrain');node.meshRenderer.sharedMaterial=mat;group.addChild(node);}
 if(!texture)return group;
 // Keep the original painted grass scale and crop the last tile to the world edge.
 const tile=28,gv:number[]=[],gi:number[]=[];for(let x=-MAP_HALF;x<MAP_HALF;x+=tile)for(let z=-MAP_HALF;z<MAP_HALF;z+=tile){const w=Math.min(tile,MAP_HALF-x),d=Math.min(tile,MAP_HALF-z),n=gv.length/8;for(const [dx,dz,u,v]of [[0,0,0,0],[w,0,w/tile,0],[0,d,0,d/tile],[w,d,w/tile,d/tile]])gv.push(x+dx,-.07,z+dz,0,1,0,u,v);gi.push(n+2,n,n+3,n,n+1,n+3);}
 const groundMesh=L.PrimitiveMesh._createMesh(L.VertexMesh.getVertexDeclaration('POSITION,NORMAL,UV'),new Float32Array(gv),new Uint16Array(gi));
 const plane=new L.MeshSprite3D(groundMesh,'Hand-painted grass');
 const ground=new L.UnlitMaterial();ground.albedoTexture=texture.bitmap;ground.albedoColor=new L.Color(1,1,1,1);ground.cull=L.RenderState.CULL_NONE;texture.bitmap.wrapModeU=1;texture.bitmap.wrapModeV=1;plane.meshRenderer.sharedMaterial=ground;group.addChild(plane);return group;
}
