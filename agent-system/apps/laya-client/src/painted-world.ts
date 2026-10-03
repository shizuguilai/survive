import type {World} from '../../../packages/sim-core/src/domain.ts';
import {homeDesign} from '../../../packages/sim-core/src/home-design.ts';
import {resourceStage} from '../../../packages/sim-core/src/resources.ts';
import {projectToStage,type MapCamera,type MapViewport} from './map-camera.ts';
import atlas from './art-atlas.json' with {type:'json'};

type Frame={texture:any;width:number;height:number;anchor:number[]};
const frames=new Map<string,Frame>();let grass:any;
export async function loadCampArt():Promise<void>{
 const L=(globalThis as any).Laya;
 const names=['grass.png','scenery-atlas.png'];
 const images=await Promise.all(names.map(name=>L.loader.load('assets/art/'+name,L.Loader.IMAGE)));
 if(images.some(image=>!image))throw Error('营地画面素材加载失败，请刷新重试。');
 grass=images[0];
 for(const item of atlas.assets.scenery.sprites){
  const [x,y,width,height]=item.rect;frames.set(item.name,{texture:L.Texture.createFromTexture(images[1],x,y,width,height),width,height,anchor:item.anchor});
 }
}
export function grassTexture():any{return grass;}
export function artFrame(name:string):Frame|undefined{return frames.get(name);}
/** Painted observer layer. All positions/poses come from simulation, never from wall time. */
export class PaintedWorld{
 readonly root:any;private sprites=new Map<string,any>();private activeObjects=new Set<string>();
 constructor(){const L=(globalThis as any).Laya;this.root=new L.Sprite();this.root.name='Painted camp';this.root.mouseEnabled=false;}
 hasObject(id:string):boolean{return this.activeObjects.has(id);}
 private sprite(id:string):any{
  let entry=this.sprites.get(id);if(entry)return entry;
  const L=(globalThis as any).Laya,root=new L.Sprite(),shadow=new L.Sprite(),image=new L.Sprite(),gear=new L.Text();
  root.name='Painted '+id;root.mouseEnabled=false;root.addChild(shadow);root.addChild(image);root.addChild(gear);this.root.addChild(root);
  gear.font='Camp Sans, Noto Sans CJK SC, Microsoft YaHei, Arial';gear.fontSize=11;gear.color='#fffbe7';gear.stroke=2;gear.strokeColor='#2c3e32';gear.mouseEnabled=false;
  entry={root,shadow,image,gear,key:'',frame:''};this.sprites.set(id,entry);return entry;
 }
 render(world:World,camera:MapCamera,viewport:MapViewport,roofs:boolean):void{
  const L=(globalThis as any).Laya,unit=viewport.height/camera.zoom,seen=new Set<string>();this.activeObjects.clear();
  this.root.pos(viewport.x,viewport.y);this.root.scrollRect=new L.Rectangle(0,0,viewport.width,viewport.height);
  const place=(id:string,name:string,p:{x:number;y:number;z:number},width:number,anchorY?:number,bob=0,angle=0,shadow=true)=>{
   const f=frames.get(name);if(!f)return null;seen.add(id);const item=this.sprite(id),screen=projectToStage(p,camera,viewport),scale=width*unit/f.width;
   item.root.pos(screen.x-viewport.x,screen.y-viewport.y);item.root.zOrder=Math.round(screen.y*10);item.root.visible=true;
   item.image.texture=f.texture;item.image.size(f.width*scale,f.height*scale);item.image.pos(-f.anchor[0]*scale,-(anchorY??f.anchor[1])*scale-bob);item.image.rotation=angle;
   item.gear.text='';item.image.alpha=1;
   const shadowKey=[width,unit,shadow].join(':');if(item.key!==shadowKey){item.key=shadowKey;const g=item.shadow.graphics;g.clear();if(shadow){g.drawEllipse(-width*unit*.32,-unit*.13,width*unit*.71,unit*.37,'rgba(31,63,42,0.16)');g.drawEllipse(-width*unit*.23,-unit*.07,width*unit*.5,unit*.23,'rgba(31,63,42,0.12)');}}
   return {item,screen,top:screen.y-f.anchor[1]*scale-bob,scale};
  };
  for(const o of world.objects){
   const stage=resourceStage(o);let frame='',width=1.8,p={...o.position};
   switch(o.kind){
    case 'tree':frame=stage===0?'stump':['treeBroad','treeTall','treeBushy'][Math.abs([...o.id].reduce((v,c)=>v+c.charCodeAt(0),0))%3];width=stage===0?.88:4.3*(.6+stage*.1);break;
    case 'berry':if(!o.resources)continue;frame='berryBush';width=2.05*(.7+stage*.075);break;
    case 'rock':if(!o.resources)continue;frame='rock';width=1.65*(.3+stage*.175);break;
    case 'board':frame='bulletin';width=2.05;break;
    case 'workbench':frame='workbench';width=2.05;break;
    case 'pond':frame='pond';width=o.width*1.08;break;
    case 'house':if(!roofs||Math.abs(camera.yaw??0)>.01||(o.buildStage??3)<3)continue;frame='cottage';width=o.width+1;p.z+=o.depth*.42;break;
    default:continue;
   }
   const result=place(o.id,frame,p,width,undefined,0,0,o.kind!=='pond');if(result){this.activeObjects.add(o.id);
    if(o.kind==='house'){const d=homeDesign(o.homeDesign,o.ownerId),f=frames.get('cottage')!,item=result.item;const stretch=Math.max(.85,Math.min(1.35,o.depth/o.width*1.18));item.image.height*=stretch;item.image.y=-f.anchor[1]*result.scale*stretch;
     if(!item.roof){item.roof=new L.Sprite();item.image.addChild(item.roof);item.roof.texture=L.Texture.createFromTexture(f.texture,0,0,f.width,Math.floor(f.height*.52));}
     item.roof.size(item.image.width,item.image.height*.52);const rgb=[1,3,5].map(n=>parseInt(d.roof.slice(n,n+2),16)/255),filter=new L.ColorFilter([rgb[0]/.25,0,0,0,0,0,rgb[1]/.48,0,0,0,0,0,rgb[2]/.65,0,0,0,0,0,1,0]);item.roof.filters=[filter];
    }
    // Painted scenery is above the native 3D layer; fade overlaps so hands and bodies stay readable.
    if(o.kind!=='pond'){
     const image=result.item.image,left=result.screen.x+image.x,top=result.screen.y+image.y;
     if(world.residents.some(r=>{const foot=projectToStage(r.position,camera,viewport),head=projectToStage({...r.position,y:r.position.y+1.95},camera,viewport);return foot.x+unit*.55>left&&foot.x-unit*.55<left+image.width&&foot.y>top&&head.y<top+image.height;}))image.alpha=.3;
    }
   }
  }
  for(const [id,item]of this.sprites)if(!seen.has(id)){item.root.destroy(true);this.sprites.delete(id);}
 }
}
