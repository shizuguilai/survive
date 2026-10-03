import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {HOME_DESIGNS} from '../packages/sim-core/src/home-design.ts';

const bundle=await build({entryPoints:['apps/laya-client/src/painted-world.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const {PaintedWorld,loadCampArt}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
class Sprite{
 children:Sprite[]=[];graphics={clear(){},drawEllipse(){}};x=0;y=0;width=0;height=0;
 addChild(child:Sprite){this.children.push(child);}
 pos(x:number,y:number){this.x=x;this.y=y;}
 size(width:number,height:number){this.width=width;this.height=height;}
 destroy(){}
}

test('Painted scenery never replaces house geometry when roofs or camera angles change',async()=>{
 const previous=(globalThis as any).Laya;
 (globalThis as any).Laya={Sprite,Text:Sprite,Rectangle:class{},Loader:{IMAGE:'image'},loader:{async load(){return {};}},Texture:{createFromTexture(){return {};}}};
 try{
  await loadCampArt();const painted=new PaintedWorld(),world=createCrewWorld(2);
  world.residents=[];
  world.objects=HOME_DESIGNS.flatMap(design=>[1,2,3].map(buildStage=>({id:`house-${design.id}-${buildStage}`,kind:'house' as const,position:{x:0,y:0,z:0},width:design.width,depth:design.depth,height:4,appearance:'home',resources:0,homeDesign:design.id,buildStage})));
  world.objects.push({id:'painted-tree',kind:'tree',position:{x:8,y:0,z:8},width:1,depth:1,height:3,appearance:'tree',resources:8});
  for(const yaw of [0,.001,Math.PI/2,Math.PI])for(const roofs of [true,false,true]){
   painted.render(world,{x:0,z:0,zoom:18,yaw},{x:0,y:0,width:900,height:600},roofs);
   for(const house of world.objects.filter(o=>o.kind==='house'))assert.equal(painted.hasObject(house.id),false,`${house.id}, yaw ${yaw}, roofs ${roofs}`);
   assert.equal(painted.hasObject('painted-tree'),true);
  }
 }finally{(globalThis as any).Laya=previous;}
});
