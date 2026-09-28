import {resourceRatio,resourceStage} from '../../../packages/sim-core/src/resources.ts';
import type {WorldObject} from '../../../packages/sim-core/src/domain.ts';
/** All scenery is native Laya geometry; these objects never advance the simulation. */
export class WorldMesh{
 readonly node:any;private geometries:any[]=[];private materials:any[]=[];private ink:any;private roofs:any[]=[];private lampParts:any[]=[];
 constructor(readonly object:WorldObject){
  const L=(globalThis as any).Laya;this.node=new L.Sprite3D(object.id);this.node.transform.position=new L.Vector3(object.position.x,object.position.y,object.position.z);
  const box=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,c:string)=>this.part(name,L.PrimitiveMesh.createBox(w,h,d),x,y,z,c);
  const ball=(name:string,r:number,x:number,y:number,z:number,c:string,sx=1,sy=1,sz=1)=>{const p=this.part(name,L.PrimitiveMesh.createSphere(r,10,12),x,y,z,c);p.transform.localScale=new L.Vector3(sx,sy,sz);return p;};
  const ratio=resourceRatio(object),stage=resourceStage(object);
  const shadowR=object.kind==='pond'?2.75:object.kind==='house'||object.kind==='plot'?2.7:object.kind==='tree'?1.15:.83;
  const shadow=this.part('contact shadow',L.PrimitiveMesh.createCylinder(shadowR,.018,20),.13,-.022,.12,'#4d5539');shadow.transform.localScale=new L.Vector3(1,1,.78);
  switch(object.kind){
   case 'board':
    box('notice frame',1.5,1,.15,0,1.15,0,'#735437');for(const x of [-.56,.56])box('board post',.12,1.8,.14,x,.9,0,'#866244');
    box('paper notice',1.19,.7,.025,0,1.18,.09,'#e7d8af');for(let i=0;i<3;i++)box('written lines',.8-i*.12,.035,.028,-.08,1.38-i*.16,.108,'#81775d');
    box('roof',1.8,.16,.65,0,1.83,0,'#577768');box('shared store crate',.85,.65,.75,1.05,.33,.15,'#b1905e');box('crate rim',.95,.07,.83,1.05,.66,.15,'#7e6045');break;
   case 'workbench':
    box('workbench top',2,.17,.95,0,1.08,0,'#c5a276');for(const x of [-.75,.75])for(const z of [-.3,.3])box('bench leg',.16,1,.16,x,.5,z,'#84613f');
    for(let i=0;i<4;i++)box('bench plank seam',1.96,.012,.018,0,1.17,-.34+i*.23,'#71553a');box('bench brace',1.6,.12,.12,0,.38,0,'#9c794e');ball('anvil stone',.25,.35,1.32,0,'#8c9791',1.3,.6,1);box('hammer handle',.45,.07,.08,-.55,1.22,.13,'#785336');box('hammer head',.15,.15,.24,-.38,1.29,.13,'#818c87');break;
   case 'rock':{const scale=stage===0?.15:stage===1?.43:stage===2?.65:stage===3?.85:1;this.node.transform.localScale=new L.Vector3(scale,scale,scale);ball('stone cluster',.73,0,.43,0,'#747c78',1.25,.68,1);ball('stone edge',.43,.55,.24,.19,'#969a8b',1,.7,1);const facet=box('stone top facet',.65,.035,.44,-.12,.89,-.06,'#a8aa99');facet.transform.localRotationEuler=new L.Vector3(0,18,-7);box('rock fissure',.38,.025,.045,.12,.9,.01,'#555e57');break;}
   case 'berry':
    ball('berry leaves',.64,0,.45,0,object.resources?'#4d6638':'#858052',1,.72,1);
    if(object.resources)for(let i=0;i<Math.ceil(ratio*7);i++){const a=i*2.4;ball('ripe berry',.095,Math.cos(a)*.42,.59+(i%3)*.1,Math.sin(a)*.4,'#b74e4b');}break;
   case 'pond':this.part('shore bank',L.PrimitiveMesh.createCylinder(2.72,.025,32),0,-.01,0,'#8d8965');this.part('water',L.PrimitiveMesh.createCylinder(2.5,.035,32),0,.015,0,'#557b78');this.part('deep water',L.PrimitiveMesh.createCylinder(1.92,.012,32),-.17,.04,-.17,'#436c6b');for(let i=0;i<4;i++)box('water glint',.35+i*.11,.008,.025,-.8+i*.42,.055,-.7+i*.4,'#8da8a0');for(let i=0;i<10;i++){const a=i*Math.PI/5;ball('shore stone',.25,Math.cos(a)*2.6,.09,Math.sin(a)*2.6,'#aaa48a',1.3,.45,1);}break;
   case 'plot':case 'house':{
    const stage=object.buildStage??3,w=object.width,d=object.depth,hw=w/2,hd=d/2,front=(hw+.7)/2,side=(w-1.4)/2;
    box('building footprint',w+.4,.03,d+.5,0,.02,0,'#b8ae86');
    if(stage<3)for(const x of [-hw,hw])for(const z of [-hd,hd])box('survey stake',.10,.65,.10,x,.34,z,'#e1cf95');
    if(stage>=1){box('stone foundation',w+.1,.3,d+.2,0,.17,0,'#969a8b');box('wood floor',w-.1,.09,d,0,.36,0,'#ba9569');for(let x=-hw+.25;x<hw;x+=.5)box('floor seam',.015,.01,d,x,.41,0,'#987648');}
    if(stage>=2){
     box('back wall',w,2.1,.18,0,1.42,-hd+.05,'#c2a06c');for(const x of [-hw+.08,hw-.08])box('side wall',.16,2.1,d,x,1.42,0,'#c6aa7d');
     for(const x of [-front,front])box('front wall',side,2.1,.17,x,1.42,hd-.05,'#bf9c68');box('door lintel',1.45,.36,.2,0,2.3,hd-.05,'#8f714b');
     for(let row=0;row<6;row++){for(const x of [-front,front])box('front horizontal timber seam',side,.018,.015,x,.52+row*.31,hd+.044,'#856b4c');for(const x of [-hw-.012,hw+.012])box('side timber seam',.012,.018,d,x,.52+row*.31,0,'#856b4c');}
     for(const x of [-front,front]){box('window frame',.67,.77,.10,x,1.55,hd+.07,'#715638');box('window pane',.51,.6,.035,x,1.55,hd+.13,'#496b70');box('window crossbar',.04,.6,.04,x,1.55,hd+.16,'#715638');}
    }
    if(stage>=3){
     const peak=2.5+Math.tan(24*Math.PI/180)*hw,roofY=peak-Math.tan(24*Math.PI/180)*(hw/2+.08),roofW=(hw+.5)/Math.cos(24*Math.PI/180);
     for(const side of [-1,1]){const roof=box('sloping roof',roofW,.18,d+.75,side*(hw/2+.08),roofY,0,'#69715b');roof.transform.localRotationEuler=new L.Vector3(0,0,-side*24);}
     for(const side of [-1,1])for(let z=-hd-.15;z<hd+.25;z+=.46){const seam=box('roof shingle seam',roofW,.025,.028,side*(hw/2+.08),roofY+.103,z,'#35483e');seam.transform.localRotationEuler=new L.Vector3(0,0,-side*24);}
     box('roof ridge',.19,.2,d+.85,0,peak+.05,0,'#3b483c');box('chimney',.48,1,.5,hw-.84,peak-.03,-hd+.65,'#8f9181');box('chimney cap',.58,.13,.6,hw-.84,peak+.51,-hd+.65,'#5a6158');box('porch step',1.6,.18,.7,0,.14,hd+.48,'#9c9b85');
     const f=object.furniture;
     if(f?.bed){const x=-hw+.82;box('bed frame',1.15,.25,1.95,x,.55,-.13,'#805a3e');box('bed mattress',1.07,.2,1.83,x,.76,-.13,'#d4c7a0');box('bed blanket',1.08,.06,1.25,x,.89,.14,'#75948c');box('bed pillow',.83,.13,.38,x,.91,-.78,'#ede3c8');box('bed headboard',1.2,.73,.1,x,.73,-1.15,'#9f774d');}
     if(f?.cabinet){box('personal cabinet',.88,1.35,.65,hw-.68,1.08,-hd+.6,'#9e794f');box('cabinet doors',.8,1.13,.04,hw-.68,1.08,-hd+.95,'#bc9560');box('cabinet split',.025,1.05,.04,hw-.68,1.08,-hd+.98,'#795637');ball('cabinet handle',.04,hw-.8,1.1,-hd+1,'#dfc798');}
     if(f?.lamp){box('lamp stand',.07,1.2,.07,hw-.63,1.05,hd-.54,'#685a42');ball('lamp shade',.23,hw-.63,1.71,hd-.54,'#e8ce80',1,.72,1);this.lampParts.push(ball('lamp glow',.26,hw-.63,1.71,hd-.54,'#fff0ac',1,.7,1));const pool=this.part('lamp pool',L.PrimitiveMesh.createCylinder(Math.min(hw,1.5),.012,24),.2,.423,.1,'#d0bb7d');this.lampParts.push(pool);}
     if(f?.mop){const handle=box('mop handle',.045,1.25,.045,hw-.29,1.03,.16,'#b49765');handle.transform.localRotationEuler=new L.Vector3(8,0,-7);box('mop head',.30,.08,.16,hw-.35,.44,.23,'#c2c9b8');}
    }break;
   }
   case 'wall':box('stone wall',object.width,object.height,object.depth,0,object.height/2,0,'#777f73');for(let row=1;row<Math.min(12,object.height/.35);row++)box('mortar seam',object.width+.012,.024,object.depth+.012,0,row*.35,0,'#4e584e');break;
   default:
    this.part('trunk',L.PrimitiveMesh.createCylinder(.21,1.7,10),0,.82,0,'#73573b');
    if(object.resources){if(stage<=2)this.node.transform.localRotationEuler=new L.Vector3(0,0,stage===1?16:8);ball('broad crown',1,0,2.05,0,'#4b6338',1.15,.72,1);if(stage>=3)ball('sunlit crown',.75,-.19,2.52,-.07,'#7c8c52',1,.77,1);if(stage>=2)ball('side crown',.65,-.58,2.08,.3,'#667e43',1,.75,1);if(stage>=4)ball('leaf cluster',.45,.63,2.24,.16,'#8e9c5e',1,.65,1);if(stage<=2)box('cut in trunk',.27,.15,.22,.15,.62,.14,'#d6b78c');box('bark line',.026,.68,.025,.03,.76,.21,'#463e2d');}
    else this.node.transform.localScale=new L.Vector3(1,.2,1);
  }
 }
 private part(name:string,geometry:any,x:number,y:number,z:number,color:string):any{
  const L=(globalThis as any).Laya,node=new L.MeshSprite3D(geometry,name),n=parseInt(color.slice(1),16);node.transform.localPosition=new L.Vector3(x,y,z);
  const flat=/crown|cluster|leaves|shadow|water|lamp glow|lamp pool/.test(name);const material=flat?new L.UnlitMaterial():new L.BlinnPhongMaterial();material.albedoColor=new L.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);material.specularColor=new L.Color(0,0,0,1);node.meshRenderer.sharedMaterial=material;this.node.addChild(node);this.geometries.push(geometry);this.materials.push(material);
  if(/crown|cluster|leaves|trunk|stone edge|wall$|foundation|roof$|crate$|frame$|workbench top/.test(name)){
   if(!this.ink){this.ink=new L.UnlitMaterial();this.ink.albedoColor=new L.Color(.17,.19,.15,1);this.ink.cull=L.RenderState.CULL_FRONT;this.materials.push(this.ink);}
   const outline=new L.MeshSprite3D(geometry,'ink silhouette');outline.transform.localScale=new L.Vector3(1.026,1.026,1.026);outline.meshRenderer.sharedMaterial=this.ink;node.addChild(outline);
  }if(['house','plot'].includes(this.object.kind)&&/roof|chimney/.test(name))this.roofs.push(node);return node;
 }
 setNight(night:boolean):void{for(const node of this.lampParts)node.active=night;}
 setRoofVisible(visible:boolean):void{for(const roof of this.roofs)roof.active=visible;}
 dispose():void{this.node.destroy(true);for(const g of this.geometries)g.destroy();for(const m of this.materials)m.destroy();}
}
