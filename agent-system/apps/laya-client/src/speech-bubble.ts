/** Small native Laya bubbles, with a dotted thought tail and a spoken tail. */
export class SpeechBubble{
 readonly root:any;private label:any;private key='';width=0;height=0;
 constructor(parent:any){
  const L=(globalThis as any).Laya;this.root=new L.Sprite();this.root.mouseEnabled=false;this.root.visible=false;parent.addChild(this.root);
  this.label=new L.Text();this.label.font='Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif';this.label.fontSize=14;this.label.leading=3;this.label.wordWrap=true;this.label.align='center';this.label.color='#344137';this.label.mouseEnabled=false;this.label.pos(14,10);this.root.addChild(this.label);
 }
 show(text:string,thought:boolean,alpha=1):void{
  const key=(thought?'thought:':'speech:')+text;
  if(key!==this.key){
   this.key=key;this.label.width=202;this.label.text=text;this.label.typeset();
   this.width=Math.min(230,Math.max(96,Math.ceil(this.label.textWidth)+28));this.label.width=this.width-28;this.label.typeset();this.height=Math.max(38,Math.ceil(this.label.textHeight)+20);this.root.size(this.width,this.height+12);
   const g=this.root.graphics,w=this.width,h=this.height,fill=thought?'#eff1e5':'#f7f2e5';g.clear();
   g.drawRoundRect(0,2,w,h,17,17,17,17,'rgba(20,30,24,0.14)');
   g.drawRoundRect(0,0,w,h,17,17,17,17,fill,'rgba(95,111,88,0.35)',1);
   if(thought){g.drawCircle(w/2+4,h+3,3,fill);g.drawCircle(w/2,h+10,1.7,fill);}
   else g.drawPoly(w/2-5,h-1,[0,0,10,0,4,8],fill);
  }
  this.root.visible=true;this.root.alpha=alpha;
 }
 hide():void{this.root.visible=false;}
 destroy():void{this.root.destroy(true);}
}
