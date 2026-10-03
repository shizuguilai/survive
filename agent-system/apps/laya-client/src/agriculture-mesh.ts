import type {WorldObject} from '../../../packages/sim-core/src/domain.ts';

type Crop=NonNullable<WorldObject['crop']>;
type Animal=NonNullable<WorldObject['animal']>;
const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));

/** Render poses use the authoritative simulation tick. Pausing the world freezes every detail. */
export function cropPose(crop:Crop,tick:number,offset=0){
 const harvested=crop.stage==='harvested',growth=clamp(crop.growth),age=Math.max(0,tick-(crop.harvestedTick??tick));
 return {height:harvested?.13:.22+growth*.78,spread:harvested?.72:.56+growth*.44,
  sway:harvested?0:Math.sin(tick*.075+offset)*(.8+growth*2.3),
  grain:!harvested&&crop.stage!=='seedling'&&growth>.45?clamp((growth-.45)/.45):0,
  gold:crop.stage==='mature'||growth>.8,
  harvest:harvested&&age<22?1-age/22:0,harvestAge:age};
}
export function animalPose(animal:Animal,tick:number){
 const age=Math.max(0,tick-animal.phaseStartedTick),stride=animal.activity==='walk'?Math.sin(age*.6):0;
 const peck=animal.activity==='peck'?(1-Math.cos(age*.45))/2:0;
 return {stride,bob:Math.abs(stride)*.045,peck,
  wing:animal.activity==='flap'?25+Math.sin(age*.72)*38:Math.sin(tick*.065+animal.phase)*2,
  breathe:Math.sin(tick*.09+animal.phase)*.009};
}

// All crop and bird instances share four small primitive meshes and a color palette.
// One reference per AgricultureMesh keeps those resources alive until the final instance is removed.
type Palette={refs:number;geometries:Map<string,any>;materials:Map<string,any>};
const palettes=new WeakMap<object,Palette>();
function retain(L:any):Palette{let palette=palettes.get(L);if(!palette){palette={refs:0,geometries:new Map(),materials:new Map()};palettes.set(L,palette);}palette.refs++;return palette;}

/** Small procedural crops and poultry, animated without timers or simulation mutations. */
export class AgricultureMesh{
 readonly node:any;
 private readonly L:any;private readonly palette:Palette;private disposed=false;
 private plants:{node:any;stem?:any;head?:any;leaves:any[];offset:number}[]=[];
 private sparks:{node:any;angle:number}[]=[];private glints:any[]=[];
 private body:any;private birdHead:any;private wings:any[]=[];private legs:any[]=[];
 private cropKind?:Crop['kind'];private animalKind?:Animal['kind'];private headBase=0;
 constructor(object:WorldObject){
  this.L=(globalThis as any).Laya;
  if(!this.L?.PrimitiveMesh)throw new Error('Laya 原生网格能力尚未加载');
  this.palette=retain(this.L);this.node=new this.L.Sprite3D(object.id);
  if(object.kind==='crop'&&object.crop){this.cropKind=object.crop.kind;this.createCrop(object);}
  else if(object.kind==='animal'&&object.animal){this.animalKind=object.animal.kind;this.createAnimal(object);}
  this.update(object,object.crop?.plantedTick??object.animal?.phaseStartedTick??0);
 }
 private vector(x:number,y:number,z:number):any{return new this.L.Vector3(x,y,z);}
 private group(name:string,x=0,y=0,z=0,parent=this.node):any{const node=new this.L.Sprite3D(name);parent.addChild(node);node.transform.localPosition=this.vector(x,y,z);return node;}
 private material(color:string,ink=false):any{
  const key=ink?'ink':color;let material=this.palette.materials.get(key);
  if(!material){const n=parseInt(color.slice(1),16);material=new (this.L.UnlitMaterial??this.L.BlinnPhongMaterial)();material.albedoColor=new this.L.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);material.specularColor=new this.L.Color(0,0,0,1);if(ink)material.cull=this.L.RenderState?.CULL_FRONT??1;this.palette.materials.set(key,material);}
  return material;
 }
 private geometry(shape:string):any{
  let geometry=this.palette.geometries.get(shape);
  if(!geometry){const P=this.L.PrimitiveMesh;geometry=shape==='sphere'?P.createSphere(1,6,8):shape==='cylinder'?P.createCylinder(1,1,8):shape==='cone'?P.createCone(1,1,8):P.createBox(1,1,1);this.palette.geometries.set(shape,geometry);}
  return geometry;
 }
 private part(name:string,shape:string,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,parent=this.node,outline=false):any{
  const geometry=this.geometry(shape),node=new this.L.MeshSprite3D(geometry,name);node.transform.localPosition=this.vector(x,y,z);node.transform.localScale=this.vector(sx,sy,sz);node.meshRenderer.sharedMaterial=this.material(color);parent.addChild(node);
  if(outline){const edge=new this.L.MeshSprite3D(geometry,'agriculture ink silhouette');edge.transform.localScale=this.vector(1.045,1.045,1.045);edge.meshRenderer.sharedMaterial=this.material('#393d2c',true);node.addChild(edge);}
  return node;
 }
 private turn(node:any,x:number,y:number,z:number):void{node.transform.localRotationEuler=this.vector(x,y,z);}
 private createCrop(object:WorldObject):void{
  const kind=this.cropKind!,rice=kind==='rice',w=Math.max(.85,object.width),d=Math.max(.85,object.depth);
  this.part('planting bed rim','box','#968259',0,.016,0,w,.052,d);
  this.part(rice?'shallow rice paddy':'tilled earth','box',rice?'#6e9891':'#79694c',0,.048,0,w-.09,.025,d-.09);
  for(const side of [-1,1])this.part(rice?'paddy bank':'soil furrow','box',rice?'#adad73':'#a28b5d',side*w*.28,.065,0,rice?.045:.07,.014,d-.13);
  if(rice)for(let i=0;i<2;i++)this.glints.push(this.part('paddy water glint','box','#a5c1af',-.23+i*.43,.07,-.28+i*.54,.24,.008,.025));
  const count=kind==='corn'?2:3;
  for(let i=0;i<count;i++){
   const angle=i*Math.PI*2/count+.4,x=Math.cos(angle)*w*.22,z=Math.sin(angle)*d*.22;
   const plant=this.group(`${kind} growth`,x,.075,z),leaves:any[]=[];let stem:any,head:any;
   if(kind==='carrot'){
    head=this.part('orange carrot shoulder','cone','#d98c3e',0,.065,0,.105,.25,.105,plant,true);this.turn(head,180,0,0);
    for(let j=0;j<3;j++){const leaf=this.part('carrot feather leaf','sphere',j===1?'#8a9d51':'#607f43',(j-1)*.06,.31,0,.055,.29,.035,plant);this.turn(leaf,0,j*60,(j-1)*-28);leaves.push(leaf);}
   }else{
    const corn=kind==='corn',height=corn?1.48:kind==='wheat'?.93:.85;
    stem=this.part(`${kind} stalk`,'cylinder','#82924c',0,height*.48,0,corn?.035:.022,height,.022,plant);
    for(const side of [-1,1]){const leaf=this.part(corn?'broad corn leaf':`${kind} blade`,'sphere',side<0?'#627f43':'#93a353',side*(corn?.16:.095),height*(corn?.48:.43),0,corn?.085:.034,corn?.44:.32,corn?.05:.025,plant);this.turn(leaf,side*14,side*22,-side*(corn?44:32));leaves.push(leaf);}
    head=this.part(corn?'corn cob':rice?'drooping rice panicle':'wheat grain head','sphere','#dcc477',rice?.09:corn?.13:0,corn?.84:height+.035,0,corn?.085:rice?.063:.067,corn?.23:rice?.175:.19,corn?.085:.052,plant,true);this.turn(head,0,0,corn?-18:rice?38:-8);
   }
   this.plants.push({node:plant,stem,head,leaves,offset:i*2.2+x});
  }
  for(let i=0;i<3;i++){const node=this.part('harvest grain fleck','sphere','#eed694',0,.5,0,.04,.075,.04);this.sparks.push({node,angle:i*Math.PI*2/3});node.active=false;}
 }
 private createAnimal(object:WorldObject):void{
  const kind=this.animalKind!,chicken=kind==='chicken',goose=kind==='goose',duck=kind==='duck';
  const bodyColor=chicken?'#d8b581':goose?'#e9e5ce':'#8a7860',wingColor=chicken?'#a17c55':goose?'#c7cabb':'#65786c';
  const size=goose?.64:duck?.66:.62;
  const shadow=this.part('poultry contact shadow','cylinder','#778145',0,.018,0,.42*size,.012,.29*size);this.turn(shadow,0,0,0);
  this.body=this.group('poultry body motion');this.body.transform.localScale=this.vector(size,size,size);
  this.part(`${kind} round body`,'sphere',bodyColor,0,.49,0,.32,.29,.42,this.body,true);
  const tail=this.part('poultry tail','sphere',wingColor,0,.6,-.38,.2,.12,.25,this.body);this.turn(tail,-20,0,0);
  for(const side of [-1,1]){
   const leg=this.group(`poultry leg ${side}`,side*.14,.22,.025,this.body);
   this.part('poultry shank','cylinder','#bd8b46',0,-.06,0,.025,.2,.025,leg);
   this.part(duck||goose?'webbed foot':'chicken foot','box','#cf9a4b',0,-.15,.055,duck||goose?.13:.10,.035,.16,leg);this.legs.push(leg);
   const wing=this.group(`poultry wing ${side}`,side*.27,.58,-.06,this.body);
   this.part('folded poultry wing','sphere',wingColor,side*.025,-.09,0,.085,.17,.29,wing,true);this.wings.push(wing);
  }
  this.headBase=chicken?.67:goose?.72:.63;
  this.birdHead=this.group('poultry head and neck',0,this.headBase,.24,this.body);
  if(goose)this.part('long goose neck','sphere',bodyColor,0,.22,.035,.105,.34,.12,this.birdHead);
  else if(chicken)this.part('short chicken neck','sphere',bodyColor,0,.03,0,.13,.18,.13,this.birdHead);
  const hy=goose?.51:chicken?.19:.14,hz=goose?.08:.09;
  this.part(`${kind} head`,'sphere',duck?'#496e53':bodyColor,0,hy,hz,.18,.18,.20,this.birdHead,true);
  this.part(duck?'broad duck bill':'poultry beak','box',goose?'#d59445':'#d5aa54',0,hy-.035,hz+.20,duck?.22:.11,.07,duck?.19:.14,this.birdHead);
  for(const side of [-1,1])this.part('poultry eye','sphere','#30372d',side*.143,hy+.025,hz+.11,.027,.029,.027,this.birdHead);
  if(chicken){const comb=this.part('red chicken comb','sphere','#bb6952',0,hy+.18,hz-.015,.055,.095,.13,this.birdHead);this.turn(comb,-10,0,0);}
 }
 update(object:WorldObject,tick:number):void{
  if(this.disposed)return;
  this.node.transform.position=this.vector(object.position.x,object.position.y,object.position.z);
  if(object.kind==='crop'&&object.crop){
   const crop=object.crop,carrot=this.cropKind==='carrot';
   for(const plant of this.plants){
    const pose=cropPose(crop,tick,plant.offset);plant.node.transform.localScale=this.vector(pose.spread,pose.height,pose.spread);this.turn(plant.node,pose.sway*.45,0,pose.sway);
    if(plant.stem)plant.stem.meshRenderer.sharedMaterial=this.material(pose.gold?'#b6a75c':'#82924c');
    for(const leaf of plant.leaves)leaf.meshRenderer.sharedMaterial=this.material(pose.gold&&!carrot?'#a6a05a':'#759149');
    if(plant.head){plant.head.active=carrot?crop.stage!=='harvested':pose.grain>0;const headScale=carrot?1:Math.max(.12,pose.grain);plant.head.transform.localScale=this.vector(carrot?.105:(this.cropKind==='corn'?.085:this.cropKind==='rice'?.063:.067)*headScale,carrot?.25:(this.cropKind==='corn'?.23:this.cropKind==='rice'?.175:.19)*headScale,carrot?.105:(this.cropKind==='corn'?.085:.052)*headScale);if(!carrot)plant.head.meshRenderer.sharedMaterial=this.material(pose.gold?'#ddbd66':'#acb96a');}
   }
   const pose=cropPose(crop,tick);
   for(const spark of this.sparks){spark.node.active=pose.harvest>0;const distance=(1-pose.harvest)*.5;spark.node.transform.localPosition=this.vector(Math.cos(spark.angle)*distance,.25+Math.sin((1-pose.harvest)*Math.PI)*.6,Math.sin(spark.angle)*distance);spark.node.transform.localScale=this.vector(.04*pose.harvest,.075*pose.harvest,.04*pose.harvest);this.turn(spark.node,pose.harvestAge*11,spark.angle*90,pose.harvestAge*7);}
   for(let i=0;i<this.glints.length;i++)this.glints[i].transform.localScale=this.vector(.20+Math.sin(tick*.045+i)*.04,.008,.025);
  }else if(object.kind==='animal'&&object.animal&&this.body){
   const animal=object.animal,pose=animalPose(animal,tick),goose=this.animalKind==='goose';
   this.node.transform.rotationEuler=this.vector(0,90-animal.heading*180/Math.PI,0);
   this.body.transform.localPosition=this.vector(0,pose.bob+pose.breathe,0);this.turn(this.body,pose.peck*9,0,pose.stride*2);
   this.birdHead.transform.localPosition=this.vector(0,this.headBase-pose.peck*(goose?.26:.16),.24+pose.peck*.12);this.turn(this.birdHead,pose.peck*(goose?66:62),0,0);
   for(let i=0;i<this.legs.length;i++){const side=i===0?-1:1;this.turn(this.legs[i],pose.stride*side*29,0,0);this.legs[i].transform.localPosition=this.vector(side*.14,.22+Math.max(0,pose.stride*side)*.025,.025);}
   for(let i=0;i<this.wings.length;i++)this.turn(this.wings[i],0,0,(i===0?-1:1)*pose.wing);
  }
 }
 dispose():void{
  if(this.disposed)return;this.disposed=true;this.node.destroy(true);
  if(--this.palette.refs===0){for(const geometry of this.palette.geometries.values())geometry.destroy();for(const material of this.palette.materials.values())material.destroy();palettes.delete(this.L);}
 }
}
