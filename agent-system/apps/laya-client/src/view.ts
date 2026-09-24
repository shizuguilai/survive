import type { World, SensoryOverlay } from '../../../packages/sim-core/src/domain.ts';
import {CharacterMesh} from './character-mesh.ts';
import {publicCharacterSummary} from '../../../packages/sim-core/src/character.ts';
import defaults from '../../../packages/sim-core/defaults.json' with {type:'json'};

export type ViewCallbacks = {
  onPause():void; onResume():void; onRetry():void; onStop():void;
  onSelect(id:string):void; onToggleSenses():void; onReplay():void; onLive():void;
  onSeek(tick:number):void; onSpeed(value:number):void; onStart():void; onConnect(token:string):void;
};
export type ViewState = {
  world:World; overlays:Record<string,SensoryOverlay>; status:string; error?:string;
  mode:'UNCONFIGURED'|'REAL_MODEL'|'REPLAY'; selectedId:string; showSenses:boolean;
  playbackTick:number; maxTick:number; speed:number;
};

// All visible controls and graphics use Laya. Only its engine-owned Input bridge
// uses platform input facilities; no game scene, HUD, or controls use DOM rendering.
const L:any=(globalThis as any).Laya;
const WIDTH=1280,HEIGHT=720,SIDE=292,TOP=84,BOTTOM=614;
const palette={ink:'#172b2d',muted:'#8da19c',paper:'#f4f2e9',panel:'#142f31',line:'#325153',mint:'#9ee3be',amber:'#f3c87c'};
type NativeButton={root:any;label:any;set(text:string):void};

export async function initialize(api:ViewCallbacks):Promise<ObserverView>{
  if(!L?.Scene3D)throw Error('LayaAir 3.3.12 runtime 未加载');
  if(!L.stage){
    L.Config3D.enableMultiLight=false;
    L.Config3D.enableDynamicBatch=true;
    await L.init({designWidth:WIDTH,designHeight:HEIGHT,scaleMode:'showall',screenMode:'horizontal',alignH:'center',alignV:'middle',backgroundColor:palette.paper});
  }
  L.stage.designWidth=WIDTH;L.stage.designHeight=HEIGHT;L.stage.scaleMode='showall';L.stage.screenMode='horizontal';
  L.stage.alignH='center';L.stage.alignV='middle';L.stage.bgColor=palette.paper;
  return new ObserverView(api);
}

export class ObserverView {
  readonly root:any; readonly scene:any; readonly camera:any;
  private labels:Record<string,any>={};private buttons:Record<string,NativeButton>={};
  private residents=new Map<string,CharacterMesh>();private objects=new Map<string,any>();
  private nameLabels=new Map<string,any>();private speechLabels=new Map<string,any>();private senseLines:any;private selection:any;
  private state:ViewState|null=null;private token:any;private timeline:any;
  private offset={x:0,z:0};private drag:{x:number;y:number;ox:number;oz:number;moved:boolean}|null=null;
  private markers:any;private sceneInput:any;private zoom=17;private scrubbing=false;

  constructor(private api:ViewCallbacks){
    this.scene=new L.Scene3D();this.scene.name='Survive — 认知观察场';L.stage.addChild(this.scene);
    this.scene.ambientMode=0;this.scene.ambientColor=new L.Color(.8,.82,.74,1);this.scene.enableFog=false;
    this.camera=new L.Camera(0,.1,160);this.scene.addChild(this.camera);
    this.camera.clearColor=new L.Color(.91,.93,.86,1);this.camera.clearFlag=L.CameraClearFlags.SolidColor;
    this.camera.orthographic=true;this.camera.orthographicVerticalSize=this.zoom;
    this.camera.normalizedViewport=new L.Viewport(SIDE/WIDTH,TOP/HEIGHT,(WIDTH-SIDE)/WIDTH,(BOTTOM-TOP)/HEIGHT);
    this.camera.enableHDR=false;this.camera.enableBuiltInRenderTexture=false;this.camera.msaa=false;
    this.moveCamera();
    const light=new L.Sprite3D('Daylight');this.scene.addChild(light);
    light.transform.rotationEuler=new L.Vector3(-55,25,0);const dl=light.addComponent(L.DirectionLightCom);dl.color=new L.Color(.65,.63,.55,1);dl.intensity=.8;
    this.mesh('ground',L.PrimitiveMesh.createBox(38,.12,30),{x:0,y:-.12,z:0},'#cbd4b5');
    this.mesh('clearing',L.PrimitiveMesh.createCylinder(8,.025,60),{x:0,y:-.038,z:0},'#d9d5b8');
    const grid=new L.PixelLineSprite3D(70,'terrain grid');this.scene.addChild(grid);
    for(let n=-16;n<=16;n+=2){this.line(grid,{x:n,y:-.012,z:-14},{x:n,y:-.012,z:14},'#b8c4a7');this.line(grid,{x:-18,y:-.012,z:n},{x:18,y:-.012,z:n},'#b8c4a7');}
    this.senseLines=new L.PixelLineSprite3D(1200,'有限感知参考');this.scene.addChild(this.senseLines);
    this.selection=new L.PixelLineSprite3D(72,'selected resident');this.scene.addChild(this.selection);
    this.root=new L.Sprite();this.root.name='Observer UI';L.stage.addChild(this.root);
    this.buildUI();
    L.stage.on(L.Event.MOUSE_MOVE,this,()=>this.pointerMove());
    L.stage.on(L.Event.MOUSE_UP,this,()=>this.pointerUp());
    L.stage.on(L.Event.RESIZE,this,()=>this.positionLabels());
  }

  private color(hex:string,alpha=1):any{const h=parseInt(hex.slice(1),16);return new L.Color((h>>16&255)/255,(h>>8&255)/255,(h&255)/255,alpha);}
  private text(parent:any,text:string,x:number,y:number,size=16,color=palette.ink,width=250):any{
    const t=new L.Text();t.text=text;t.pos(x,y);t.font='Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif';t.fontSize=size;t.color=color;t.width=width;t.wordWrap=true;t.leading=5;parent.addChild(t);return t;
  }
  private panel(parent:any,x:number,y:number,w:number,h:number,color:string,r=0):any{
    const s=new L.Sprite();s.pos(x,y);s.size(w,h);
    if(r)s.graphics.drawRoundRect(0,0,w,h,r,r,r,r,color);else s.graphics.drawRect(0,0,w,h,color);
    parent.addChild(s);return s;
  }
  private button(id:string,text:string,x:number,y:number,w:number,click:()=>void,bright=false):NativeButton{
    const r=this.panel(this.root,x,y,w,35,bright?palette.mint:palette.line,7);r.mouseEnabled=true;
    const t=this.text(r,text,0,10,14,bright?palette.ink:'#eff9ef',w);t.align='center';t.mouseEnabled=false;
    r.on(L.Event.CLICK,this,click);const b={root:r,label:t,set:(s:string)=>t.text=s};this.buttons[id]=b;return b;
  }
  private buildUI():void{
    this.panel(this.root,0,0,WIDTH,TOP,palette.paper);this.panel(this.root,0,TOP,SIDE,HEIGHT-TOP,palette.panel);
    this.panel(this.root,SIDE,BOTTOM,WIDTH-SIDE,HEIGHT-BOTTOM,palette.paper);
    this.panel(this.root,0,TOP-1,WIDTH,1,'#c8d1c2');
    this.text(this.root,'SURVIVE',23,18,27,palette.ink,230).bold=true;
    this.text(this.root,'微小世界 · 独立心智',25,54,13,'#60786d',240);
    this.labels.mode=this.text(this.root,'等待连接真实模型',323,18,17,palette.ink,430);
    this.labels.status=this.text(this.root,'世界尚未启动',323,49,13,'#60786d',560);
    this.labels.time=this.text(this.root,'模拟 00:00',1000,21,24,palette.ink,250);this.labels.time.align='right';
    this.text(this.root,'等待模型时，全世界静止',1000,54,12,'#60786d',250).align='right';
    this.text(this.root,'观察对象',20,104,12,palette.muted);
    this.button('resident0','居民 A',18,129,121,()=>this.selectIndex(0));this.button('resident1','居民 B',151,129,121,()=>this.selectIndex(1));
    this.labels.person=this.text(this.root,'选择一名居民',21,186,24,'#f1f4dc',252);this.labels.person.bold=true;
    this.labels.personality=this.text(this.root,'每个人只拥有自己的感官与记忆。',21,222,13,'#aac2b7',250);
    this.panel(this.root,20,267,252,1,palette.line);
    this.text(this.root,'此刻的私人感知',20,285,12,palette.muted);
    this.labels.perception=this.text(this.root,'暂无感知事件',20,312,14,'#e5f1df',250);this.labels.perception.height=118;this.labels.perception.overflow='hidden';
    this.text(this.root,'当前意图',20,444,12,palette.muted);
    this.labels.goal=this.text(this.root,'尚未得到真实模型决策',20,468,14,'#e5f1df',252);this.labels.goal.height=53;this.labels.goal.overflow='hidden';
    this.button('senses','感官显示  开',18,538,254,()=>this.api.onToggleSenses());
    this.text(this.root,'青绿：视野 · 金环：无墙无噪声参考\n橙线：听见的方向 · 蓝圈：最后已知',20,584,12,'#95b3a6',254);
    this.labels.equipment=this.text(this.root,'',20,633,11,'#aac2b7',254);this.labels.equipment.height=36;this.labels.equipment.overflow='hidden';
    this.text(this.root,'摄影机可拖动；暂停时仍可观察。',20,685,11,'#95b3a6',254);
    this.sceneInput=new L.Sprite();this.sceneInput.pos(SIDE,TOP);this.sceneInput.size(WIDTH-SIDE,BOTTOM-TOP);this.sceneInput.mouseEnabled=true;
    this.sceneInput.hitArea=new L.Rectangle(0,0,WIDTH-SIDE,BOTTOM-TOP);this.root.addChild(this.sceneInput);
    this.sceneInput.on(L.Event.MOUSE_DOWN,this,()=>{this.drag={x:L.stage.mouseX,y:L.stage.mouseY,ox:this.offset.x,oz:this.offset.z,moved:false};});
    this.sceneInput.on(L.Event.MOUSE_WHEEL,this,(e:any)=>{this.zoom=Math.max(10,Math.min(34,this.zoom-e.delta));this.camera.orthographicVerticalSize=this.zoom;this.positionLabels();});
    this.markers=new L.Sprite();this.markers.mouseEnabled=false;this.root.addChild(this.markers);
    this.labels.caption=this.text(this.root,'两名居民 · 两棵树 · 一堵墙',315,97,12,'#426356',430);
    this.labels.caption.mouseEnabled=false;
    this.labels.error=this.text(this.root,'',326,494,16,'#7b3e24',908);this.labels.error.height=104;this.labels.error.overflow='hidden';this.labels.error.mouseEnabled=false;
    this.button('start','开始真实认知',315,628,130,()=>this.api.onStart(),true);
    this.button('pause','暂停',455,628,72,()=>{const paused=/PAUS|STOP|暂停/i.test(this.state?.status||'');paused?this.api.onResume():this.api.onPause();});
    this.button('retry','重试',537,628,72,()=>this.api.onRetry());
    this.button('stop','停止',619,628,72,()=>this.api.onStop());
    this.button('replay','查看回放',705,628,104,()=>this.state?.mode==='REPLAY'?this.api.onLive():this.api.onReplay());
    this.button('speed','1× 播放',819,628,94,()=>{const current=this.state?.speed||1;this.api.onSpeed(current>=4?.5:current*2);});
    this.text(this.root,'网关令牌',929,636,12,'#60786d',84);
    this.token=new L.Input();this.token.pos(1007,629);this.token.size(152,33);this.token.fontSize=14;this.token.color=palette.ink;this.token.bgColor='#e0e6d9';this.token.type='password';this.token.prompt='仅存当前会话';this.token.promptColor='#7f9688';this.token.padding=[7,7,7,7];this.root.addChild(this.token);
    this.button('connect','连接',1170,628,86,()=>{const token=this.token.text;this.token.text='';this.api.onConnect(token);},true);
    this.timeline=this.panel(this.root,320,681,880,8,'#c8d4c2',4);this.timeline.mouseEnabled=true;this.timeline.hitArea=new L.Rectangle(0,-12,880,34);
    this.timeline.on(L.Event.MOUSE_DOWN,this,()=>{this.scrubbing=true;this.seekAtPointer();});
    this.labels.timeline=this.text(this.root,'暂无回放',1210,675,12,'#60786d',67);
    this.text(this.root,'仅播放模拟时间；网络等待不会出现在回放中',320,699,10,'#82907f',650);
  }
  private selectIndex(index:number):void{const id=this.state?.world.residents[index]?.id;if(id)this.api.onSelect(id);}
  private seekAtPointer():void{if(this.state?.mode!=='REPLAY')return;this.api.onSeek(Math.round(Math.max(0,Math.min(1,(L.stage.mouseX-320)/880))*this.state.maxTick));}
  private pointerMove():void{
    if(this.scrubbing){this.seekAtPointer();return;}
    if(!this.drag)return;const dx=L.stage.mouseX-this.drag.x,dy=L.stage.mouseY-this.drag.y;
    if(Math.abs(dx)+Math.abs(dy)>4)this.drag.moved=true;
    this.offset.x=this.drag.ox-dx*this.zoom/900;this.offset.z=this.drag.oz-dy*this.zoom/550;this.moveCamera();this.positionLabels();
  }
  private pointerUp():void{
    this.scrubbing=false;
    const drag=this.drag;this.drag=null;if(!drag||drag.moved||!this.state)return;
    let nearest:string|null=null,distance=42;
    for(const r of this.state.world.residents){const p=this.project({...r.position,y:r.position.y+1});const d=Math.hypot(p.x-L.stage.mouseX,p.y-L.stage.mouseY);if(d<distance){nearest=r.id;distance=d;}}
    if(nearest)this.api.onSelect(nearest);
  }
  private moveCamera():void{this.camera.transform.position=new L.Vector3(this.offset.x+12,21,this.offset.z+21);this.camera.transform.lookAt(new L.Vector3(this.offset.x,0,this.offset.z),new L.Vector3(0,1,0),false,true);}
  private mesh(name:string,geometry:any,p:{x:number;y:number;z:number},color:string):any{
    const mesh=new L.MeshSprite3D(geometry,name);mesh.transform.position=new L.Vector3(p.x,p.y,p.z);
    const mat=new L.BlinnPhongMaterial();mat.albedoColor=this.color(color);mat.specularColor=new L.Color(.05,.05,.05,1);mesh.meshRenderer.sharedMaterial=mat;this.scene.addChild(mesh);return mesh;
  }
  private line(target:any,a:{x:number;y:number;z:number},b:{x:number;y:number;z:number},color:string):void{const c=this.color(color);target.addLine(new L.Vector3(a.x,a.y,a.z),new L.Vector3(b.x,b.y,b.z),c,c);}
  private ring(target:any,p:{x:number;y:number;z:number},radius:number,color:string,dashed=false):void{
    for(let i=0;i<64;i++){if(dashed&&i%2)continue;const a=i/64*Math.PI*2,b=(i+1)/64*Math.PI*2;this.line(target,{x:p.x+Math.cos(a)*radius,y:.035,z:p.z+Math.sin(a)*radius},{x:p.x+Math.cos(b)*radius,y:.035,z:p.z+Math.sin(b)*radius},color);}
  }
  private drawWorld(world:World):void{
    const liveIds=new Set(world.residents.map(r=>r.id));
    for(const [id,node]of this.residents){if(!liveIds.has(id)){node.dispose();this.residents.delete(id);this.nameLabels.get(id)?.destroy();this.nameLabels.delete(id);this.speechLabels.get(id)?.destroy();this.speechLabels.delete(id);}}
    for(const r of world.residents){
      let node=this.residents.get(r.id);
      if(!node){node=new CharacterMesh(r);this.scene.addChild(node.node);this.residents.set(r.id,node);const t=this.text(this.markers,r.name,0,0,13,palette.ink,120);t.align='center';t.bold=true;t.mouseEnabled=false;this.nameLabels.set(r.id,t);const speech=this.text(this.markers,'',0,0,14,palette.ink,230);speech.bgColor='#f4f2e9';speech.padding=[7,9,7,9];speech.align='center';speech.mouseEnabled=false;this.speechLabels.set(r.id,speech);}
      node.update(r);
    }
    for(const o of world.objects){if(this.objects.has(o.id))continue;let node:any;
      if(o.kind==='wall')node=this.mesh(o.id,L.PrimitiveMesh.createBox(o.width,o.height,o.depth),{...o.position,y:o.position.y+o.height/2},'#92958b');
      else {node=new L.Sprite3D(o.id);this.scene.addChild(node);node.transform.position=new L.Vector3(o.position.x,o.position.y,o.position.z);
        const trunk=this.mesh(o.id+' trunk',L.PrimitiveMesh.createCylinder(.17,1.6,8),{x:0,y:.8,z:0},'#8a7759');node.addChild(trunk);
        const leaves=this.mesh(o.id+' leaves',L.PrimitiveMesh.createSphere(.95,7,8),{x:0,y:2.2,z:0},'#65876c');node.addChild(leaves);
        const crown=this.mesh(o.id+' crown',L.PrimitiveMesh.createSphere(.72,6,7),{x:.23,y:2.8,z:.08},'#86a071');node.addChild(crown);
      }this.objects.set(o.id,node);
    }
    this.positionLabels();
  }
  private project(p:{x:number;y:number;z:number}):{x:number;y:number}{const out=new L.Vector4();this.camera.worldToViewportPoint(new L.Vector3(p.x,p.y,p.z),out);return {x:out.x,y:out.y};}
  private positionLabels():void{if(!this.state)return;for(const r of this.state.world.residents){const p=this.project({...r.position,y:r.position.y+(this.residents.get(r.id)?.height??1.9)+.25});const t=this.nameLabels.get(r.id);if(t){t.pos(p.x-60,p.y-10);t.visible=p.x>SIDE+10&&p.x<WIDTH-10&&p.y>TOP+24&&p.y<BOTTOM-20;}
    const speech=this.speechLabels.get(r.id);if(speech){const fragments=this.state.world.sounds.filter(s=>s.sourceId===r.id&&this.state!.world.tick-s.emittedTick<3000/defaults.simulation.fixedDtMs);const text=fragments.map(s=>s.text).join('').slice(-55);speech.text=text?`“${text}”`:'';speech.visible=!!text&&t?.visible;const offset=this.state.world.residents.indexOf(r)%2?-5:-225;speech.pos(Math.max(SIDE+12,Math.min(WIDTH-242,p.x+offset)),Math.max(TOP+30,p.y-75));}}
  }
  private drawSenses(state:ViewState):void{
    this.senseLines.clear();this.selection.clear();const r=state.world.residents.find(r=>r.id===state.selectedId);if(r)this.ring(this.selection,r.position,.56,'#355e48');
    if(!state.showSenses)return;const o=state.overlays[state.selectedId];if(!o)return;
    const poly=o.visionPolygon;if(poly.length>1){for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];this.line(this.senseLines,{...a,y:.045},{...b,y:.045},'#45997b');}for(let i=0;i<poly.length;i+=4)this.line(this.senseLines,{...o.eye,y:.04},{...poly[i],y:.04},'#8eb698');}
    for(const ring of o.hearingRadii)this.ring(this.senseLines,o.eye,ring.radius,'#b5a067',true);
    const directions=['front','front_right','right','back_right','back','back_left','left','front_left'];
    for(const observation of o.observations.filter(v=>v.modality==='auditory').slice(-2)){const sector=directions.indexOf(observation.detail.relativeDirection);if(sector<0)continue;const angle=o.heading+sector*Math.PI/4;this.line(this.senseLines,{...o.eye,y:.075},{x:o.eye.x+Math.cos(angle)*2,y:.075,z:o.eye.z+Math.sin(angle)*2},'#bc793f');}
    for(const known of o.lastKnown){this.ring(this.senseLines,known.position,.35,'#798caa',true);this.line(this.senseLines,{...known.position,y:.04},{...known.position,y:1},'#798caa');}
  }
  render(state:ViewState):void{
    this.state=state;this.drawWorld(state.world);this.drawSenses(state);
    const r=state.world.residents.find(x=>x.id===state.selectedId)||state.world.residents[0];
    const mode=state.mode==='UNCONFIGURED'?'尚未接入真实模型':state.mode==='REPLAY'?'观察回放 · 不调用模型':'真实模型 · 独立居民';
    this.labels.mode.text=mode;this.labels.status.text=this.humanStatus(state.status);
    const seconds=Math.floor(state.world.tick*defaults.simulation.fixedDtMs/1000);this.labels.time.text=`模拟 ${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
    for(let i=0;i<2;i++){const person=state.world.residents[i];this.buttons['resident'+i].set(person?`${person.id===state.selectedId?'●  ':''}${person.name}`:'暂无居民');}
    if(r){this.labels.equipment.text=r.character?'可见穿着 · '+publicCharacterSummary(r.character):'';this.labels.person.text=r.name;this.labels.personality.text=r.personality;this.labels.goal.text=r.goal||'尚未得到真实模型决策';
      const obs=state.overlays[r.id]?.observations||r.observations;this.labels.perception.text=obs.slice(-4).map(o=>{const d=o.detail;if(o.modality==='auditory')return `听 · ${d.heardText?(d.recognizedSpeakerName?d.recognizedSpeakerName+'：':'')+d.heardText:'听到模糊说话声，未听清内容'}`;if(o.modality==='visual')return `视 · ${Array.isArray(d.appearance)?d.appearance.join('；'):d.appearance||'注意到一个轮廓'}`;const senses:Record<string,string>={hunger:'饥饿',fatigue:'疲劳',pain:'疼痛',touch:'触碰',imbalance:'失衡',obstructed:'受阻'},intensity:Record<string,string>={mild:'轻微',noticeable:'明显',severe:'严重'};return `身 · ${senses[d.sensation]||'身体状态'}：${intensity[d.intensity]||'有所变化'}`;}).join('\n')||'尚未感知到新的线索';}
    this.buttons.senses.set(`感官显示  ${state.showSenses?'开':'关'}`);this.buttons.replay.set(state.mode==='REPLAY'?'返回现场':'查看回放');this.buttons.speed.set(`${state.speed}× 播放`);
    this.buttons.pause.set(/PAUS|STOP|暂停/i.test(state.status)?'继续':'暂停');
    this.labels.error.text=state.error?state.error.slice(0,260)+(state.status==='ERROR_PAUSED'?'\n世界保持冻结，可修正连接后重试。':''):state.mode==='UNCONFIGURED'?'这是静态观察场。请先配置模型服务并连接网关。\n连接真实模型后，居民才会自主相遇、交流。':'';
    this.labels.caption.text=state.mode==='REPLAY'?'回放现场 · 按模拟时间播放':'两名居民 · 两棵树 · 一堵墙';
    this.timeline.graphics.clear();this.timeline.graphics.drawRoundRect(0,0,880,8,4,4,4,4,'#c8d4c2');const progress=state.maxTick>0?Math.max(0,Math.min(1,state.playbackTick/state.maxTick)):0;
    if(progress>0)this.timeline.graphics.drawRoundRect(0,0,880*progress,8,4,4,4,4,'#4c8970');this.timeline.graphics.drawCircle(880*progress,4,6,'#4c8970');
    this.labels.timeline.text=state.maxTick?`${state.playbackTick}/${state.maxTick}`:'暂无回放';
  }
  private humanStatus(status:string):string{const map:Record<string,string>={RUNNING:'世界运行中',PAUSED:'观察者已暂停',THINKING:'居民正在思考 · 世界已冻结',COMMITTING:'完整决策批次正在提交 · 世界保持冻结',READY:'准备开始',PLAYING:'回放播放中 · 不调用模型',BUFFERING:'回放缓冲中',ERROR_PAUSED:'认知请求失败 · 世界保持冻结',WAITING_FOR_MODEL:'模型思考中 · 世界已冻结',WAITING:'模型思考中 · 世界已冻结',ERROR:'认知请求失败 · 世界保持冻结',IDLE:'准备开始',STOPPED:'已停止',UNCONFIGURED:'未配置真实模型'};return map[status]||status;}
}
