import type {WorldObject} from '../../../packages/sim-core/src/domain.ts';
/** All scenery is native Laya geometry; these objects never advance the simulation. */
export class WorldMesh{
 readonly node:any;private geometries:any[]=[];private materials:any[]=[];private ink:any;
 constructor(readonly object:WorldObject){
  const L=(globalThis as any).Laya;this.node=new L.Sprite3D(object.id);this.node.transform.position=new L.Vector3(object.position.x,object.position.y,object.position.z);
  const box=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,c:string)=>this.part(name,L.PrimitiveMesh.createBox(w,h,d),x,y,z,c);
  const ball=(name:string,r:number,x:number,y:number,z:number,c:string,sx=1,sy=1,sz=1)=>{const p=this.part(name,L.PrimitiveMesh.createSphere(r,10,12),x,y,z,c);p.transform.localScale=new L.Vector3(sx,sy,sz);return p;};
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
   case 'rock':{ball('stone cluster',.73,0,.43,0,'#747c78',1.25,.68,1);ball('stone edge',.43,.55,.24,.19,'#969a8b',1,.7,1);const facet=box('stone top facet',.65,.035,.44,-.12,.89,-.06,'#a8aa99');facet.transform.localRotationEuler=new L.Vector3(0,18,-7);box('rock fissure',.38,.025,.045,.12,.9,.01,'#555e57');break;}
   case 'berry':
    ball('berry leaves',.64,0,.45,0,object.resources?'#4d6638':'#858052',1,.72,1);
    if(object.resources)for(let i=0;i<7;i++){const a=i*2.4;ball('ripe berry',.095,Math.cos(a)*.42,.59+(i%3)*.1,Math.sin(a)*.4,'#b74e4b');}break;
   case 'pond':this.part('shore bank',L.PrimitiveMesh.createCylinder(2.72,.025,32),0,-.01,0,'#8d8965');this.part('water',L.PrimitiveMesh.createCylinder(2.5,.035,32),0,.015,0,'#557b78');this.part('deep water',L.PrimitiveMesh.createCylinder(1.92,.012,32),-.17,.04,-.17,'#436c6b');for(let i=0;i<4;i++)box('water glint',.35+i*.11,.008,.025,-.8+i*.42,.055,-.7+i*.4,'#8da8a0');for(let i=0;i<10;i++){const a=i*Math.PI/5;ball('shore stone',.25,Math.cos(a)*2.6,.09,Math.sin(a)*2.6,'#aaa48a',1.3,.45,1);}break;
   case 'plot':case 'house':{
    const stage=object.buildStage??3;
    box('building footprint',4.4,.03,3.5,0,.02,0,'#b8ae86');
    for(const x of [-2,2])for(const z of [-1.5,1.5])box('survey stake',.10,.65,.10,x,.34,z,'#e1cf95');
    if(stage>=1){box('stone foundation',4.1,.3,3.2,0,.17,0,'#969a8b');box('wood floor',3.9,.09,3,0,.36,0,'#ba9569');for(let i=0;i<8;i++)box('floor seam',.015,.01,3,-1.75+i*.5,.41,0,'#987648');}
    if(stage>=2){box('back wall',4,2.1,.18,0,1.42,-1.45,'#c2a06c');for(const x of [-1.92,1.92])box('side wall',.16,2.1,3,x,1.42,0,'#c6aa7d');
     for(const x of [-1.35,1.35])box('front wall',1.3,2.1,.17,x,1.42,1.45,'#bf9c68');box('door lintel',1.45,.36,.2,0,2.3,1.45,'#8f714b');
     for(let row=0;row<6;row++){for(const x of [-1.35,1.35])box('front horizontal timber seam',1.3,.018,.015,x,.52+row*.31,1.544,'#856b4c');for(const x of [-2.012,2.012])box('side timber seam',.012,.018,3,x,.52+row*.31,0,'#856b4c');}for(const x of [-1.25,1.25]){box('window frame',.67,.77,.10,x,1.55,1.57,'#715638');box('window pane',.51,.6,.035,x,1.55,1.63,'#496b70');box('window crossbar',.04,.6,.04,x,1.55,1.66,'#715638');}}
    if(stage>=3){for(const side of [-1,1]){const roof=box('sloping roof',2.7,.18,3.75,side*1.08,2.9,0,'#69715b');roof.transform.localRotationEuler=new L.Vector3(0,0,-side*24);}for(const side of [-1,1])for(let row=0;row<8;row++){const seam=box('roof shingle seam',2.72,.025,.028,side*1.08,3.003,-1.65+row*.46,'#35483e');seam.transform.localRotationEuler=new L.Vector3(0,0,-side*24);}box('roof ridge',.19,.2,3.85,0,3.43,0,'#3b483c');box('chimney',.48,1,.5,1.16,3.35,-.85,'#8f9181');box('chimney cap',.58,.13,.6,1.16,3.89,-.85,'#5a6158');box('porch step',1.6,.18,.7,0,.14,1.98,'#9c9b85');box('door shade',.76,1.63,.04,0,1.19,-1.36,'#6c634b');}break;
   }
   case 'wall':box('stone wall',object.width,object.height,object.depth,0,object.height/2,0,'#777f73');for(let row=1;row<Math.min(12,object.height/.35);row++)box('mortar seam',object.width+.012,.024,object.depth+.012,0,row*.35,0,'#4e584e');break;
   default:
    this.part('trunk',L.PrimitiveMesh.createCylinder(.21,1.7,10),0,.82,0,'#73573b');
    if(object.resources){ball('broad crown',1,0,2.05,0,'#465f35',1.15,.72,1);ball('sunlit crown',.75,-.19,2.52,-.07,'#718449',1,.77,1);ball('side crown',.65,-.58,2.08,.3,'#60783e',1,.75,1);ball('leaf cluster',.45,.63,2.24,.16,'#879451',1,.65,1);box('bark line',.026,.68,.025,.03,.76,.21,'#463e2d');}
    else this.node.transform.localScale=new L.Vector3(1,.2,1);
  }
 }
 private part(name:string,geometry:any,x:number,y:number,z:number,color:string):any{
  const L=(globalThis as any).Laya,node=new L.MeshSprite3D(geometry,name),n=parseInt(color.slice(1),16);node.transform.localPosition=new L.Vector3(x,y,z);
  const material=new L.BlinnPhongMaterial();material.albedoColor=new L.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);material.specularColor=new L.Color(0,0,0,1);node.meshRenderer.sharedMaterial=material;this.node.addChild(node);this.geometries.push(geometry);this.materials.push(material);
  if(/crown|cluster|leaves|trunk|stone edge|wall$|foundation|roof$|crate$|frame$|workbench top/.test(name)){
   if(!this.ink){this.ink=new L.UnlitMaterial();this.ink.albedoColor=new L.Color(.17,.19,.15,1);this.ink.cull=L.RenderState.CULL_FRONT;this.materials.push(this.ink);}
   const outline=new L.MeshSprite3D(geometry,'ink silhouette');outline.transform.localScale=new L.Vector3(1.026,1.026,1.026);outline.meshRenderer.sharedMaterial=this.ink;node.addChild(outline);
  }return node;
 }
 dispose():void{this.node.destroy(true);for(const g of this.geometries)g.destroy();for(const m of this.materials)m.destroy();}
}
