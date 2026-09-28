/** Single-finger and wheel scrolling for native Laya Text, with a draggable thumb. */
export class NativeTextScroll{
 private track:any;private thumb:any;private drag:{id:number|undefined;y:number;scroll:number;thumb:boolean}|null=null;
 constructor(private text:any,parent:any,x:number,y:number,private height:number){
  const L=(globalThis as any).Laya;
  text.height=height;text.overflow='scroll';text.mouseEnabled=true;text.hitArea=new L.Rectangle(0,0,text.width,height);
  this.track=new L.Sprite();this.track.pos(x,y);this.track.size(18,height);this.track.mouseEnabled=true;this.track.hitArea=new L.Rectangle(-6,0,28,height);parent.addChild(this.track);
  this.thumb=new L.Sprite();this.track.addChild(this.thumb);
  const down=(e:any,thumb:boolean)=>{if(this.drag)return;e.stopPropagation?.();this.drag={id:e.touchId,y:e.stageY??L.stage.mouseY,scroll:text.scrollY,thumb};};
  text.on(L.Event.MOUSE_DOWN,this,(e:any)=>down(e,false));this.track.on(L.Event.MOUSE_DOWN,this,(e:any)=>down(e,true));
  for(const node of [text,this.track])node.on(L.Event.MOUSE_WHEEL,this,(e:any)=>{e.stopPropagation?.();this.set(text.scrollY-e.delta*30);});
  L.stage.on(L.Event.MOUSE_MOVE,this,(e:any)=>{const d=this.drag;if(!d)return;if(!text.displayedInStage||(d.id!==undefined&&e.touchId!==undefined&&e.touchId!==d.id)){if(!text.displayedInStage)this.drag=null;return;}const dy=(e.stageY??L.stage.mouseY)-d.y;const max=text.maxScrollY??0;this.set(d.scroll+(d.thumb?dy*max/Math.max(1,height-this.thumb.height):-dy));});
  L.stage.on(L.Event.MOUSE_UP,this,(e:any)=>{if(this.drag&&(e.touchId===undefined||this.drag.id===undefined||e.touchId===this.drag.id))this.drag=null;});
  this.refresh();
 }
 set(value:number):void{this.text.scrollY=Math.max(0,Math.min(this.text.maxScrollY??0,value));this.refresh();}
 refresh():void{
  this.text.typeset();const max=this.text.maxScrollY??0,thumbHeight=Math.max(36,this.height*this.height/(this.height+max));
  this.track.graphics.clear();this.track.graphics.drawRoundRect(6,0,6,this.height,3,3,3,3,'#202a2b');
  this.thumb.height=thumbHeight;this.thumb.graphics.clear();this.thumb.graphics.drawRoundRect(3,0,12,thumbHeight,5,5,5,5,max?'#a8b692':'#58645b');
  this.thumb.y=max?(this.height-thumbHeight)*this.text.scrollY/max:0;
 }
}
