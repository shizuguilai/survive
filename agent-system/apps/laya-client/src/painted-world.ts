import type {World} from '../../../packages/sim-core/src/domain.ts';
import {resourceStage} from '../../../packages/sim-core/src/resources.ts';
import {projectToStage,type MapCamera,type MapViewport} from './map-camera.ts';
import {sceneryOccludesResident,sceneryQuad} from './scenery-occlusion.ts';
import atlas from './art-atlas.json' with {type:'json'};

type Frame={texture:any;width:number;height:number;anchor:number[]};
const frames=new Map<string,Frame>();let grass:any;let soil:any;
export async function loadCampArt():Promise<void>{
 const L=(globalThis as any).Laya;
 const names=['grass.png','scenery-atlas.png','garden-soil.png','berry-bush-empty.png'];
 const images=await Promise.all(names.map(name=>L.loader.load('assets/art/'+name,L.Loader.IMAGE)));
 if(images.some(image=>!image))throw Error('营地画面素材加载失败，请刷新重试。');
 grass=images[0];soil=images[2];
 for(const item of atlas.assets.scenery.sprites){
  const [x,y,width,height]=item.rect;frames.set(item.name,{texture:L.Texture.createFromTexture(images[1],x,y,width,height),width,height,anchor:item.anchor});
 }
 // The harvested plant stays a full leafy bush; only its ripe fruit is removed.
 frames.set('berryBushEmpty',{texture:L.Texture.createFromTexture(images[3],132,160,1005,918),width:1005,height:918,anchor:[488,874]});
}
export function grassTexture():any{return grass;}
export function soilTexture():any{return soil;}
export function artFrame(name:string):Frame|undefined{return frames.get(name);}
/** Painted observer layer. All positions/poses come from simulation, never from wall time. */
export class PaintedWorld{
 readonly root:any;readonly node:any;private sprites=new Map<string,any>();private activeObjects=new Set<string>();private geometries=new Map<string,any>();
 constructor(){const L=(globalThis as any).Laya;this.root=new L.Sprite();this.root.name='Painted camp';this.root.mouseEnabled=false;this.node=new L.Sprite3D('Depth-tested painted camp');}
 hasObject(id:string):boolean{return this.activeObjects.has(id);}
 private sprite(id:string):any{
  let entry=this.sprites.get(id);if(entry)return entry;
  const L=(globalThis as any).Laya,root=new L.MeshSprite3D(null,'Painted '+id),material=new L.UnlitMaterial();
  material.albedoColor=new L.Color(1,1,1,1);material.renderMode=L.UnlitMaterial.RENDERMODE_CUTOUT;material.alphaTestValue=.12;material.cull=L.RenderState.CULL_NONE;
  root.meshRenderer.sharedMaterial=material;this.node.addChild(root);
  entry={root,material,image:{alpha:1,x:0,y:0,width:0,height:0},key:'',frame:''};this.sprites.set(id,entry);return entry;
 }
 render(world:World,camera:MapCamera,viewport:MapViewport,_roofs:boolean):void{
  const L=(globalThis as any).Laya,unit=viewport.height/camera.zoom,seen=new Set<string>();this.activeObjects.clear();
  this.root.pos(viewport.x,viewport.y);this.root.scrollRect=new L.Rectangle(0,0,viewport.width,viewport.height);
  const place=(id:string,name:string,p:{x:number;y:number;z:number},width:number,flat=false)=>{
   const f=frames.get(name);if(!f)return null;seen.add(id);const item=this.sprite(id),screen=projectToStage(p,camera,viewport),scale=width*unit/f.width;
   const key=[name,width,flat].join(':');if(item.key!==key){
    let geometry=this.geometries.get(key);if(!geometry){geometry=L.PrimitiveMesh._createMesh(L.VertexMesh.getVertexDeclaration('POSITION,UV'),sceneryQuad(f,width,f.texture.uv,flat),new Uint16Array([0,1,2,2,1,3]));this.geometries.set(key,geometry);}
    item.root.meshFilter.sharedMesh=geometry;item.material.albedoTexture=f.texture.bitmap;item.key=key;item.frame=name;
   }
   if(item.x!==p.x||item.y!==p.y||item.z!==p.z){item.root.transform.position=new L.Vector3(p.x,p.y,p.z);item.x=p.x;item.y=p.y;item.z=p.z;}
   const yaw=camera.yaw??0;if(item.yaw!==yaw){item.root.transform.rotationEuler=new L.Vector3(0,yaw*180/Math.PI,0);item.yaw=yaw;}item.root.active=true;
   Object.assign(item.image,{width:f.width*scale,height:f.height*scale,x:-f.anchor[0]*scale,y:-f.anchor[1]*scale});
   return {item,screen};
  };
  for(const o of world.objects){
   const stage=resourceStage(o);let frame='',width=1.8,p={...o.position};
   // Buildings keep their native geometry at every angle and roof setting.
   // A single painted cottage cannot preserve their footprint or roof cutaway.
   switch(o.kind){
    case 'tree':frame=stage===0?'stump':['treeBroad','treeTall','treeBushy'][Math.abs([...o.id].reduce((v,c)=>v+c.charCodeAt(0),0))%3];width=stage===0?.88:4.3*(.6+stage*.1);break;
    case 'berry':frame=o.resources>0?'berryBush':'berryBushEmpty';width=2.05;break;
    case 'rock':if(!o.resources)continue;frame='rock';width=1.65*(.3+stage*.175);break;
    case 'board':frame='bulletin';width=2.05;break;
    case 'workbench':frame='workbench';width=2.05;break;
    case 'pond':frame='pond';width=o.width*1.08;break;
    default:continue;
   }
   const result=place(o.id,frame,p,width,o.kind==='pond');if(result){this.activeObjects.add(o.id);
    const {item,screen}=result,image=item.image,rect={x:screen.x+image.x,y:screen.y+image.y,width:image.width,height:image.height};
    const alpha=o.kind!=='pond'&&world.residents.some(r=>sceneryOccludesResident(p,rect,r.position,camera,viewport))?.3:1;
    if(image.alpha!==alpha){image.alpha=alpha;item.material.renderMode=alpha===1?L.UnlitMaterial.RENDERMODE_CUTOUT:L.UnlitMaterial.RENDERMODE_TRANSPARENT;item.material.cull=L.RenderState.CULL_NONE;item.material.albedoColor=new L.Color(1,1,1,alpha);}
   }
  }
  for(const [id,item]of this.sprites)if(!seen.has(id)){item.root.destroy(true);item.material.destroy();this.sprites.delete(id);}
 }
}
