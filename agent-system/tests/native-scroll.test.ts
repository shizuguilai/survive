import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['apps/laya-client/src/native-scroll.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {NativeTextScroll}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
class Node{
 x=0;y=0;width=500;height=0;mouseEnabled=false;displayedInStage=true;scrollY=0;maxScrollY=1000;children:Node[]=[];handlers=new Map<string,Function[]>();
 graphics={clear(){},drawRoundRect(){}};pos(x:number,y:number){this.x=x;this.y=y;}size(w:number,h:number){this.width=w;this.height=h;}addChild(n:Node){this.children.push(n);}typeset(){}
 on(event:string,owner:object,fn:Function){this.handlers.set(event,[...(this.handlers.get(event)??[]),fn.bind(owner)]);}emit(event:string,e:any){for(const f of this.handlers.get(event)??[])f(e);}
}
test('Native inventory content drags with one finger, clamps at both ends, and supports dragging the scrollbar',()=>{
 const stage=new Node(),parent=new Node(),body=new Node();(globalThis as any).Laya={stage,Sprite:Node,Rectangle:class{constructor(..._args:any[]){}},Event:{MOUSE_DOWN:'down',MOUSE_MOVE:'move',MOUSE_UP:'up',MOUSE_WHEEL:'wheel'}};
 const scroll=new NativeTextScroll(body,parent,500,0,300);let stopped=false;
 body.emit('down',{touchId:5,stageY:240,stopPropagation:()=>stopped=true});stage.emit('move',{touchId:5,stageY:120});assert.equal(body.scrollY,120);assert.equal(stopped,true);
 stage.emit('move',{touchId:6,stageY:10});assert.equal(body.scrollY,120);stage.emit('up',{touchId:5});stage.emit('move',{touchId:5,stageY:0});assert.equal(body.scrollY,120);
 scroll.set(10000);assert.equal(body.scrollY,1000);scroll.set(-50);assert.equal(body.scrollY,0);
 parent.children[0].emit('down',{touchId:7,stageY:50});stage.emit('move',{touchId:7,stageY:350});assert.equal(body.scrollY,1000);stage.emit('up',{touchId:7});
 body.emit('wheel',{delta:2,stopPropagation(){}});assert.equal(body.scrollY,940);
});
