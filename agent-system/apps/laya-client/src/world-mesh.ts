import {resourceRatio,resourceStage} from '../../../packages/sim-core/src/resources.ts';
import type {WorldObject} from '../../../packages/sim-core/src/domain.ts';
import {homeDesign,homeLayout} from '../../../packages/sim-core/src/home-design.ts';
/** All scenery is native Laya geometry; these objects never advance the simulation. */
export class WorldMesh{
 readonly node:any;private geometries:any[]=[];private materials:any[]=[];private ink:any;private roofs:any[]=[];private lampParts:any[]=[];private lampGlass:any[]=[];private night:boolean|undefined;private partParent:any;
 constructor(readonly object:WorldObject){
  const L=(globalThis as any).Laya;this.node=new L.Sprite3D(object.id);this.node.transform.position=new L.Vector3(object.position.x,object.position.y,object.position.z);
  const box=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,c:string)=>this.part(name,L.PrimitiveMesh.createBox(w,h,d),x,y,z,c);
  const ball=(name:string,r:number,x:number,y:number,z:number,c:string,sx=1,sy=1,sz=1)=>{const p=this.part(name,L.PrimitiveMesh.createSphere(r,10,12),x,y,z,c);p.transform.localScale=new L.Vector3(sx,sy,sz);return p;};
  const ratio=resourceRatio(object),stage=resourceStage(object);
  const shadowR=object.kind==='pond'?2.75:object.kind==='house'||object.kind==='plot'?2.7:object.kind==='tree'?[.29,.72,.93,1.07,1.15][stage]:.83;
  const stump=object.kind==='tree'&&stage===0;
  const shadow=this.part('contact shadow',L.PrimitiveMesh.createCylinder(shadowR,.018,20),stump?0:.13,-.022,stump?0:.12,'#799543');shadow.transform.localScale=new L.Vector3(1,1,stump?.92:.78);
  switch(object.kind){
   case 'board':
    box('notice frame',1.5,1,.15,0,1.15,0,'#735437');for(const x of [-.56,.56])box('board post',.12,1.8,.14,x,.9,0,'#866244');
    box('paper notice',1.19,.7,.025,0,1.18,.09,'#e7d8af');for(let i=0;i<3;i++)box('written lines',.8-i*.12,.035,.028,-.08,1.38-i*.16,.108,'#81775d');
    box('roof',1.8,.16,.65,0,1.83,0,'#396780');box('shared store crate',.85,.65,.75,1.05,.33,.15,'#b1905e');box('crate rim',.95,.07,.83,1.05,.66,.15,'#7e6045');break;
   case 'workbench':
    box('workbench top',2,.17,.95,0,1.08,0,'#c5a276');for(const x of [-.75,.75])for(const z of [-.3,.3])box('bench leg',.16,1,.16,x,.5,z,'#84613f');
    for(let i=0;i<4;i++)box('bench plank seam',1.96,.012,.018,0,1.17,-.34+i*.23,'#71553a');box('bench brace',1.6,.12,.12,0,.38,0,'#9c794e');ball('anvil stone',.25,.35,1.32,0,'#8c9791',1.3,.6,1);box('hammer handle',.45,.07,.08,-.55,1.22,.13,'#785336');box('hammer head',.15,.15,.24,-.38,1.29,.13,'#818c87');break;
   case 'rock':{const scale=stage===0?.15:stage===1?.43:stage===2?.65:stage===3?.85:1;this.node.transform.localScale=new L.Vector3(scale,scale,scale);ball('stone cluster',.73,0,.43,0,'#747c78',1.25,.68,1);ball('stone edge',.43,.55,.24,.19,'#969a8b',1,.7,1);const facet=box('stone top facet',.65,.035,.44,-.12,.89,-.06,'#a8aa99');facet.transform.localRotationEuler=new L.Vector3(0,18,-7);box('rock fissure',.38,.025,.045,.12,.9,.01,'#555e57');break;}
   case 'berry':
    ball('berry leaves',.64,0,.45,0,object.resources?'#4d6638':'#858052',1,.72,1);
    if(object.resources)for(let i=0;i<Math.ceil(ratio*7);i++){const a=i*2.4;ball('ripe berry',.095,Math.cos(a)*.42,.59+(i%3)*.1,Math.sin(a)*.4,'#b74e4b');}break;
   case 'pond':this.part('shore bank',L.PrimitiveMesh.createCylinder(2.72,.025,32),0,-.01,0,'#aec977');this.part('water',L.PrimitiveMesh.createCylinder(2.5,.035,32),0,.015,0,'#557b78');this.part('deep water',L.PrimitiveMesh.createCylinder(1.92,.012,32),-.17,.04,-.17,'#436c6b');for(let i=0;i<4;i++)box('water glint',.35+i*.11,.008,.025,-.8+i*.42,.055,-.7+i*.4,'#8da8a0');for(let i=0;i<10;i++){const a=i*Math.PI/5;ball('shore stone',.25,Math.cos(a)*2.6,.09,Math.sin(a)*2.6,'#aaa48a',1.3,.45,1);}break;
   case 'plot':case 'house':{
    const stage=object.buildStage??3,w=object.width,d=object.depth,hw=w/2,hd=d/2,front=(hw+.7)/2,side=(w-1.4)/2,design=homeDesign(object.homeDesign,object.ownerId),layout=homeLayout(object);
    box('building footprint',w+.4,.03,d+.5,0,.02,0,'#b8ae86');
    if(stage<3)for(const x of [-hw,hw])for(const z of [-hd,hd])box('survey stake',.10,.65,.10,x,.34,z,'#e1cf95');
    if(stage>=1){box('stone foundation',w+.1,.3,d+.2,0,.17,0,'#969a8b');box('wood floor',w-.1,.09,d,0,.36,0,design.floor);for(let x=-hw+.25;x<hw;x+=.5)box('floor seam',.015,.01,d,x,.41,0,design.trim);}
    if(stage>=2){
     box('back wall',w,2.1,.18,0,1.42,-hd+.05,design.wall);for(const x of [-hw+.08,hw-.08])box('side wall',.16,2.1,d,x,1.42,0,design.wall);
     for(const x of [-front,front])box('front wall',side,2.1,.17,x,1.42,hd-.05,design.wall);box('door lintel',1.45,.36,.2,0,2.3,hd-.05,design.trim);
     for(let row=0;row<6;row++){for(const x of [-front,front])box('front horizontal timber seam',side,.018,.015,x,.52+row*.31,hd+.044,design.trim);for(const x of [-hw-.012,hw+.012])box('side timber seam',.012,.018,d,x,.52+row*.31,0,design.trim);}
     for(const x of [-front,front]){box('window frame',.67,.77,.10,x,1.55,hd+.07,design.trim);box('window pane',.51,.6,.035,x,1.55,hd+.13,'#496b70');box('window crossbar',.04,.6,.04,x,1.55,hd+.16,design.trim);if(design.shutters)for(const dx of [-.4,.4])box('window shutter',.12,.7,.06,x+dx,1.55,hd+.10,design.roof);}
    }
    if(stage>=3){
     const turned=design.across==='depth',across=turned?hd:hw,length=turned?w:d,slope=Math.tan(design.pitch*Math.PI/180),peak=2.5+slope*across,roofY=peak-slope*(across/2+.08),roofW=(across+.5)/Math.cos(design.pitch*Math.PI/180);
     this.partParent=new L.Sprite3D('roof frame');this.node.addChild(this.partParent);this.partParent.transform.localRotationEuler=new L.Vector3(0,turned?90:0,0);
     for(const side of [-1,1]){const roof=box('sloping roof',roofW,.18,length+.75,side*(across/2+.08),roofY,0,design.roof);roof.transform.localRotationEuler=new L.Vector3(0,0,-side*design.pitch);}
     for(const side of [-1,1])for(let z=-length/2-.15;z<length/2+.25;z+=.46){const seam=box('roof shingle seam',roofW,.025,.028,side*(across/2+.08),roofY+.103,z,design.trim);seam.transform.localRotationEuler=new L.Vector3(0,0,-side*design.pitch);}
     box('roof ridge',.19,.2,length+.85,0,peak+.05,0,design.trim);this.partParent=undefined;
     const chimneyX=hw-.84,chimneyZ=-hd+.65,chimneyY=peak-slope*Math.abs(turned?chimneyZ:chimneyX);
     box('chimney',.48,1,.5,chimneyX,chimneyY+.22,chimneyZ,'#8f9181');box('chimney cap',.58,.13,.6,chimneyX,chimneyY+.76,chimneyZ,'#5a6158');box('porch step',1.6,.18,.7,0,.14,hd+.48,'#9c9b85');
     const f=object.furniture;
     if(f?.bed){const {x,z}=layout.bed;box('bed frame',1.15,.25,1.95,x,.55,z,design.trim);box('bed mattress',1.07,.2,1.83,x,.76,z,'#d4c7a0');box('bed blanket',1.08,.06,1.25,x,.89,z+.27,design.blanket);box('bed pillow',.83,.13,.38,x,.91,z-.65,'#ede3c8');box('bed headboard',1.2,.73,.1,x,.73,z-1.02,design.trim);}
     if(f?.cabinet){const {x,z}=layout.cabinet;box('personal cabinet',.88,1.35,.65,x,1.08,z,design.trim);box('cabinet doors',.8,1.13,.04,x,1.08,z+.35,design.floor);box('cabinet split',.025,1.05,.04,x,1.08,z+.38,design.trim);ball('cabinet handle',.04,x-.12,1.1,z+.4,'#dfc798');}
     if(f?.lamp){
      const {x,z}=layout.lamp;
      this.part('lamp foot',L.PrimitiveMesh.createCylinder(.21,.07,16),x,.45,z,'#555344');
      this.part('lamp stem',L.PrimitiveMesh.createCylinder(.045,1.05,10),x,1.005,z,'#69583e');
      this.part('lantern lower rim',L.PrimitiveMesh.createCylinder(.25,.07,12),x,1.55,z,'#78603d');
      const glass=box('lantern glass',.34,.42,.34,x,1.8,z,'#d2c8a7'),mat=glass.meshRenderer.sharedMaterial;
      mat.renderMode=L.UnlitMaterial.RENDERMODE_TRANSPARENT;mat.albedoColor=new L.Color(.82,.78,.65,.26);this.lampGlass.push(mat);
      for(const dx of [-.19,.19])for(const dz of [-.19,.19])box('lantern frame post',.035,.47,.035,x+dx,1.8,z+dz,'#66543b');
      this.part('lantern upper rim',L.PrimitiveMesh.createCylinder(.25,.06,12),x,2.04,z,'#78603d');
      this.part('lantern hood',L.PrimitiveMesh.createCone(.32,.19,12),x,2.16,z,'#526253');
      box('lantern handle top',.21,.035,.035,x,2.3,z,'#4f503f');for(const dx of [-.09,.09])box('lantern handle side',.035,.13,.035,x+dx,2.24,z,'#4f503f');
      ball('lamp bulb',.075,x,1.78,z,'#d9d0af',1,1.3,1);this.lampParts.push(ball('lamp glow',.11,x,1.79,z,'#ffe3a0',1,1.45,1));
     }
     if(f?.mop){const {x,z}=layout.mop;const handle=box('mop handle',.045,1.25,.045,x,1.03,z,'#b49765');handle.transform.localRotationEuler=new L.Vector3(8,0,layout.side*7);box('mop head',.30,.08,.16,x+layout.side*.06,.44,z+.07,'#c2c9b8');}
    }break;
   }
   case 'wall':box('stone wall',object.width,object.height,object.depth,0,object.height/2,0,'#777f73');for(let row=1;row<Math.min(12,object.height/.35);row++)box('mortar seam',object.width+.012,.024,object.depth+.012,0,row*.35,0,'#4e584e');break;
   default:
    if(!object.resources){this.part('stump trunk',L.PrimitiveMesh.createCylinder(.23,.3,10),0,.12,0,'#73573b');this.part('stump cut surface',L.PrimitiveMesh.createCylinder(.225,.016,12),0,.279,0,'#cbae7b');this.part('stump growth ring',L.PrimitiveMesh.createCylinder(.13,.008,12),0,.291,0,'#a78657');break;}
    this.partParent=new L.Sprite3D('tree growth');this.node.addChild(this.partParent);
    this.part('trunk',L.PrimitiveMesh.createCylinder(.21,1.7,10),0,.82,0,'#73573b');
    if(stage<=2)this.partParent.transform.localRotationEuler=new L.Vector3(0,0,stage===1?16:8);ball('broad crown',1,0,2.05,0,'#4b6338',1.15,.72,1);if(stage>=3)ball('sunlit crown',.75,-.19,2.52,-.07,'#7c8c52',1,.77,1);if(stage>=2)ball('side crown',.65,-.58,2.08,.3,'#667e43',1,.75,1);if(stage>=4)ball('leaf cluster',.45,.63,2.24,.16,'#8e9c5e',1,.65,1);if(stage<=2)box('cut in trunk',.27,.15,.22,.15,.62,.14,'#d6b78c');box('bark line',.026,.68,.025,.03,.76,.21,'#463e2d');
  }
 }
 private part(name:string,geometry:any,x:number,y:number,z:number,color:string):any{
  const L=(globalThis as any).Laya,node=new L.MeshSprite3D(geometry,name),n=parseInt(color.slice(1),16);node.transform.localPosition=new L.Vector3(x,y,z);
  const flat=/crown|cluster|leaves|shadow|water|lamp glow|lantern glass/.test(name);const material=flat?new L.UnlitMaterial():new L.BlinnPhongMaterial();material.albedoColor=new L.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);material.specularColor=new L.Color(0,0,0,1);node.meshRenderer.sharedMaterial=material;(this.partParent??this.node).addChild(node);this.geometries.push(geometry);this.materials.push(material);
  if(/crown|cluster|leaves|trunk|stone edge|wall$|foundation|roof$|crate$|frame$|workbench top/.test(name)){
   if(!this.ink){this.ink=new L.UnlitMaterial();this.ink.albedoColor=new L.Color(.17,.19,.15,1);this.ink.cull=L.RenderState.CULL_FRONT;this.materials.push(this.ink);}
   const outline=new L.MeshSprite3D(geometry,'ink silhouette');outline.transform.localScale=new L.Vector3(1.026,1.026,1.026);outline.meshRenderer.sharedMaterial=this.ink;node.addChild(outline);
  }if(['house','plot'].includes(this.object.kind)&&/roof|chimney/.test(name))this.roofs.push(node);return node;
 }
 setNight(night:boolean):void{if(this.night===night)return;this.night=night;for(const node of this.lampParts)node.active=night;const L=(globalThis as any).Laya;for(const mat of this.lampGlass)mat.albedoColor=night?new L.Color(1,.84,.48,.38):new L.Color(.82,.78,.65,.26);}
 setRoofVisible(visible:boolean):void{for(const roof of this.roofs)roof.active=visible;}
 dispose():void{this.node.destroy(true);for(const g of this.geometries)g.destroy();for(const m of this.materials)m.destroy();}
}
