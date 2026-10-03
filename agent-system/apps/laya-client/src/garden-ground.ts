import type {World,WorldObject} from '../../../packages/sim-core/src/domain.ts';

type GardenCrop=WorldObject&{crop:NonNullable<WorldObject['crop']>};
type Cell={object:GardenCrop;left:number;right:number;top:number;bottom:number};
export type GardenBed={id:string;cells:Cell[];bounds:{minX:number;maxX:number;minZ:number;maxZ:number}};
type Batch={vertices:number[];indices:number[]};
type Point={x:number;z:number;distance:number};
const STRIDE=12,STEP=.28,LIMIT=60000;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const unique=(values:number[])=>[...new Set(values.map(n=>Math.round(n*1000)/1000))].sort((a,b)=>a-b);
const wave=(x:number,z:number)=>Math.sin(x*2.53+z*.71)*.025+Math.sin(z*3.17-x*.93)*.02;
const smoothMin=(a:number,b:number)=>{const h=Math.max(.7-Math.abs(a-b),0)/.7;return Math.min(a,b)-h*h*.175;};
const bucket=(length:number)=>length===4?2:length<=3?Math.max(1,length):3;
const distanceAxis=(axis:number[],i:number)=>Math.min(4,Math.max(1.45,Math.min(i?axis[i]-axis[i-1]:Infinity,i+1<axis.length?axis[i+1]-axis[i]:Infinity,axis.length===1?1.7:Infinity)));

/** Stable bed grouping includes reserved cells, but prepared geometry never includes them. */
export function gardenLayout(world:Pick<World,'objects'>):GardenBed[]{
 const zones=new Map<string,GardenCrop[]>();
 for(const object of world.objects)if(object.kind==='crop'&&object.crop){const key=object.zoneId??'unassigned';const crops=zones.get(key)??[];crops.push(object as GardenCrop);zones.set(key,crops);}
 const beds:GardenBed[]=[];
 for(const [zone,crops]of zones){
  const xs=unique(crops.map(o=>o.position.x)),zs=unique(crops.map(o=>o.position.z));
  // Broad horizontal beds separated by two-row walking lanes match a kitchen garden.
  const nx=bucket(xs.length),nz=zs.length===3?3:Math.min(2,zs.length),groups=new Map<string,GardenCrop[]>();
  for(const object of crops){if(object.crop.stage==='fallow')continue;const xi=xs.indexOf(Math.round(object.position.x*1000)/1000),zi=zs.indexOf(Math.round(object.position.z*1000)/1000),key=`${Math.floor(xi/nx)}:${Math.floor(zi/nz)}`,items=groups.get(key)??[];items.push(object);groups.set(key,items);}
  for(const [key,items]of groups){
   const cells:Cell[]=items.map(object=>{const xi=xs.indexOf(Math.round(object.position.x*1000)/1000),zi=zs.indexOf(Math.round(object.position.z*1000)/1000),sx=distanceAxis(xs,xi),sz=distanceAxis(zs,zi),gx=Math.floor(xi/nx),gz=Math.floor(zi/nz);
    const neighbor=(dx:number,dz:number)=>items.some(o=>Math.abs(o.position.x-(xs[xi+dx]??Infinity))<.01&&Math.abs(o.position.z-(zs[zi+dz]??Infinity))<.01);
    const extent=(step:number,connected:boolean)=>Math.max(.65,step/2-(connected?-.045:.33));
    return {object,left:extent(sx,xi%nx>0&&neighbor(-1,0)),right:extent(sx,Math.floor((xi+1)/nx)===gx&&neighbor(1,0)),top:extent(sz,zi%nz>0&&neighbor(0,-1)),bottom:extent(sz,Math.floor((zi+1)/nz)===gz&&neighbor(0,1))};});
   beds.push({id:`${zone}:${key}`,cells,bounds:{minX:Math.min(...cells.map(c=>c.object.position.x-c.left))-.4,maxX:Math.max(...cells.map(c=>c.object.position.x+c.right))+.4,minZ:Math.min(...cells.map(c=>c.object.position.z-c.top))-.4,maxZ:Math.max(...cells.map(c=>c.object.position.z+c.bottom))+.4}});
  }
 }
 return beds;
}

/** Rounded cell unions have one continuous contour, never visible per-cell rims. */
export function gardenBedDistance(bed:GardenBed,x:number,z:number):number{
 const originalX=x,originalZ=z;
 x+=Math.sin(originalZ*1.07)*.16+Math.sin(originalX*.48+originalZ*.61)*.11;
 z+=Math.sin(originalX*.89)*.18+Math.sin(originalZ*.58-originalX*.39)*.10;
 let distance=Infinity;
 for(const c of bed.cells){const p=c.object.position,cx=p.x+(c.right-c.left)/2,cz=p.z+(c.bottom-c.top)/2,hx=(c.right+c.left)/2,hz=(c.top+c.bottom)/2,r=Math.min(.6,hx*.67,hz*.67),qx=Math.abs(x-cx)-hx+r,qz=Math.abs(z-cz)-hz+r,d=Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-r;
  distance=smoothMin(distance,d);
 }
 const bounds=bed.bounds,cx=(bounds.minX+bounds.maxX)/2,cz=(bounds.minZ+bounds.maxZ)/2,hx=(bounds.maxX-bounds.minX)/2-.4,hz=(bounds.maxZ-bounds.minZ)/2-.4,r=Math.min(1.35,hx*.5,hz*.5),qx=Math.abs(x-cx)-hx+r,qz=Math.abs(z-cz)-hz+r;
 const envelope=Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-r;
 return Math.max(distance,envelope)+wave(x,z);
}

// Split along each texture tile before normalizing UVs. Laya clamps non-POT images,
// so modulo per vertex alone would smear any triangle straddling a tile boundary.
function cutAxis(points:{x:number;z:number}[],axis:'x'|'z',edge:number,lower:boolean):{x:number;z:number}[]{
 const out:{x:number;z:number}[]=[];
 for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],insideA=lower?a[axis]>=edge:a[axis]<=edge,insideB=lower?b[axis]>=edge:b[axis]<=edge;if(insideA)out.push(a);if(insideA!==insideB){const t=(edge-a[axis])/(b[axis]-a[axis]);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}}
 return out;
}
class Batcher{
 batches:Batch[]=[];private vertices:number[]=[];private indices:number[]=[];
 polygon(points:{x:number;z:number}[],y:number,color:(x:number,z:number)=>number[]):void{
  if(points.length<3)return;const tile=4.5,minX=Math.floor(Math.min(...points.map(p=>p.x))/tile),maxX=Math.floor(Math.max(...points.map(p=>p.x))/tile),minZ=Math.floor(Math.min(...points.map(p=>p.z))/tile),maxZ=Math.floor(Math.max(...points.map(p=>p.z))/tile);
  for(let tx=minX;tx<=maxX;tx++)for(let tz=minZ;tz<=maxZ;tz++){
   let piece=cutAxis(points,'x',tx*tile,true);piece=cutAxis(piece,'x',(tx+1)*tile,false);piece=cutAxis(piece,'z',tz*tile,true);piece=cutAxis(piece,'z',(tz+1)*tile,false);if(piece.length<3)continue;
   if(this.vertices.length/STRIDE+piece.length>LIMIT)this.flush();const start=this.vertices.length/STRIDE;
   for(const p of piece)this.vertices.push(p.x,y,p.z,0,1,0,...color(p.x,p.z),clamp((p.x-tx*tile)/tile,0,1),clamp((p.z-tz*tile)/tile,0,1));
   for(let i=1;i<piece.length-1;i++)this.indices.push(start,start+i+1,start+i);
  }
 }
 flush():void{if(this.vertices.length)this.batches.push({vertices:this.vertices,indices:this.indices});this.vertices=[];this.indices=[];}
}
function clipped(points:Point[],level:number):Point[]{
 const result:Point[]=[];
 for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],insideA=a.distance<=level,insideB=b.distance<=level;if(insideA)result.push(a);if(insideA!==insideB){const t=(level-a.distance)/(b.distance-a.distance);result.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,distance:level});}}
 return result;
}
const neutral=(x:number,z:number)=>{const shade=.92+Math.sin(x*1.7+z*.8)*.035+Math.sin(x*.63-z*2.1)*.025;return [shade,shade,shade,1];};
const border=(bed:GardenBed,x:number,z:number)=>{const edge=clamp(gardenBedDistance(bed,x,z)/.26,0,1),shade=Math.sin(x*3+z*2)*.035;return [.58+edge*.02+shade,.45+edge*.16+shade,.25+edge*.02+shade,1];};
const green=(x:number,z:number)=>{const shade=Math.sin(x*4.2+z*1.4)*.07;return [.47+shade,.59+shade,.24+shade,1];};

/** Batched, render-only ground. Every plane stays below seeds, stalks and water glints. */
export function gardenGeometry(beds:GardenBed[]):{soil:Batch[];border:Batch[];fringe:Batch[]}{
 const soil=new Batcher(),rim=new Batcher(),fringe=new Batcher();
 for(const bed of beds){const b=bed.bounds,x0=Math.floor(b.minX/STEP)*STEP,z0=Math.floor(b.minZ/STEP)*STEP,nx=Math.ceil((b.maxX-x0)/STEP),nz=Math.ceil((b.maxZ-z0)/STEP),field:Point[][]=[];
  for(let iz=0;iz<=nz;iz++){const row:Point[]=[];for(let ix=0;ix<=nx;ix++){const x=x0+ix*STEP,z=z0+iz*STEP;row.push({x,z,distance:gardenBedDistance(bed,x,z)});}field.push(row);}
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=field[iz][ix],b=field[iz][ix+1],c=field[iz+1][ix],d=field[iz+1][ix+1];for(const triangle of [[a,b,d],[a,d,c]]){rim.polygon(clipped(triangle,.26),.012,(x,z)=>border(bed,x,z));soil.polygon(clipped(triangle,0),.022,neutral);}
   // Low meadow tongues and a few pale pebbles soften the soil into the original grass.
   const centerX=a.x+STEP/2,centerZ=a.z+STEP/2,edge=gardenBedDistance(bed,centerX,centerZ),seed=Math.abs(Math.sin(centerX*12.9898+centerZ*78.233)*43758.5453)%1;
   if(edge>.08&&edge<.43&&seed>.45){const angle=seed*19,dx=Math.cos(angle)*.16,dz=Math.sin(angle)*.16;
    for(let leaf=0;leaf<3;leaf++){const turn=angle+leaf*1.4,ex=Math.cos(turn)*(.15+seed*.13),ez=Math.sin(turn)*(.15+seed*.13);fringe.polygon([{x:centerX-dz*.3,z:centerZ+dx*.3},{x:centerX+dz*.3,z:centerZ-dx*.3},{x:centerX+ex,z:centerZ+ez}],.034+leaf*.001,green);}
    if(seed>.94){const rx=.055+seed*.02,rz=.045;fringe.polygon([{x:centerX-rx,z:centerZ},{x:centerX-rx*.45,z:centerZ-rz},{x:centerX+rx*.6,z:centerZ-rz*.7},{x:centerX+rx,z:centerZ+rz*.4},{x:centerX,z:centerZ+rz}],.039,()=>[.68,.65,.48,1]);}
   }
  }
 }
 soil.flush();rim.flush();fringe.flush();return {soil:soil.batches,border:rim.batches,fringe:fringe.batches};
}
function wetGeometry(beds:GardenBed[]):Batch[]{
 const out=new Batcher();
 for(const source of beds){const cells=source.cells.filter(c=>{const crop=c.object.crop;return crop.kind==='rice'&&crop.stage!=='fallow'&&(crop.moisture??(['seedling','growing','mature'].includes(crop.stage)?1:0))>.18;});if(!cells.length)continue;
  const bed={...source,cells},b=bed.bounds,x0=Math.floor(b.minX/STEP)*STEP,z0=Math.floor(b.minZ/STEP)*STEP,nx=Math.ceil((b.maxX-x0)/STEP),nz=Math.ceil((b.maxZ-z0)/STEP),field:Point[][]=[];
  for(let iz=0;iz<=nz;iz++){const row:Point[]=[];for(let ix=0;ix<=nx;ix++){const x=x0+ix*STEP,z=z0+iz*STEP;row.push({x,z,distance:gardenBedDistance(bed,x,z)});}field.push(row);}
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=field[iz][ix],b=field[iz][ix+1],c=field[iz+1][ix],d=field[iz+1][ix+1];out.polygon(clipped([a,b,d],-.13),.026,neutral);out.polygon(clipped([a,d,c],-.13),.026,neutral);}
 }
 out.flush();return out.batches;
}

export class GardenGround{
 readonly node:any;private readonly L:any;private materials:Record<string,any>;private layers=new Map<string,{node:any;mesh:any}[]>();private topology='';private wet='';private disposed=false;private beds:GardenBed[]=[];
 constructor(texture?:any){
  this.L=(globalThis as any).Laya;const L=this.L;this.node=new L.Sprite3D('Natural cultivated garden ground');this.materials={};
  for(const key of ['soil','border','fringe','wet']){const material=new L.UnlitMaterial();material.enableVertexColor=true;material.cull=L.RenderState?.CULL_NONE??0;material.albedoColor=new L.Color(1,1,1,1);this.materials[key]=material;}
  this.setSoilTexture(texture);
 }
 setSoilTexture(texture?:any):void{
  if(this.disposed)return;const bitmap=texture?.bitmap??texture;
  if(bitmap){bitmap.wrapModeU=this.L.WrapMode?.Repeat??0;bitmap.wrapModeV=this.L.WrapMode?.Repeat??0;}
  this.materials.soil.albedoTexture=bitmap??null;this.materials.wet.albedoTexture=bitmap??null;
  this.materials.soil.albedoColor=bitmap?new this.L.Color(1,1,1,1):new this.L.Color(.52,.37,.21,1);
  this.materials.wet.albedoColor=bitmap?new this.L.Color(.84,.96,.91,1):new this.L.Color(.46,.39,.27,1);
 }
 private replace(key:string,batches:Batch[],name:string):void{
  for(const old of this.layers.get(key)??[]){old.node.destroy(true);old.mesh.destroy();}const layer=[];
  for(const batch of batches){const mesh=this.L.PrimitiveMesh._createMesh(this.L.VertexMesh.getVertexDeclaration('POSITION,NORMAL,COLOR,UV'),new Float32Array(batch.vertices),new Uint16Array(batch.indices)),node=new this.L.MeshSprite3D(mesh,name);node.meshRenderer.sharedMaterial=this.materials[key];this.node.addChild(node);layer.push({node,mesh});}this.layers.set(key,layer);
 }
 update(world:Pick<World,'objects'>):void{
  if(this.disposed)return;const crops=world.objects.filter(o=>o.kind==='crop'&&o.crop),topology=crops.map(o=>`${o.id}:${o.zoneId??''}:${o.position.x},${o.position.z}:${o.crop!.stage==='fallow'?0:1}`).join('|');
  if(topology!==this.topology){this.topology=topology;this.beds=gardenLayout(world);const geometry=gardenGeometry(this.beds);this.replace('soil',geometry.soil,'Continuous garden soil');this.replace('border',geometry.border,'Soft earthen garden border');this.replace('fringe',geometry.fringe,'Garden edge meadow');this.wet='!';}
  const wet=crops.filter(o=>o.crop!.kind==='rice').map(o=>`${o.id}:${o.crop!.stage!=='fallow'&&(o.crop!.moisture??(['seedling','growing','mature'].includes(o.crop!.stage)?1:0))>.18?1:0}`).join('|');
  if(wet!==this.wet){this.wet=wet;this.beds=gardenLayout(world);this.replace('wet',wetGeometry(this.beds),'Watered rice earth');}
 }
 dispose():void{if(this.disposed)return;this.disposed=true;for(const layer of this.layers.values())for(const part of layer){part.node.destroy(true);part.mesh.destroy();}this.layers.clear();this.node.destroy(true);for(const material of Object.values(this.materials))material.destroy();}
}
