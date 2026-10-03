import {PaintedWorld,loadCampArt} from './painted-world.ts';
import {CROP_LABELS,ANIMAL_LABELS,zoneKind,zoneConflict} from '../../../packages/sim-core/src/agriculture.ts';
import {DEFAULT_MAP_ZOOM} from '../../../packages/sim-core/src/map-config.ts';
import {zoneOverlayGeometry} from './zone-overlay.ts';
import {Minimap} from './minimap.ts';
import {ThoughtCadence} from './thought-cadence.ts';
import {SpeechBubble} from './speech-bubble.ts';
import {homeDesign,preferredHome} from '../../../packages/sim-core/src/home-design.ts';
import {clampMapCamera,groundAtScreen,projectToStage,beginMapPinch,moveMapPinch,cameraFootprint,cameraEye,normalizedYaw,type MapPinch,type MapTouch} from './map-camera.ts';
import {NativeTextScroll} from './native-scroll.ts';
import {dayClock,residentThought,moodReasons,ownHouse,onBreak,FURNITURE,homeSize} from '../../../packages/sim-core/src/living.ts';
import {drawIcon} from './hud-icons.ts';
import {boundedZoom,cycleHit} from './interaction.ts';
import {zoneBounds,validateZone,homeSites} from '../../../packages/sim-core/src/housing.ts';
import {resourceCapacity,resourceStage} from '../../../packages/sim-core/src/resources.ts';
import type {Resident,WorldObject,ResidentialBounds,ZoneKind,CropKind,AnimalKind} from '../../../packages/sim-core/src/domain.ts';
import {createTerrain} from './terrain.ts';
import {controlSettings,DEFAULT_CONTROL,type ControlSettings} from '../../../packages/contracts/src/command.ts';
import type { World, SensoryOverlay } from '../../../packages/sim-core/src/domain.ts';
import {RESOURCE_LABELS,type TaskDraft} from '../../../packages/sim-core/src/camp.ts';
import {MemoryMapView} from './memory-map.ts';
import {CharacterMesh} from './character-mesh.ts';
import {WorldMesh} from './world-mesh.ts';
import {RECIPES,HOUSE_STEPS,houseSteps,houseCost,materialText,taskTitle} from '../../../packages/sim-core/src/recipes.ts';
import {selectJournal,journalTime,JOURNAL_LABELS,readableAction,type JournalEntry,type JournalCategory} from './journal.ts';
import {summaryInput,latestSummary} from './journal-summary.ts';
import type {SummaryRequest,SavedSummary} from '../../../packages/contracts/src/journal-summary.ts';
import {publicCharacterSummary,listOwnEquipment} from '../../../packages/sim-core/src/character.ts';
import defaults from '../../../packages/sim-core/defaults.json' with {type:'json'};

export type ViewCallbacks = {
  onSave?():void;onLoad?():void;
  onControl?(settings:ControlSettings,newCamp?:boolean):void;onRemoteRetry?():void;
  onSummarize?(request:SummaryRequest):void;
  onTask(draft:TaskDraft):boolean|void;
  onPause():void; onResume():void; onRetry():void; onStop():void;
  onSelect(id:string):void; onToggleSenses():void; onReplay?():void; onLive?():void;
  onSeek?(tick:number):void; onSpeed?(value:number):void; onStart():void; onConnect(token:string):void;
};
export type ViewState = {
  saveStatus?:string;resumeReady?:boolean;
  control?:ControlSettings;controlDetail?:string;controlNotice?:string;fallbackActive?:boolean;
  summaries?:SavedSummary[];summaryBusy?:boolean;summaryError?:string;summaryVersion?:number;
  cognitionDetail?:string;
  history?:JournalEntry[];historyVersion?:number;historyWarning?:string;
  pendingTasks?:number;world:World; overlays:Record<string,SensoryOverlay>; status:string; error?:string;
  mode:'UNCONFIGURED'|'REAL_MODEL'|'REPLAY'|'LOCAL_ALGORITHM'; selectedId:string; showSenses:boolean;
  playbackTick?:number; maxTick?:number; speed?:number; hosted?:boolean;
};

// All visible controls and graphics use Laya. Only its engine-owned Input bridge
// uses platform input facilities; no game scene, HUD, or controls use DOM rendering.
const L:any=(globalThis as any).Laya;
const WIDTH=1280,HEIGHT=720,SIDE=292,TOP=68,BOTTOM=646;
const ZONE_LABELS:Record<ZoneKind,string>={residential:'居住区',planting:'种植区',pasture:'畜牧区'};
const palette={ink:'#f5f8f5',muted:'#b9c9d2',paper:'#21394c',panel:'#273f53',line:'#345670',mint:'#b8df78',amber:'#f8da93'};
type HistoryRow=JournalEntry&{title:string;evidence?:JournalEntry[]};
type NativeButton={root:any;label:any;set(text:string):void};

export async function initialize(api:ViewCallbacks):Promise<ObserverView>{
  if(!L?.Scene3D)throw Error('LayaAir 3.3.12 runtime 未加载');
  if(!L.stage){
    L.Config.useRetinalCanvas=true;L.Config.isAntialias=true;
    L.Config3D.enableMultiLight=false;
    L.Config3D.enableDynamicBatch=true;
    await L.init({designWidth:WIDTH,designHeight:HEIGHT,scaleMode:'showall',screenMode:'horizontal',alignH:'center',alignV:'middle',backgroundColor:palette.paper});
  }
  L.stage.designWidth=WIDTH;L.stage.designHeight=HEIGHT;L.stage.scaleMode='showall';L.stage.screenMode='horizontal';
  L.stage.alignH='center';L.stage.alignV='middle';L.stage.bgColor=palette.paper;
  if(typeof document!=='undefined'&&document.fonts)await Promise.all([document.fonts.load('14px Camp Sans'),document.fonts.load('14px Camp Extension','丰产养割卜啄幼影扑散植牧玉田畜禽种稻翅耕苗萝途鸡鸭鹅')]).catch(()=>{});
  const loading=new L.Text();loading.text='正在载入营地…';loading.font='Camp Extension, Camp Sans, Arial';loading.fontSize=22;loading.color='#edf4da';loading.width=WIDTH;loading.align='center';loading.y=HEIGHT/2-15;L.stage.addChild(loading);
  try{await loadCampArt();loading.destroy();}catch(error){loading.text='营地素材加载未完成，请刷新重试。';throw error;}
  return new ObserverView(api);
}

export class ObserverView {
  readonly root:any; readonly scene:any; readonly camera:any;
  private labels:Record<string,any>={};private buttons:Record<string,NativeButton>={};
  private residents=new Map<string,CharacterMesh>();private objects=new Map<string,WorldMesh>();private objectSignatures=new Map<string,string>();private placeLabels=new Map<string,any>();
  private nameLabels=new Map<string,any>();private speechLabels=new Map<string,SpeechBubble>();private thoughts=new ThoughtCadence();private senseLines:any;private selection:any;
  private inspector:any;private sidebarCollapsed=true;private modalLayouts:{panel:any;width:number}[]=[];
  private get sceneLeft():number{return this.sidebarCollapsed?0:SIDE;}
  private controlPanel:any;private controlDraft=controlSettings(null);
  private memoryPanel:any;private memoryMap!:MemoryMapView;
  private planner:any;private taskNote:any;private draftResource:TaskDraft['resource']='wood';private draftAmount=8;
  private draftKind:'gather'|'craft'|ZoneKind='gather';private draftRecipe='stone_axe';private draftCrop:CropKind='rice';private draftAnimal:AnimalKind|'mixed'='mixed';
  private historyPanel:any;private workshopPanel:any;private historyFilter:JournalCategory|'all'|'summary'='action';private historyPage=0;private historyAllRuns=true;private historyDetail:HistoryRow|null=null;
  private historyRows:any[]=[];private displayedHistory:HistoryRow[]=[];private historySnapshot:JournalEntry[]|null=null;private historySnapshotScope='';private historySummaryRunId='';private historyCache='';
  private state:ViewState|null=null;private token:any;
  private worldRevision='';private senseRevision='';private hudRevision='';private mapRevision='';private hudDirty=true;private highQuality=false;
  private offset={x:-3,z:-2};private drag:{id?:number;x:number;y:number;ox:number;oz:number;moved:boolean;travel?:number}|null=null;
  private residentDetails:any;private objectDetails:any;private inventoryPanel:any;
  private statBars:any[]=[];private statValues:any[]=[];private selectedObject:string|null=null;
  private nightShade:any;private daylightLight:any;private lifePanel:any;private statusPanel:any;private inventoryScroll:NativeTextScroll|null=null;private lifeScroll:NativeTextScroll|null=null;private statusScroll:NativeTextScroll|null=null;private taskScroll:NativeTextScroll|null=null;
  private resourceRail:any;private resourceExpanded=true;private showRoofs=true;private showZones=false;
  private zoneOverlay:any;private zoneDrawing=false;private zoneStart:{x:number;z:number}|null=null;private zoneDraft:ResidentialBounds|null=null;private zoneRevision='';
  private pinch:MapPinch|null=null;private pendingPinch:MapTouch[]|null=null;private suppressTap=false;private minimap:Minimap|null=null;
  private art:PaintedWorld;private markers:any;private sceneInput:any;private zoom=DEFAULT_MAP_ZOOM;private yaw=0;private captionPanel:any;

  constructor(private api:ViewCallbacks){
    this.scene=new L.Scene3D();this.scene.name='Survive — 认知观察场';L.stage.addChild(this.scene);
    this.scene.ambientMode=0;this.scene.ambientColor=new L.Color(.56,.59,.64,1);this.scene.enableFog=false;
    this.camera=new L.Camera(0,.1,160);this.scene.addChild(this.camera);
    this.camera.clearColor=new L.Color(.16,.19,.19,1);this.camera.clearFlag=L.CameraClearFlags.SolidColor;
    this.camera.orthographic=true;this.camera.orthographicVerticalSize=this.zoom;
    this.camera.normalizedViewport=new L.Viewport(this.sceneLeft/WIDTH,TOP/HEIGHT,(WIDTH-this.sceneLeft)/WIDTH,(BOTTOM-TOP)/HEIGHT);
    this.camera.enableHDR=false;this.camera.enableBuiltInRenderTexture=true;
    try{this.highQuality=globalThis.localStorage?.getItem('survive_render_quality_v1')==='fine';}catch{}
    this.applyQuality();
    this.moveCamera();
    const light=new L.Sprite3D('Daylight');this.scene.addChild(light);
    light.transform.rotationEuler=new L.Vector3(-55,25,0);const dl=light.addComponent(L.DirectionLightCom);this.daylightLight=dl;dl.color=new L.Color(1,.92,.76,1);dl.intensity=.65;
    this.scene.addChild(createTerrain(L));
    this.senseLines=new L.PixelLineSprite3D(1200,'有限感知参考');this.scene.addChild(this.senseLines);
    this.selection=new L.PixelLineSprite3D(72,'selected resident');this.scene.addChild(this.selection);
    try{this.showRoofs=globalThis.localStorage?.getItem('survive_roofs_v1')!=='hidden';}catch{}
    try{this.showZones=globalThis.localStorage?.getItem('survive_zones_v1')==='shown';}catch{}
    this.art=new PaintedWorld();L.stage.addChild(this.art.root);
    this.zoneOverlay=new L.Sprite();this.zoneOverlay.name='Residential zone overlay';this.zoneOverlay.mouseEnabled=false;L.stage.addChild(this.zoneOverlay);
    this.root=new L.Sprite();this.root.name='Observer UI';L.stage.addChild(this.root);
    this.nightShade=new L.Sprite();this.nightShade.mouseEnabled=false;this.root.addChild(this.nightShade);
    this.buildUI();this.layoutInspector();
    L.InputManager.multiTouchEnabled=true;
    L.stage.on(L.Event.MOUSE_MOVE,this,(e:any)=>this.pointerMove(e));
    L.stage.on(L.Event.MOUSE_UP,this,(e:any)=>this.pointerUp(e));
    L.stage.on(L.Event.RESIZE,this,()=>{this.resetMapGesture();this.moveCamera();this.positionLabels();});
    const wx=(globalThis as any).wx;if(wx?.onHide)wx.onHide(()=>this.resetMapGesture());else globalThis.addEventListener?.('blur',()=>this.resetMapGesture());
  }

  private color(hex:string,alpha=1):any{const h=parseInt(hex.slice(1),16);return new L.Color((h>>16&255)/255,(h>>8&255)/255,(h&255)/255,alpha);}
  private text(parent:any,text:string,x:number,y:number,size=16,color=palette.ink,width=250):any{
    const t=new L.Text();t.text=text;t.pos(x,y);t.font='Camp Extension, Camp Sans, Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif';t.fontSize=size;t.color=color;t.width=width;t.wordWrap=true;t.leading=5;t.mouseEnabled=false;parent.addChild(t);return t;
  }
  private panel(parent:any,x:number,y:number,w:number,h:number,color:string,r=0):any{
    const s=new L.Sprite();s.pos(x,y);s.size(w,h);
    if(r){s.graphics.drawRoundRect(0,3,w,h,r,r,r,r,'rgba(9,28,40,0.24)');s.graphics.drawRoundRect(0,0,w,h,r,r,r,r,color,'#8299a6',1.3);s.graphics.drawRoundRect(2,2,w-4,Math.min(14,h/3),r-1,r-1,0,0,'rgba(221,239,250,0.07)');}else s.graphics.drawRect(0,0,w,h,color);
    parent.addChild(s);return s;
  }
  private button(id:string,text:string,x:number,y:number,w:number,click:()=>void,bright=false):NativeButton{
    const h=42,r=this.panel(this.root,x,y,w,h,bright?palette.mint:palette.line,12);r.mouseEnabled=true;r.name=id;r.hitArea=new L.Rectangle(0,0,w,h);
    r.graphics.drawRoundRect(2,2,w-4,16,10,10,3,3,bright?'#ccea98':'#436985');
    const glyphs:Record<string,string>={quickHistory:'▤',quickMap:'◈',quickSenses:'◉',start:'▶',pause:'Ⅱ',retry:'⟳',stop:'■',workshop:'⚒',tasks:'▦',rotateLeft:'↶',rotateReset:'⟳',rotateRight:'↷',connect:'↗',control:'⚙',stockToggle:'▣'};
    const glyph=glyphs[id],inset=glyph?25:0;
    if(glyph){const icon=this.text(r,glyph,9,8,21,bright?'#264628':'#f1f6f8',26);icon.align='center';icon.bold=true;}
    const t=this.text(r,text,inset,12,14,bright?'#263e2c':'#f5f8fc',w-inset-3);t.align='center';t.bold=true;t.mouseEnabled=false;
    r.on(L.Event.MOUSE_DOWN,this,()=>r.alpha=.82);r.on(L.Event.MOUSE_UP,this,()=>r.alpha=1);r.on(L.Event.MOUSE_OUT,this,()=>r.alpha=1);
    r.on(L.Event.CLICK,this,()=>{this.hudDirty=true;click();});const b={root:r,label:t,set:(s:string)=>t.text=s};this.buttons[id]=b;return b;
  }

  private buildUI():void{
    this.inspector=new L.Sprite();this.inspector.name='Resident inspector';this.inspector.zOrder=10;this.root.addChild(this.inspector);
    this.panel(this.root,0,0,WIDTH,TOP,palette.paper);this.panel(this.inspector,0,TOP,SIDE,HEIGHT-TOP,palette.panel);
    this.panel(this.root,0,BOTTOM,WIDTH,HEIGHT-BOTTOM,palette.paper);
    this.panel(this.root,0,TOP-1,WIDTH,1,'#535b58');
    this.text(this.root,'SURVIVE',72,7,34,palette.ink,230).bold=true;
    this.text(this.root,'边境营地 · 生存与建造',74,43,14,palette.muted,240);
    drawIcon(this.root,'leaf',19,10,45);
    this.labels.mode=this.text(this.root,'等待连接真实模型',350,13,17,palette.ink,430);
    this.labels.status=this.text(this.root,'世界尚未启动',350,40,12,'#b4b7a8',700);this.labels.status.height=34;this.labels.status.leading=3;this.labels.status.mouseEnabled=true;this.labels.status.hitArea=new L.Rectangle(0,0,744,37);this.labels.status.on(L.Event.CLICK,this,()=>{this.hideModals();this.statusPanel.visible=true;});
    this.labels.time=this.text(this.root,'模拟 00:00',999,17,21,palette.ink,191);this.labels.time.align='right';
    this.button('control','设置',1207,12,61,()=>{this.controlDraft=controlSettings(this.state?.control);this.hideModals();this.controlPanel.visible=true;});
    const inspectorStart=this.root.numChildren;
    this.button('nextResident','下一位',187,89,85,()=>this.nextResident());
    this.button('resident0','居民 A',18,129,121,()=>this.selectIndex(this.residentPage()));this.button('resident1','居民 B',151,129,121,()=>this.selectIndex(this.residentPage()+1));
    this.residentDetails=new L.Sprite();this.root.addChild(this.residentDetails);const detailStart=this.root.numChildren;
    this.labels.person=this.text(this.root,'选择居民',22,181,24,'#f1f4dc',248);this.labels.person.bold=true;
    this.labels.personality=this.text(this.root,'',22,215,13,palette.muted,248);this.labels.personality.height=18;this.labels.personality.overflow='hidden';
    const section=(y:number,h:number,title:string,icon:string)=>{const card=this.panel(this.root,16,y,260,h,'#343e41',5);card.graphics.drawRoundRect(0,0,260,h,5,5,5,5,null,'#52605b',1);drawIcon(this.root,icon,27,y+10,20);this.text(this.root,title,55,y+12,14,palette.mint,205);};
    section(242,158,'身体与心情','health');
    ['health','hunger','mood','fatigue'].forEach((kind,i)=>{const y=279+i*27;drawIcon(this.root,kind,28,y-3,19);this.text(this.root,['生命','饱腹感','心情','精力'][i],54,y,14,palette.ink,75);const value=this.text(this.root,'',185,y,13,palette.ink,75);value.align='right';this.statValues.push(value);const bar=new L.Sprite();bar.pos(99,y+5);this.root.addChild(bar);this.statBars.push(bar);});
    section(410,98,'随身携带','bag');
    this.button('inventory','查看物品',172,416,94,()=>{this.hideModals();this.inventoryPanel.visible=true;});
    ['wood','stone','food'].forEach((kind,i)=>{drawIcon(this.root,kind,29+i*82,455,21);this.labels['carry-'+kind]=this.text(this.root,'0',55+i*82,454,17,palette.ink,50);this.text(this.root,['木材','石料','食物'][i],28+i*82,479,12,palette.muted,75);});
    this.labels.equipment=this.text(this.root,'',28,494,11,palette.muted,232);this.labels.equipment.height=16;this.labels.equipment.overflow='hidden';
    section(518,130,'心愿与活动','eye');this.button('lifeDetails','生活详情',177,523,89,()=>{this.hideModals();this.lifePanel.visible=true;});
    this.labels.goal=this.text(this.root,'',28,552,14,palette.ink,232);this.labels.goal.height=36;this.labels.goal.overflow='hidden';
    this.labels.action=this.text(this.root,'',28,592,13,palette.amber,232);this.labels.action.height=18;this.labels.action.overflow='hidden';
    this.labels.perception=this.text(this.root,'',28,621,12,palette.muted,232);this.labels.perception.height=18;this.labels.perception.overflow='hidden';
    this.button('history','档案',18,667,79,()=>this.openHistory(),true);
    this.button('memoryMap','地图',105,667,79,()=>{this.hideModals();this.memoryPanel.visible=true;},true);
    this.button('senses','感官',192,667,80,()=>this.api.onToggleSenses());
    const detailNodes=[];for(let i=detailStart;i<this.root.numChildren;i++)detailNodes.push(this.root.getChildAt(i));for(const node of detailNodes)this.residentDetails.addChild(node);
    const inspectorNodes=[];for(let i=inspectorStart;i<this.root.numChildren;i++)inspectorNodes.push(this.root.getChildAt(i));for(const node of inspectorNodes)this.inspector.addChild(node);
    this.sceneInput=new L.Sprite();this.sceneInput.name='World interaction';this.sceneInput.pos(SIDE,TOP);this.sceneInput.size(WIDTH-SIDE,BOTTOM-TOP);this.sceneInput.mouseEnabled=true;
    this.sceneInput.hitArea=new L.Rectangle(0,0,WIDTH-SIDE,BOTTOM-TOP);this.root.addChild(this.sceneInput);
    this.sceneInput.on(L.Event.MOUSE_DOWN,this,(e:any)=>this.pointerDown(e));
    this.sceneInput.on(L.Event.MOUSE_WHEEL,this,(e:any)=>{this.setZoom(this.zoom-e.delta);});
    this.markers=new L.Sprite();this.markers.mouseEnabled=false;this.root.addChild(this.markers);
    this.button('inspectorToggle','居民信息 ›',15,80,170,()=>{this.sidebarCollapsed=!this.sidebarCollapsed;this.layoutInspector();}).root.zOrder=11;
    this.captionPanel=this.panel(this.root,190,80,255,57,'#887642',9);this.captionPanel.alpha=.92;
    this.labels.caption=this.text(this.root,'两名居民 · 两棵树 · 一堵墙',202,89,13,'#fff6d5',330);
    this.labels.caption.mouseEnabled=false;
    this.button('zoomOut','−',952,81,51,()=>{this.setZoom(this.zoom+3);});
    this.button('zoomIn','＋',1011,81,51,()=>{this.setZoom(this.zoom-3);});
    this.button('rotateLeft','左转',872,133,64,()=>this.setYaw(this.yaw-Math.PI/4));
    this.button('rotateReset','复位',941,133,64,()=>this.setYaw(0));
    this.button('rotateRight','右转',1010,133,64,()=>this.setYaw(this.yaw+Math.PI/4));
    this.button('workshop','工作台配方',794,81,149,()=>{this.hideModals();this.workshopPanel.visible=true;});
    this.button('tasks','规划 / 区域',1074,81,191,()=>{this.hideModals();this.planner.visible=true;},true);
    this.button('roofToggle',this.showRoofs?'屋顶：开':'屋顶：关',1081,133,89,()=>{this.showRoofs=!this.showRoofs;this.buttons.roofToggle.set(this.showRoofs?'屋顶：开':'屋顶：关');for(const node of this.objects.values())node.setRoofVisible(this.showRoofs);this.positionLabels();try{globalThis.localStorage?.setItem('survive_roofs_v1',this.showRoofs?'shown':'hidden');}catch{}});
    this.button('zoneToggle',this.showZones?'区域：开':'区域：关',1176,133,89,()=>{this.showZones=!this.showZones;this.drawZones();this.drawMinimap();this.updateZoneHint();try{globalThis.localStorage?.setItem('survive_zones_v1',this.showZones?'shown':'hidden');}catch{}});
    this.buildResourceRail();this.buildObjectDetails();
    this.button('zoneConfirm','确认居住区',610,147,140,()=>this.commitZone()).root.visible=false;
    this.button('zoneCancel','取消圈地',759,147,120,()=>this.cancelZone()).root.visible=false;
    this.labels.zoneHint=this.text(this.root,'',320,151,14,'#fff4c2',280);this.labels.zoneHint.stroke=3;this.labels.zoneHint.strokeColor='#152d40';this.labels.zoneHint.visible=false;
    this.labels.taskSummary=this.text(this.root,'',202,114,13,'#fff6d5',560);this.labels.taskSummary.mouseEnabled=false;
    this.labels.error=this.text(this.root,'',326,494,16,'#ffe2a5',682);this.labels.error.height=148;this.labels.error.overflow='hidden';this.labels.error.mouseEnabled=false;
    this.button('quickHistory','档案',19,660,86,()=>this.openHistory());
    this.button('quickMap','地图',116,660,86,()=>{this.hideModals();this.memoryPanel.visible=true;});
    this.button('quickSenses','感官',214,660,91,()=>this.api.onToggleSenses());
    this.button('start','开始真实认知',327,660,131,()=>this.api.onStart(),true);
    this.button('pause','暂停',471,660,87,()=>{const paused=/PAUS|STOP|暂停/i.test(this.state?.status||'');paused?this.api.onResume():this.api.onPause();});
    this.button('retry','重试',572,660,87,()=>this.api.onRetry());
    this.button('stop','停止',672,660,87,()=>this.api.onStop());
    this.button('quality','画面：流畅优先',772,660,132,()=>{this.highQuality=!this.highQuality;this.applyQuality();try{globalThis.localStorage?.setItem('survive_render_quality_v1',this.highQuality?'fine':'fast');}catch{}});
    this.labels.gateway=this.text(this.root,'网关令牌',914,674,12,'#b4b7a8',84);
    this.labels.hosted=this.text(this.root,'云端模型 · 服务端连接',932,674,13,'#b4b7a8',315);this.labels.hosted.visible=false;
    this.token=new L.Input();this.token.pos(997,661);this.token.size(149,39);this.token.fontSize=14;this.token.color='#26352c';this.token.bgColor='#e0e6d9';this.token.type='password';this.token.prompt='仅存当前会话';this.token.promptColor='#7f9688';this.token.padding=[7,7,7,7];this.root.addChild(this.token);
    this.button('connect','连接',1161,660,101,()=>{const token=this.token.text;this.token.text='';this.api.onConnect(token);},true);
    this.labels.saveStatus=this.text(this.root,'本机自动存档 · 运行设置中可手动保存与读取',315,707,11,'#a6afa7',650);
    this.buildPlanner();this.buildWorkshop();this.buildHistory();this.buildMemoryMap();this.buildControl();this.buildInventory();this.buildLifeDetails();
    this.minimap=new Minimap(this.root,p=>{this.resetMapGesture();this.offset={...p};this.moveCamera();this.positionLabels();},()=>this.focusCamp());
  }

  private buildResourceRail():void{
    this.resourceRail=this.panel(this.root,1077,222,188,163,palette.panel,12);this.resourceRail.mouseEnabled=true;this.resourceRail.hitArea=new L.Rectangle(0,0,188,163);
    this.button('stockToggle','仓储 ▾',1077,179,188,()=>{this.resourceExpanded=!this.resourceExpanded;this.resourceRail.visible=this.resourceExpanded;this.buttons.stockToggle.set(this.resourceExpanded?'仓储 ▾':'仓储 ▸');});
    ['wood','stone','food'].forEach((kind,i)=>{drawIcon(this.resourceRail,kind,17,9+i*43,31);this.text(this.resourceRail,RESOURCE_LABELS[kind as TaskDraft['resource']],72,6+i*43,14,palette.muted,95);this.labels['stock-'+kind]=this.text(this.resourceRail,'0',72,23+i*43,19,palette.ink,95);});
    this.text(this.resourceRail,'已搬入仓储',18,143,13,palette.muted,150);
  }

  private renderResources(state:ViewState):void{for(const kind of ['wood','stone','food'] as const)this.labels['stock-'+kind].text=String(state.world.camp?.stock?.[kind]??0);}
  private buildObjectDetails():void{
    this.objectDetails=new L.Sprite();this.inspector.addChild(this.objectDetails);this.objectDetails.visible=false;
    this.labels.objectName=this.text(this.objectDetails,'',22,189,24,palette.ink,248);
    this.labels.objectType=this.text(this.objectDetails,'',22,223,14,palette.muted,248);
    this.panel(this.objectDetails,16,262,260,142,'#343e41',5);drawIcon(this.objectDetails,'eye',28,278,23);
    this.text(this.objectDetails,'现场信息',62,283,15,palette.mint,198);
    this.labels.objectStock=this.text(this.objectDetails,'',29,324,20,palette.amber,229);
    this.labels.objectDetail=this.text(this.objectDetails,'',24,424,15,palette.ink,244);this.labels.objectDetail.height=172;this.labels.objectDetail.overflow='hidden';
    this.labels.objectLocation=this.text(this.objectDetails,'',24,613,13,palette.muted,244);
    const back=this.button('objectBack','返回居民信息',18,667,254,()=>{this.selectedObject=null;this.senseRevision='';});this.objectDetails.addChild(back.root);
  }
  private renderObject(state:ViewState):void{
    const o=state.world.objects.find(o=>o.id===this.selectedObject);this.objectDetails.visible=!!o;this.residentDetails.visible=!o;if(!o)return;
    const names:Record<string,string>={tree:'树木',rock:'岩石',berry:'浆果丛',house:'木石小屋',plot:'住宅工地',board:'公告板 / 仓储',pond:'池塘',workbench:'工作台',wall:'石墙'};
    this.labels.objectName.text=['house','plot'].includes(o.kind)?homeDesign(o.homeDesign,o.ownerId).name:o.crop?CROP_LABELS[o.crop.kind]:o.animal?ANIMAL_LABELS[o.animal.kind]:names[o.kind];this.labels.objectType.text=o.ownerId?(state.world.residents.find(r=>r.id===o.ownerId)?.name??'居民')+'的住处':'地图物体';
    if(['tree','rock','berry'].includes(o.kind)){
      const capacity=resourceCapacity(o),resource=o.resourceKind??(o.kind==='tree'?'wood':o.kind==='rock'?'stone':'food');
      this.labels.objectStock.text=`${RESOURCE_LABELS[resource]}剩余 ${o.resources} / ${capacity}`;
      this.labels.objectDetail.text=(o.resources<=0?'已经采空。':`还可采集 ${o.resources} 份。\n剩余 ${Math.round(o.resources/capacity*100)}% · ${resourceStage(o)<=2?'已明显减少':'资源充足'}`)+'\n\n'+(o.kind==='tree'?'采伐后树冠减少，树干出现切口并倾斜；采空留下树桩。':o.kind==='rock'?'采掘后岩石逐步缩小，采空留下碎石。':'采收后枝上的浆果逐步减少。');
    }else if(o.crop){
      const c=o.crop,stage={seedling:'幼苗',growing:'生长中',mature:'已成熟',harvested:'已收割'}[c.stage];
      this.labels.objectType.text='种植区 · '+stage;this.labels.objectStock.text=c.stage==='mature'?`可收割食物 ${o.resources} 份`:c.stage==='harvested'?'休耕 · 等待重新发苗':`生长进度 ${Math.round(c.growth*100)}%`;
      this.labels.objectDetail.text='幼苗 → 生长 → 成熟 → 收割\n\n居民发现成熟作物后，可以走近收割并搬运入库。收完后休耕，再重新生长。\n已收割 '+c.cycles+' 轮';
    }else if(o.animal){
      this.labels.objectType.text='畜牧区 · 自由活动';this.labels.objectStock.text={walk:'正在散步',peck:'正在啄食',idle:'正在休息',flap:'正在扑翅'}[o.animal.activity];this.labels.objectDetail.text='在划定的畜牧区内散步、啄食和扑翅。\n\n活动随营地时间推进，暂停时一起停下。';
    }else if(['house','plot'].includes(o.kind)){
      this.labels.objectStock.text=o.kind==='house'?'已竣工 · 可进入休息':`施工 ${o.buildStage??0} / 3`;
      const project=state.world.camp?.tasks.find(t=>t.id===o.projectId);this.labels.objectDetail.text=`大小 ${o.width}×${o.depth} · ${o.homeLevel??1}级\n`+(o.kind==='house'?`整洁度 ${Math.round((o.cleanliness??1)*100)}%\n家具：${Object.entries(FURNITURE).filter(([k])=>o.furniture?.[k as keyof typeof FURNITURE]).map(([,f])=>f.label).join('、')||'尚未添置'}\n柜内：${materialText(o.stored??{})||'空'}`:`下一步：${project?houseSteps(project)[project.progress]?.label:'地基'}\n材料${project?.reserved?'已预留':'从仓储扣除'}`)+'\n\n右上角可隐藏屋顶，观察屋内生活。';
    }else{this.labels.objectStock.text=o.kind==='board'?materialText(state.world.camp?.stock??{})||'仓储暂无物资':o.kind==='pond'?'岸边可以休息':o.kind==='workbench'?'工具制作 / 物资置换':'阻挡通行与视线';this.labels.objectDetail.text=o.appearance;}
    this.labels.objectLocation.text=`位置 ${o.position.x.toFixed(1)}, ${o.position.z.toFixed(1)}`;
  }
  private renderResident(r:Resident,state:ViewState):void{
    const values=[(r.health??100)/100,1-r.hunger,r.mood??.75,1-r.fatigue];
    values.forEach((v,i)=>{v=Math.max(0,Math.min(1,v));this.statValues[i].text=Math.round(v*100)+(i===0?' / 100':'%');const g=this.statBars[i].graphics;g.clear();g.drawRect(0,0,79,6,'#222b2e');g.drawRect(0,0,79*v,6,['#9fbf97','#d5b376','#afbf89','#9cb4cb'][i]);});
    for(const kind of ['wood','stone','food'] as const)this.labels['carry-'+kind].text=String(r.supplies?.[kind]??0);
    const gear=r.character?listOwnEquipment(r.character,r.id):[];this.labels.equipment.text=`采集袋 ${r.inventory} / 30 · 物品 ${gear.length}件`;
    const stacked=state.world.residents.filter(x=>Math.hypot(x.position.x-r.position.x,x.position.z-r.position.z)<.9).length;
    this.labels.person.text=r.name;this.labels.personality.text=stacked>1?`${stacked}人重叠 · 再点角色切换`:r.homeId?'已有住处 · 可进屋休息':r.personality;
    this.labels.goal.text=residentThought(state.world,r);this.labels.goal.color=onBreak(state.world,r)?'#edb097':palette.ink;
    const observations=state.overlays[r.id]?.observations??r.observations;const o=observations.at(-1);
    this.labels.perception.text=o?(o.modality==='auditory'?'听到：'+(o.detail.heardText??'附近声音'):o.modality==='visual'?'看到：'+(Array.isArray(o.detail.appearance)?o.detail.appearance.join('；'):o.detail.appearance??'附近事物'):'感到：'+(o.detail.sensation==='hunger'?'饥饿':o.detail.sensation==='fatigue'?'疲劳':'身体状态变化')):'感知：暂无新的线索';
  }
  private buildInventory():void{
    this.inventoryPanel=this.modal('Resident inventory',735);drawIcon(this.inventoryPanel,'bag',344,168,27);
    this.labels.inventoryTitle=this.text(this.inventoryPanel,'随身物品',384,173,23,palette.ink,620);
    this.labels.inventoryBody=this.text(this.inventoryPanel,'',344,225,16,palette.ink,665);this.labels.inventoryBody.width=639;this.inventoryScroll=new NativeTextScroll(this.labels.inventoryBody,this.inventoryPanel,1002,225,276);
    this.text(this.inventoryPanel,'随身资源、包内物品与已装备物品分开记录。',344,513,13,palette.muted,655);
    this.text(this.inventoryPanel,'单指上下滑动 · 也可拖动右侧滚动条',344,558,14,palette.mint,470);
    this.modalButton(this.inventoryPanel,'inventoryClose','返回观察',883,548,144,()=>{this.inventoryPanel.visible=false;});
  }
  private renderInventory(r:Resident):void{
    const gear=r.character?listOwnEquipment(r.character,r.id):[],worn=gear.filter(g=>g.equippedSlots.length),bag=gear.filter(g=>!g.equippedSlots.length);
    const slots:Record<string,string>={leftHand:'左手',rightHand:'右手',head:'头部',torso:'身体',back:'背部'};
    this.labels.inventoryTitle.text=r.name+' · 随身物品';
    const text=`采集袋  ${r.inventory} / 30\n木材 ${r.supplies?.wood??0}    石料 ${r.supplies?.stone??0}    食物 ${r.supplies?.food??0}\n\n已装备\n${worn.map(g=>g.equippedSlots.map(s=>slots[s]).join(' / ')+' · '+g.label).join('\n')||'无'}\n\n背包内\n${bag.map(g=>'· '+g.label).join('\n')||'暂无未装备物品'}\n\n状态条越满越好：饱腹感与精力100%表示吃饱、精神充沛。`;
    if(this.labels.inventoryBody.text!==text){const scroll=this.labels.inventoryBody.scrollY;this.labels.inventoryBody.text=text;this.labels.inventoryBody.scrollY=scroll;this.inventoryScroll?.refresh();}
  }
  private buildLifeDetails():void{
    this.lifePanel=this.modal('Personal needs',735);drawIcon(this.lifePanel,'mood',344,168,27);
    this.labels.lifeTitle=this.text(this.lifePanel,'生活与心愿',384,173,23,palette.ink,620);
    this.labels.lifeBody=this.text(this.lifePanel,'',344,225,16,palette.ink,639);
    this.lifeScroll=new NativeTextScroll(this.labels.lifeBody,this.lifePanel,1002,225,300);
    this.text(this.lifePanel,'单指上下滑动 · 身体状态越满越好',344,558,13,palette.mint,470);
    this.modalButton(this.lifePanel,'lifeClose','返回观察',883,548,144,()=>{this.lifePanel.visible=false;});
    this.statusPanel=this.modal('Full phase status',735);this.text(this.statusPanel,'运行与统筹规划 · 完整信息',344,173,23,palette.ink,650);
    this.labels.statusDetails=this.text(this.statusPanel,'',344,225,16,palette.ink,639);this.statusScroll=new NativeTextScroll(this.labels.statusDetails,this.statusPanel,1002,225,300);
    this.text(this.statusPanel,'长文字可单指滑动或拖动滚动条',344,558,13,palette.mint,470);
    this.modalButton(this.statusPanel,'statusClose','返回观察',883,548,144,()=>{this.statusPanel.visible=false;});
  }
  private renderLifeDetails(r:Resident,state:ViewState):void{
    const w=state.world,h=ownHouse(w,r),project=w.camp?.tasks.find(t=>t.ownerId===r.id&&t.status==='open'),level=r.living?.desiredLevel??1;
    const design=homeDesign(h?.homeDesign,r.id),targetSize=homeSize(level,h?h.homeDesign:preferredHome(r.id).id);
    this.labels.lifeTitle.text=r.name+' · 生活与心愿';
    const furniture=h?(Object.entries(FURNITURE).map(([k,v])=>`${h.furniture?.[k as keyof typeof FURNITURE]?'✓':'○'} ${v.label} · ${v.effect}`).join('\n')):'';
    const body=`现在的心愿\n${residentThought(w,r)}\n住房喜好：${design.name}\n\n身体与心情（100%最好）\n饱腹感 ${Math.round((1-r.hunger)*100)}%    精力 ${Math.round((1-r.fatigue)*100)}%    心情 ${Math.round((r.mood??.75)*100)}%\n${onBreak(w,r)?`正在${r.living?.breakKind==='tantrum'?'冷静':'罢工'} · 还需${Math.ceil(((r.living?.breakUntil??0)-w.tick)/20)}模拟秒\n`:''}\n心情的原因\n${moodReasons(w,r).map(s=>'· '+s).join('\n')}\n\n自己的住处\n${h?`${h.width}×${h.depth} · ${h.homeLevel??1}级住宅 · 整洁度${Math.round((h.cleanliness??1)*100)}%\n${furniture}\n\n个人柜子（24份容量）\n${materialText(h.stored??{})||'暂无存放物资'}`:project?`正在施工 ${project.progress}/${project.amount} · ${houseSteps(project)[project.progress]?.label??''}`:'还没有自己的住处。请在「规划 / 居住区」圈出可用空地。'}\n\n下一步生活\n${h&&level>(h.homeLevel??1)?`希望改建到${targetSize.width}×${targetSize.depth}，先备足${materialText(houseCost(level,h.homeDesign))}并检查居住区空地。`:(h?.homeLevel===3?'目前已是宽敞住宅，继续照料家具与整洁。':'居民会逐步添置家具；住满一个模拟日后可能想扩建。')}\n夜间与精力不足时优先休息，床能加快恢复。长期缺少住房、食物和休息会降低心情；归零会短暂罢工，或在自家发脾气损坏家具。\n\n当前安排\n${r.goal}`;
    if(this.labels.lifeBody.text!==body){const y=this.labels.lifeBody.scrollY;this.labels.lifeBody.text=body;this.lifeScroll?.set(y);}
  }
  private draftZoneKind():ZoneKind{return this.draftKind==='planting'||this.draftKind==='pasture'?this.draftKind:'residential';}
  private zoneError(bounds:ResidentialBounds):string|null{return validateZone(bounds,this.draftZoneKind()==='residential'?6:4)??(this.state?zoneConflict(this.state.world,bounds,this.draftZoneKind()):null);}
  private beginZone():void{this.hideModals();this.zoneDrawing=true;this.zoneDraft=null;this.zoneStart=null;this.drag=null;this.drawZones();this.drawMinimap();this.updateZoneHint();}
  private cancelZone():void{this.zoneDrawing=false;this.zoneDraft=null;this.zoneStart=null;this.drag=null;this.hudDirty=true;this.drawZones();this.drawMinimap();this.updateZoneHint();}
  private commitZone():void{if(!this.zoneDraft||this.zoneError(this.zoneDraft))return;const kind=this.draftZoneKind(),accepted=this.api.onTask({kind,resource:kind==='residential'?'wood':'food',amount:1,note:this.taskNote?.text??'',bounds:{...this.zoneDraft},...(kind==='planting'?{cropKind:this.draftCrop}:kind==='pasture'?{animalKind:this.draftAnimal}:{})});if(accepted!==false)this.cancelZone();}
  private updateZoneHint():void{
    this.buttons.zoneCancel.root.visible=this.zoneDrawing;this.buttons.zoneConfirm.root.visible=this.zoneDrawing;this.labels.zoneHint.visible=this.zoneDrawing;
    this.buttons.zoneToggle.set(this.zoneDrawing?'区域：规划':this.showZones?'区域：开':'区域：关');
    this.buttons.zoneToggle.root.mouseEnabled=!this.zoneDrawing;
    if(!this.zoneDrawing)return;const kind=this.draftZoneKind(),error=this.zoneDraft?this.zoneError(this.zoneDraft):'单指拖出范围，再确认';
    this.buttons.zoneConfirm.set('确认'+ZONE_LABELS[kind]);this.buttons.zoneConfirm.root.mouseEnabled=!!this.zoneDraft&&!error;this.buttons.zoneConfirm.root.alpha=error ? .45 : 1;
    const detail=kind==='residential'?`约${this.state&&this.zoneDraft?homeSites(this.state.world,this.zoneDraft).length:0}间基础小屋`:kind==='planting'?CROP_LABELS[this.draftCrop]+' · 确认后播种':ANIMAL_LABELS[this.draftAnimal]+' · 确认后放养';
    this.labels.zoneHint.text=(error??`${this.zoneDraft!.maxX-this.zoneDraft!.minX}×${this.zoneDraft!.maxZ-this.zoneDraft!.minZ}格 · ${detail}`)+'\n金色当前选区 · 同类可重叠';
  }
  private drawZones():void{
    const zones=this.state?.world.camp?.zones??[],viewport=this.mapViewport(),key=JSON.stringify([zones.map(z=>[z.bounds,zoneKind(z)]),this.zoneDraft,this.zoneDrawing,this.showZones,this.draftZoneKind(),this.mapCamera(),viewport]);if(key===this.zoneRevision)return;this.zoneRevision=key;
    this.zoneOverlay.visible=this.showZones||this.zoneDrawing;this.zoneOverlay.pos(viewport.x,viewport.y);this.zoneOverlay.scrollRect=new L.Rectangle(0,0,viewport.width,viewport.height);const g=this.zoneOverlay.graphics;g.clear();if(!this.zoneOverlay.visible)return;
    const project=(p:{x:number;z:number})=>{const q=this.project({...p,y:.055});return {x:q.x-viewport.x,y:q.y-viewport.y};};
    const corners=(b:ResidentialBounds)=>[{x:b.minX,z:b.minZ},{x:b.maxX,z:b.minZ},{x:b.maxX,z:b.maxZ},{x:b.minX,z:b.maxZ}].map(project);
    const line=(a:{x:number;z:number},b:{x:number;z:number},color:string,width:number)=>{const p=project(a),q=project(b);g.drawLine(p.x,p.y,q.x,q.y,color,width);};
    for(const kind of ['residential','planting','pasture'] as const){
      const union=zoneOverlayGeometry(zones.filter(z=>zoneKind(z)===kind).map(z=>z.bounds)),color={residential:'#d4bceb',planting:'#d6ed9b',pasture:'#f2d49b'}[kind],fill={residential:'rgba(174,133,204,0.10)',planting:'rgba(133,174,81,0.10)',pasture:'rgba(221,174,93,0.10)'}[kind];
      for(const b of union.fills)g.drawPoly(0,0,corners(b).flatMap(p=>[p.x,p.y]),fill);
      for(const [a,b]of union.edges)line(a,b,'rgba(37,52,36,0.75)',4);
      for(const [a,b]of union.edges)line(a,b,color,2);
    }
    if(this.zoneDraft){
      const b=this.zoneDraft,invalid=!!this.zoneError(b),points=corners(b),flat=points.flatMap(p=>[p.x,p.y]),border=invalid?'#ff8f9a':'#ffe88a';
      g.drawPoly(0,0,flat,invalid?'rgba(255,71,93,0.22)':'rgba(255,215,102,0.16)','#30230c',5);g.drawPoly(0,0,flat,null,border,2);
      for(let x=Math.ceil(b.minX/2)*2;x<b.maxX;x+=2)line({x,z:b.minZ},{x,z:b.maxZ},invalid?'rgba(255,200,205,0.5)':'rgba(255,238,183,0.4)',1);
      for(let z=Math.ceil(b.minZ/2)*2;z<b.maxZ;z+=2)line({x:b.minX,z},{x:b.maxX,z},invalid?'rgba(255,200,205,0.5)':'rgba(255,238,183,0.4)',1);
      for(const p of points)g.drawCircle(p.x,p.y,4,border,'#30230c',2);
    }
  }

  private applyQuality():void{this.camera.msaa=this.highQuality;L.stage.frameRate=this.highQuality?L.Stage.FRAME_FAST:L.Stage.FRAME_SLOW;this.buttons.quality?.set(this.highQuality?'画面：精细优先':'画面：流畅优先');}
  private layoutInspector():void{
    const left=this.sceneLeft;this.inspector.visible=!this.sidebarCollapsed;
    for(const id of ['quickHistory','quickMap'])this.buttons[id].root.visible=this.sidebarCollapsed;this.buttons.quickSenses.root.visible=true;this.buttons.quickSenses.root.pos(this.sidebarCollapsed?214:21,this.sidebarCollapsed?660:87);this.buttons.quickSenses.root.visible=this.sidebarCollapsed;
    this.camera.normalizedViewport=new L.Viewport(left/WIDTH,TOP/HEIGHT,(WIDTH-left)/WIDTH,(BOTTOM-TOP)/HEIGHT);
    this.sceneInput.pos(left,TOP);this.sceneInput.size(WIDTH-left,BOTTOM-TOP);this.sceneInput.hitArea=new L.Rectangle(0,0,WIDTH-left,BOTTOM-TOP);
    this.labels.caption.x=this.sidebarCollapsed?202:315;this.labels.taskSummary.x=this.sidebarCollapsed?202:320;this.captionPanel.visible=this.sidebarCollapsed;
    for(const {panel,width}of this.modalLayouts)panel.x=left+(WIDTH-left-width)/2-320;
    this.applyQuality();this.updateInspectorButton();if(this.nightShade){this.nightShade.graphics.clear();this.nightShade.graphics.drawRect(this.sceneLeft,TOP,WIDTH-this.sceneLeft,BOTTOM-TOP,'#0c1734');}this.resetMapGesture();this.moveCamera();this.positionLabels();
  }
  private updateInspectorButton():void{const r=this.state?.world.residents.find(r=>r.id===this.state?.selectedId);this.buttons.inspectorToggle.set(this.sidebarCollapsed?(this.selectedObject?'物体':r?.name??'居民')+' · 信息 ›':'‹ 收起信息');}
  private hideModals():void{this.hudDirty=true;for(const panel of [this.planner,this.workshopPanel,this.historyPanel,this.memoryPanel,this.controlPanel,this.inventoryPanel,this.lifePanel,this.statusPanel])if(panel)panel.visible=false;}
  private modal(name:string,width=910):any{const p=new L.Sprite();p.name=name;p.zOrder=20;this.root.addChild(p);this.modalLayouts.push({panel:p,width});const background=this.panel(p,320,145,width,450,palette.panel,12);background.mouseEnabled=true;background.hitArea=new L.Rectangle(0,0,width,450);p.visible=false;return p;}
  private modalButton(parent:any,id:string,label:string,x:number,y:number,w:number,fn:()=>void,bright=true):NativeButton{const b=this.button(id,label,x,y,w,fn,bright);parent.addChild(b.root);return b;}
  private buildPlanner():void{
    this.planner=this.modal('Camp planner');
    this.text(this.planner,'规划营地',344,166,23,'#f1f4dc',500);
    this.text(this.planner,'把目标写上公告板，居民亲自阅读后，自主接取、备料与执行。',344,205,13,palette.muted,840);
    const add=(id:string,label:string,x:number,y:number,w:number,fn:()=>void)=>this.modalButton(this.planner,id,label,x,y,w,fn);
    for(const [i,kind]of (['gather','craft','residential','planting','pasture'] as const).entries())add('kind-'+kind,['采集','制作','居住区','种植区','畜牧区'][i],344+i*76,239,70,()=>{this.draftKind=kind;});
    this.labels.draftTitle=this.text(this.planner,'',344,292,17,'#f1f4dc',385);
    for(const [i,resource]of (['wood','stone','food'] as const).entries())add('task-'+resource,RESOURCE_LABELS[resource],344+i*125,330,115,()=>{this.draftResource=resource;});
    for(const [i,recipe]of RECIPES.filter(r=>r.kind==='craft').entries())add('recipe-'+recipe.id,recipe.label,344+i*184,330,174,()=>{this.draftRecipe=recipe.id;});
    for(const [i,kind]of (['rice','wheat','corn','carrot'] as const).entries())add('crop-'+kind,CROP_LABELS[kind],344+i*96,330,86,()=>{this.draftCrop=kind;});
    for(const [i,kind]of (['chicken','duck','goose','mixed'] as const).entries())add('animal-'+kind,kind==='mixed'?'混养':ANIMAL_LABELS[kind],344+i*96,330,86,()=>{this.draftAnimal=kind;});
    this.labels.zonePlanner=this.text(this.planner,'',344,329,14,palette.mint,374);
    add('amount','数量 8',344,379,110,()=>{this.draftAmount=this.draftKind==='craft'?(this.draftAmount>=3?1:this.draftAmount+1):(this.draftAmount>=20?4:this.draftAmount+4);});
    this.labels.requirements=this.text(this.planner,'',469,379,12,'#c9d8bd',250);this.labels.requirements.height=40;
    this.taskNote=new L.Input();this.taskNote.pos(344,430);this.taskNote.size(374,36);this.taskNote.fontSize=14;this.taskNote.color='#26352c';this.taskNote.bgColor='#e0e6d9';this.taskNote.prompt='目标说明（可选）';this.taskNote.maxChars=120;this.planner.addChild(this.taskNote);
    this.labels.draftHelp=this.text(this.planner,'',344,481,12,palette.muted,380);this.labels.draftHelp.height=43;
    this.text(this.planner,'已发布的目标',756,246,14,palette.mint,430);
    this.text(this.planner,'上下滑动查看全部',1030,248,12,palette.muted,174);
    this.labels.taskList=this.text(this.planner,'',756,282,14,'#e5f1df',421);this.taskScroll=new NativeTextScroll(this.labels.taskList,this.planner,1186,282,207);
    this.labels.stock=this.text(this.planner,'',756,496,13,palette.amber,442);
    add('publishTask','发布目标',344,535,204,()=>{if(this.draftKind!=='gather'&&this.draftKind!=='craft'){this.beginZone();return;}this.api.onTask({kind:this.draftKind,resource:this.draftResource,amount:this.draftKind==='craft'?Math.min(3,this.draftAmount):this.draftAmount,note:this.taskNote.text,recipeId:this.draftRecipe});this.taskNote.text='';});
    add('closeTasks','返回观察',1062,535,142,()=>{this.planner.visible=false;});
    this.labels.taskNotice=this.text(this.planner,'',565,538,11,palette.amber,480);this.labels.taskNotice.height=35;
  }
  private buildWorkshop():void{
    this.workshopPanel=this.modal('Recipe book',735);
    this.text(this.workshopPanel,'工作台 · 配方与置换',344,168,23,'#f1f4dc',650);
    this.text(this.workshopPanel,'居民必须靠近工作台读取配方，备齐随身材料，再由自己决定合成。',344,205,13,palette.muted,665);
    RECIPES.forEach((recipe,i)=>{const y=244+i*53;this.text(this.workshopPanel,recipe.label,344,y,16,palette.mint,155);this.text(this.workshopPanel,materialText(recipe.cost)+' → '+(recipe.item?recipe.label:materialText(recipe.output!)),512,y,14,'#eff4df',510);this.text(this.workshopPanel,recipe.effect,512,y+23,11,palette.muted,510);});
    this.text(this.workshopPanel,'制作、建造每获得3点熟练度升1级，每级缩短4%耗时，最高5级。',344,516,11,palette.muted,650);
    this.modalButton(this.workshopPanel,'workshopGoal','发布制作目标',344,545,175,()=>{this.hideModals();this.draftKind='craft';this.draftAmount=1;this.planner.visible=true;});
    this.modalButton(this.workshopPanel,'closeWorkshop','返回观察',881,545,147,()=>{this.workshopPanel.visible=false;});
  }
  private renderTaskList(state:ViewState):void{
    const text=[...(state.world.camp?.tasks??[])].reverse().map(t=>`${t.status==='done'?'✓':'○'} ${taskTitle(t)} ${t.progress}/${t.amount}${t.kind==='house'&&t.status==='open'?' · 待'+(houseSteps(t)[t.progress]?.label??'下一阶段'):''}\n   ${t.kind==='planting'?'已播种':t.kind==='pasture'?'已放养':t.acceptedBy.map(id=>state.world.residents.find(r=>r.id===id)?.name).join('、')||'尚无人接受'}${t.note?' · '+t.note:''}`).join('\n\n')||'还没有发布目标。';
    if(this.labels.taskList.text!==text){const y=this.labels.taskList.scrollY;this.labels.taskList.text=text;this.taskScroll?.set(y);}
  }
  private residentPage():number{return Math.floor(Math.max(0,this.state?.world.residents.findIndex(r=>r.id===this.state?.selectedId)??0)/2)*2;}
  private nextResident():void{const w=this.state?.world;if(w)this.selectIndex((w.residents.findIndex(r=>r.id===this.state?.selectedId)+1)%w.residents.length);}
  private buildControl():void{
    this.controlPanel=this.modal('Control settings');
    this.text(this.controlPanel,'运行设置 · 玩家布置任务，居民执行',344,167,22,'#f1f4dc',845);
    for(const [i,mode]of (['commander','independent','local'] as const).entries())this.modalButton(this.controlPanel,'mode-'+mode,['模型统筹（默认）','独立居民','本地算法'][i],344+i*290,218,276,()=>{this.controlDraft.mode=mode;});
    this.labels.controlHelp=this.text(this.controlPanel,'',344,270,14,palette.muted,835);this.labels.controlHelp.height=85;
    this.modalButton(this.controlPanel,'phaseSize','',344,365,264,()=>{this.controlDraft.phaseUnits=this.controlDraft.phaseUnits===4?8:4;});
    this.modalButton(this.controlPanel,'reviewGap','',628,365,285,()=>{const a=[30,60,120] as const;this.controlDraft.reviewSeconds=a[(a.indexOf(this.controlDraft.reviewSeconds)+1)%3];});
    this.modalButton(this.controlPanel,'crewCount','',933,365,270,()=>{const a=[2,4,6] as const;this.controlDraft.residents=a[(a.indexOf(this.controlDraft.residents)+1)%3];});
    this.modalButton(this.controlPanel,'localFallback','',344,416,420,()=>{this.controlDraft.fallback=!this.controlDraft.fallback;});
    this.modalButton(this.controlPanel,'remoteRetry','重新尝试远程统筹',790,416,413,()=>{this.api.onRemoteRetry?.();});
    this.text(this.controlPanel,'应用设置保留现场与私人记忆；人数仅在“新营地”生效。新营地会重置当前世界。',344,476,13,palette.amber,850);
    this.modalButton(this.controlPanel,'saveCamp','保存进度',344,500,125,()=>this.api.onSave?.());
    this.modalButton(this.controlPanel,'loadCamp','读取存档',482,500,125,()=>{this.api.onLoad?.();this.controlPanel.visible=false;});
    this.labels.saveDetail=this.text(this.controlPanel,'',626,498,12,palette.mint,578);this.labels.saveDetail.height=40;
    this.modalButton(this.controlPanel,'applyControl','应用设置',344,545,265,()=>{this.api.onControl?.(this.controlDraft);this.controlPanel.visible=false;});
    this.modalButton(this.controlPanel,'newCamp','新营地（重置）',631,545,285,()=>{this.api.onControl?.(this.controlDraft,true);this.controlPanel.visible=false;});
    this.modalButton(this.controlPanel,'closeControl','返回观察',936,545,266,()=>{this.controlPanel.visible=false;});
  }
  private buildMemoryMap():void{
    this.memoryPanel=this.modal('Personal map memory');
    this.text(this.memoryPanel,'地图记忆 · 每个人记住的世界不同',344,166,22,'#f1f4dc',840);
    this.text(this.memoryPanel,'记录本人走过与看见的地方；文字记忆另存对话、约定、行动结果和重要经历。',344,207,12,palette.muted,852);
    this.memoryMap=new MemoryMapView(this.memoryPanel);
    this.modalButton(this.memoryPanel,'memoryPerson0','阿林的地图',344,545,167,()=>this.selectIndex(this.residentPage()));
    this.modalButton(this.memoryPanel,'memoryPerson1','小禾的地图',525,545,167,()=>this.selectIndex(this.residentPage()+1));
    this.modalButton(this.memoryPanel,'memoryArchive','文字记忆 / 档案',707,545,198,()=>{this.historyFilter='memory';this.openHistory();});
    this.modalButton(this.memoryPanel,'memoryNext','下一位',923,545,124,()=>this.nextResident());
    this.modalButton(this.memoryPanel,'closeMemory','返回观察',1061,545,143,()=>{this.memoryPanel.visible=false;});
  }
  private refreshHistory():void{this.historySnapshot=null;this.historyPage=0;this.historyDetail=null;this.historyCache='';}
  private openHistory():void{this.hideModals();this.historyPanel.visible=true;this.refreshHistory();}
  private buildHistory():void{
    this.historyPanel=this.modal('Resident history');
    this.labels.historyTitle=this.text(this.historyPanel,'居民档案',344,166,22,'#f1f4dc',840);
    this.labels.historyMeta=this.text(this.historyPanel,'',344,202,11,palette.muted,852);this.labels.historyMeta.height=25;this.labels.historyMeta.overflow='hidden';
    for(const [i,filter]of (['summary','action','decision','speech','memory','all'] as const).entries())this.modalButton(this.historyPanel,'history-'+filter,['阶段总结','实际行动','模型计划','已说出口','私人记忆','全部流水'][i],344+i*110,231,100,()=>{this.historyFilter=filter;this.historyPage=0;this.historyDetail=null;this.historyCache='';});
    this.modalButton(this.historyPanel,'historyScope','全部轮次',1004,231,199,()=>{if(this.historyFilter==='summary'){const runs=this.historyRuns();const i=runs.indexOf(this.historySummaryRunId);this.historySummaryRunId=runs[(i+1)%runs.length]??'';this.historyPage=0;this.historyDetail=null;this.historyCache='';}else{this.historyAllRuns=!this.historyAllRuns;this.refreshHistory();}});
    for(let i=0;i<5;i++){
      const row=this.panel(this.historyPanel,344,280+i*45,860,39,'#234144',6);row.mouseEnabled=true;row.hitArea=new L.Rectangle(0,0,860,39);
      const heading=this.text(row,'',10,4,10,palette.mint,820),body=this.text(row,'',10,19,12,'#e5f1df',822);heading.height=14;heading.overflow='hidden';body.height=16;body.overflow='hidden';
      row.on(L.Event.CLICK,this,()=>{this.hudDirty=true;this.historyDetail=this.displayedHistory[this.historyPage*5+i]??null;this.labels.historyDetail.scrollY=0;this.historyCache='';});this.historyRows.push({root:row,heading,body});
    }
    this.labels.historyDetail=this.text(this.historyPanel,'',350,282,14,'#e5f1df',842);this.labels.historyDetail.height=222;this.labels.historyDetail.overflow='scroll';
    this.labels.historyEmpty=this.text(this.historyPanel,'',355,310,16,'#e5f1df',820);this.labels.historyEmpty.height=170;this.labels.historyEmpty.overflow='hidden';
    this.labels.historyCount=this.text(this.historyPanel,'',344,514,11,palette.muted,850);this.labels.historyCount.height=23;this.labels.historyCount.overflow='hidden';
    this.modalButton(this.historyPanel,'historyNewer','上一页',344,545,116,()=>this.turnHistory(-1));
    this.modalButton(this.historyPanel,'historyOlder','下一页',472,545,116,()=>this.turnHistory(1));
    this.modalButton(this.historyPanel,'historyBack','返回列表',600,545,116,()=>{this.historyDetail=null;this.historyCache='';});
    this.modalButton(this.historyPanel,'summaryGenerate','生成 / 更新总结',730,545,175,()=>{
      const s=this.state;if(!s||s.summaryBusy||s.mode==='REPLAY')return;const r=s.world.residents.find(r=>r.id===s.selectedId)!;
      const request=summaryInput(this.historySnapshot??[],r.id,r.name,this.historySummaryRunId||s.world.runId,false);
      if(request)this.api.onSummarize?.(request);
    });
    this.modalButton(this.historyPanel,'historyRefresh','载入新记录',918,545,132,()=>this.refreshHistory());
    this.modalButton(this.historyPanel,'closeHistory','返回观察',1062,545,142,()=>{this.historyPanel.visible=false;});
    this.historyPanel.on(L.Event.MOUSE_WHEEL,this,(e:any)=>{this.turnHistory(e.delta<0?1:-1);e.stopPropagation();});
  }
  private historyRuns():string[]{
    const s=this.state;if(!s)return [];
    const saved=(s.summaries??[]).filter(e=>e.response.residentId===s.selectedId&&(s.mode!=='REPLAY'||e.response.runId===s.world.runId&&e.response.throughTick<=s.world.tick)).map(e=>e.response.runId);
    return [...new Set([...saved,...(this.historySnapshot??[]).filter(e=>e.residentId===s.selectedId&&(s.mode!=='REPLAY'||e.runId===s.world.runId)).map(e=>e.runId)])].reverse();
  }
  private turnHistory(direction:number):void{this.hudDirty=true;
    if(this.historyDetail){const t=this.labels.historyDetail;t.scrollY=Math.max(0,Math.min(Math.max(0,t.textHeight-t.height),t.scrollY+direction*180));return;}
    this.historyPage=Math.max(0,Math.min(Math.max(0,Math.ceil(this.displayedHistory.length/5)-1),this.historyPage+direction));this.historyCache='';
  }
  private renderHistory(state:ViewState):void{
    if(!this.historyPanel.visible)return;
    const replay=state.mode==='REPLAY',scopeKey=[state.selectedId,state.mode,replay?state.world.tick:'live',this.historyAllRuns].join('|');
    if(!this.historySnapshot||this.historySnapshotScope!==scopeKey){
      this.historySnapshot=(state.history??[]).filter(e=>(!replay||e.tick<=state.world.tick&&e.runId===state.world.runId)).slice();
      this.historySnapshotScope=scopeKey;this.historyPage=0;this.historyDetail=null;this.historyCache='';
    }
    const key=[state.summaryVersion,state.summaryBusy,state.summaryError,state.historyVersion,state.selectedId,this.historyFilter,this.historyPage,this.historyAllRuns,this.historyDetail?.id,state.mode,state.historyWarning,this.historySnapshotScope].join('|');if(this.historyCache===key)return;this.historyCache=key;
    const r=state.world.residents.find(r=>r.id===state.selectedId)!;
    const rows=selectJournal(this.historySnapshot,r.id,this.historyFilter==='summary'?'all':this.historyFilter,replay||!this.historyAllRuns?state.world.runId:undefined,replay?state.world.tick:Infinity);
    this.displayedHistory=rows.map(e=>({...e,title:`${journalTime(e.tick)}  ${JOURNAL_LABELS[e.category]}${e.source?' · '+({REAL_MODEL:'独立真实模型',MODEL_DIRECTED:'模型统筹 / 执行器',LOCAL_ALGORITHM:'本地算法',MOCK_TEST:'Mock 测试'}[e.source]??e.source):''}${e.runId!==state.world.runId?' · 之前轮次':''}`}));
    const own=this.historySnapshot.filter(e=>e.residentId===r.id);
    const runs=this.historyRuns();
    if(!runs.includes(this.historySummaryRunId)){
      const saved=(state.summaries??[]).filter(s=>s.response.residentId===r.id&&runs.includes(s.response.runId)).at(-1);
      this.historySummaryRunId=saved?.response.runId??runs[0]??state.world.runId;
    }
    const runId=replay?state.world.runId:this.historySummaryRunId;
    const report=latestSummary(state.summaries??[],r.id,runId,replay?state.world.tick:Infinity);
    let hint='实际行动与未执行计划分开查看；列表固定，点击「载入新记录」更新。';
    if(this.historyFilter==='summary'){
      this.displayedHistory=[];
      if(report){
        const labels={progress:'★ 关键进展',setback:'! 问题 / 阻碍',plan:'○ 待执行计划',social:'交流',observation:'观察'};
        const add=(id:string,title:string,text:string,ids:string[])=>{const evidence=ids.map(id=>report.entries.find(e=>e.id===id)).filter(Boolean) as JournalEntry[];this.displayedHistory.push({id,runId:report.response.runId,tick:report.response.throughTick,residentId:r.id,category:'world',title,text,evidence});};
        add('overview:'+report.response.requestId,'阶段总览 · '+report.response.summary.headline,report.response.summary.overview,[]);
        report.response.summary.highlights.forEach((p,i)=>add(report.response.requestId+':h'+i,labels[p.kind]+' · '+p.title,p.detail,p.evidenceIds));
        report.response.summary.nextFocus.forEach((p,i)=>add(report.response.requestId+':n'+i,'→ 后续关注 · 尚未完成',p.text,p.evidenceIds));
        hint=`glm-4.5-air · ${report.entries.length}条记录 · ${journalTime(report.response.fromTick)}—${journalTime(report.response.throughTick)} · ${runId===state.world.runId?'本轮':'之前轮次'}；点击关键点查看原始依据`;
      }else hint='总结按单个居民、单轮最多120条记录生成，优先实际行动和计划；原始记录可翻阅。';
    }
    const pages=Math.max(1,Math.ceil(this.displayedHistory.length/5));this.historyPage=Math.min(this.historyPage,pages-1);
    this.labels.historyTitle.text=r.name+'的档案 · '+(this.historyFilter==='summary'?'阶段总结与关键进展':'点击记录查看详情');
    this.labels.historyMeta.text=hint;
    this.buttons.historyScope.set(replay?'回放此刻以前':this.historyFilter==='summary'?(runId===state.world.runId?'本轮':'之前轮次')+` · 切换 ${runs.indexOf(runId)+1}/${runs.length||1}`:this.historyAllRuns?'全部轮次（含旧档）':'仅本轮记录');
    for(const filter of ['summary','all','action','decision','speech','memory'])this.buttons['history-'+filter].label.color=filter===this.historyFilter?'#14271b':'#314030';
    this.historyRows.forEach((row,i)=>{const item=this.displayedHistory[this.historyPage*5+i];row.root.visible=!this.historyDetail&&!!item;if(!item)return;row.heading.text=item.title;row.body.text=readableAction(item.text);row.heading.color=item.title.startsWith('★')?palette.amber:palette.mint;});
    this.labels.historyDetail.visible=!!this.historyDetail;
    if(this.historyDetail){const d=this.historyDetail;this.labels.historyDetail.text=d.title+'\n\n'+readableAction(d.text)+(d.evidence?.length?'\n\n原始记录依据（仅所选居民 / 公告）：\n'+d.evidence.map(e=>`${journalTime(e.tick)} · ${JOURNAL_LABELS[e.category]}\n${readableAction(e.text)}`).join('\n\n'):'');}
    this.labels.historyEmpty.visible=!this.historyDetail&&!this.displayedHistory.length;
    this.labels.historyEmpty.text=this.historyFilter==='summary'?'还没有这一轮的模型总结。\n\n点击下方「生成 / 更新总结」，提取关键进展、问题与待办。\n这是给玩家看的归纳，不写入居民的记忆或行动。':'此筛选下没有记录。\n可切换「全部流水」或「全部轮次（含旧档）」查看。';
    const snapshotIds=new Set(this.historySnapshot.map(e=>e.id));const fresh=(state.history??[]).filter(e=>!snapshotIds.has(e.id)&&(e.residentId===r.id||e.residentId==='planner')).length;
    this.labels.historyCount.text=state.summaryBusy?'真实模型正在整理档案… 可继续翻阅记录。':state.summaryError||state.historyWarning||(this.historyDetail?'详情 · 上一页 / 下一页滚动长文；返回列表继续翻页':`${this.displayedHistory.length}项 · 第${this.historyPage+1}/${pages}页${fresh?` · 有${fresh}条新记录，点击载入`:''} · 本机保留档案2000条、总结40份`);
    this.buttons.historyBack.root.visible=!!this.historyDetail;
    this.buttons.summaryGenerate.root.visible=this.historyFilter==='summary';
    this.buttons.summaryGenerate.set(state.summaryBusy?'正在生成…':report?'更新本轮总结':'生成真实模型总结');
    this.buttons.summaryGenerate.root.mouseEnabled=!state.summaryBusy&&!replay&&own.some(e=>e.runId===runId);this.buttons.summaryGenerate.root.alpha=this.buttons.summaryGenerate.root.mouseEnabled?1:.45;
    for(const [id,enabled]of [['historyNewer',!!this.historyDetail||this.historyPage>0],['historyOlder',!!this.historyDetail||this.historyPage<pages-1]] as const){this.buttons[id].root.mouseEnabled=enabled;this.buttons[id].root.alpha=enabled?1:.4;}
  }
  private selectIndex(index:number):void{const id=this.state?.world.residents[index]?.id;if(id){this.selectedObject=null;this.hudDirty=true;this.api.onSelect(id);}}
  private mapViewport(){return {x:this.sceneLeft,y:TOP,width:WIDTH-this.sceneLeft,height:BOTTOM-TOP};}
  private mapCamera(){return {x:this.offset.x,z:this.offset.z,zoom:this.zoom,yaw:this.yaw};}
  private setYaw(value:number):void{this.resetMapGesture();this.yaw=normalizedYaw(value);this.moveCamera();this.positionLabels();}
  private resetMapGesture():void{this.pinch=null;this.pendingPinch=null;this.drag=null;this.suppressTap=false;this.zoneStart=null;}
  private focusCamp():void{const p=this.state?.world.objects.find(o=>o.kind==='board')?.position;this.resetMapGesture();this.offset={x:p?.x??0,z:p?.z??0};this.zoom=DEFAULT_MAP_ZOOM;this.moveCamera();this.positionLabels();}
  private drawMinimap():void{if(this.state)this.minimap?.render(this.state.world,this.state.selectedId,cameraFootprint(this.mapCamera(),this.mapViewport()),this.showZones||this.zoneDrawing);}
  private setZoom(value:number):void{this.flushPinch();this.zoom=boundedZoom(value);this.moveCamera();this.positionLabels();}
  private groundAt(x:number,y:number):{x:number;z:number}{return groundAtScreen({x,y},this.mapCamera(),this.mapViewport());}
  private touches(e:any):any[]{return (e?.touches??[]).filter((t:any)=>t.began&&t.downTargets?.includes(this.sceneInput));}
  private touchPoints(ts:any[]):MapTouch[]{return ts.map(t=>({id:t.touchId,pos:{x:t.pos.x,y:t.pos.y}}));}
  private flushPinch():void{
    const samples=this.pendingPinch;this.pendingPinch=null;if(!samples||!this.pinch)return;
    const c=moveMapPinch(this.pinch,samples,this.mapViewport());if(!c)return;
    this.offset={x:c.x,z:c.z};this.zoom=c.zoom;this.moveCamera();this.positionLabels();
  }
  private pointerDown(e:any):void{
    const ts=this.touches(e);if(this.suppressTap&&!this.pinch)return;
    if(ts.length>=2){if(!this.pinch){const [a,b]=this.touchPoints(ts);this.pinch=beginMapPinch(a,b,this.mapCamera(),this.mapViewport());this.pendingPinch=null;}this.suppressTap=true;this.drag=null;this.zoneStart=null;return;}
    if(this.pinch)return;this.suppressTap=false;
    const x=e?.stageX??L.stage.mouseX,y=e?.stageY??L.stage.mouseY;
    this.drag={id:e?.touchId,x,y,ox:this.offset.x,oz:this.offset.z,moved:false};if(this.zoneDrawing){this.zoneStart=this.groundAt(x,y);this.zoneDraft=null;this.drawZones();this.updateZoneHint();}
  }
  private pointerMove(e:any):void{
    if(this.pinch){this.pendingPinch=this.touchPoints(this.touches(e));return;}
    if(this.suppressTap||!this.drag||(this.drag.id!==undefined&&e.touchId!==this.drag.id))return;
    const x=e?.stageX??L.stage.mouseX,y=e?.stageY??L.stage.mouseY,dx=x-this.drag.x,dy=y-this.drag.y;
    this.drag.travel=(this.drag.travel??0)+Math.hypot(dx,dy);if(this.drag.travel>7)this.drag.moved=true;
    if(this.zoneDrawing&&this.zoneStart){this.zoneDraft=zoneBounds(this.zoneStart,this.groundAt(x,y));this.drawZones();this.updateZoneHint();return;}
    const from=this.groundAt(this.drag.x,this.drag.y),to=this.groundAt(x,y);this.offset.x+=from.x-to.x;this.offset.z+=from.z-to.z;this.drag.x=x;this.drag.y=y;this.moveCamera();this.positionLabels();
  }
  private pointerUp(e:any):void{
    const ts=this.touches(e).filter((t:any)=>t.touchId!==e.touchId);
    if(this.pinch){if(e.touchId!==undefined&&!this.pinch.ids.includes(e.touchId))return;this.pendingPinch=this.touchPoints(e.touches??[]);this.flushPinch();this.pinch=null;this.pendingPinch=null;this.drag=null;this.zoneStart=null;this.suppressTap=ts.length>0;return;}
    if(this.suppressTap){if(!ts.length)this.suppressTap=false;this.drag=null;return;}
    if(this.drag?.id!==undefined&&e.touchId!==this.drag.id)return;
    const drag=this.drag;this.drag=null;if(!drag||!this.state)return;
    if(e?.nativeEvent?.type==='touchcancel'){this.zoneStart=null;return;}
    if(this.zoneDrawing){this.zoneStart=null;this.updateZoneHint();return;}if(drag.moved)return;
    const x=e?.stageX??L.stage.mouseX,y=e?.stageY??L.stage.mouseY;
    if(x<this.sceneLeft||y<TOP||y>BOTTOM)return;
    const hits=this.state.world.residents.map(r=>{const top=this.project({...r.position,y:r.position.y+(this.residents.get(r.id)?.height??1.95)}),base=this.project(r.position),nearY=Math.max(top.y,Math.min(base.y,y));return {id:r.id,distance:Math.hypot(top.x-x,nearY-y)};}).filter(h=>h.distance<24);
    const id=cycleHit(hits,this.state.selectedId);if(id){this.selectedObject=null;this.api.onSelect(id);}else{
      const candidates=this.state.world.objects.map(o=>{const base=this.project(o.position),edges=[this.project({...o.position,x:o.position.x+o.width/2}),this.project({...o.position,z:o.position.z+(o.depth??o.width)/2})];const radius=Math.max(22,edges.reduce((sum,p)=>sum+Math.abs(p.x-base.x),0)+12);const top=this.project({...o.position,y:o.height}),nearY=Math.max(top.y,Math.min(base.y,y));const d=Math.hypot(base.x-x,nearY-y);return {o,d,radius};}).filter(v=>v.d<v.radius).sort((a,b)=>a.d-b.d);
      if(!candidates.length)return;this.selectedObject=candidates[0].o.id;
    }
    const anchor=this.groundAt(x,y);this.sidebarCollapsed=false;this.hudDirty=true;this.senseRevision='';this.layoutInspector();
    if(x>SIDE+10){const shifted=this.groundAt(x,y);this.offset.x+=anchor.x-shifted.x;this.offset.z+=anchor.z-shifted.z;this.moveCamera();this.positionLabels();}
  }
  private moveCamera():void{const c=clampMapCamera(this.mapCamera(),this.mapViewport()),eye=cameraEye(c);this.offset={x:c.x,z:c.z};this.zoom=c.zoom;this.yaw=c.yaw??0;this.camera.orthographicVerticalSize=c.zoom;this.camera.transform.position=new L.Vector3(eye.x,eye.y,eye.z);this.camera.transform.lookAt(new L.Vector3(this.offset.x,0,this.offset.z),new L.Vector3(0,1,0),false,true);}
  private mesh(name:string,geometry:any,p:{x:number;y:number;z:number},color:string):any{
    const mesh=new L.MeshSprite3D(geometry,name);mesh.transform.position=new L.Vector3(p.x,p.y,p.z);
    const mat=new L.BlinnPhongMaterial();mat.albedoColor=this.color(color);mat.specularColor=new L.Color(.05,.05,.05,1);mesh.meshRenderer.sharedMaterial=mat;this.scene.addChild(mesh);return mesh;
  }
  private line(target:any,a:{x:number;y:number;z:number},b:{x:number;y:number;z:number},color:string):void{const c=this.color(color);target.addLine(new L.Vector3(a.x,a.y,a.z),new L.Vector3(b.x,b.y,b.z),c,c);}
  private ring(target:any,p:{x:number;y:number;z:number},radius:number,color:string,dashed=false):void{
    for(let i=0;i<64;i++){if(dashed&&i%2)continue;const a=i/64*Math.PI*2,b=(i+1)/64*Math.PI*2;this.line(target,{x:p.x+Math.cos(a)*radius,y:.035,z:p.z+Math.sin(a)*radius},{x:p.x+Math.cos(b)*radius,y:.035,z:p.z+Math.sin(b)*radius},color);}
  }
  private drawWorld(world:World):void{
    this.daylightLight.intensity=.16+world.daylight*.64;this.scene.ambientColor=new L.Color(.24+world.daylight*.32,.28+world.daylight*.31,.38+world.daylight*.26,1);this.nightShade.graphics.clear();this.nightShade.graphics.drawRect(this.sceneLeft,TOP,WIDTH-this.sceneLeft,BOTTOM-TOP,'#0c1734');this.nightShade.alpha=(1-world.daylight)*.46;
    const liveIds=new Set(world.residents.map(r=>r.id));
    for(const [id,node]of this.residents){if(!liveIds.has(id)){node.dispose();this.residents.delete(id);this.nameLabels.get(id)?.destroy();this.nameLabels.delete(id);this.speechLabels.get(id)?.destroy();this.speechLabels.delete(id);}}
    for(const r of world.residents){
      let node=this.residents.get(r.id);
      if(!node){node=new CharacterMesh(r);this.scene.addChild(node.node);this.residents.set(r.id,node);const t=this.text(this.markers,r.name,0,0,13,palette.ink,120);t.align='center';t.bold=true;t.stroke=2;t.strokeColor='#252c24';t.color='#fff4d8';t.mouseEnabled=false;this.nameLabels.set(r.id,t);this.speechLabels.set(r.id,new SpeechBubble(this.markers));}
      node.update(r);
    }
    const ids=new Set(world.objects.map(o=>o.id));
    for(const [id,node]of this.objects)if(!ids.has(id)){node.dispose();this.objects.delete(id);this.objectSignatures.delete(id);this.placeLabels.get(id)?.destroy();this.placeLabels.delete(id);}
    for(const o of world.objects){const signature=o.kind==='crop'||o.kind==='animal'?[o.kind,o.crop?.kind,o.animal?.kind,o.zoneId,o.width,o.depth].join(':'):[o.kind,o.buildStage,o.width,o.depth,o.homeDesign,o.position.x,o.position.z,JSON.stringify(o.furniture),resourceStage(o)].join(':');if(this.objectSignatures.get(o.id)!==signature){this.objects.get(o.id)?.dispose();const node=new WorldMesh(o);this.scene.addChild(node.node);node.setRoofVisible(this.showRoofs);this.objects.set(o.id,node);this.objectSignatures.set(o.id,signature);}this.objects.get(o.id)?.update(o,world.tick);this.objects.get(o.id)?.setNight(dayClock(world.tick).night);
      if(['board','workbench','plot','house','pond'].includes(o.kind)){let label=this.placeLabels.get(o.id);if(!label){label=this.text(this.markers,'',0,0,12,'#365346',168);label.align='center';label.color='#e7ddbf';label.stroke=2;label.strokeColor='#30382b';label.width=150;label.padding=[3,5,3,5];this.placeLabels.set(o.id,label);}label.text=o.kind==='board'?'公告板 · 仓储':o.kind==='workbench'?'工作台':o.kind==='pond'?'池塘':o.kind==='house'?(world.residents.find(r=>r.id===o.ownerId)?.name??'公共')+'的小屋':`小屋施工 · ${o.buildStage??0}/3`;}
    }
    this.drawZones();this.positionLabels();
  }
  private project(p:{x:number;y:number;z:number}):{x:number;y:number}{return projectToStage(p,this.mapCamera(),this.mapViewport());}
  private positionLabels():void{if(!this.state)return;this.drawZones();this.drawMinimap();this.art.render(this.state.world,this.mapCamera(),this.mapViewport(),this.showRoofs);for(const [id,node] of this.objects)node.node.active=!this.art.hasObject(id);for(const r of this.state.world.residents){const p=this.project({...r.position,y:r.position.y+(this.residents.get(r.id)?.height??1.9)+.25});const t=this.nameLabels.get(r.id);if(t){t.pos(p.x-60,p.y-10);t.visible=p.x>this.sceneLeft+10&&p.x<WIDTH-10&&p.y>TOP+24&&p.y<BOTTOM-20;}
    }this.positionBubbles();
    for(const object of this.state.world.objects){const label=this.placeLabels.get(object.id);if(!label)continue;const p=this.project({...object.position,y:0,z:object.position.z+(object.kind==='house'||object.kind==='plot'?object.depth/2+1:object.kind==='pond'?3.1:1)});label.pos(p.x-75,p.y+7);label.visible=p.x>this.sceneLeft+85&&p.x<WIDTH-85&&p.y>TOP+64&&p.y<BOTTOM-30;}
  }
  private positionBubbles():void{
    if(!this.state)return;const w=this.state.world;
    const visible=w.residents.filter(r=>this.nameLabels.get(r.id)?.visible);
    const spoken=new Map(visible.map(r=>[r.id,w.sounds.filter(s=>s.sourceId===r.id&&w.tick-s.emittedTick<3000/defaults.simulation.fixedDtMs).map(s=>s.text).join('').slice(-55)]));
    const candidates=w.camp?visible.map(r=>({id:r.id,text:residentThought(w,r)})):[];
    const thought=this.thoughts.update(w.runId,performance.now(),candidates,[...spoken.values()].some(Boolean));
    for(const r of w.residents){const bubble=this.speechLabels.get(r.id);if(!bubble)continue;
      const words=spoken.get(r.id),wish=thought?.id===r.id?thought:null;
      if(!words&&!wish){bubble.hide();continue;}
      bubble.show(words?`“${words}”`:wish!.text,!words,words?1:wish!.alpha);
      const p=this.project({...r.position,y:r.position.y+(this.residents.get(r.id)?.height??1.9)+.25});
      bubble.root.pos(Math.max(this.sceneLeft+12,Math.min(WIDTH-bubble.width-12,p.x-bubble.width/2)),Math.max(TOP+12,p.y-bubble.height-26));
    }
  }
  private drawSenses(state:ViewState):void{
    this.senseLines.clear();this.selection.clear();const r=state.world.residents.find(r=>r.id===state.selectedId),object=state.world.objects.find(o=>o.id===this.selectedObject);if(object)this.ring(this.selection,object.position,Math.max(.6,object.width/2),'#f1e3a5');else if(r)this.ring(this.selection,r.position,.56,'#f1e3a5');
    if(!state.showSenses)return;const o=state.overlays[state.selectedId];if(!o)return;
    const poly=o.visionPolygon;if(poly.length>1){for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];this.line(this.senseLines,{...a,y:.045},{...b,y:.045},'#45997b');}for(let i=0;i<poly.length;i+=4)this.line(this.senseLines,{...o.eye,y:.04},{...poly[i],y:.04},'#8eb698');}
    for(const ring of o.hearingRadii)this.ring(this.senseLines,o.eye,ring.radius,'#b5a067',true);
    const directions=['front','front_right','right','back_right','back','back_left','left','front_left'];
    for(const observation of o.observations.filter(v=>v.modality==='auditory').slice(-2)){const sector=directions.indexOf(observation.detail.relativeDirection);if(sector<0)continue;const angle=o.heading+sector*Math.PI/4;this.line(this.senseLines,{...o.eye,y:.075},{x:o.eye.x+Math.cos(angle)*2,y:.075,z:o.eye.z+Math.sin(angle)*2},'#bc793f');}
    for(const known of o.lastKnown){this.ring(this.senseLines,known.position,.35,'#798caa',true);this.line(this.senseLines,{...known.position,y:.04},{...known.position,y:1},'#798caa');}
  }
  render(state:ViewState):void{
    if(this.state&&this.state.world.runId!==state.world.runId){this.selectedObject=null;this.cancelZone();}
    this.state=state;this.flushPinch();this.drawMinimap();const worldKey=[state.world.runId,state.world.revision,state.world.tick].join(':');
    if(worldKey!==this.worldRevision){this.drawWorld(state.world);this.worldRevision=worldKey;}else this.positionBubbles();
    const senseKey=[worldKey,state.selectedId,state.showSenses].join('|');if(senseKey!==this.senseRevision){this.drawSenses(state);this.senseRevision=senseKey;}
    const mapKey=worldKey+'|'+state.selectedId;if(this.memoryPanel?.visible&&(this.hudDirty||this.mapRevision!==mapKey)){const remembered=state.world.residents.find(r=>r.id===state.selectedId);if(remembered)this.memoryMap.render(remembered);this.mapRevision=mapKey;}
    const hudKey=[worldKey,state.selectedId,state.showSenses,state.status,state.mode,state.error,state.hosted,state.cognitionDetail,state.controlDetail,state.controlNotice,state.fallbackActive,state.historyVersion,state.historyWarning,state.summaryVersion,state.summaryBusy,state.summaryError,state.pendingTasks,state.saveStatus,state.resumeReady].join('|');
    if(!this.hudDirty&&this.hudRevision===hudKey)return;this.hudDirty=false;this.hudRevision=hudKey;
    this.updateInspectorButton();
    this.labels.gateway.visible=this.token.visible=this.buttons.connect.root.visible=!state.hosted;
    this.labels.hosted.visible=Boolean(state.hosted);
    const r=state.world.residents.find(x=>x.id===state.selectedId)||state.world.residents[0];
    const control=state.control??{...DEFAULT_CONTROL,mode:'independent' as const};
    const mode=state.mode==='LOCAL_ALGORITHM'?'本地算法 · 无远程模型':state.mode==='UNCONFIGURED'?'尚未接入真实模型':state.mode==='REPLAY'?'观察回放 · 不调用模型':control.mode==='commander'?'模型统筹 · 阶段执行':'真实模型 · 独立居民';
    this.labels.mode.text=mode;const statusText=(state.controlDetail&&!['THINKING','ERROR_PAUSED'].includes(state.status)?state.controlDetail:this.humanStatus(state.status)+(state.cognitionDetail?' · '+state.cognitionDetail:''));this.labels.status.text=statusText.length>82?statusText.slice(0,76)+'… 点此展开':statusText+' · 点此展开';this.labels.statusDetails.text=mode+'\n\n'+statusText+(state.controlNotice?'\n\n'+state.controlNotice:'')+(state.error?'\n\n'+state.error:'');this.statusScroll?.refresh();
    this.buttons.start.set(state.resumeReady?'继续营地':'开始运行');this.labels.saveStatus.text=state.saveStatus??'本机自动存档';this.labels.saveDetail.text=(state.saveStatus??'本机自动存档')+'\n存于此设备此浏览器，换设备不会同步。';
    if(this.controlPanel.visible){const d=this.controlDraft;for(const m of ['commander','independent','local']){const t=this.buttons['mode-'+m].label;t.color=m===d.mode?'#14271b':'#314030';t.bold=m===d.mode;t.underline=m===d.mode;}this.labels.controlHelp.text=d.mode==='commander'?'一个glm-4.5-air统筹阶段目标；执行器持续完成走路、采集、搬运和施工。每人记忆独立。阶段结束、新任务或持续受阻时汇总复查；最短间隔按模拟时间计算。':d.mode==='independent'?'每名居民独立调用真实模型，只读自己的感官与记忆。保留原有认知触发；模型失败保持暂停，可手动切换本地模式。':'完全本地任务算法，免密钥、免远程请求；不是大模型。根据任务和有限感知执行采集、备料、制作与分步建房。';this.buttons.phaseSize.set('阶段工作量：'+d.phaseUnits+'份');this.buttons.reviewGap.set('模型最短间隔：'+d.reviewSeconds+'秒');this.buttons.crewCount.set('新营地人数：'+d.residents);this.buttons.localFallback.set('统筹失败自动转本地：'+(d.fallback?'开':'关'));}
    const action=r?.plan.find(p=>!p.done);this.labels.action.text=action?`实际动作：${readableAction(action.action.op)} · 已执行${(action.elapsedTicks*.05).toFixed(1)}秒${['THINKING','COMMITTING','ERROR_PAUSED'].includes(state.status)?'（冻结）':''}`:'实际动作：等待下一项计划';
    const seconds=Math.floor(state.world.tick*defaults.simulation.fixedDtMs/1000);this.labels.time.fontSize=21;this.labels.time.text=(dayClock(state.world.tick).night?'夜 · ':'日 · ')+dayClock(state.world.tick).label;
    for(let i=0;i<2;i++){const person=state.world.residents[this.residentPage()+i];this.buttons['resident'+i].set(person?`${person.id===state.selectedId?'●  ':''}${person.name}`:'暂无居民');this.buttons['memoryPerson'+i].set(person?person.name+'的地图':'暂无居民');}
    if(r){this.renderResident(r,state);if(this.lifePanel.visible)this.renderLifeDetails(r,state);}this.renderObject(state);this.renderResources(state);
    this.buttons.senses.set(`感官 ${state.showSenses?'开':'关'}`);this.buttons.quickSenses.set(`感官 ${state.showSenses?'开':'关'}`);
    this.buttons.pause.set(/PAUS|STOP|暂停/i.test(state.status)?'继续':'暂停');
    this.labels.error.text=state.controlNotice?state.controlNotice:state.error?state.error.slice(0,260)+(state.status==='ERROR_PAUSED'?'\n世界保持冻结，可修正连接后重试。':''):state.mode==='UNCONFIGURED'?'这是静态观察场。请先配置模型服务并连接网关。\n连接真实模型后，居民才会自主相遇、交流。':'';
    this.labels.caption.text=this.zoneDrawing?'圈选'+ZONE_LABELS[this.draftZoneKind()]+' · 单指拖出范围，双指调整地图':state.mode==='REPLAY'?'回放现场 · 按模拟时间播放':state.world.camp?'双指平移 · 捏合缩放 · 小地图定位':'两名居民 · 两棵树 · 一堵墙';
    const tasks=state.world.camp?.tasks??[],recipe=RECIPES.find(r=>r.id===this.draftRecipe)!;
    const isZone=this.draftKind!=='gather'&&this.draftKind!=='craft',kind=this.draftZoneKind();
    this.buttons.publishTask.set(isZone?'到地图圈选'+ZONE_LABELS[kind]:this.draftKind==='craft'?`发布${recipe.label}制作目标`:`发布${RESOURCE_LABELS[this.draftResource]}目标`);
    for(const type of ['gather','craft','residential','planting','pasture']){const label=this.buttons['kind-'+type].label;label.color=type===this.draftKind?'#14271b':'#314030';label.underline=type===this.draftKind;}
    for(const resource of ['wood','stone','food']){this.buttons['task-'+resource].root.visible=this.draftKind==='gather';this.buttons['task-'+resource].set((this.draftResource===resource?'● ':'')+RESOURCE_LABELS[resource as TaskDraft['resource']]);}
    for(const entry of RECIPES.filter(r=>r.kind==='craft')){this.buttons['recipe-'+entry.id].root.visible=this.draftKind==='craft';this.buttons['recipe-'+entry.id].set((this.draftRecipe===entry.id?'● ':'')+entry.label);}
    for(const c of ['rice','wheat','corn','carrot'] as const){this.buttons['crop-'+c].root.visible=this.draftKind==='planting';this.buttons['crop-'+c].set((c===this.draftCrop?'● ':'')+CROP_LABELS[c]);}
    for(const a of ['chicken','duck','goose','mixed'] as const){this.buttons['animal-'+a].root.visible=this.draftKind==='pasture';this.buttons['animal-'+a].set((a===this.draftAnimal?'● ':'')+(a==='mixed'?'混养':ANIMAL_LABELS[a]));}
    this.labels.zonePlanner.visible=this.draftKind==='residential';this.labels.zonePlanner.text='单指拖出矩形区域 · 自由选择位置和大小\n双指同向平移 · 张合缩放地图';
    this.buttons.amount.root.visible=!isZone;this.buttons.amount.set('数量 '+(this.draftKind==='craft'?Math.min(3,this.draftAmount):this.draftAmount));
    this.labels.draftTitle.text=this.draftKind==='planting'?'选择作物 · 从幼苗长到丰收':this.draftKind==='pasture'?'选择家禽 · 散步、啄食与扑翅':this.draftKind==='residential'?'居住区 · 居民按需申请自己的住处':this.draftKind==='craft'?'制作并由居民自行装备工具':'采集营地的基础物资';
    this.labels.requirements.pos(isZone?344:469,379);this.labels.requirements.width=isZone?374:250;
    this.labels.requirements.text=this.draftKind==='planting'?'幼苗 → 生长 → 成熟 → 收割 → 重新发苗\n区域至少4×4格 · 避开建筑和其他用途区域':this.draftKind==='pasture'?'单一品种或鸡鸭鹅混养 · 区域至少4×4格\n家禽在区内自由活动，暂停时一起停下':this.draftKind==='residential'?'住处大小和用料因人而异 · 区域至少6×6格':this.draftKind==='craft'?'每件：'+materialText(recipe.cost):'居民可自由选择参与';
    this.taskNote.visible=!isZone;
    this.labels.draftHelp.text=this.draftKind==='planting'?'确认后播种；成熟后居民可亲自收割食物并搬入仓储。区域标记可用右上角开关显示或隐藏。':this.draftKind==='pasture'?'确认后放养；家禽会走动、低头啄食和扑翅。区域标记可随时隐藏，不影响它们的活动。':this.draftKind==='residential'?'划区后确认，居民自主申请、备料与建房。同类区域可重叠圈选，重复范围不新增。':this.draftKind==='craft'?'先读工作台配方；消耗自己的随身材料。成品归制作者，需要自行持握。':'采集计入目标，入库由居民自主搬运。';
    const goals=tasks.filter(t=>!['residential','planting','pasture'].includes(t.kind??'')),zones=state.world.camp?.zones??[];
    this.labels.taskSummary.text=`目标 ${goals.filter(t=>t.status==='done').length}/${goals.length} · 住${zones.filter(z=>zoneKind(z)==='residential').length} 种${zones.filter(z=>zoneKind(z)==='planting').length} 牧${zones.filter(z=>zoneKind(z)==='pasture').length}${state.pendingTasks?` · 待发布${state.pendingTasks}`:''}`;

    this.renderTaskList(state);
    this.labels.stock.text='公共仓储：'+(materialText(state.world.camp?.stock??{})||'暂无材料');
    this.labels.taskNotice.text=state.pendingTasks?`已排队${state.pendingTasks}项，世界恢复后写入`:(state.error??'').slice(0,70);
    this.renderHistory(state);if(this.inventoryPanel.visible&&r)this.renderInventory(r);this.updateZoneHint();
  }
  private humanStatus(status:string):string{const map:Record<string,string>={RUNNING:'世界运行中',PAUSED:'观察者已暂停',THINKING:'居民正在思考 · 世界已冻结',COMMITTING:'完整决策批次正在提交 · 世界保持冻结',READY:'准备开始',PLAYING:'回放播放中 · 不调用模型',BUFFERING:'回放缓冲中',ERROR_PAUSED:'认知请求失败 · 世界保持冻结',WAITING_FOR_MODEL:'模型思考中 · 世界已冻结',WAITING:'模型思考中 · 世界已冻结',ERROR:'认知请求失败 · 世界保持冻结',IDLE:'准备开始',STOPPED:'已停止',UNCONFIGURED:'未配置真实模型'};return map[status]||status;}
}
