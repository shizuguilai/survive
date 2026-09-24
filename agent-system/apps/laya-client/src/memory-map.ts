import type {Resident} from '../../../packages/sim-core/src/domain.ts';
import {buildSpatialContext} from '../../../packages/sim-core/src/spatial-memory.ts';
const colors={unknown:'#12292b',seen:'#395354',visited:'#6a947e',blocked:'#af806e',trail:'#e4ce85',self:'#b2f1c9'};
const symbols:Record<string,string>={tree:'木',rock:'石',berry:'果',board:'告',workbench:'台',wall:'墙',pond:'水',plot:'地',house:'房',person:'人'};
/** Reads only the selected resident's remembered cells, never world objects or other residents. */
export class MemoryMapView{
 private canvas:any;private marks:any;private info:any;private signature='';
 constructor(parent:any){const L=(globalThis as any).Laya;this.canvas=new L.Sprite();this.canvas.name='Private remembered terrain';this.canvas.pos(344,245);this.canvas.size(648,280);parent.addChild(this.canvas);this.marks=new L.Sprite();this.marks.mouseEnabled=false;this.canvas.addChild(this.marks);this.info=new L.Text();this.info.pos(1010,245);this.info.width=196;this.info.height=276;this.info.font='Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif';this.info.fontSize=12;this.info.leading=2;this.info.overflow='hidden';this.info.color='#d7e9d8';this.info.wordWrap=true;this.info.mouseEnabled=false;parent.addChild(this.info);}
 render(resident:Resident):void{
  const map=buildSpatialContext(resident),signature=resident.id+JSON.stringify(map);if(signature===this.signature)return;this.signature=signature;
  const L=(globalThis as any).Laya,g=this.canvas.graphics;g.clear();this.marks.destroyChildren();g.drawRect(0,0,648,280,colors.unknown);
  if(!map){this.info.text='尚未形成个人地图。\n开始模拟后，只记录本人走过或实际看见的地方。';return;}
  const points=[map.currentCell,...map.cells,...map.landmarks,...map.trail];let minX=Math.min(...points.map(p=>p.x))-1,maxX=Math.max(...points.map(p=>p.x))+1,minZ=Math.min(...points.map(p=>p.z))-1,maxZ=Math.max(...points.map(p=>p.z))+1;
  if(maxX-minX<15){const center=(minX+maxX)/2;minX=Math.floor(center-7);maxX=minX+15;}if(maxZ-minZ<11){const center=(minZ+maxZ)/2;minZ=Math.floor(center-5);maxZ=minZ+11;}
  const size=Math.min(648/(maxX-minX+1),280/(maxZ-minZ+1)),ox=(648-(maxX-minX+1)*size)/2,oz=(280-(maxZ-minZ+1)*size)/2;
  const pt=(p:{x:number;z:number})=>({x:ox+(p.x-minX+.5)*size,y:oz+(p.z-minZ+.5)*size});
  for(const c of map.cells){const p=pt(c);g.drawRect(p.x-size/2+.5,p.y-size/2+.5,size-1,size-1,colors[c.state]);}
  for(let i=1;i<map.trail.length;i++){const a=pt(map.trail[i-1]),b=pt(map.trail[i]);g.drawLine(a.x,a.y,b.x,b.y,colors.trail,2);}
  for(const landmark of map.landmarks){const p=pt(landmark),label=new L.Text();label.name='Remembered landmark '+landmark.knownRef;label.text=(symbols[landmark.kind]??'?')+(landmark.state==='depleted'?'×':'');label.pos(p.x-size/2,p.y-size/2);label.width=size;label.height=size;label.fontSize=Math.max(8,Math.min(15,size-3));label.align='center';label.valign='middle';label.color=landmark.state==='depleted'?'#bd938a':'#f5efcf';label.mouseEnabled=false;this.marks.addChild(label);}
  const self=pt(map.currentCell);g.drawCircle(self.x,self.y,Math.max(3,Math.min(6,size*.27)),colors.self);g.drawCircle(self.x,self.y,Math.max(5,Math.min(9,size*.4)),null,'#1e3b2f',1);
  this.info.text=`${resident.name}的私人地图
每格约2米 · 相对起点

暗色：未探索
灰绿：曾看见 · 浅绿：走过
棕色：记得有障碍
黄线：最近走过的路
亮点：自己所在格

木 / 石 / 果：资源
告 / 台 / 房：设施
人：最后看见的位置
×：亲眼见过已采空

${map.cells.length}格 · ${map.landmarks.length}个地标
记忆可能过时，不是实时全图`;
 }
}
