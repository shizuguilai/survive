import type {WorldObject} from '../../../packages/sim-core/src/domain.ts';
/** All scenery is native Laya geometry; these objects never advance the simulation. */
export class WorldMesh{
 readonly node:any;private geometries:any[]=[];private materials:any[]=[];
 constructor(readonly object:WorldObject){
  const L=(globalThis as any).Laya;this.node=new L.Sprite3D(object.id);this.node.transform.position=new L.Vector3(object.position.x,object.position.y,object.position.z);
  const box=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,c:string)=>this.part(name,L.PrimitiveMesh.createBox(w,h,d),x,y,z,c);
  const ball=(name:string,r:number,x:number,y:number,z:number,c:string,sx=1,sy=1,sz=1)=>{const p=this.part(name,L.PrimitiveMesh.createSphere(r,7,8),x,y,z,c);p.transform.localScale=new L.Vector3(sx,sy,sz);return p;};
  switch(object.kind){
   case 'board':
    box('notice frame',1.5,1,.15,0,1.15,0,'#735437');for(const x of [-.56,.56])box('board post',.12,1.8,.14,x,.9,0,'#866244');
    box('paper notice',1.19,.7,.025,0,1.18,.09,'#e7d8af');for(let i=0;i<3;i++)box('written lines',.8-i*.12,.035,.028,-.08,1.38-i*.16,.108,'#81775d');
    box('roof',1.8,.16,.65,0,1.83,0,'#577768');box('shared store crate',.85,.65,.75,1.05,.33,.15,'#b1905e');box('crate rim',.95,.07,.83,1.05,.66,.15,'#7e6045');break;
   case 'workbench':
    box('workbench top',2,.17,.95,0,1.08,0,'#c5a276');for(const x of [-.75,.75])for(const z of [-.3,.3])box('bench leg',.16,1,.16,x,.5,z,'#84613f');
    box('bench brace',1.6,.12,.12,0,.38,0,'#9c794e');ball('anvil stone',.25,.35,1.32,0,'#8c9791',1.3,.6,1);box('hammer handle',.45,.07,.08,-.55,1.22,.13,'#785336');box('hammer head',.15,.15,.24,-.38,1.29,.13,'#818c87');break;
   case 'rock':ball('stone cluster',.73,0,.5,0,'#8c9890',1.25,.85,1);ball('stone edge',.43,.55,.3,.19,'#adb5a2',1,.8,1);break;
   case 'berry':
    ball('berry leaves',.64,0,.45,0,object.resources?'#6d9361':'#8c9e74',1,.72,1);
    if(object.resources)for(let i=0;i<7;i++){const a=i*2.4;ball('ripe berry',.095,Math.cos(a)*.42,.59+(i%3)*.1,Math.sin(a)*.4,'#b75a61');}break;
   case 'pond':this.part('water',L.PrimitiveMesh.createCylinder(2.5,.035,32),0,.015,0,'#7ba9a3');for(let i=0;i<10;i++){const a=i*Math.PI/5;ball('shore stone',.25,Math.cos(a)*2.6,.09,Math.sin(a)*2.6,'#c0baa1',1.3,.45,1);}break;
   case 'plot':case 'house':{
    const stage=object.buildStage??3;
    box('building footprint',4.4,.03,3.5,0,.02,0,'#b8ae86');
    for(const x of [-2,2])for(const z of [-1.5,1.5])box('survey stake',.10,.65,.10,x,.34,z,'#e1cf95');
    if(stage>=1){box('stone foundation',4.1,.3,3.2,0,.17,0,'#969a8b');box('wood floor',3.9,.09,3,0,.36,0,'#ba9569');for(let i=0;i<8;i++)box('floor seam',.015,.01,3,-1.75+i*.5,.41,0,'#987648');}
    if(stage>=2){box('back wall',4,2.1,.18,0,1.42,-1.45,'#c2a06c');for(const x of [-1.92,1.92])box('side wall',.16,2.1,3,x,1.42,0,'#c6aa7d');
     for(const x of [-1.35,1.35])box('front wall',1.3,2.1,.17,x,1.42,1.45,'#bf9c68');box('door lintel',1.45,.36,.2,0,2.3,1.45,'#8f714b');
     for(const x of [-1.25,1.25]){box('window frame',.67,.77,.10,x,1.55,1.57,'#715638');box('window pane',.51,.6,.035,x,1.55,1.63,'#a9c6bd');box('window crossbar',.04,.6,.04,x,1.55,1.66,'#715638');}}
    if(stage>=3){for(const side of [-1,1]){const roof=box('sloping roof',2.7,.18,3.75,side*1.08,2.9,0,'#587f70');roof.transform.localRotationEuler=new L.Vector3(0,0,-side*24);}box('roof ridge',.19,.2,3.85,0,3.43,0,'#3f6657');box('porch step',1.6,.18,.7,0,.14,1.98,'#9c9b85');box('door shade',.76,1.63,.04,0,1.19,-1.36,'#6c634b');}break;
   }
   case 'wall':box('stone wall',object.width,object.height,object.depth,0,object.height/2,0,'#92958b');break;
   default:
    this.part('trunk',L.PrimitiveMesh.createCylinder(.18,1.7,8),0,.82,0,'#8d7450');
    if(object.resources){ball('broad crown',1,0,2.2,0,'#6d936a',1.1,.92,1);ball('sunlit crown',.73,.23,2.85,.08,'#90aa78');ball('side crown',.65,-.53,2.3,.24,'#7fa16b');}
    else this.node.transform.localScale=new L.Vector3(1,.2,1);
  }
 }
 private part(name:string,geometry:any,x:number,y:number,z:number,color:string):any{
  const L=(globalThis as any).Laya,node=new L.MeshSprite3D(geometry,name),n=parseInt(color.slice(1),16);node.transform.localPosition=new L.Vector3(x,y,z);
  const material=new L.BlinnPhongMaterial();material.albedoColor=new L.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);material.specularColor=new L.Color(.035,.035,.035,1);node.meshRenderer.sharedMaterial=material;this.node.addChild(node);this.geometries.push(geometry);this.materials.push(material);return node;
 }
 dispose():void{this.node.destroy(true);for(const g of this.geometries)g.destroy();for(const m of this.materials)m.destroy();}
}
