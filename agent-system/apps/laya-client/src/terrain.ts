/** Native vertex-colored terrain: one mesh, no texture blur and no per-frame generation. */
export function createTerrain(L:any):any{
 const v:number[]=[],indices:number[]=[];
 const color=(hex:string)=>{const n=parseInt(hex.slice(1),16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1];};
 const quad=(x:number,z:number,w:number,d:number,hex:string,y=0)=>{const base=v.length/10,c=color(hex);for(const [dx,dz]of [[0,0],[w,0],[0,d],[w,d]])v.push(x+dx,y,z+dz,0,1,0,...c);indices.push(base+2,base,base+3,base,base+1,base+3);};
 const rand=(x:number,z:number)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);};
 const grass=['#737c4b','#788151','#7b8352','#707947','#7e8554'];
 const soil=['#938160','#9a8663','#95825e','#a08b66'];
 for(let x=-28;x<28;x++)for(let z=-28;z<28;z++){
  const r=rand(x,z),path=Math.abs(z)<1.4&&Math.abs(x)<13||Math.abs(x)<1.2&&z>-8&&z<9;
  const bare=path||Math.hypot(x*.85,z)<4.2||x>5&&x<10&&z>-3&&z<3;
  const c=(bare?soil:grass)[Math.floor(r*(bare?soil.length:grass.length))];quad(x,z,1,1,c,-.065);
  if(bare){if(r>.35)quad(x+.12+r*.3,z+.22,.28,.026,'#7d7054',-.060);if(r>.77)quad(x+.62,z+.67,.055,.055,'#c3b18b',-.056);}
  else{
   if(r>.3){quad(x+.18,z+.3,.025,.15,'#52623b',-.06);quad(x+.22,z+.4,.11,.027,'#58683c',-.059);}
   if(r>.69){quad(x+.67,z+.64,.025,.17,'#a2a16b',-.057);quad(x+.7,z+.61,.026,.14,'#8d945c',-.056);}
  }
 }
 // Dry-laid paving is a readable landmark at the communal notice board.
 for(let x=-2;x<3;x++)for(let z=-1;z<2;z++){quad(x*.6-.1,z*.55+.15,.56,.51,(x+z)%2?'#b2a68b':'#a69b80',-.05);quad(x*.6-.1,z*.55+.15,.56,.025,'#706b56',-.048);}
 const mesh=L.PrimitiveMesh._createMesh(L.VertexMesh.getVertexDeclaration('POSITION,NORMAL,COLOR'),new Float32Array(v),new Uint16Array(indices));
 const node=new L.MeshSprite3D(mesh,'Batched illustrated terrain');const mat=new L.UnlitMaterial();mat.albedoColor=new L.Color(1,1,1,1);mat.enableVertexColor=true;mat.cull=L.RenderState.CULL_NONE;node.meshRenderer.sharedMaterial=mat;return node;
}
