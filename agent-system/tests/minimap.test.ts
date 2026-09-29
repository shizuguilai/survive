import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {cameraFootprint} from '../apps/laya-client/src/map-camera.ts';
const bundle=await build({entryPoints:['apps/laya-client/src/minimap.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {Minimap}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
class Node{
 name='';text='';x=0;y=0;width=0;height=0;visible=true;displayedInStage=true;parent:Node|null=null;children:Node[]=[];handlers=new Map<string,Function[]>();
 polygons:number[][]=[];graphics={clear(){},drawRoundRect(){},drawRect(){},drawLine(){},drawCircle(){},drawPoly:(_x:number,_y:number,points:number[])=>this.polygons.push([...points])};
 pos(x:number,y:number){this.x=x;this.y=y;}size(w:number,h:number){this.width=w;this.height=h;}addChild(n:Node){this.children.push(n);n.parent=this;return n;}
 globalToLocal(p:{x:number;y:number}){let n:Node|null=this;while(n){p.x-=n.x;p.y-=n.y;n=n.parent;}return p;}
 on(event:string,owner:object,fn:Function){this.handlers.set(event,[...(this.handlers.get(event)??[]),fn.bind(owner)]);}emit(event:string,e:any){for(const f of this.handlers.get(event)??[])f(e);}
}
test('Native minimap navigates with its owning finger, releases cleanly, returns home, and never changes the world',()=>{
 const stage=new Node(),parent=new Node();(globalThis as any).Laya={stage,Sprite:Node,Text:Node,Rectangle:class{constructor(..._args:any[]){}},Point:class{x:number;y:number;constructor(x:number,y:number){this.x=x;this.y=y;}},Event:{MOUSE_DOWN:'down',MOUSE_MOVE:'move',MOUSE_UP:'up',CLICK:'click',RESIZE:'resize'}};
 const positions:{x:number;z:number}[]=[];let homes=0;const mini=new Minimap(parent,(p:{x:number;z:number})=>positions.push(p),()=>homes++);
 const world=createCrewWorld(2),before=hashCanonical(world);mini.render(world,'resident-a',{minX:-10,maxX:10,minZ:-5,maxZ:5});
 const root:Node=mini.root,contents=root.children[0],map=contents.children.find(n=>n.name==='Minimap navigation')!;let stopped=false;
 map.emit('down',{touchId:5,stageX:1139,stageY:524,stopPropagation:()=>stopped=true});assert.deepEqual(positions.at(-1),{x:0,z:0});assert.equal(stopped,true);
 stage.emit('move',{touchId:6,stageX:0,stageY:0});assert.equal(positions.length,1);
 stage.emit('move',{touchId:5,stageX:1000,stageY:400});assert.deepEqual(positions.at(-1),{x:-28,z:-28});
 stage.emit('up',{touchId:5});stage.emit('move',{touchId:5,stageX:1139,stageY:524});assert.equal(positions.length,2);
 const home=contents.children.find(n=>n.children.some(t=>t.text==='回营地'))!;home.emit('click',{});assert.equal(homes,1);
 const toggle=root.children.find(n=>n.children.some(t=>t.text==='−'))!;toggle.emit('click',{});assert.equal(contents.visible,false);toggle.emit('click',{});assert.equal(contents.visible,true);
 map.emit('down',{touchId:7,stageX:1139,stageY:524});stage.emit('resize',{});stage.emit('move',{touchId:7,stageX:1000,stageY:400});assert.equal(positions.length,3);
 mini.render(world,'resident-b',{minX:3,maxX:15,minZ:-10,maxZ:10});assert.equal(hashCanonical(world),before);
 const viewport={x:0,y:84,width:1280,height:570},layer=map.children[2];
 mini.render(world,'resident-b',cameraFootprint({x:0,z:0,zoom:18,yaw:Math.PI/4},viewport));const first=layer.polygons.at(-1)!;assert.ok(Math.abs(first[1]-first[3])>1);
 mini.render(world,'resident-b',cameraFootprint({x:0,z:0,zoom:18,yaw:-Math.PI/4},viewport));assert.notDeepEqual(layer.polygons.at(-1),first);
});
