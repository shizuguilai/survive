import {drawIcon} from './hud-icons.ts';
import {pinchZoom,boundedZoom,cycleHit} from './interaction.ts';
import {zoneBounds,validateZone,homeSites} from '../../../packages/sim-core/src/housing.ts';
import {resourceCapacity,resourceStage} from '../../../packages/sim-core/src/resources.ts';
import type {Resident,WorldObject,ResidentialBounds} from '../../../packages/sim-core/src/domain.ts';
import {createTerrain} from './terrain.ts';
import {controlSettings,DEFAULT_CONTROL,type ControlSettings} from '../../../packages/contracts/src/command.ts';
import type { World, SensoryOverlay } from '../../../packages/sim-core/src/domain.ts';
import {RESOURCE_LABELS,type TaskDraft} from '../../../packages/sim-core/src/camp.ts';
import {MemoryMapView} from './memory-map.ts';
import {CharacterMesh} from './character-mesh.ts';
import {WorldMesh} from './world-mesh.ts';
import {RECIPES,HOUSE_STEPS,materialText,taskTitle} from '../../../packages/sim-core/src/recipes.ts';
import {selectJournal,journalTime,JOURNAL_LABELS,readableAction,type JournalEntry,type JournalCategory} from './journal.ts';
import {summaryInput,latestSummary} from './journal-summary.ts';
import type {SummaryRequest,SavedSummary} from '../../../packages/contracts/src/journal-summary.ts';
import {publicCharacterSummary,listOwnEquipment} from '../../../packages/sim-core/src/character.ts';
import defaults from '../../../packages/sim-core/defaults.json' with {type:'json'};

export type ViewCallbacks = {
  onControl?(settings:ControlSettings,newCamp?:boolean):void;onRemoteRetry?():void;
  onSummarize?(request:SummaryRequest):void;
  onTask(draft:TaskDraft):boolean|void;
  onPause():void; onResume():void; onRetry():void; onStop():void;
  onSelect(id:string):void; onToggleSenses():void; onReplay?():void; onLive?():void;
  onSeek?(tick:number):void; onSpeed?(value:number):void; onStart():void; onConnect(token:string):void;
};
export type ViewState = {
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
const WIDTH=1280,HEIGHT=720,SIDE=292,TOP=84,BOTTOM=654;
const palette={ink:'#e6e0cb',muted:'#a6afa7',paper:'#20272a',panel:'#2c3437',line:'#465052',mint:'#9cae83',amber:'#ddbd7d'};
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
  return new ObserverView(api);
}

export class ObserverView {
  readonly root:any; readonly scene:any; readonly camera:any;
  private labels:Record<string,any>={};private buttons:Record<string,NativeButton>={};
  private residents=new Map<string,CharacterMesh>();private objects=new Map<string,WorldMesh>();private objectSignatures=new Map<string,string>();private placeLabels=new Map<string,any>();
  private nameLabels=new Map<string,any>();private speechLabels=new Map<string,any>();private senseLines:any;private selection:any;
  private inspector:any;private sidebarCollapsed=true;private modalLayouts:{panel:any;width:number}[]=[];
  private get sceneLeft():number{return this.sidebarCollapsed?0:SIDE;}
  private controlPanel:any;private controlDraft=controlSettings(null);
  private memoryPanel:any;private memoryMap!:MemoryMapView;
  private planner:any;private taskNote:any;private draftResource:TaskDraft['resource']='wood';private draftAmount=8;
  private draftKind:'gather'|'craft'|'residential'='gather';private draftRecipe='stone_axe';
  private historyPanel:any;private workshopPanel:any;private historyFilter:JournalCategory|'all'|'summary'='action';private historyPage=0;private historyAllRuns=true;private historyDetail:HistoryRow|null=null;
  private historyRows:any[]=[];private displayedHistory:HistoryRow[]=[];private historySnapshot:JournalEntry[]|null=null;private historySnapshotScope='';private historySummaryRunId='';private historyCache='';
  private state:ViewState|null=null;private token:any;
  private worldRevision='';private senseRevision='';private hudRevision='';private mapRevision='';private hudDirty=true;private highQuality=false;
  private offset={x:0,z:0};private drag:{x:number;y:number;ox:number;oz:number;moved:boolean;travel?:number}|null=null;
  private residentDetails:any;private objectDetails:any;private inventoryPanel:any;
  private statBars:any[]=[];private statValues:any[]=[];private selectedObject:string|null=null;
  private resourceRail:any;private resourceExpanded=true;private showRoofs=true;
  private zoneLines:any;private zoneDrawing=false;private zoneStart:{x:number;z:number}|null=null;private zoneDraft:ResidentialBounds|null=null;private zoneRevision='';
  private pinch:{distance:number;zoom:number;anchor:{x:number;z:number}}|null=null;private suppressTap=false;
  private markers:any;private sceneInput:any;private zoom=18;

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
    light.transform.rotationEuler=new L.Vector3(-55,25,0);const dl=light.addComponent(L.DirectionLightCom);dl.color=new L.Color(1,.92,.76,1);dl.intensity=.65;
    this.scene.addChild(createTerrain(L));
    this.senseLines=new L.PixelLineSprite3D(1200,'有限感知参考');this.scene.addChild(this.senseLines);
    this.selection=new L.PixelLineSprite3D(72,'selected resident');this.scene.addChild(this.selection);
    this.zoneLines=new L.PixelLineSprite3D(800,'Residential zones');this.scene.addChild(this.zoneLines);
    try{this.showRoofs=globalThis.localStorage?.getItem('survive_roofs_v1')!=='hidden';}catch{}
    this.root=new L.Sprite();this.root.name='Observer UI';L.stage.addChild(this.root);
    this.buildUI();this.layoutInspector();
    L.InputManager.multiTouchEnabled=true;
    L.stage.on(L.Event.MOUSE_MOVE,this,(e:any)=>this.pointerMove(e));
    L.stage.on(L.Event.MOUSE_UP,this,(e:any)=>this.pointerUp(e));
    L.stage.on(L.Event.RESIZE,this,()=>this.positionLabels());
  }

  private color(hex:string,alpha=1):any{const h=parseInt(hex.slice(1),16);return new L.Color((h>>16&255)/255,(h>>8&255)/255,(h&255)/255,alpha);}
  private text(parent:any,text:string,x:number,y:number,size=16,color=palette.ink,width=250):any{
    const t=new L.Text();t.text=text;t.pos(x,y);t.font='Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif';t.fontSize=size;t.color=color;t.width=width;t.wordWrap=true;t.leading=5;t.mouseEnabled=false;parent.addChild(t);return t;
  }
  private panel(parent:any,x:number,y:number,w:number,h:number,color:string,r=0):any{
    const s=new L.Sprite();s.pos(x,y);s.size(w,h);
    if(r)s.graphics.drawRoundRect(0,0,w,h,r,r,r,r,color);else s.graphics.drawRect(0,0,w,h,color);
    parent.addChild(s);return s;
  }
  private button(id:string,text:string,x:number,y:number,w:number,click:()=>void,bright=false):NativeButton{
    const r=this.panel(this.root,x,y,w,35,bright?palette.mint:palette.line,3);r.mouseEnabled=true;r.name=id;r.hitArea=new L.Rectangle(0,0,w,35);
    const t=this.text(r,text,0,10,14,bright?'#202a23':'#eee9d9',w);t.align='center';t.mouseEnabled=false;
    r.on(L.Event.CLICK,this,()=>{this.hudDirty=true;click();});const b={root:r,label:t,set:(s:string)=>t.text=s};this.buttons[id]=b;return b;
  }
  private buildUI():void{
    this.inspector=new L.Sprite();this.inspector.name='Resident inspector';this.inspector.zOrder=10;this.root.addChild(this.inspector);
    this.panel(this.root,0,0,WIDTH,TOP,palette.paper);this.panel(this.inspector,0,TOP,SIDE,HEIGHT-TOP,palette.panel);
    this.panel(this.root,0,BOTTOM,WIDTH,HEIGHT-BOTTOM,palette.paper);
    this.panel(this.root,0,TOP-1,WIDTH,1,'#535b58');
    this.text(this.root,'SURVIVE',23,18,27,palette.ink,230).bold=true;
    this.text(this.root,'边境营地 · 生存与建造',25,54,13,'#b4b7a8',240);
    this.labels.mode=this.text(this.root,'等待连接真实模型',323,18,17,palette.ink,430);
    this.labels.status=this.text(this.root,'世界尚未启动',323,47,12,'#b4b7a8',663);
    this.labels.time=this.text(this.root,'模拟 00:00',1000,21,24,palette.ink,250);this.labels.time.align='right';
    this.button('control','运行设置',1094,50,156,()=>{this.controlDraft=controlSettings(this.state?.control);this.hideModals();this.controlPanel.visible=true;});
    const inspectorStart=this.root.numChildren;
    this.button('nextResident','下一位',187,89,85,()=>this.nextResident());
    this.button('resident0','居民 A',18,129,121,()=>this.selectIndex(this.residentPage()));this.button('resident1','居民 B',151,129,121,()=>this.selectIndex(this.residentPage()+1));
    this.residentDetails=new L.Sprite();this.root.addChild(this.residentDetails);const detailStart=this.root.numChildren;
    this.labels.person=this.text(this.root,'选择居民',22,181,24,'#f1f4dc',248);this.labels.person.bold=true;
    this.labels.personality=this.text(this.root,'',22,215,13,palette.muted,248);this.labels.personality.height=18;this.labels.personality.overflow='hidden';
    const section=(y:number,h:number,title:string,icon:string)=>{const card=this.panel(this.root,16,y,260,h,'#343e41',5);card.graphics.drawRoundRect(0,0,260,h,5,5,5,5,null,'#52605b',1);drawIcon(this.root,icon,27,y+10,20);this.text(this.root,title,55,y+12,14,palette.mint,205);};
    section(242,158,'身体与心情','health');
    ['health','hunger','mood','fatigue'].forEach((kind,i)=>{const y=279+i*27;drawIcon(this.root,kind,28,y-3,19);this.text(this.root,['生命','饥饿','心情','疲劳'][i],54,y,14,palette.ink,75);const value=this.text(this.root,'',185,y,13,palette.ink,75);value.align='right';this.statValues.push(value);const bar=new L.Sprite();bar.pos(99,y+5);this.root.addChild(bar);this.statBars.push(bar);});
    section(410,98,'随身携带','bag');
    this.button('inventory','查看物品',172,416,94,()=>{this.hideModals();this.inventoryPanel.visible=true;});
    ['wood','stone','food'].forEach((kind,i)=>{drawIcon(this.root,kind,29+i*82,455,21);this.labels['carry-'+kind]=this.text(this.root,'0',55+i*82,454,17,palette.ink,50);this.text(this.root,['木材','石料','食物'][i],28+i*82,479,12,palette.muted,75);});
    this.labels.equipment=this.text(this.root,'',28,494,11,palette.muted,232);this.labels.equipment.height=16;this.labels.equipment.overflow='hidden';
    section(518,130,'当前活动','eye');
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
    this.button('inspectorToggle','居民信息 ›',18,89,158,()=>{this.sidebarCollapsed=!this.sidebarCollapsed;this.layoutInspector();}).root.zOrder=11;
    this.labels.caption=this.text(this.root,'两名居民 · 两棵树 · 一堵墙',315,97,12,'#eee3c4',430);
    this.labels.caption.mouseEnabled=false;
    this.button('zoomOut','−',966,94,38,()=>{this.setZoom(this.zoom+3);});
    this.button('zoomIn','＋',1014,94,38,()=>{this.setZoom(this.zoom-3);});
    this.button('workshop','工作台配方',812,94,140,()=>{this.hideModals();this.workshopPanel.visible=true;});
    this.button('tasks','规划 / 居住区',1064,94,185,()=>{this.hideModals();this.planner.visible=true;},true);
    this.button('roofToggle',this.showRoofs?'屋顶：显示':'屋顶：隐藏',1064,140,185,()=>{this.showRoofs=!this.showRoofs;this.buttons.roofToggle.set(this.showRoofs?'屋顶：显示':'屋顶：隐藏');for(const node of this.objects.values())node.setRoofVisible(this.showRoofs);try{globalThis.localStorage?.setItem('survive_roofs_v1',this.showRoofs?'shown':'hidden');}catch{}});
    this.buildResourceRail();this.buildObjectDetails();
    this.button('zoneConfirm','确认居住区',610,147,140,()=>this.commitZone()).root.visible=false;
    this.button('zoneCancel','取消圈地',759,147,120,()=>this.cancelZone()).root.visible=false;
    this.labels.zoneHint=this.text(this.root,'',320,151,14,palette.amber,280);this.labels.zoneHint.visible=false;
    this.labels.taskSummary=this.text(this.root,'',320,122,12,'#eee3c4',560);this.labels.taskSummary.mouseEnabled=false;
    this.labels.error=this.text(this.root,'',326,494,16,'#ffe2a5',908);this.labels.error.height=104;this.labels.error.overflow='hidden';this.labels.error.mouseEnabled=false;
    this.button('quickHistory','档案',18,670,77,()=>this.openHistory());
    this.button('quickMap','地图',105,670,77,()=>{this.hideModals();this.memoryPanel.visible=true;});
    this.button('quickSenses','感官',192,670,77,()=>this.api.onToggleSenses());
    this.button('start','开始真实认知',315,670,130,()=>this.api.onStart(),true);
    this.button('pause','暂停',455,670,72,()=>{const paused=/PAUS|STOP|暂停/i.test(this.state?.status||'');paused?this.api.onResume():this.api.onPause();});
    this.button('retry','重试',537,670,72,()=>this.api.onRetry());
    this.button('stop','停止',619,670,72,()=>this.api.onStop());
    this.button('quality','画面：流畅优先',705,670,208,()=>{this.highQuality=!this.highQuality;this.applyQuality();try{globalThis.localStorage?.setItem('survive_render_quality_v1',this.highQuality?'fine':'fast');}catch{}});
    this.labels.gateway=this.text(this.root,'网关令牌',929,678,12,'#b4b7a8',84);
    this.labels.hosted=this.text(this.root,'云端模型 · 密钥由服务端保管',936,681,12,'#b4b7a8',315);this.labels.hosted.visible=false;
    this.token=new L.Input();this.token.pos(1007,671);this.token.size(152,33);this.token.fontSize=14;this.token.color='#26352c';this.token.bgColor='#e0e6d9';this.token.type='password';this.token.prompt='仅存当前会话';this.token.promptColor='#7f9688';this.token.padding=[7,7,7,7];this.root.addChild(this.token);
    this.button('connect','连接',1170,670,86,()=>{const token=this.token.text;this.token.text='';this.api.onConnect(token);},true);
    this.text(this.root,'居民档案自动保存 · 可切换流畅 / 精细画面',315,710,9,'#a6afa7',650);
    this.buildPlanner();this.buildWorkshop();this.buildHistory();this.buildMemoryMap();this.buildControl();this.buildInventory();
  }

  private buildResourceRail():void{
    this.resourceRail=this.panel(this.root,1127,224,122,168,'#2c3437',5);this.resourceRail.mouseEnabled=true;this.resourceRail.hitArea=new L.Rectangle(0,0,122,168);
    this.button('stockToggle','仓储 ▾',1127,186,122,()=>{this.resourceExpanded=!this.resourceExpanded;this.resourceRail.visible=this.resourceExpanded;this.buttons.stockToggle.set(this.resourceExpanded?'仓储 ▾':'仓储 ▸');});
    ['wood','stone','food'].forEach((kind,i)=>{drawIcon(this.resourceRail,kind,10,12+i*43,24);this.text(this.resourceRail,RESOURCE_LABELS[kind as TaskDraft['resource']],41,11+i*43,13,palette.muted,69);this.labels['stock-'+kind]=this.text(this.resourceRail,'0',41,27+i*43,17,palette.ink,72);});
    this.text(this.resourceRail,'已搬入仓储',10,150,12,palette.muted,103);
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
    this.labels.objectName.text=names[o.kind];this.labels.objectType.text=o.ownerId?(state.world.residents.find(r=>r.id===o.ownerId)?.name??'居民')+'的住处':'地图物体';
    if(['tree','rock','berry'].includes(o.kind)){
      const capacity=resourceCapacity(o),resource=o.resourceKind??(o.kind==='tree'?'wood':o.kind==='rock'?'stone':'food');
      this.labels.objectStock.text=`${RESOURCE_LABELS[resource]}剩余 ${o.resources} / ${capacity}`;
      this.labels.objectDetail.text=(o.resources<=0?'已经采空。':`还可采集 ${o.resources} 份。\n剩余 ${Math.round(o.resources/capacity*100)}% · ${resourceStage(o)<=2?'已明显减少':'资源充足'}`)+'\n\n'+(o.kind==='tree'?'采伐后树冠减少，树干出现切口并倾斜；采空留下树桩。':o.kind==='rock'?'采掘后岩石逐步缩小，采空留下碎石。':'采收后枝上的浆果逐步减少。');
    }else if(['house','plot'].includes(o.kind)){
      this.labels.objectStock.text=o.kind==='house'?'已竣工 · 可进入休息':`施工 ${o.buildStage??0} / 3`;
      this.labels.objectDetail.text=(o.kind==='house'?'从小屋正面门口进出。\n屋内休息可更快恢复疲劳。':`下一阶段：${HOUSE_STEPS[o.buildStage??0]?.label??'已完成'}\n材料从公共仓储扣除。`)+'\n\n右上角「屋顶」可显示或隐藏屋顶，观察屋内居民。';
    }else{this.labels.objectStock.text=o.kind==='board'?materialText(state.world.camp?.stock??{})||'仓储暂无物资':o.kind==='pond'?'岸边可以休息':o.kind==='workbench'?'工具制作 / 物资置换':'阻挡通行与视线';this.labels.objectDetail.text=o.appearance;}
    this.labels.objectLocation.text=`位置 ${o.position.x.toFixed(1)}, ${o.position.z.toFixed(1)}`;
  }
  private renderResident(r:Resident,state:ViewState):void{
    const values=[(r.health??100)/100,r.hunger,r.mood??.75,r.fatigue];
    values.forEach((v,i)=>{v=Math.max(0,Math.min(1,v));this.statValues[i].text=Math.round(v*100)+(i===0?' / 100':'%');const g=this.statBars[i].graphics;g.clear();g.drawRect(0,0,79,6,'#222b2e');g.drawRect(0,0,79*v,6,['#9fbf97','#d5b376','#afbf89','#9cb4cb'][i]);});
    for(const kind of ['wood','stone','food'] as const)this.labels['carry-'+kind].text=String(r.supplies?.[kind]??0);
    const gear=r.character?listOwnEquipment(r.character,r.id):[];this.labels.equipment.text=`采集袋 ${r.inventory} / 30 · 物品 ${gear.length}件`;
    const stacked=state.world.residents.filter(x=>Math.hypot(x.position.x-r.position.x,x.position.z-r.position.z)<.9).length;
    this.labels.person.text=r.name;this.labels.personality.text=stacked>1?`${stacked}人重叠 · 再点角色切换`:r.homeId?'已有住处 · 可进屋休息':r.personality;
    this.labels.goal.text=r.goal||'正在观察附近，尚未安排活动';
    const observations=state.overlays[r.id]?.observations??r.observations;const o=observations.at(-1);
    this.labels.perception.text=o?(o.modality==='auditory'?'听到：'+(o.detail.heardText??'附近声音'):o.modality==='visual'?'看到：'+(Array.isArray(o.detail.appearance)?o.detail.appearance.join('；'):o.detail.appearance??'附近事物'):'感到：'+(o.detail.sensation==='hunger'?'饥饿':o.detail.sensation==='fatigue'?'疲劳':'身体状态变化')):'感知：暂无新的线索';
  }
  private buildInventory():void{
    this.inventoryPanel=this.modal('Resident inventory',735);drawIcon(this.inventoryPanel,'bag',344,168,27);
    this.labels.inventoryTitle=this.text(this.inventoryPanel,'随身物品',384,173,23,palette.ink,620);
    this.labels.inventoryBody=this.text(this.inventoryPanel,'',344,225,16,palette.ink,665);this.labels.inventoryBody.height=276;this.labels.inventoryBody.overflow='scroll';
    this.text(this.inventoryPanel,'随身资源、包内物品与已装备物品分开记录。',344,513,13,palette.muted,655);
    this.inventoryPanel.on(L.Event.MOUSE_WHEEL,this,(e:any)=>{this.labels.inventoryBody.scrollY=Math.max(0,this.labels.inventoryBody.scrollY-e.delta*26);});
    this.modalButton(this.inventoryPanel,'inventoryUp','向上',344,548,100,()=>this.labels.inventoryBody.scrollY=Math.max(0,this.labels.inventoryBody.scrollY-96));
    this.modalButton(this.inventoryPanel,'inventoryDown','向下',454,548,100,()=>this.labels.inventoryBody.scrollY+=96);
    this.modalButton(this.inventoryPanel,'inventoryClose','返回观察',883,548,144,()=>{this.inventoryPanel.visible=false;});
  }
  private renderInventory(r:Resident):void{
    const gear=r.character?listOwnEquipment(r.character,r.id):[],worn=gear.filter(g=>g.equippedSlots.length),bag=gear.filter(g=>!g.equippedSlots.length);
    const slots:Record<string,string>={leftHand:'左手',rightHand:'右手',head:'头部',torso:'身体',back:'背部'};
    this.labels.inventoryTitle.text=r.name+' · 随身物品';
    const text=`采集袋  ${r.inventory} / 30\n木材 ${r.supplies?.wood??0}    石料 ${r.supplies?.stone??0}    食物 ${r.supplies?.food??0}\n\n已装备\n${worn.map(g=>g.equippedSlots.map(s=>slots[s]).join(' / ')+' · '+g.label).join('\n')||'无'}\n\n背包内\n${bag.map(g=>'· '+g.label).join('\n')||'暂无未装备物品'}\n\n心情随饥饿、疲劳、疼痛和是否有住处缓慢变化。`;
    if(this.labels.inventoryBody.text!==text){const scroll=this.labels.inventoryBody.scrollY;this.labels.inventoryBody.text=text;this.labels.inventoryBody.scrollY=scroll;}
  }
  private beginZone():void{this.hideModals();this.zoneDrawing=true;this.zoneDraft=null;this.zoneStart=null;this.drag=null;this.updateZoneHint();}
  private cancelZone():void{this.zoneDrawing=false;this.zoneDraft=null;this.zoneStart=null;this.drag=null;this.hudDirty=true;this.drawZones();this.updateZoneHint();}
  private commitZone():void{if(!this.zoneDraft||validateZone(this.zoneDraft))return;const accepted=this.api.onTask({kind:'residential',resource:'wood',amount:1,note:'',bounds:{...this.zoneDraft}});if(accepted!==false)this.cancelZone();}
  private updateZoneHint():void{
    this.buttons.zoneCancel.root.visible=this.zoneDrawing;this.buttons.zoneConfirm.root.visible=this.zoneDrawing;this.labels.zoneHint.visible=this.zoneDrawing;
    if(!this.zoneDrawing)return;const error=this.zoneDraft?validateZone(this.zoneDraft):'单指拖出范围，再确认';
    this.buttons.zoneConfirm.root.mouseEnabled=!!this.zoneDraft&&!error;this.buttons.zoneConfirm.root.alpha=error ? .45 : 1;
    this.labels.zoneHint.text=error??`${this.zoneDraft!.maxX-this.zoneDraft!.minX}×${this.zoneDraft!.maxZ-this.zoneDraft!.minZ}格 · 当前空地可容纳${this.state?homeSites(this.state.world,this.zoneDraft!).length:0}间`;
  }
  private drawZones():void{
    const zones=this.state?.world.camp?.zones??[],key=JSON.stringify([zones,this.zoneDraft]);if(key===this.zoneRevision)return;this.zoneRevision=key;this.zoneLines.clear();
    const draw=(b:ResidentialBounds,color:string)=>{const {minX:x,maxX:r,minZ:z,maxZ:f}=b;const p=[{x,y:.055,z},{x:r,y:.055,z},{x:r,y:.055,z:f},{x,y:.055,z:f}];for(let i=0;i<4;i++)this.line(this.zoneLines,p[i],p[(i+1)%4],color);for(let gx=Math.ceil(x);gx<r;gx+=2)this.line(this.zoneLines,{x:gx,y:.05,z},{x:gx,y:.05,z:f},color);for(let gz=Math.ceil(z);gz<f;gz+=2)this.line(this.zoneLines,{x,y:.05,z:gz},{x:r,y:.05,z:gz},color);};
    for(const zone of zones)draw(zone.bounds,'#9eb690');if(this.zoneDraft)draw(this.zoneDraft,validateZone(this.zoneDraft)?'#dc8f75':'#f2d08a');
  }

  private applyQuality():void{this.camera.msaa=this.highQuality;L.stage.frameRate=this.highQuality?L.Stage.FRAME_FAST:L.Stage.FRAME_SLOW;this.buttons.quality?.set(this.highQuality?'画面：精细优先':'画面：流畅优先');}
  private layoutInspector():void{
    const left=this.sceneLeft;this.inspector.visible=!this.sidebarCollapsed;
    for(const id of ['quickHistory','quickMap'])this.buttons[id].root.visible=this.sidebarCollapsed;this.buttons.quickSenses.root.visible=true;this.buttons.quickSenses.root.pos(this.sidebarCollapsed?192:21,this.sidebarCollapsed?670:87);this.buttons.quickSenses.root.visible=this.sidebarCollapsed;
    this.camera.normalizedViewport=new L.Viewport(left/WIDTH,TOP/HEIGHT,(WIDTH-left)/WIDTH,(BOTTOM-TOP)/HEIGHT);
    this.sceneInput.pos(left,TOP);this.sceneInput.size(WIDTH-left,BOTTOM-TOP);this.sceneInput.hitArea=new L.Rectangle(0,0,WIDTH-left,BOTTOM-TOP);
    this.labels.caption.x=this.sidebarCollapsed?195:315;this.labels.taskSummary.x=this.sidebarCollapsed?195:320;
    for(const {panel,width}of this.modalLayouts)panel.x=left+(WIDTH-left-width)/2-320;
    this.applyQuality();this.updateInspectorButton();this.drag=null;this.positionLabels();
  }
  private updateInspectorButton():void{const r=this.state?.world.residents.find(r=>r.id===this.state?.selectedId);this.buttons.inspectorToggle.set(this.sidebarCollapsed?(this.selectedObject?'物体':r?.name??'居民')+' · 信息 ›':'‹ 收起信息');}
  private hideModals():void{this.hudDirty=true;for(const panel of [this.planner,this.workshopPanel,this.historyPanel,this.memoryPanel,this.controlPanel,this.inventoryPanel])if(panel)panel.visible=false;}
  private modal(name:string,width=910):any{const p=new L.Sprite();p.name=name;p.zOrder=20;this.root.addChild(p);this.modalLayouts.push({panel:p,width});const background=this.panel(p,320,145,width,450,palette.panel,12);background.mouseEnabled=true;background.hitArea=new L.Rectangle(0,0,width,450);p.visible=false;return p;}
  private modalButton(parent:any,id:string,label:string,x:number,y:number,w:number,fn:()=>void,bright=true):NativeButton{const b=this.button(id,label,x,y,w,fn,bright);parent.addChild(b.root);return b;}
  private buildPlanner():void{
    this.planner=this.modal('Camp planner');
    this.text(this.planner,'规划营地',344,166,23,'#f1f4dc',500);
    this.text(this.planner,'把目标写上公告板，居民亲自阅读后，自主接取、备料与执行。',344,205,13,palette.muted,840);
    const add=(id:string,label:string,x:number,y:number,w:number,fn:()=>void)=>this.modalButton(this.planner,id,label,x,y,w,fn);
    for(const [i,kind]of (['gather','craft','residential'] as const).entries())add('kind-'+kind,['采集物资','制作工具','划居住区'][i],344+i*131,239,121,()=>{this.draftKind=kind;});
    this.labels.draftTitle=this.text(this.planner,'',344,292,17,'#f1f4dc',385);
    for(const [i,resource]of (['wood','stone','food'] as const).entries())add('task-'+resource,RESOURCE_LABELS[resource],344+i*125,330,115,()=>{this.draftResource=resource;});
    for(const [i,recipe]of RECIPES.filter(r=>r.kind==='craft').entries())add('recipe-'+recipe.id,recipe.label,344+i*184,330,174,()=>{this.draftRecipe=recipe.id;});
    this.labels.zonePlanner=this.text(this.planner,'',344,329,14,palette.mint,374);
    add('amount','数量 8',344,379,110,()=>{this.draftAmount=this.draftKind==='craft'?(this.draftAmount>=3?1:this.draftAmount+1):(this.draftAmount>=20?4:this.draftAmount+4);});
    this.labels.requirements=this.text(this.planner,'',469,379,12,'#c9d8bd',250);this.labels.requirements.height=40;
    this.taskNote=new L.Input();this.taskNote.pos(344,430);this.taskNote.size(374,36);this.taskNote.fontSize=14;this.taskNote.color='#26352c';this.taskNote.bgColor='#e0e6d9';this.taskNote.prompt='目标说明（可选）';this.taskNote.maxChars=120;this.planner.addChild(this.taskNote);
    this.labels.draftHelp=this.text(this.planner,'',344,481,12,palette.muted,380);this.labels.draftHelp.height=43;
    this.text(this.planner,'已发布的目标',756,246,14,palette.mint,430);
    this.labels.taskList=this.text(this.planner,'',756,282,13,'#e5f1df',448);this.labels.taskList.height=207;this.labels.taskList.overflow='hidden';
    this.labels.stock=this.text(this.planner,'',756,496,13,palette.amber,442);
    add('publishTask','发布目标',344,535,204,()=>{if(this.draftKind==='residential'){this.beginZone();return;}this.api.onTask({kind:this.draftKind,resource:this.draftResource,amount:this.draftKind==='craft'?Math.min(3,this.draftAmount):this.draftAmount,note:this.taskNote.text,recipeId:this.draftRecipe});this.taskNote.text='';});
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
  private setZoom(value:number):void{this.zoom=boundedZoom(value);this.camera.orthographicVerticalSize=this.zoom;this.positionLabels();}
  private groundAt(x:number,y:number):{x:number;z:number}{
    const a=this.project({x:0,y:0,z:0}),b=this.project({x:1,y:0,z:0}),c=this.project({x:0,y:0,z:1});
    const bx=b.x-a.x,by=b.y-a.y,cx=c.x-a.x,cy=c.y-a.y,d=bx*cy-by*cx;
    return {x:((x-a.x)*cy-(y-a.y)*cx)/d,z:((y-a.y)*bx-(x-a.x)*by)/d};
  }
  private touches(e:any):any[]{return (e?.touches??[]).filter((t:any)=>t.began&&t.downTargets?.includes(this.sceneInput));}
  private pointerDown(e:any):void{
    const ts=this.touches(e);if(ts.length>=2){const [a,b]=ts;this.pinch={distance:Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y),zoom:this.zoom,anchor:this.groundAt((a.pos.x+b.pos.x)/2,(a.pos.y+b.pos.y)/2)};this.suppressTap=true;this.drag=null;this.zoneStart=null;return;}
    if(this.pinch)return;this.suppressTap=false;
    const x=e?.stageX??L.stage.mouseX,y=e?.stageY??L.stage.mouseY;
    this.drag={x,y,ox:this.offset.x,oz:this.offset.z,moved:false};if(this.zoneDrawing){this.zoneStart=this.groundAt(x,y);this.zoneDraft=null;}
  }
  private pointerMove(e:any):void{
    const ts=this.touches(e);if(ts.length>=2){if(!this.pinch)this.pointerDown(e);if(!this.pinch)return;const [a,b]=ts;
      this.setZoom(pinchZoom(this.pinch.zoom,this.pinch.distance,Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y)));
      const point=this.groundAt((a.pos.x+b.pos.x)/2,(a.pos.y+b.pos.y)/2);this.offset.x+=this.pinch.anchor.x-point.x;this.offset.z+=this.pinch.anchor.z-point.z;this.moveCamera();this.positionLabels();return;
    }
    if(!this.drag)return;const x=e?.stageX??L.stage.mouseX,y=e?.stageY??L.stage.mouseY,dx=x-this.drag.x,dy=y-this.drag.y;
    this.drag.travel=(this.drag.travel??0)+Math.hypot(dx,dy);if(this.drag.travel>7)this.drag.moved=true;
    if(this.zoneDrawing&&this.zoneStart){this.zoneDraft=zoneBounds(this.zoneStart,this.groundAt(x,y));this.drawZones();this.updateZoneHint();return;}
    const from=this.groundAt(this.drag.x,this.drag.y),to=this.groundAt(x,y);this.offset.x+=from.x-to.x;this.offset.z+=from.z-to.z;this.drag.x=x;this.drag.y=y;this.moveCamera();this.positionLabels();
  }
  private pointerUp(e:any):void{
    const ts=this.touches(e).filter((t:any)=>t.touchId!==e.touchId);
    if(this.pinch||this.suppressTap){this.pinch=null;this.drag=null;if(ts.length===1)this.drag={x:ts[0].pos.x,y:ts[0].pos.y,ox:this.offset.x,oz:this.offset.z,moved:true};if(!ts.length)this.suppressTap=false;return;}
    const drag=this.drag;this.drag=null;if(!drag||!this.state)return;
    if(e?.nativeEvent?.type==='touchcancel'){this.zoneStart=null;return;}
    if(this.zoneDrawing){this.zoneStart=null;this.updateZoneHint();return;}if(drag.moved)return;
    const x=e?.stageX??L.stage.mouseX,y=e?.stageY??L.stage.mouseY;
    if(x<this.sceneLeft||y<TOP||y>BOTTOM)return;
    const hits=this.state.world.residents.map(r=>{const top=this.project({...r.position,y:r.position.y+1.95}),base=this.project(r.position),nearY=Math.max(top.y,Math.min(base.y,y));return {id:r.id,distance:Math.hypot(top.x-x,nearY-y)};}).filter(h=>h.distance<24);
    const id=cycleHit(hits,this.state.selectedId);if(id){this.selectedObject=null;this.api.onSelect(id);}else{
      const candidates=this.state.world.objects.map(o=>{const p=this.project({...o.position,y:Math.min(o.height*.45,1.4)}),base=this.project(o.position),edge=this.project({...o.position,x:o.position.x+o.width/2});const radius=Math.max(22,Math.abs(edge.x-base.x)+12);const top=this.project({...o.position,y:o.height}),nearY=Math.max(top.y,Math.min(base.y,y));const d=Math.hypot(base.x-x,nearY-y);return {o,d,radius};}).filter(v=>v.d<v.radius).sort((a,b)=>a.d-b.d);
      if(!candidates.length)return;this.selectedObject=candidates[0].o.id;
    }
    const anchor=this.groundAt(x,y);this.sidebarCollapsed=false;this.hudDirty=true;this.senseRevision='';this.layoutInspector();
    if(x>SIDE+10){const shifted=this.groundAt(x,y);this.offset.x+=anchor.x-shifted.x;this.offset.z+=anchor.z-shifted.z;this.moveCamera();this.positionLabels();}
  }
  private moveCamera():void{this.camera.transform.position=new L.Vector3(this.offset.x,28,this.offset.z+20);this.camera.transform.lookAt(new L.Vector3(this.offset.x,0,this.offset.z),new L.Vector3(0,1,0),false,true);}
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
      if(!node){node=new CharacterMesh(r);this.scene.addChild(node.node);this.residents.set(r.id,node);const t=this.text(this.markers,r.name,0,0,13,palette.ink,120);t.align='center';t.bold=true;t.stroke=2;t.strokeColor='#252c24';t.color='#fff4d8';t.mouseEnabled=false;this.nameLabels.set(r.id,t);const speech=this.text(this.markers,'',0,0,14,palette.ink,230);speech.bgColor='#e7dfc8';speech.color='#28332a';speech.padding=[7,9,7,9];speech.align='center';speech.mouseEnabled=false;this.speechLabels.set(r.id,speech);}
      node.update(r);
    }
    const ids=new Set(world.objects.map(o=>o.id));
    for(const [id,node]of this.objects)if(!ids.has(id)){node.dispose();this.objects.delete(id);this.objectSignatures.delete(id);this.placeLabels.get(id)?.destroy();this.placeLabels.delete(id);}
    for(const o of world.objects){const signature=[o.kind,o.buildStage,resourceStage(o)].join(':');if(this.objectSignatures.get(o.id)!==signature){this.objects.get(o.id)?.dispose();const node=new WorldMesh(o);this.scene.addChild(node.node);node.setRoofVisible(this.showRoofs);this.objects.set(o.id,node);this.objectSignatures.set(o.id,signature);}
      if(['board','workbench','plot','house','pond'].includes(o.kind)){let label=this.placeLabels.get(o.id);if(!label){label=this.text(this.markers,'',0,0,12,'#365346',168);label.align='center';label.color='#e7ddbf';label.stroke=2;label.strokeColor='#30382b';label.width=150;label.padding=[3,5,3,5];this.placeLabels.set(o.id,label);}label.text=o.kind==='board'?'公告板 · 仓储':o.kind==='workbench'?'工作台':o.kind==='pond'?'池塘':o.kind==='house'?(world.residents.find(r=>r.id===o.ownerId)?.name??'公共')+'的小屋':`小屋施工 · ${o.buildStage??0}/3`;}
    }
    this.drawZones();this.positionLabels();
  }
  private project(p:{x:number;y:number;z:number}):{x:number;y:number}{const out=new L.Vector4();this.camera.worldToViewportPoint(new L.Vector3(p.x,p.y,p.z),out);return {x:out.x,y:out.y};}
  private positionLabels():void{if(!this.state)return;for(const r of this.state.world.residents){const p=this.project({...r.position,y:r.position.y+(this.residents.get(r.id)?.height??1.9)+.25});const t=this.nameLabels.get(r.id);if(t){t.pos(p.x-60,p.y-10);t.visible=p.x>this.sceneLeft+10&&p.x<WIDTH-10&&p.y>TOP+24&&p.y<BOTTOM-20;}
    const speech=this.speechLabels.get(r.id);if(speech){const fragments=this.state.world.sounds.filter(s=>s.sourceId===r.id&&this.state!.world.tick-s.emittedTick<3000/defaults.simulation.fixedDtMs);const text=fragments.map(s=>s.text).join('').slice(-55);speech.text=text?`“${text}”`:'';speech.visible=!!text&&t?.visible;const offset=this.state.world.residents.indexOf(r)%2?-5:-225;speech.pos(Math.max(this.sceneLeft+12,Math.min(WIDTH-242,p.x+offset)),Math.max(TOP+30,p.y-75));}}
    for(const object of this.state.world.objects){const label=this.placeLabels.get(object.id);if(!label)continue;const p=this.project({...object.position,y:0,z:object.position.z+(object.kind==='house'||object.kind==='plot'?2.5:object.kind==='pond'?3.1:1)});let captionY=p.y+7;for(const r of this.state.world.residents){const rp=this.project({...r.position,y:1});if(Math.abs(rp.x-p.x)<95&&Math.abs(rp.y-captionY)<42)captionY=Math.max(captionY,rp.y+42);}label.pos(p.x-75,captionY);label.visible=p.x>this.sceneLeft+85&&p.x<WIDTH-85&&p.y>TOP+64&&p.y<BOTTOM-30;}
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
    this.state=state;const worldKey=[state.world.runId,state.world.revision,state.world.tick].join(':');
    if(worldKey!==this.worldRevision){this.drawWorld(state.world);this.worldRevision=worldKey;}
    const senseKey=[worldKey,state.selectedId,state.showSenses].join('|');if(senseKey!==this.senseRevision){this.drawSenses(state);this.senseRevision=senseKey;}
    const mapKey=worldKey+'|'+state.selectedId;if(this.memoryPanel?.visible&&(this.hudDirty||this.mapRevision!==mapKey)){const remembered=state.world.residents.find(r=>r.id===state.selectedId);if(remembered)this.memoryMap.render(remembered);this.mapRevision=mapKey;}
    const hudKey=[worldKey,state.selectedId,state.showSenses,state.status,state.mode,state.error,state.hosted,state.cognitionDetail,state.controlDetail,state.controlNotice,state.fallbackActive,state.historyVersion,state.historyWarning,state.summaryVersion,state.summaryBusy,state.summaryError,state.pendingTasks].join('|');
    if(!this.hudDirty&&this.hudRevision===hudKey)return;this.hudDirty=false;this.hudRevision=hudKey;
    this.updateInspectorButton();
    this.labels.gateway.visible=this.token.visible=this.buttons.connect.root.visible=!state.hosted;
    this.labels.hosted.visible=Boolean(state.hosted);
    const r=state.world.residents.find(x=>x.id===state.selectedId)||state.world.residents[0];
    const control=state.control??{...DEFAULT_CONTROL,mode:'independent' as const};
    const mode=state.mode==='LOCAL_ALGORITHM'?'本地算法 · 无远程模型':state.mode==='UNCONFIGURED'?'尚未接入真实模型':state.mode==='REPLAY'?'观察回放 · 不调用模型':control.mode==='commander'?'模型统筹 · 阶段执行':'真实模型 · 独立居民';
    this.labels.mode.text=mode;this.labels.status.text=(state.controlDetail&&!['THINKING','ERROR_PAUSED'].includes(state.status)?state.controlDetail:this.humanStatus(state.status)+(state.cognitionDetail?' · '+state.cognitionDetail:''));this.labels.status.overflow='hidden';this.labels.status.height=26;
    this.buttons.start.set('开始运行');
    if(this.controlPanel.visible){const d=this.controlDraft;for(const m of ['commander','independent','local']){const t=this.buttons['mode-'+m].label;t.color=m===d.mode?'#14271b':'#314030';t.bold=m===d.mode;t.underline=m===d.mode;}this.labels.controlHelp.text=d.mode==='commander'?'一个glm-4.5-air统筹阶段目标；执行器持续完成走路、采集、搬运和施工。每人记忆独立。阶段结束、新任务或持续受阻时汇总复查；最短间隔按模拟时间计算。':d.mode==='independent'?'每名居民独立调用真实模型，只读自己的感官与记忆。保留原有认知触发；模型失败保持暂停，可手动切换本地模式。':'完全本地任务算法，免密钥、免远程请求；不是大模型。根据任务和有限感知执行采集、备料、制作与分步建房。';this.buttons.phaseSize.set('阶段工作量：'+d.phaseUnits+'份');this.buttons.reviewGap.set('模型最短间隔：'+d.reviewSeconds+'秒');this.buttons.crewCount.set('新营地人数：'+d.residents);this.buttons.localFallback.set('统筹失败自动转本地：'+(d.fallback?'开':'关'));}
    const action=r?.plan.find(p=>!p.done);this.labels.action.text=action?`实际动作：${readableAction(action.action.op)} · 已执行${(action.elapsedTicks*.05).toFixed(1)}秒${['THINKING','COMMITTING','ERROR_PAUSED'].includes(state.status)?'（冻结）':''}`:'实际动作：等待下一项计划';
    const seconds=Math.floor(state.world.tick*defaults.simulation.fixedDtMs/1000);this.labels.time.text=`模拟 ${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
    for(let i=0;i<2;i++){const person=state.world.residents[this.residentPage()+i];this.buttons['resident'+i].set(person?`${person.id===state.selectedId?'●  ':''}${person.name}`:'暂无居民');this.buttons['memoryPerson'+i].set(person?person.name+'的地图':'暂无居民');}
    if(r)this.renderResident(r,state);this.renderObject(state);this.renderResources(state);
    this.buttons.senses.set(`感官 ${state.showSenses?'开':'关'}`);this.buttons.quickSenses.set(`感官 ${state.showSenses?'开':'关'}`);
    this.buttons.pause.set(/PAUS|STOP|暂停/i.test(state.status)?'继续':'暂停');
    this.labels.error.text=state.controlNotice?state.controlNotice:state.error?state.error.slice(0,260)+(state.status==='ERROR_PAUSED'?'\n世界保持冻结，可修正连接后重试。':''):state.mode==='UNCONFIGURED'?'这是静态观察场。请先配置模型服务并连接网关。\n连接真实模型后，居民才会自主相遇、交流。':'';
    this.labels.caption.text=this.zoneDrawing?'圈选居住区 · 单指拖出范围，双指调整地图':state.mode==='REPLAY'?'回放现场 · 按模拟时间播放':state.world.camp?'双指缩放 · 单指拖动 · 点击查看 · 重叠再点切换':'两名居民 · 两棵树 · 一堵墙';
    const tasks=state.world.camp?.tasks??[],recipe=RECIPES.find(r=>r.id===this.draftRecipe)!;
    this.buttons.publishTask.set(this.draftKind==='residential'?'到地图圈选居住区':this.draftKind==='craft'?`发布${recipe.label}制作目标`:`发布${RESOURCE_LABELS[this.draftResource]}目标`);
    for(const kind of ['gather','craft','residential'])this.buttons['kind-'+kind].label.color=kind===this.draftKind?'#14271b':'#314030';
    for(const resource of ['wood','stone','food']){this.buttons['task-'+resource].root.visible=this.draftKind==='gather';this.buttons['task-'+resource].set((this.draftResource===resource?'● ':'')+RESOURCE_LABELS[resource as TaskDraft['resource']]);}
    for(const entry of RECIPES.filter(r=>r.kind==='craft')){this.buttons['recipe-'+entry.id].root.visible=this.draftKind==='craft';this.buttons['recipe-'+entry.id].set((this.draftRecipe===entry.id?'● ':'')+entry.label);}
    this.labels.zonePlanner.visible=this.draftKind==='residential';this.labels.zonePlanner.text='单指拖出矩形区域 · 自由选择位置和大小\n双指仍可缩放、移动地图';
    this.buttons.amount.root.visible=this.draftKind!=='residential';this.buttons.amount.set('数量 '+(this.draftKind==='craft'?Math.min(3,this.draftAmount):this.draftAmount));
    this.labels.draftTitle.text=this.draftKind==='residential'?'居住区 · 居民按需申请自己的住处':this.draftKind==='craft'?'制作并由居民自行装备工具':'采集营地的基础物资';
    this.labels.requirements.pos(this.draftKind==='residential'?344:469,379);this.labels.requirements.width=this.draftKind==='residential'?374:250;
    this.labels.requirements.text=this.draftKind==='residential'?'每间需12木材 + 8石料 · 区域至少6×6格':this.draftKind==='craft'?'每件：'+materialText(recipe.cost):'居民可自由选择参与';
    this.labels.draftHelp.text=this.draftKind==='residential'?'划区后确认，居民阅读公告后自主申请、备料与建房。区域可容纳多间房；树石、池塘及已有建筑会被避开。':this.draftKind==='craft'?'先读工作台配方；消耗自己的随身材料。成品归制作者，需要自行持握。':'采集计入目标，入库由居民自主搬运。';
    this.labels.taskSummary.text=`营地目标 ${tasks.filter(t=>t.status==='done').length}/${tasks.filter(t=>t.kind!=='residential').length} 已完成 · 居住区${state.world.camp?.zones?.length??0}${state.pendingTasks?` · ${state.pendingTasks}项待写入公告`:''}`;
    this.labels.taskList.text=tasks.slice(-6).map(t=>`${t.status==='done'?'✓':'○'} ${taskTitle(t)} ${t.progress}/${t.amount}${t.kind==='house'&&t.status==='open'?' · 待'+HOUSE_STEPS[t.progress]?.label:''}\n   ${t.acceptedBy.map(id=>state.world.residents.find(r=>r.id===id)?.name).join('、')||'尚无人接受'}${t.note?' · '+t.note.slice(0,24):''}`).join('\n');
    this.labels.stock.text='公共仓储：'+(materialText(state.world.camp?.stock??{})||'暂无材料');
    this.labels.taskNotice.text=state.pendingTasks?`已排队${state.pendingTasks}项，世界恢复后写入`:(state.error??'').slice(0,70);
    this.renderHistory(state);if(this.inventoryPanel.visible&&r)this.renderInventory(r);this.updateZoneHint();
  }
  private humanStatus(status:string):string{const map:Record<string,string>={RUNNING:'世界运行中',PAUSED:'观察者已暂停',THINKING:'居民正在思考 · 世界已冻结',COMMITTING:'完整决策批次正在提交 · 世界保持冻结',READY:'准备开始',PLAYING:'回放播放中 · 不调用模型',BUFFERING:'回放缓冲中',ERROR_PAUSED:'认知请求失败 · 世界保持冻结',WAITING_FOR_MODEL:'模型思考中 · 世界已冻结',WAITING:'模型思考中 · 世界已冻结',ERROR:'认知请求失败 · 世界保持冻结',IDLE:'准备开始',STOPPED:'已停止',UNCONFIGURED:'未配置真实模型'};return map[status]||status;}
}
