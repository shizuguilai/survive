import type {WorldObject} from '../../../packages/sim-core/src/domain.ts';

type Crop=NonNullable<WorldObject['crop']>;
type Animal=NonNullable<WorldObject['animal']>;
const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
// Layout variation is stable across reloads and never consumes the simulation's random stream.
function cropVariation(id:string,salt:number):number{let hash=2166136261^salt;for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);return (hash>>>0)/4294967295;}
const leafColors=['#416f35','#64943d','#8cb549','#adc961'];
const dryLeafColors=['#807446','#99894f','#aea064','#c0ae70'];
const wheatLeafColors=['#8f8240','#aca24b','#c6b15c','#d5bd70'];
const riceLeafColors=['#617f39','#7c9b43','#a0ad4e','#b6bd5c'];
const ripeGrainColors=['#c2963d','#d8b44d','#efd275'];
const greenGrainColors=['#87a345','#a4b855','#b5c86c'];

/** Render poses use the authoritative simulation tick. Pausing the world freezes every detail. */
export function cropPose(crop:Crop,tick:number,offset=0){
 const harvested=crop.stage==='harvested',growth=clamp(crop.growth),age=Math.max(0,tick-(crop.harvestedTick??tick));
 const prepared=crop.stage!=='fallow',sprouted=!['fallow','tilled','sown'].includes(crop.stage);
 // Older saves had no moisture field. Their established plants retain their previous appearance.
 const moisture=clamp(crop.moisture??(sprouted?1:0)),wet=prepared&&moisture>.18,dry=sprouted&&!harvested&&moisture<=0;
 return {prepared,sprouted,seeds:crop.stage==='sown',wet,dry,
  height:harvested?.13:.22+growth*.78,spread:harvested?.72:.56+growth*.44,
  sway:harvested?0:(dry?7:0)+Math.sin(tick*.075+offset)*(dry?.4:.8+growth*2.3),
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
 private plants:{node:any;stem?:any;head?:any;grains:any[];leaves:{node:any;tone:number}[];offset:number;heading:number;size:number}[]=[];
 private sparks:{node:any;angle:number}[]=[];private glints:any[]=[];
 private seeds:any[]=[];
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
  // A work target is spaced two metres from its neighbours. Fill its bed with a readable
  // canopy instead of shrinking decorative plants to the narrow interaction footprint.
  this.node.transform.localScale=this.vector(1.85,1,1.85);
  // Soil belongs to the joined GardenGround surface, never to a rectangular crop tile.
  if(rice)for(let i=0;i<2;i++)this.glints.push(this.part('paddy water glint','sphere','#b5d6c0',-.23+i*.43,.066,-.28+i*.54,.13,.004,.015));
  for(let i=0;i<3;i++){const seed=this.part('sown seed','sphere','#e5c278',(i-1)*w*.22,.07,(i%2?1:-1)*d*.13,.037,.018,.055);this.turn(seed,0,cropVariation(object.id,90+i)*180,0);this.seeds.push(seed);}
  const count=kind==='corn'?2:3;
  for(let i=0;i<count;i++){
   const angle=i*Math.PI*2/count+.35,x=Math.cos(angle)*w*.175+(cropVariation(object.id,17+i)-.5)*.065,z=Math.sin(angle)*d*.175+(cropVariation(object.id,31+i)-.5)*.065;
   const plant=this.group(`${kind} growth`,x,.065,z),leaves:{node:any;tone:number}[]=[],grains:any[]=[];let stem:any,head:any;
   const heading=cropVariation(object.id,44+i)*65+i*113,size=.94+cropVariation(object.id,63+i)*.12;
   const leaf=(name:string,tone:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,rx:number,ry:number,rz:number)=>{const node=this.part(name,'sphere',leafColors[tone],x,y,z,sx,sy,sz,plant);this.turn(node,rx,ry,rz);leaves.push({node,tone});return node;};
   if(kind==='carrot'){
    head=this.group('orange carrot shoulder',0,0,0,plant);
    const root=this.part('tapered carrot root','cone','#d98b35',0,.055,0,.105,.23,.10,head);this.turn(root,180,0,0);
    this.part('sunlit carrot shoulder','sphere','#f0ac47',-.02,.125,.008,.092,.065,.084,head);
    for(let j=0;j<5;j++){const a=j*Math.PI*2/5,tilt=48+(j%2)*9;leaf('carrot feather leaf',j%3,Math.sin(a)*.09,.255,Math.cos(a)*.09,.125,.23,.087,Math.cos(a)*tilt,j*72,-Math.sin(a)*tilt);}
    leaf('carrot crown leaf',3,-.025,.315,.012,.10,.15,.085,-12,15,12);
   }else if(kind==='corn'){
    stem=this.part('corn stalk','cylinder','#64943d',0,.52,0,.032,1.04,.028,plant);
    for(let j=0;j<4;j++){const side=j%2===0?-1:1;leaf('broad corn leaf',j%3,side*.10,.34+Math.floor(j/2)*.27,(j%2?1:-1)*.025,.095,.335,.067,side*9,j*41,-side*(53-j*3));}
    head=this.group('corn cob',.10,.62,.012,plant);this.turn(head,0,0,-18);
    grains.push(this.part('golden corn kernels','sphere',ripeGrainColors[1],0,0,0,.082,.225,.077,head));
    this.part('corn husk','sphere','#67913c',-.038,-.085,-.027,.069,.165,.070,head);
    const tassel=this.part('corn tassel','sphere','#b7b76a',0,1.065,0,.048,.12,.037,plant);grains.push(tassel);
   }else{
    const height=rice?.68:.77;
    stem=this.part(`${kind} stalk`,'cylinder','#7c9845',0,height*.48,0,.021,height,.022,plant);
    const bladeCount=rice?5:4;
    for(let j=0;j<bladeCount;j++){const a=j*2.4,tilt=19+(j%3)*12;leaf(`${kind} blade`,j%4,Math.sin(a)*.04,.275+(j%2)*.055,Math.cos(a)*.04,rice?.068:.078,rice?.33:.28,.055,Math.cos(a)*tilt,j*137,-Math.sin(a)*tilt);}
    head=this.group(rice?'drooping rice panicle':'wheat grain head',0,height,0,plant);
    if(rice){
     const bend=this.part('bent rice neck','sphere','#8e9e49',.046,.018,0,.032,.13,.025,head);this.turn(bend,0,0,-52);
     for(let j=0;j<2;j++){const grain=this.part('hanging rice kernels','sphere',ripeGrainColors[j+1],.092+j*.057,-.022-j*.085,j*.012,.046,.12,.040,head);this.turn(grain,7,12,-25+j*15);grains.push(grain);}
    }else{
     grains.push(this.part('central wheat ear','sphere',ripeGrainColors[1],0,.07,0,.067,.175,.050,head));
     for(const side of [-1,1]){const grain=this.part('wheat ear kernels','sphere',ripeGrainColors[side<0?0:2],side*.047,.012,side*.013,.036,.12,.037,head);this.turn(grain,0,0,side*-20);grains.push(grain);}
    }
   }
   this.plants.push({node:plant,stem,head,grains,leaves,offset:i*2.2+x,heading,size});
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
   const crop=object.crop,carrot=this.cropKind==='carrot',pose=cropPose(crop,tick);
   for(const seed of this.seeds)seed.active=pose.seeds;
   for(const plant of this.plants){
    const pose=cropPose(crop,tick,plant.offset);plant.node.active=pose.sprouted&&!(carrot&&crop.stage==='harvested');plant.node.transform.localScale=this.vector(pose.spread*plant.size,pose.height*plant.size*(carrot?1.45:1.3),pose.spread*plant.size);this.turn(plant.node,pose.sway*.45,plant.heading,pose.sway);
    if(plant.stem)plant.stem.meshRenderer.sharedMaterial=this.material(pose.dry?'#a49a62':pose.gold?'#a7a353':'#719344');
    const colors=pose.dry?dryLeafColors:pose.gold&&this.cropKind==='wheat'?wheatLeafColors:pose.gold&&this.cropKind==='rice'?riceLeafColors:leafColors;
    for(const leaf of plant.leaves)leaf.node.meshRenderer.sharedMaterial=this.material(colors[leaf.tone]);
    if(plant.head){plant.head.active=carrot?crop.stage!=='harvested'&&crop.growth>.3:pose.grain>0;const headScale=carrot?.45+crop.growth*.55:Math.max(.12,pose.grain)*1.12;plant.head.transform.localScale=this.vector(headScale,headScale,headScale);}
    for(let i=0;i<plant.grains.length;i++){plant.grains[i].active=pose.grain>0;plant.grains[i].meshRenderer.sharedMaterial=this.material((pose.gold?ripeGrainColors:greenGrainColors)[i%3]);}
   }
   for(const spark of this.sparks){spark.node.active=pose.harvest>0;const distance=(1-pose.harvest)*.5;spark.node.transform.localPosition=this.vector(Math.cos(spark.angle)*distance,.25+Math.sin((1-pose.harvest)*Math.PI)*.6,Math.sin(spark.angle)*distance);spark.node.transform.localScale=this.vector(.04*pose.harvest,.075*pose.harvest,.04*pose.harvest);this.turn(spark.node,pose.harvestAge*11,spark.angle*90,pose.harvestAge*7);}
   for(let i=0;i<this.glints.length;i++){this.glints[i].active=pose.wet;this.glints[i].transform.localScale=this.vector(.12+Math.sin(tick*.045+i)*.018,.004,.015);}
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
