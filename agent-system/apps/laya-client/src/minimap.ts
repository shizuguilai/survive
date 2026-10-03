import {artFrame,grassTexture} from './painted-world.ts';
import type {World} from '../../../packages/sim-core/src/domain.ts';
import {resourceStage} from '../../../packages/sim-core/src/resources.ts';
import {MAP_SIZE} from '../../../packages/sim-core/src/map-config.ts';
import {worldToMinimap,minimapToWorld,type MapPoint,type MapFootprint} from './map-camera.ts';

/** Observer-only navigation. This map never feeds a resident's private spatial memory. */
export class Minimap{
 readonly root:any;private contents:any;private terrain:any;private people:any;private viewport:any;private map:any;
 private staticKey='';private peopleKey='';private viewKey='';private expanded=true;private toggle:any;private touch:number|undefined|null=null;
 private readonly size=176;
 constructor(parent:any,private navigate:(point:MapPoint)=>void,private home:()=>void){
  const L=(globalThis as any).Laya;
  this.root=new L.Sprite();this.root.name='Camp minimap';this.root.pos(1013,394);this.root.size(252,248);this.root.zOrder=12;this.root.mouseEnabled=true;parent.addChild(this.root);
  this.contents=new L.Sprite();this.root.addChild(this.contents);
  const text=(parent:any,value:string,x:number,y:number,width:number,size=14)=>{const t=new L.Text();t.text=value;t.font='Camp Extension, Camp Sans, Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif';t.fontSize=size;t.color='#f4f8ef';t.pos(x,y);t.width=width;t.mouseEnabled=false;parent.addChild(t);return t;};
  text(this.root,'营地小地图',18,13,175,16);
  const button=(parent:any,label:string,x:number,y:number,w:number,h:number,fn:()=>void)=>{const b=new L.Sprite();b.pos(x,y);b.size(w,h);b.graphics.drawRoundRect(0,0,w,h,9,9,9,9,'#426580','#7996ab',1);b.mouseEnabled=true;b.hitArea=new L.Rectangle(0,0,w,h);const t=text(b,label,0,(h-14)/2,w);t.align='center';parent.addChild(b);b.on(L.Event.MOUSE_DOWN,this,(e:any)=>e.stopPropagation?.());b.on(L.Event.CLICK,this,(e:any)=>{e.stopPropagation?.();fn();});return t;};
  this.toggle=button(this.root,'−',211,7,31,29,()=>{this.expanded=!this.expanded;this.contents.visible=this.expanded;this.touch=null;this.toggle.text=this.expanded?'−':'＋';this.background();});
  this.map=new L.Sprite();this.map.name='Minimap navigation';this.map.pos(12,43);this.map.scale(1.295,.88);this.map.size(this.size,this.size);this.map.mouseEnabled=true;this.map.hitArea=new L.Rectangle(0,0,this.size,this.size);this.contents.addChild(this.map);
  this.terrain=new L.Sprite();this.people=new L.Sprite();this.viewport=new L.Sprite();for(const layer of [this.terrain,this.people,this.viewport]){layer.mouseEnabled=false;this.map.addChild(layer);}
  button(this.contents,'回营地',10,208,91,33,()=>this.home());text(this.contents,'点击 / 拖动定位',111,218,133,12);
  const move=(e:any)=>{const local=this.map.globalToLocal(new L.Point(e.stageX??L.stage.mouseX,e.stageY??L.stage.mouseY));this.navigate(minimapToWorld(local,this.size));};
  this.map.on(L.Event.MOUSE_DOWN,this,(e:any)=>{e.stopPropagation?.();if(this.touch!==null)return;this.touch=e.touchId;move(e);});
  L.stage.on(L.Event.MOUSE_MOVE,this,(e:any)=>{if(this.touch===null)return;if(!this.root.displayedInStage||!this.expanded){this.touch=null;return;}if(this.touch!==undefined&&e.touchId!==this.touch)return;move(e);});
  L.stage.on(L.Event.MOUSE_UP,this,(e:any)=>{if(this.touch===undefined||e.touchId===this.touch)this.touch=null;});
  const reset=()=>{this.touch=null;};L.stage.on(L.Event.RESIZE,this,reset);
  const wx=(globalThis as any).wx;if(wx?.onHide)wx.onHide(reset);else globalThis.addEventListener?.('blur',reset);
  this.background();
 }
 private background():void{const L=(globalThis as any).Laya,h=this.expanded?248:40;this.root.graphics.clear();this.root.graphics.drawRoundRect(0,0,252,h,13,13,13,13,'#273f53','#a6bc9b',2);this.root.hitArea=new L.Rectangle(0,0,252,h);}
 render(w:World,selected:string,view:MapFootprint,showZones=true):void{
  if(!this.expanded)return;
  const point=(p:MapPoint)=>worldToMinimap(p,this.size),scale=this.size/MAP_SIZE;
  const key=w.runId+'|'+showZones+'|'+JSON.stringify(showZones?w.camp?.zones??[]:[])+'|'+w.objects.filter(o=>o.kind!=='animal').map(o=>[o.id,o.kind,o.position.x,o.position.z,o.width,o.depth,o.buildStage,resourceStage(o),o.crop?.stage].join(',')).join(';');
  if(key!==this.staticKey){
   this.staticKey=key;const g=this.terrain.graphics;g.clear();g.drawRect(-2,-2,this.size+4,this.size+4,'#dfc79a','#eddbb2',3);const grass=grassTexture();if(grass)g.drawTexture(grass,0,0,this.size,this.size);else g.drawRect(0,0,this.size,this.size,'#a6c775');

   if(showZones)for(const zone of w.camp?.zones??[]){const a=point({x:zone.bounds.minX,z:zone.bounds.minZ}),b=point({x:zone.bounds.maxX,z:zone.bounds.maxZ}),color=zone.kind==='planting'?'#8dad68':zone.kind==='pasture'?'#cfaf6b':'#b6a0c4';g.drawRect(a.x,a.y,b.x-a.x,b.y-a.y,null,color,1);}
   for(const o of w.objects){if(o.kind==='animal')continue;const p=point(o.position);if(o.kind==='crop'){g.drawCircle(p.x,p.y,1.6,o.crop?.stage==='mature'?'#e0bd60':o.crop?.stage==='harvested'?'#a88857':'#648745');continue;}if(o.resourceKind&&o.resources<=0)continue;
    if(o.kind==='house'||o.kind==='plot'||o.kind==='wall')g.drawRect(p.x-o.width*scale/2,p.y-o.depth*scale/2,o.width*scale,o.depth*scale,o.kind==='house'?'#d6b57f':null,o.kind==='wall'?'#333e36':'#edce93',1);
    else if(o.kind==='pond')g.drawCircle(p.x,p.y,o.width*scale/2,'#567f89');
    else if(o.kind==='board'){g.drawCircle(p.x,p.y,4,'#f3e7ba','#344d3e',1);g.drawLine(p.x-3,p.y,p.x+3,p.y,'#665238',1);g.drawLine(p.x,p.y-3,p.x,p.y+3,'#665238',1);}
    else if(o.kind==='workbench')g.drawRect(p.x-3,p.y-2,6,4,'#b88757');
    else {const f=artFrame(o.kind==='tree'?'treeBroad':o.kind==='rock'?'rock':'berryBush'),s=o.kind==='tree'?11:6;if(f)g.drawTexture(f.texture,p.x-s/2,p.y-s,s,s);else g.drawCircle(p.x,p.y,2,'#4f773d');}
   }
  }
  const peopleKey=w.runId+'|'+w.revision+'|'+w.tick+'|'+selected;
  if(peopleKey!==this.peopleKey){this.peopleKey=peopleKey;const g=this.people.graphics;g.clear();for(const o of w.objects)if(o.kind==='animal'){const p=point(o.position);g.drawCircle(p.x,p.y,o.animal?.kind==='goose'?2:1.7,o.animal?.kind==='chicken'?'#d99753':'#f5edda','#7e7859',.6);}for(const r of w.residents){const p=point(r.position);if(r.id===selected)g.drawCircle(p.x,p.y,5,null,'#f8f4de',1.5);g.drawCircle(p.x,p.y,2.8,r.id===selected?'#81c8e4':'#f0cd76','#273837',1);}}
  const viewKey=JSON.stringify(view);if(viewKey!==this.viewKey){this.viewKey=viewKey;const corners=(view.corners??[{x:view.minX,z:view.minZ},{x:view.maxX,z:view.minZ},{x:view.maxX,z:view.maxZ},{x:view.minX,z:view.maxZ}]).map(point),g=this.viewport.graphics;g.clear();g.drawPoly(0,0,corners.flatMap(p=>[p.x,p.y]),'rgba(244,224,164,0.07)','#fff0bd',1.5);const x=corners.reduce((s,p)=>s+p.x,0)/4,y=corners.reduce((s,p)=>s+p.y,0)/4,top={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2},dx=top.x-x,dy=top.y-y,d=Math.hypot(dx,dy);g.drawLine(x,y,x+dx/d*9,y+dy/d*9,'#fff0bd',2);g.drawCircle(x,y,2,'#fff0bd');}
 }
}
