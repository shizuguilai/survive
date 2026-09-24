import type { Resident } from '../../../packages/sim-core/src/domain.ts';
import {createCharacterState,equippedItem} from '../../../packages/sim-core/src/character.ts';
import type {CharacterState,EquipmentSlot} from '../../../packages/sim-core/src/character.ts';

/** Native Laya 3D pawn. Owns its generated geometry/materials and never advances simulation. */
export class CharacterMesh {
  readonly node:any;
  height=1.9;
  private signature='';private visuals:any;
  private geometries:any[]=[];private materials:any[]=[];private disposed=false;
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
  }
  private color(hex:string):any{const n=parseInt(hex.slice(1),16);return new this.L.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);}
  private part(name:string,geometry:any,color:string,x:number,y:number,z:number,sx=1,sy=1,sz=1,parent=this.visuals):any{
    const L=this.L,mesh=new L.MeshSprite3D(geometry,name);this.geometries.push(geometry);
    mesh.transform.localPosition=new L.Vector3(x,y,z);mesh.transform.localScale=new L.Vector3(sx,sy,sz);
    const material=new L.BlinnPhongMaterial();material.albedoColor=this.color(color);material.specularColor=new L.Color(.035,.035,.035,1);this.materials.push(material);
    mesh.meshRenderer.sharedMaterial=material;parent.addChild(mesh);return mesh;
  }
  private sphere(name:string,color:string,r:number,x:number,y:number,z:number,sx=1,sy=1,sz=1):any{return this.part(name,this.L.PrimitiveMesh.createSphere(r,10,12),color,x,y,z,sx,sy,sz);}
  private box(name:string,color:string,w:number,h:number,d:number,x:number,y:number,z:number):any{return this.part(name,this.L.PrimitiveMesh.createBox(w,h,d),color,x,y,z);}
  private clearVisuals():void{
    if(this.visuals){this.visuals.destroy(true);this.visuals=null;}
    for(const geometry of this.geometries)geometry.destroy();
    for(const material of this.materials)material.destroy();
    this.geometries=[];this.materials=[];
  }
  private rebuild(character:CharacterState):void{
    this.clearVisuals();const L=this.L,a=character.appearance;
    this.visuals=new L.Sprite3D('appearance and equipment');this.node.addChild(this.visuals);
    const width=.33*a.bodyWidth,bodyH=(a.bodyShape==='rounded'?.96:1.18)*a.bodyLength;
    const headR=.31*a.headSize,headY=.13+bodyH+headR*.77,handR=.12*a.handSize;
    this.height=headY+headR*1.35;
    const torso=equippedItem(character,'torso'),skin=a.skinColor;
    // Single continuous body; two round hands; no independent animation/timer.
    this.part('body',L.PrimitiveMesh.createCapsule(1,3,8,12),torso?a.clothingColor:skin,0,.1+bodyH/2,0,width,bodyH/3,width*.78);
    this.sphere('head',skin,headR,0,headY,0);
    this.sphere('nose',skin,headR*.15,0,headY-.02,headR*.95,1,1,1.1);
    for(const side of [-1,1])this.sphere(`eye ${side}`,'#272c2b',headR*.06,side*headR*.33,headY+headR*.08,headR*.93,1,1.1,.6);
    // Cloth hems distinguish a tunic from a long coat; all garments keep chosen dye colors.
    if(torso){
      this.box('cloth belt',a.trimColor,width*1.72,.075,width*1.38,0,.1+bodyH*.46,.015);
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
    const twoHanded=left?.definition.hands===2||right?.definition.hands===2;
    const handY=.12+bodyH*.48;
    for(const side of [-1,1])this.sphere(`round hand ${side}`,skin,handR,side*width*(twoHanded?.74:1.2),handY+(twoHanded?side*.1:0),twoHanded?width*1.1:.1);
    const rendered=new Set<string>();
    for(const [slot,side]of [['leftHand',-1],['rightHand',1]] as const){
      const gear=equippedItem(character,slot);if(!gear||rendered.has(gear.item.id))continue;rendered.add(gear.item.id);
      if(gear.definition.id==='spear'){
        const holder=new L.Sprite3D('two hand spear');this.visuals.addChild(holder);holder.transform.localPosition=new L.Vector3(0,handY,width*1.23);holder.transform.localRotationEuler=new L.Vector3(0,0,-64);
        this.part('spear shaft',L.PrimitiveMesh.createCylinder(.027,2.1,6),'#9b7148',0,0,0,1,1,1,holder);
        this.part('spear point',L.PrimitiveMesh.createSphere(.09,6,8),'#c3c9c6',0,1.13,0,.6,2,.45,holder);
      }else{
        const x=side*width*1.2;
        this.part('knife grip',L.PrimitiveMesh.createCylinder(.037,.22,6),'#725442',x,handY+.08,.12);
        this.box('knife blade','#c6cfcb',.065,.32,.025,x,handY+.34,.12);
        this.box('knife guard','#877e65',.15,.035,.075,x,handY+.18,.12);
      }
    }
    const pack=equippedItem(character,'back');
    if(pack){
      const big=pack.definition.id==='expedition_pack',pw=width*(big?1.25:1),ph=bodyH*(big?.8:.59),color=pack.definition.color;
      this.sphere('backpack',color,1,0,.1+bodyH*.58,-width*.87,pw,ph/2,width*.48);
      this.box('backpack flap',a.trimColor,pw*1.45,.07,.06,0,.1+bodyH*.58+ph*.17,-width*1.37);
      for(const side of [-1,1])this.box(`shoulder strap ${side}`,color,.045,bodyH*.55,.045,side*width*.48,.1+bodyH*.64,width*.76);
    }
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.clearVisuals();this.node.destroy(true);}
}
export function createCharacterMesh(resident:Resident):CharacterMesh{return new CharacterMesh(resident);}
export function updateCharacterMesh(mesh:CharacterMesh,resident:Resident):void{mesh.update(resident);}
export function disposeCharacterMesh(mesh:CharacterMesh):void{mesh.dispose();}
