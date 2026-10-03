import type {World,WorldObject} from '../../../packages/sim-core/src/domain.ts';
import {homeDesign} from '../../../packages/sim-core/src/home-design.ts';
import {resourceStage} from '../../../packages/sim-core/src/resources.ts';
import {createCharacterState,equippedItem} from '../../../packages/sim-core/src/character.ts';
import {pawnPose,workPose} from './pawn-pose.ts';
import {projectToStage,type MapCamera,type MapViewport} from './map-camera.ts';
import atlas from './art-atlas.json' with {type:'json'};

type Frame={texture:any;width:number;height:number;anchor:number[]};
const frames=new Map<string,Frame>();let grass:any;
export async function loadCampArt():Promise<void>{
 const L=(globalThis as any).Laya;
 const names=['grass.png','scenery-atlas.png','villagers-atlas.png'];
 const images=await Promise.all(names.map(name=>L.loader.load('assets/art/'+name,L.Loader.IMAGE)));
 if(images.some(image=>!image))throw Error('营地画面素材加载失败，请刷新重试。');
 grass=images[0];
 for(const [index,group] of [atlas.assets.scenery,atlas.assets.villagers].entries())for(const item of group.sprites){
  const [x,y,width,height]=item.rect;frames.set(item.name,{texture:L.Texture.createFromTexture(images[index+1],x,y,width,height),width,height,anchor:item.anchor});
 }
}
export function grassTexture():any{return grass;}
export function artFrame(name:string):Frame|undefined{return frames.get(name);}
/** Painted observer layer. All positions/poses come from simulation, never from wall time. */
export class PaintedWorld{
 readonly root:any;private sprites=new Map<string,any>();private activeObjects=new Set<string>();private activeResidents=new Set<string>();private tops=new Map<string,{x:number;y:number}>();private bounds=new Map<string,{x:number;y:number;width:number;height:number}>();private identities=new Map<string,{signature:string;supported:boolean}>();
 constructor(){const L=(globalThis as any).Laya;this.root=new L.Sprite();this.root.name='Painted camp';this.root.mouseEnabled=false;}
 hasObject(id:string):boolean{return this.activeObjects.has(id);}
 hasResident(id:string):boolean{return this.activeResidents.has(id);}
 residentTop(id:string){return this.tops.get(id);}
 residentBounds(id:string){return this.bounds.get(id);}
 private supportsResident(r:World['residents'][number]):boolean{
  if(!r.character)return true;const signature=JSON.stringify(r.character),cached=this.identities.get(r.id);if(cached?.signature===signature)return cached.supported;
  const baseline=createCharacterState(r.id),supported=JSON.stringify(r.character.appearance)===JSON.stringify(baseline.appearance)&&(['torso','head','leftHand','rightHand','back'] as const).every(slot=>(equippedItem(r.character!,slot)?.definition.id??null)===(equippedItem(baseline,slot)?.definition.id??null));
  this.identities.set(r.id,{signature,supported});return supported;
 }
 private sprite(id:string):any{
  let entry=this.sprites.get(id);if(entry)return entry;
  const L=(globalThis as any).Laya,root=new L.Sprite(),shadow=new L.Sprite(),image=new L.Sprite(),gear=new L.Text();
  root.name='Painted '+id;root.mouseEnabled=false;root.addChild(shadow);root.addChild(image);root.addChild(gear);this.root.addChild(root);
  gear.font='Camp Sans, Noto Sans CJK SC, Microsoft YaHei, Arial';gear.fontSize=11;gear.color='#fffbe7';gear.stroke=2;gear.strokeColor='#2c3e32';gear.mouseEnabled=false;
  entry={root,shadow,image,gear,key:'',frame:''};this.sprites.set(id,entry);return entry;
 }
 render(world:World,camera:MapCamera,viewport:MapViewport,roofs:boolean,selected:string):void{
  const L=(globalThis as any).Laya,unit=viewport.height/camera.zoom,seen=new Set<string>();this.activeObjects.clear();this.activeResidents.clear();this.tops.clear();this.bounds.clear();
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
    // Fade foreground foliage when a resident is behind it, retaining readable navigation.
    if(o.kind==='tree'&&world.residents.some(r=>{const q=projectToStage(r.position,camera,viewport);return Math.abs(q.x-result.screen.x)<width*unit*.32&&q.y<result.screen.y&&q.y>result.top;}))result.item.image.alpha=.48;
   }
  }
  for(const r of world.residents){
   if(!this.supportsResident(r))continue;const i=[...r.id].reduce((n,c)=>n+c.charCodeAt(0),0);
   const a=r.heading+(camera.yaw??0),x=Math.cos(a),y=Math.sin(a),direction=Math.abs(x)>Math.abs(y)?(x>0?'Right':'Left'):(y>0?'Front':'Back');
   const pose=pawnPose(r),work=workPose(r),body=r.character?.appearance.bodyLength??1,frame=(i%2?'white':'navy')+direction;
   const width=1.60*Math.max(.9,Math.min(1.1,body)),bob=pose.moving?Math.abs(pose.stride)*unit*.05:0;
   const sleeping=(r.health??100)<=0||r.plan?.some(p=>!p.done&&p.action.op==='rest'&&p.bedSettled),result=place(r.id,frame,r.position,width,undefined,bob,sleeping?-65:work.lean+pose.stride*2);
   if(!result)continue;this.activeResidents.add(r.id);this.tops.set(r.id,{x:result.screen.x,y:result.top-5});this.bounds.set(r.id,{x:result.screen.x-width*unit/2,y:result.top,width:width*unit,height:result.screen.y-result.top});
   const item=result.item,gear=r.character;const held=gear&&(equippedItem(gear,'rightHand')??equippedItem(gear,'leftHand'));
   if(held){item.gear.text=held.definition.label;item.gear.pos(width*unit*.25,-unit*.40+work.right*unit);}
   if(selected===r.id){item.shadow.graphics.drawEllipse(-width*unit*.36,-unit*.16,width*unit*.78,unit*.4,null,'#f8edbd',1.5);item.key='';}
  }
  for(const [id,item]of this.sprites)if(!seen.has(id)){item.root.destroy(true);this.sprites.delete(id);}
 }
}
