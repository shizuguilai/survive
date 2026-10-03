import {pawnPose,workPose,farmingPose} from './pawn-pose.ts';
import type { Resident } from '../../../packages/sim-core/src/domain.ts';
import {createCharacterState,equippedItem} from '../../../packages/sim-core/src/character.ts';
import type {CharacterState,EquipmentSlot} from '../../../packages/sim-core/src/character.ts';

/** Native Laya 3D pawn. Owns its generated geometry/materials and never advances simulation. */
export class CharacterMesh {
  readonly node:any;
  height=1.9;
  private signature='';private visuals:any;private shadow:any;
  private hands:{node:any;side:number;x:number;y:number;z:number}[]=[];private sharedGrip:any;private twoHanded=false;
  private handheld:any[]=[];private hoe:any;private seedPouch:any;private bucket:any;private bucketWater:any;
  private seedParticles:any[]=[];private waterDrops:any[]=[];
  private geometries:any[]=[];private materials:any[]=[];private ink:any;private disposed=false;
  private materialByColor=new Map<string,any>();
  private readonly L:any;
  constructor(resident:Resident){
    this.L=(globalThis as any).Laya;
    if(!this.L?.PrimitiveMesh)throw new Error('Laya 原生网格能力尚未加载');
    this.node=new this.L.Sprite3D(`resident:${resident.id}`);this.update(resident);
  }
  update(resident:Resident):void{
    if(this.disposed)return;
    const L=this.L,character=resident.character??createCharacterState(resident.id);
    const slots:EquipmentSlot[]=['torso','head','leftHand','rightHand','back'];
    const signature=JSON.stringify({appearance:character.appearance,gear:slots.map(slot=>[slot,equippedItem(character,slot)?.definition.id??null])});
    if(signature!==this.signature){this.rebuild(character);this.signature=signature;}
    this.node.name=resident.name;
    this.node.transform.position=new L.Vector3(resident.position.x,resident.position.y,resident.position.z);
    this.node.transform.rotationEuler=new L.Vector3(0,90-resident.heading*180/Math.PI,(resident.health??100)<=0?90:0);
    const pose=pawnPose(resident);this.visuals.transform.localPosition=new L.Vector3(0,pose.bob,0);
    this.shadow.transform.localPosition=new L.Vector3(.07,.015-pose.bob,-.04);
    const work=workPose(resident),farm=farmingPose(resident);farm.carrying&&=!work.active;
    const farming=farm.active||farm.carrying,sleeping=resident.plan?.some(p=>!p.done&&p.action.op==='rest'&&p.bedSettled)??false;if(sleeping)this.visuals.transform.localPosition=new L.Vector3(0,.43,.78);this.visuals.transform.localRotationEuler=new L.Vector3(sleeping?-90:work.lean,0,0);
    for(const h of this.hands){const lift=work.active?(this.twoHanded||h.side>0?work.right:work.left):0;const swing=pose.stride*(this.twoHanded?.045:h.side*.26);h.node.transform.localPosition=new L.Vector3(h.x,h.y+(this.twoHanded?0:Math.abs(pose.stride)*.045)+lift,h.z+swing+(work.active?.24-lift*.3:0));h.node.transform.localRotationEuler=new L.Vector3(work.active?-25-lift*100:this.twoHanded?0:pose.stride*h.side*14,0,0);}
    if(this.sharedGrip){this.sharedGrip.active=!farming;this.sharedGrip.transform.localPosition=new L.Vector3(0,work.active?work.right:0,pose.stride*.045+(work.active?.18:0));}
    for(const held of this.handheld)held.active=!farming;
    this.updateFarming(farm,pose.stride);
  }
  private color(hex:string):any{const n=parseInt(hex.slice(1),16);return new this.L.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);}
  private part(name:string,geometry:any,color:string,x:number,y:number,z:number,sx=1,sy=1,sz=1,parent=this.visuals):any{
    const L=this.L,mesh=new L.MeshSprite3D(geometry,name);if(!this.geometries.includes(geometry))this.geometries.push(geometry);
    mesh.transform.localPosition=new L.Vector3(x,y,z);mesh.transform.localScale=new L.Vector3(sx,sy,sz);
    let material=this.materialByColor.get(color);if(!material){material=new (L.UnlitMaterial??L.BlinnPhongMaterial)();material.albedoColor=this.color(color);material.specularColor=new L.Color(0,0,0,1);this.materials.push(material);this.materialByColor.set(color,material);}
    mesh.meshRenderer.sharedMaterial=material;parent.addChild(mesh);
    if(this.hands.some(h=>h.node===parent)&&!name.startsWith('round hand'))this.handheld.push(mesh);
    if(!/eye|nose|belt|strap|collar|lapel|binding|guard|flap|shadow|droplet|seed particle|water surface/.test(name)){
      if(!this.ink){this.ink=new (L.UnlitMaterial??L.BlinnPhongMaterial)();this.ink.albedoColor=this.color('#292c29');this.ink.cull=L.RenderState?.CULL_FRONT??1;this.materials.push(this.ink);}
      const outline=new L.MeshSprite3D(geometry,'ink silhouette');outline.transform.localScale=new L.Vector3(1.055,1.055,1.055);outline.meshRenderer.sharedMaterial=this.ink;mesh.addChild(outline);
    }
    return mesh;
  }
  private sphere(name:string,color:string,r:number,x:number,y:number,z:number,sx=1,sy=1,sz=1,parent=this.visuals):any{return this.part(name,this.L.PrimitiveMesh.createSphere(r,12,16),color,x,y,z,sx,sy,sz,parent);}
  private box(name:string,color:string,w:number,h:number,d:number,x:number,y:number,z:number,parent=this.visuals):any{return this.part(name,this.L.PrimitiveMesh.createBox(w,h,d),color,x,y,z,1,1,1,parent);}
  private clearVisuals():void{
    if(this.visuals){this.visuals.destroy(true);this.visuals=null;}
    for(const geometry of this.geometries)geometry.destroy();
    for(const material of this.materials)material.destroy();
    this.geometries=[];this.materials=[];this.materialByColor.clear();this.ink=null;this.hands=[];this.handheld=[];this.sharedGrip=null;this.shadow=null;
    this.hoe=null;this.seedPouch=null;this.bucket=null;this.bucketWater=null;this.seedParticles=[];this.waterDrops=[];
  }
  private rebuild(character:CharacterState):void{
    this.clearVisuals();const L=this.L,a=character.appearance;
    this.visuals=new L.Sprite3D('appearance and equipment');this.node.addChild(this.visuals);
    const width=.46*a.bodyWidth,bodyH=(a.bodyShape==='rounded'?.82:.97)*a.bodyLength;
    const headR=.43*a.headSize,headY=.10+bodyH+headR*.68,handR=.15*a.handSize;
    this.height=headY+headR*1.35;
    const torso=equippedItem(character,'torso'),skin=a.skinColor;
    // Flat-colored silhouette and two separate hand pivots; simulation-driven pose only.
    this.part('body',L.PrimitiveMesh.createCapsule(1,3,8,12),torso?a.clothingColor:skin,0,.1+bodyH/2,0,width,bodyH/3,width*.56);
    this.sphere('head',skin,headR,0,headY,.04,1,.94,.69);
    this.shadow=this.part('contact shadow',L.PrimitiveMesh.createCylinder(.57,.018,20),'#4c5237',.07,.015,-.04,1,1,.63);
    this.sphere('nose',skin,headR*.10,0,headY-.02,headR*.76,1,1,1.1);
    for(const side of [-1,1])this.sphere(`eye ${side}`,'#252725',headR*.065,side*headR*.33,headY+headR*.08,headR*.73,1,1.1,.5);
    // Cloth hems distinguish a tunic from a long coat; all garments keep chosen dye colors.
    if(torso){
      this.box('cloth belt',a.trimColor,width*1.72,.075,width*1.15,0,.1+bodyH*.46,.015);
      if(torso.definition.id==='travel_coat'){
        for(const side of [-1,1])this.box(`coat lapel ${side}`,a.trimColor,.058,bodyH*.37,.04,side*width*.37,.1+bodyH*.72,width*.79);
        this.sphere('coat lower hem',a.clothingColor,width,0,.1+bodyH*.22,0,1.08,.45,.84);
      }else this.box('tunic collar',a.trimColor,width*.78,.06,.05,0,.1+bodyH*.89,width*.65);
    }else this.box('base undergarment','#d4c9ac',width*1.38,bodyH*.2,width*1.25,0,.1+bodyH*.24,0);
    const hair=a.hairColor;
    if(a.hairStyle!=='bald'){
      this.sphere('hair crown',hair,headR,0,headY+headR*.56,-headR*.1,1.01,.6,.93);
      if(a.hairStyle==='short')this.sphere('short fringe',hair,headR*.35,-headR*.38,headY+headR*.51,headR*.69,1.4,.45,.6);
      if(a.hairStyle==='bob')for(const side of [-1,1])this.sphere(`bob side ${side}`,hair,headR*.46,side*headR*.78,headY-headR*.05,-headR*.18,.62,1.7,1.1);
      if(a.hairStyle==='ponytail'){this.sphere('hair tie',a.trimColor,headR*.19,0,headY+headR*.15,-headR*.96);this.sphere('ponytail',hair,headR*.38,0,headY-headR*.3,-headR*1.04,.75,1.7,.8);}
      if(a.hairStyle==='mohawk')this.sphere('mohawk ridge',hair,headR*.65,0,headY+headR*.87,0,.24,.95,1.35);
    }
    if(a.beardStyle==='stubble')this.sphere('stubble',a.beardColor,headR*.56,0,headY-headR*.55,headR*.5,1,.55,.55);
    if(a.beardStyle==='moustache')for(const side of [-1,1])this.sphere(`moustache ${side}`,a.beardColor,headR*.2,side*headR*.17,headY-headR*.25,headR*.93,1.3,.5,.4);
    if(a.beardStyle==='full')this.sphere('full beard',a.beardColor,headR*.65,0,headY-headR*.52,headR*.58,1,.9,.6);
    if(equippedItem(character,'head')){
      this.part('hat brim',L.PrimitiveMesh.createCylinder(headR*1.38,.065,16),'#a18659',0,headY+headR*.87,0);
      this.part('hat crown',L.PrimitiveMesh.createCylinder(headR*.85,headR*.55,12),'#a18659',0,headY+headR*1.12,0);
      this.height=Math.max(this.height,headY+headR*1.4);
    }
    const left=equippedItem(character,'leftHand'),right=equippedItem(character,'rightHand');
    this.twoHanded=left?.definition.hands===2||right?.definition.hands===2;
    const handY=.12+bodyH*.48;
    for(const side of [-1,1]){
      const pivot=new L.Sprite3D(`hand pivot ${side}`);this.visuals.addChild(pivot);
      const x=side*width*(this.twoHanded?.74:1.25),y=handY+(this.twoHanded?side*.1:0),z=this.twoHanded?width*1.1:.1;
      this.hands.push({node:pivot,side,x,y,z});
      this.sphere(`round hand ${side}`,skin,handR,0,0,0,1,1,.83,pivot);
    }
    const rendered=new Set<string>();
    for(const [slot,side]of [['leftHand',-1],['rightHand',1]] as const){
      const gear=equippedItem(character,slot);if(!gear||rendered.has(gear.item.id))continue;rendered.add(gear.item.id);
      const grip=this.hands.find(h=>h.side===side)!.node;
      if(gear.definition.id==='spear'){
        this.sharedGrip=new L.Sprite3D('shared weapon grip');this.visuals.addChild(this.sharedGrip);
        const holder=new L.Sprite3D('two hand spear');this.sharedGrip.addChild(holder);holder.transform.localPosition=new L.Vector3(0,handY,width*1.23);holder.transform.localRotationEuler=new L.Vector3(0,0,-64);
        this.part('spear shaft',L.PrimitiveMesh.createCylinder(.027,2.1,6),'#9b7148',0,0,0,1,1,1,holder);
        this.part('spear point',L.PrimitiveMesh.createSphere(.09,6,8),'#c3c9c6',0,1.13,0,.6,2,.45,holder);
      }else if(gear.definition.id==='stone_axe'||gear.definition.id==='stone_hoe'){
        const hoe=gear.definition.id==='stone_hoe';
        this.part('tool wood handle',L.PrimitiveMesh.createCylinder(.035,.8,6),'#8c6540',0,.1,.02,1,1,1,grip);
        this.box(hoe?'stone hoe head':'stone axe head','#81908c',hoe?.38:.32,hoe?.10:.22,hoe?.13:.09,.1,.44,.02,grip);
        this.box('tool binding','#c9b787',.09,.10,.12,0,.4,.02,grip);
      }else{
        this.part('knife grip',L.PrimitiveMesh.createCylinder(.037,.22,6),'#725442',0,.08,.02,1,1,1,grip);
        this.box('knife blade','#c6cfcb',.065,.32,.025,0,.34,.02,grip);
        this.box('knife guard','#877e65',.15,.035,.075,0,.18,.02,grip);
      }
    }
    this.createFarmingProps();
    const pack=equippedItem(character,'back');
    if(pack){
      const big=pack.definition.id==='expedition_pack',pw=width*(big?1.25:1),ph=bodyH*(big?.8:.59),color=pack.definition.color;
      this.sphere('backpack',color,1,0,.1+bodyH*.58,-width*.87,pw,ph/2,width*.48);
      this.box('backpack flap',a.trimColor,pw*1.45,.07,.06,0,.1+bodyH*.58+ph*.17,-width*1.37);
      for(const side of [-1,1])this.box(`shoulder strap ${side}`,color,.045,bodyH*.55,.045,side*width*.48,.1+bodyH*.64,width*.76);
    }
  }
  private createFarmingProps():void{
    const L=this.L,group=(name:string,parent:any)=>{const node=new L.Sprite3D(name);parent.addChild(node);return node;};
    this.hoe=group('farm hoe',this.hands.find(h=>h.side===1)!.node);
    this.part('farm hoe shaft',L.PrimitiveMesh.createCylinder(.035,1.12,6),'#9b7348',0,.16,0,1,1,1,this.hoe);
    this.box('farm hoe blade','#b5c2b9',.44,.10,.18,.13,.69,0,this.hoe);
    this.box('farm hoe binding','#d4be81',.09,.11,.12,0,.63,0,this.hoe);
    this.seedPouch=group('farm seed pouch',this.hands.find(h=>h.side===-1)!.node);
    this.sphere('farm seed sack','#c5a96a',.19,0,-.10,.02,1,1.2,.85,this.seedPouch);
    this.bucket=group('farm water bucket',this.hands.find(h=>h.side===1)!.node);
    this.part('farm bucket body',L.PrimitiveMesh.createCylinder(.20,.34,10),'#557c91',0,-.20,.08,1,1,1,this.bucket);
    this.part('farm bucket rim',L.PrimitiveMesh.createCylinder(.22,.05,10),'#c3cfc8',0,-.026,.08,1,1,1,this.bucket);
    this.bucketWater=this.part('farm bucket water surface',L.PrimitiveMesh.createCylinder(.18,.012,10),'#9fe6ed',0,.004,.08,1,1,1,this.bucket);
    for(const side of [-1,1])this.box('farm bucket handle','#a7b9b8',.03,.18,.035,side*.16,.065,.08,this.bucket);
    this.box('farm bucket handle grip','#d2c68f',.35,.035,.035,0,.155,.08,this.bucket);
    const particleGeometry=L.PrimitiveMesh.createSphere(.047,6,8);
    for(let i=0;i<3;i++)this.seedParticles.push(this.part('farm seed particle',particleGeometry,'#f4d884',0,0,0,1,.65,1));
    for(let i=0;i<6;i++)this.waterDrops.push(this.part('farm water droplet',particleGeometry,i%2?'#b7f6ff':'#64c5e1',0,0,0,.9,1.9,.9));
  }
  private updateFarming(farm:ReturnType<typeof farmingPose>,stride:number):void{
    const L=this.L,work=farm.work,active=farm.active||farm.carrying,right=this.hands.find(h=>h.side===1)!,left=this.hands.find(h=>h.side===-1)!;
    this.hoe.active=work==='till';this.seedPouch.active=work==='sow';this.bucket.active=work==='fetch'||work==='water'||farm.carrying&&!work;
    this.bucketWater.active=farm.waterLevel>0||work==='fetch'&&farm.time>1.2;
    if(active){
      // Temporarily put held equipment away visually; the resident's actual loadout is untouched.
      right.node.transform.localPosition=new L.Vector3(Math.abs(right.x),right.y,right.z+stride*.06);
      right.node.transform.localRotationEuler=new L.Vector3(0,0,0);
      left.node.transform.localPosition=new L.Vector3(-Math.abs(left.x),left.y,left.z+stride*-.20);
      left.node.transform.localRotationEuler=new L.Vector3(stride*-14,0,0);
      if(work==='till'){
        right.node.transform.localPosition=new L.Vector3(Math.abs(right.x)*.66,right.y+farm.stroke*.44,.34);
        right.node.transform.localRotationEuler=new L.Vector3(-104+farm.stroke*85,0,-8);
        left.node.transform.localPosition=new L.Vector3(-Math.abs(left.x)*.65,left.y+.08,.28);
        this.visuals.transform.localRotationEuler=new L.Vector3(4+(1-farm.stroke)*8,0,0);
      }else if(work==='sow'){
        right.node.transform.localPosition=new L.Vector3(.20+farm.seed*.16,right.y+.15,.35+(farm.seed+1)*.15);
        right.node.transform.localRotationEuler=new L.Vector3(-28-farm.seed*18,0,-farm.seed*22);
        left.node.transform.localPosition=new L.Vector3(-.35,left.y+.08,.23);
        this.visuals.transform.localRotationEuler=new L.Vector3(8,0,0);
      }else if(work==='water'){
        right.node.transform.localPosition=new L.Vector3(.31,right.y+.16,.52);
        right.node.transform.localRotationEuler=new L.Vector3(55+farm.stroke*7,0,-8);
        this.visuals.transform.localRotationEuler=new L.Vector3(9,0,0);
      }else if(work==='fetch'){
        right.node.transform.localPosition=new L.Vector3(.31,right.y-farm.scoop*.18,.30+farm.scoop*.35);
        right.node.transform.localRotationEuler=new L.Vector3(-farm.scoop*20,0,0);
        this.visuals.transform.localRotationEuler=new L.Vector3(farm.scoop*26,0,0);
      }
    }
    for(let i=0;i<this.seedParticles.length;i++){
      const node=this.seedParticles[i],phase=(farm.time*1.15+i/3)%1;node.active=work==='sow';
      node.transform.localPosition=new L.Vector3(.16+(i-1)*.17+phase*.11,.78*(1-phase)+Math.sin(phase*Math.PI)*.15,.52+phase*.75);
    }
    for(let i=0;i<this.waterDrops.length;i++){
      const node=this.waterDrops[i],phase=(farm.time*1.8+i/6)%1;node.active=work==='water'||work==='fetch'&&farm.scoop>.45;
      node.transform.localPosition=new L.Vector3(.33+(i%3-1)*.052,work==='fetch'?.12+Math.sin(phase*Math.PI)*.22:.80*(1-phase),work==='fetch'?.83+phase*.13:.63+phase*.57);
    }
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.clearVisuals();this.node.destroy(true);}
}
export function createCharacterMesh(resident:Resident):CharacterMesh{return new CharacterMesh(resident);}
export function updateCharacterMesh(mesh:CharacterMesh,resident:Resident):void{mesh.update(resident);}
export function disposeCharacterMesh(mesh:CharacterMesh):void{mesh.dispose();}
