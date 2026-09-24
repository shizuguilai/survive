import type { World, SensoryOverlay } from '../../../packages/sim-core/src/domain.ts';
import {RESOURCE_LABELS,type TaskDraft} from '../../../packages/sim-core/src/camp.ts';
import {MemoryMapView} from './memory-map.ts';
import {CharacterMesh} from './character-mesh.ts';
import {WorldMesh} from './world-mesh.ts';
import {RECIPES,BUILD_SITES,HOUSE_STEPS,materialText,taskTitle,skillLevel} from '../../../packages/sim-core/src/recipes.ts';
import {selectJournal,journalTime,JOURNAL_LABELS,readableAction,type JournalEntry,type JournalCategory} from './journal.ts';
import {summaryInput,latestSummary} from './journal-summary.ts';
import type {SummaryRequest,SavedSummary} from '../../../packages/contracts/src/journal-summary.ts';
import {publicCharacterSummary} from '../../../packages/sim-core/src/character.ts';
import defaults from '../../../packages/sim-core/defaults.json' with {type:'json'};

export type ViewCallbacks = {
  onSummarize?(request:SummaryRequest):void;
  onTask(draft:TaskDraft):void;
  onPause():void; onResume():void; onRetry():void; onStop():void;
  onSelect(id:string):void; onToggleSenses():void; onReplay():void; onLive():void;
  onSeek(tick:number):void; onSpeed(value:number):void; onStart():void; onConnect(token:string):void;
};
export type ViewState = {
  summaries?:SavedSummary[];summaryBusy?:boolean;summaryError?:string;summaryVersion?:number;
  cognitionDetail?:string;
  history?:JournalEntry[];historyVersion?:number;historyWarning?:string;
  pendingTasks?:number;world:World; overlays:Record<string,SensoryOverlay>; status:string; error?:string;
  mode:'UNCONFIGURED'|'REAL_MODEL'|'REPLAY'; selectedId:string; showSenses:boolean;
  playbackTick:number; maxTick:number; speed:number; hosted?:boolean;
};

// All visible controls and graphics use Laya. Only its engine-owned Input bridge
// uses platform input facilities; no game scene, HUD, or controls use DOM rendering.
const L:any=(globalThis as any).Laya;
const WIDTH=1280,HEIGHT=720,SIDE=292,TOP=84,BOTTOM=614;
const palette={ink:'#172b2d',muted:'#8da19c',paper:'#f4f2e9',panel:'#142f31',line:'#325153',mint:'#9ee3be',amber:'#f3c87c'};
type HistoryRow=JournalEntry&{title:string;evidence?:JournalEntry[]};
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
  private residents=new Map<string,CharacterMesh>();private objects=new Map<string,WorldMesh>();private objectSignatures=new Map<string,string>();private placeLabels=new Map<string,any>();
  private nameLabels=new Map<string,any>();private speechLabels=new Map<string,any>();private senseLines:any;private selection:any;
  private memoryPanel:any;private memoryMap!:MemoryMapView;
  private planner:any;private taskNote:any;private draftResource:TaskDraft['resource']='wood';private draftAmount=8;private vitality:any;
  private draftKind:'gather'|'craft'|'house'='gather';private draftRecipe='stone_axe';private draftSite='east';
  private historyPanel:any;private workshopPanel:any;private historyFilter:JournalCategory|'all'|'summary'='action';private historyPage=0;private historyAllRuns=true;private historyDetail:HistoryRow|null=null;
  private historyRows:any[]=[];private displayedHistory:HistoryRow[]=[];private historySnapshot:JournalEntry[]|null=null;private historySnapshotScope='';private historySummaryRunId='';private historyCache='';
  private state:ViewState|null=null;private token:any;private timeline:any;
  private offset={x:0,z:0};private drag:{x:number;y:number;ox:number;oz:number;moved:boolean}|null=null;
  private markers:any;private sceneInput:any;private zoom=26;private scrubbing=false;

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
    this.mesh('ground',L.PrimitiveMesh.createBox(72,.12,72),{x:0,y:-.12,z:0},'#cbd4b5');
    this.mesh('central clearing',L.PrimitiveMesh.createCylinder(5,.025,40),{x:0,y:-.038,z:0},'#d8cfaf');
    this.mesh('east west path',L.PrimitiveMesh.createBox(23,.02,1.6),{x:0,y:-.02,z:0},'#c5bc9c');
    this.mesh('north path',L.PrimitiveMesh.createBox(1.5,.02,14),{x:0,y:-.018,z:-3},'#c5bc9c');
    for(const [x,z,r,c] of [[-11,7,8,'#b9cb9f'],[10,9,7,'#c4c1a7'],[9,-9,7,'#b4c79a'],[-12,-10,4,'#bfc5a6']] as const)this.mesh('terrain region',L.PrimitiveMesh.createCylinder(r,.015,25),{x,y:-.03,z},c);
    for(let i=0;i<48;i++){const a=i*2.4,r=15+(i%7)*2;this.mesh('grass tuft',L.PrimitiveMesh.createBox(.08,.15+(i%3)*.06,.15),{x:Math.cos(a)*r,y:.015,z:Math.sin(a)*r},i%2?'#a6b788':'#afbe92');}
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
    const t=new L.Text();t.text=text;t.pos(x,y);t.font='Noto Sans CJK SC, Microsoft YaHei, Arial, sans-serif';t.fontSize=size;t.color=color;t.width=width;t.wordWrap=true;t.leading=5;t.mouseEnabled=false;parent.addChild(t);return t;
  }
  private panel(parent:any,x:number,y:number,w:number,h:number,color:string,r=0):any{
    const s=new L.Sprite();s.pos(x,y);s.size(w,h);
    if(r)s.graphics.drawRoundRect(0,0,w,h,r,r,r,r,color);else s.graphics.drawRect(0,0,w,h,color);
    parent.addChild(s);return s;
  }
  private button(id:string,text:string,x:number,y:number,w:number,click:()=>void,bright=false):NativeButton{
    const r=this.panel(this.root,x,y,w,35,bright?palette.mint:palette.line,7);r.mouseEnabled=true;r.name=id;r.hitArea=new L.Rectangle(0,0,w,35);
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
    this.labels.status=this.text(this.root,'世界尚未启动',323,47,12,'#60786d',663);
    this.labels.time=this.text(this.root,'模拟 00:00',1000,21,24,palette.ink,250);this.labels.time.align='right';
    this.text(this.root,'等待模型时，全世界静止',1000,54,12,'#60786d',250).align='right';
    this.text(this.root,'观察对象',20,104,12,palette.muted);
    this.button('resident0','居民 A',18,129,121,()=>this.selectIndex(0));this.button('resident1','居民 B',151,129,121,()=>this.selectIndex(1));
    this.labels.person=this.text(this.root,'选择一名居民',21,186,24,'#f1f4dc',252);this.labels.person.bold=true;
    this.labels.personality=this.text(this.root,'每个人只拥有自己的感官与记忆。',21,220,11,'#aac2b7',250);this.labels.personality.height=24;this.labels.personality.overflow='hidden';
    this.labels.vitality=this.text(this.root,'',21,244,10,'#e5f1df',252);this.vitality=new L.Sprite();this.vitality.pos(21,260);this.root.addChild(this.vitality);
    this.panel(this.root,20,267,252,1,palette.line);
    this.text(this.root,'此刻的私人感知',20,285,12,palette.muted);
    this.labels.perception=this.text(this.root,'暂无感知事件',20,312,14,'#e5f1df',250);this.labels.perception.height=118;this.labels.perception.overflow='hidden';
    this.text(this.root,'当前意图',20,444,12,palette.muted);
    this.labels.goal=this.text(this.root,'尚未得到真实模型决策',20,468,14,'#e5f1df',252);this.labels.goal.height=40;this.labels.goal.overflow='hidden';
    this.labels.action=this.text(this.root,'实际动作：尚未开始',20,516,11,palette.amber,252);this.labels.action.height=16;this.labels.action.overflow='hidden';
    this.button('history','历史 / 档案',18,538,121,()=>this.openHistory(),true);
    this.button('senses','感官显示 开',151,538,121,()=>this.api.onToggleSenses());
    this.labels.person.mouseEnabled=true;this.labels.person.on(L.Event.CLICK,this,()=>this.openHistory());
    this.button('memoryMap','地图记忆 · 个人探索',18,577,254,()=>{this.hideModals();this.memoryPanel.visible=true;},true);
    this.text(this.root,'青绿：视野 · 金环：无墙无噪声参考\n橙线：听见的方向 · 蓝圈：最后已知',20,617,11,'#95b3a6',254);
    this.labels.equipment=this.text(this.root,'',20,653,10,'#aac2b7',254);this.labels.equipment.height=36;this.labels.equipment.overflow='hidden';
    this.text(this.root,'摄影机可拖动；暂停时仍可观察。',20,685,11,'#95b3a6',254);
    this.sceneInput=new L.Sprite();this.sceneInput.pos(SIDE,TOP);this.sceneInput.size(WIDTH-SIDE,BOTTOM-TOP);this.sceneInput.mouseEnabled=true;
    this.sceneInput.hitArea=new L.Rectangle(0,0,WIDTH-SIDE,BOTTOM-TOP);this.root.addChild(this.sceneInput);
    this.sceneInput.on(L.Event.MOUSE_DOWN,this,()=>{this.drag={x:L.stage.mouseX,y:L.stage.mouseY,ox:this.offset.x,oz:this.offset.z,moved:false};});
    this.sceneInput.on(L.Event.MOUSE_WHEEL,this,(e:any)=>{this.zoom=Math.max(10,Math.min(68,this.zoom-e.delta));this.camera.orthographicVerticalSize=this.zoom;this.positionLabels();});
    this.markers=new L.Sprite();this.markers.mouseEnabled=false;this.root.addChild(this.markers);
    this.labels.caption=this.text(this.root,'两名居民 · 两棵树 · 一堵墙',315,97,12,'#426356',430);
    this.labels.caption.mouseEnabled=false;
    this.button('zoomOut','−',966,94,38,()=>{this.zoom=Math.min(68,this.zoom+6);this.camera.orthographicVerticalSize=this.zoom;this.positionLabels();});
    this.button('zoomIn','＋',1014,94,38,()=>{this.zoom=Math.max(10,this.zoom-6);this.camera.orthographicVerticalSize=this.zoom;this.positionLabels();});
    this.button('workshop','工作台配方',812,94,140,()=>{this.hideModals();this.workshopPanel.visible=true;});
    this.button('tasks','规划 / 建房',1064,94,185,()=>{this.hideModals();this.planner.visible=true;},true);
    this.labels.taskSummary=this.text(this.root,'',320,122,12,'#426356',560);this.labels.taskSummary.mouseEnabled=false;
    this.labels.error=this.text(this.root,'',326,494,16,'#7b3e24',908);this.labels.error.height=104;this.labels.error.overflow='hidden';this.labels.error.mouseEnabled=false;
    this.button('start','开始真实认知',315,628,130,()=>this.api.onStart(),true);
    this.button('pause','暂停',455,628,72,()=>{const paused=/PAUS|STOP|暂停/i.test(this.state?.status||'');paused?this.api.onResume():this.api.onPause();});
    this.button('retry','重试',537,628,72,()=>this.api.onRetry());
    this.button('stop','停止',619,628,72,()=>this.api.onStop());
    this.button('replay','查看回放',705,628,104,()=>this.state?.mode==='REPLAY'?this.api.onLive():this.api.onReplay());
    this.button('speed','1× 播放',819,628,94,()=>{const current=this.state?.speed||1;this.api.onSpeed(current>=4?.5:current*2);});
    this.labels.gateway=this.text(this.root,'网关令牌',929,636,12,'#60786d',84);
    this.labels.hosted=this.text(this.root,'云端模型 · 密钥由服务端保管',936,639,12,'#60786d',315);this.labels.hosted.visible=false;
    this.token=new L.Input();this.token.pos(1007,629);this.token.size(152,33);this.token.fontSize=14;this.token.color=palette.ink;this.token.bgColor='#e0e6d9';this.token.type='password';this.token.prompt='仅存当前会话';this.token.promptColor='#7f9688';this.token.padding=[7,7,7,7];this.root.addChild(this.token);
    this.button('connect','连接',1170,628,86,()=>{const token=this.token.text;this.token.text='';this.api.onConnect(token);},true);
    this.timeline=this.panel(this.root,320,681,880,8,'#c8d4c2',4);this.timeline.mouseEnabled=true;this.timeline.hitArea=new L.Rectangle(0,-12,880,34);
    this.timeline.on(L.Event.MOUSE_DOWN,this,()=>{this.scrubbing=true;this.seekAtPointer();});
    this.labels.timeline=this.text(this.root,'暂无回放',1210,675,12,'#60786d',67);
    this.text(this.root,'仅播放模拟时间；网络等待不会出现在回放中',320,699,10,'#82907f',650);
    this.buildPlanner();this.buildWorkshop();this.buildHistory();this.buildMemoryMap();
  }

  private hideModals():void{for(const panel of [this.planner,this.workshopPanel,this.historyPanel,this.memoryPanel])if(panel)panel.visible=false;}
  private modal(name:string,width=910):any{const p=new L.Sprite();p.name=name;this.root.addChild(p);const background=this.panel(p,320,145,width,450,palette.panel,12);background.mouseEnabled=true;background.hitArea=new L.Rectangle(0,0,width,450);p.visible=false;return p;}
  private modalButton(parent:any,id:string,label:string,x:number,y:number,w:number,fn:()=>void,bright=true):NativeButton{const b=this.button(id,label,x,y,w,fn,bright);parent.addChild(b.root);return b;}
  private buildPlanner():void{
    this.planner=this.modal('Camp planner');
    this.text(this.planner,'规划营地',344,166,23,'#f1f4dc',500);
    this.text(this.planner,'把目标写上公告板，居民亲自阅读后，自主接取、备料与执行。',344,205,13,palette.muted,840);
    const add=(id:string,label:string,x:number,y:number,w:number,fn:()=>void)=>this.modalButton(this.planner,id,label,x,y,w,fn);
    for(const [i,kind]of (['gather','craft','house'] as const).entries())add('kind-'+kind,['采集物资','制作工具','建造小屋'][i],344+i*131,239,121,()=>{this.draftKind=kind;});
    this.labels.draftTitle=this.text(this.planner,'',344,292,17,'#f1f4dc',385);
    for(const [i,resource]of (['wood','stone','food'] as const).entries())add('task-'+resource,RESOURCE_LABELS[resource],344+i*125,330,115,()=>{this.draftResource=resource;});
    for(const [i,recipe]of RECIPES.filter(r=>r.kind==='craft').entries())add('recipe-'+recipe.id,recipe.label,344+i*184,330,174,()=>{this.draftRecipe=recipe.id;});
    for(const [i,site]of BUILD_SITES.entries())add('site-'+site.id,site.label.slice(0,2)+'地块',344+i*125,330,115,()=>{this.draftSite=site.id;});
    add('amount','数量 8',344,379,110,()=>{this.draftAmount=this.draftKind==='craft'?(this.draftAmount>=3?1:this.draftAmount+1):(this.draftAmount>=20?4:this.draftAmount+4);});
    this.labels.requirements=this.text(this.planner,'',469,379,12,'#c9d8bd',250);this.labels.requirements.height=40;
    this.taskNote=new L.Input();this.taskNote.pos(344,430);this.taskNote.size(374,36);this.taskNote.fontSize=14;this.taskNote.color=palette.ink;this.taskNote.bgColor='#e0e6d9';this.taskNote.prompt='目标说明（可选）';this.taskNote.maxChars=120;this.planner.addChild(this.taskNote);
    this.labels.draftHelp=this.text(this.planner,'',344,481,12,palette.muted,380);this.labels.draftHelp.height=43;
    this.text(this.planner,'已发布的目标',756,246,14,palette.mint,430);
    this.labels.taskList=this.text(this.planner,'',756,282,13,'#e5f1df',448);this.labels.taskList.height=207;this.labels.taskList.overflow='hidden';
    this.labels.stock=this.text(this.planner,'',756,496,13,palette.amber,442);
    add('publishTask','发布目标',344,535,204,()=>{this.api.onTask({kind:this.draftKind,resource:this.draftResource,amount:this.draftKind==='house'?3:this.draftKind==='craft'?Math.min(3,this.draftAmount):this.draftAmount,note:this.taskNote.text,recipeId:this.draftRecipe,siteId:this.draftSite});this.taskNote.text='';});
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
  private buildMemoryMap():void{
    this.memoryPanel=this.modal('Personal map memory');
    this.text(this.memoryPanel,'地图记忆 · 每个人记住的世界不同',344,166,22,'#f1f4dc',840);
    this.text(this.memoryPanel,'记录本人走过与看见的地方；文字记忆另存对话、约定、行动结果和重要经历。',344,207,12,palette.muted,852);
    this.memoryMap=new MemoryMapView(this.memoryPanel);
    this.modalButton(this.memoryPanel,'memoryPerson0','阿林的地图',344,545,167,()=>this.selectIndex(0));
    this.modalButton(this.memoryPanel,'memoryPerson1','小禾的地图',525,545,167,()=>this.selectIndex(1));
    this.modalButton(this.memoryPanel,'memoryArchive','文字记忆 / 档案',707,545,198,()=>{this.historyFilter='memory';this.openHistory();});
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
      row.on(L.Event.CLICK,this,()=>{this.historyDetail=this.displayedHistory[this.historyPage*5+i]??null;this.labels.historyDetail.scrollY=0;this.historyCache='';});this.historyRows.push({root:row,heading,body});
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
  private turnHistory(direction:number):void{
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
    this.displayedHistory=rows.map(e=>({...e,title:`${journalTime(e.tick)}  ${JOURNAL_LABELS[e.category]}${e.source?' · '+(e.source==='REAL_MODEL'?'真实模型':'Mock 测试'):''}${e.runId!==state.world.runId?' · 之前轮次':''}`}));
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
    for(const filter of ['summary','all','action','decision','speech','memory'])this.buttons['history-'+filter].label.color=filter===this.historyFilter?'#1c5335':'#5a7067';
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
    const ids=new Set(world.objects.map(o=>o.id));
    for(const [id,node]of this.objects)if(!ids.has(id)){node.dispose();this.objects.delete(id);this.objectSignatures.delete(id);this.placeLabels.get(id)?.destroy();this.placeLabels.delete(id);}
    for(const o of world.objects){const signature=[o.kind,o.buildStage,o.resources===0].join(':');if(this.objectSignatures.get(o.id)!==signature){this.objects.get(o.id)?.dispose();const node=new WorldMesh(o);this.scene.addChild(node.node);this.objects.set(o.id,node);this.objectSignatures.set(o.id,signature);}
      if(['board','workbench','plot','house','pond'].includes(o.kind)){let label=this.placeLabels.get(o.id);if(!label){label=this.text(this.markers,'',0,0,12,'#365346',168);label.align='center';label.bgColor='#edf0d9';label.padding=[3,5,3,5];this.placeLabels.set(o.id,label);}label.text=o.kind==='board'?'公告板 / 公共仓储':o.kind==='workbench'?'工作台 · 配方 / 置换':o.kind==='pond'?'池塘':o.kind==='house'?'木石小屋 · 已竣工':`小屋施工 · ${o.buildStage??0}/3`;}
    }
    this.positionLabels();
  }
  private project(p:{x:number;y:number;z:number}):{x:number;y:number}{const out=new L.Vector4();this.camera.worldToViewportPoint(new L.Vector3(p.x,p.y,p.z),out);return {x:out.x,y:out.y};}
  private positionLabels():void{if(!this.state)return;for(const r of this.state.world.residents){const p=this.project({...r.position,y:r.position.y+(this.residents.get(r.id)?.height??1.9)+.25});const t=this.nameLabels.get(r.id);if(t){t.pos(p.x-60,p.y-10);t.visible=p.x>SIDE+10&&p.x<WIDTH-10&&p.y>TOP+24&&p.y<BOTTOM-20;}
    const speech=this.speechLabels.get(r.id);if(speech){const fragments=this.state.world.sounds.filter(s=>s.sourceId===r.id&&this.state!.world.tick-s.emittedTick<3000/defaults.simulation.fixedDtMs);const text=fragments.map(s=>s.text).join('').slice(-55);speech.text=text?`“${text}”`:'';speech.visible=!!text&&t?.visible;const offset=this.state.world.residents.indexOf(r)%2?-5:-225;speech.pos(Math.max(SIDE+12,Math.min(WIDTH-242,p.x+offset)),Math.max(TOP+30,p.y-75));}}
    for(const object of this.state.world.objects){const label=this.placeLabels.get(object.id);if(!label)continue;const p=this.project({...object.position,y:object.kind==='house'?3.8:object.kind==='plot'?.5:object.height+.3});label.pos(p.x-84,p.y-8);label.visible=p.x>SIDE+85&&p.x<WIDTH-85&&p.y>TOP+64&&p.y<BOTTOM-30;}
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
    this.state=state;if(this.memoryPanel?.visible){const remembered=state.world.residents.find(r=>r.id===state.selectedId);if(remembered)this.memoryMap.render(remembered);}
    this.drawWorld(state.world);this.drawSenses(state);
    this.labels.gateway.visible=this.token.visible=this.buttons.connect.root.visible=!state.hosted;
    this.labels.hosted.visible=Boolean(state.hosted);
    const r=state.world.residents.find(x=>x.id===state.selectedId)||state.world.residents[0];
    const mode=state.mode==='UNCONFIGURED'?'尚未接入真实模型':state.mode==='REPLAY'?'观察回放 · 不调用模型':'真实模型 · 独立居民';
    this.labels.mode.text=mode;this.labels.status.text=this.humanStatus(state.status)+(state.cognitionDetail?' · '+state.cognitionDetail:'');
    const action=r?.plan.find(p=>!p.done);this.labels.action.text=action?`实际动作：${readableAction(action.action.op)} · 已执行${(action.elapsedTicks*.05).toFixed(1)}秒${['THINKING','COMMITTING','ERROR_PAUSED'].includes(state.status)?'（冻结）':''}`:'实际动作：等待下一项计划';
    const seconds=Math.floor(state.world.tick*defaults.simulation.fixedDtMs/1000);this.labels.time.text=`模拟 ${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
    for(let i=0;i<2;i++){const person=state.world.residents[i];this.buttons['resident'+i].set(person?`${person.id===state.selectedId?'●  ':''}${person.name}`:'暂无居民');}
    if(r){const hp=Math.round(r.health??100),hunger=Math.round(r.hunger*100),fatigue=Math.round(r.fatigue*100);this.labels.vitality.text=`生命 ${hp}${hp===0?'（倒下）':''}     饥饿 ${hunger}%     疲劳 ${fatigue}%`;this.vitality.graphics.clear();[hp/100,r.hunger,r.fatigue].forEach((v,i)=>{this.vitality.graphics.drawRect(i*85,0,75,4,'#325153');this.vitality.graphics.drawRect(i*85,0,75*v,4,['#9ee3be','#f3c87c','#8eabcf'][i]);});
      this.labels.equipment.text=r.supplies?`随身：木材${r.supplies.wood??0} 石料${r.supplies.stone??0} 食物${r.supplies.food??0} / 30\n`+(r.character?publicCharacterSummary(r.character):''):r.character?publicCharacterSummary(r.character):'';this.labels.person.text=r.name;this.labels.personality.text=r.personality;this.labels.goal.text=r.goal||'尚未得到真实模型决策';
      const obs=state.overlays[r.id]?.observations||r.observations;this.labels.perception.text=obs.slice(-4).map(o=>{const d=o.detail;if(o.modality==='auditory')return `听 · ${d.heardText?(d.recognizedSpeakerName?d.recognizedSpeakerName+'：':'')+d.heardText:'听到模糊说话声，未听清内容'}`;if(o.modality==='visual')return `视 · ${Array.isArray(d.appearance)?d.appearance.join('；'):d.appearance||'注意到一个轮廓'}`;const senses:Record<string,string>={hunger:'饥饿',fatigue:'疲劳',pain:'疼痛',touch:'触碰',imbalance:'失衡',obstructed:'受阻'},intensity:Record<string,string>={mild:'轻微',noticeable:'明显',severe:'严重'};return `身 · ${senses[d.sensation]||'身体状态'}：${intensity[d.intensity]||'有所变化'}`;}).join('\n')||'尚未感知到新的线索';}
    this.buttons.senses.set(`感官显示  ${state.showSenses?'开':'关'}`);this.buttons.replay.set(state.mode==='REPLAY'?'返回现场':'查看回放');this.buttons.speed.set(`${state.speed}× 播放`);
    this.buttons.pause.set(/PAUS|STOP|暂停/i.test(state.status)?'继续':'暂停');
    this.labels.error.text=state.error?state.error.slice(0,260)+(state.status==='ERROR_PAUSED'?'\n世界保持冻结，可修正连接后重试。':''):state.mode==='UNCONFIGURED'?'这是静态观察场。请先配置模型服务并连接网关。\n连接真实模型后，居民才会自主相遇、交流。':'';
    this.labels.caption.text=state.mode==='REPLAY'?'回放现场 · 按模拟时间播放':state.world.camp?'营地 · 林地 / 采石区 / 浆果丛 · 滚轮缩放、拖动探索':'两名居民 · 两棵树 · 一堵墙';
    const tasks=state.world.camp?.tasks??[],recipe=RECIPES.find(r=>r.id===this.draftRecipe)!;
    this.buttons.publishTask.set(this.draftKind==='house'?'发布建房项目':this.draftKind==='craft'?`发布${recipe.label}制作目标`:`发布${RESOURCE_LABELS[this.draftResource]}目标`);
    for(const kind of ['gather','craft','house'])this.buttons['kind-'+kind].label.color=kind===this.draftKind?'#1c5335':'#5a7067';
    for(const resource of ['wood','stone','food']){this.buttons['task-'+resource].root.visible=this.draftKind==='gather';this.buttons['task-'+resource].set((this.draftResource===resource?'● ':'')+RESOURCE_LABELS[resource as TaskDraft['resource']]);}
    for(const entry of RECIPES.filter(r=>r.kind==='craft')){this.buttons['recipe-'+entry.id].root.visible=this.draftKind==='craft';this.buttons['recipe-'+entry.id].set((this.draftRecipe===entry.id?'● ':'')+entry.label);}
    for(const site of BUILD_SITES){const used=state.world.objects.some(o=>o.id==='plot-'+site.id);this.buttons['site-'+site.id].root.visible=this.draftKind==='house';this.buttons['site-'+site.id].set((this.draftSite===site.id?'● ':'')+site.label.slice(0,2)+(used?'(已占用)':'地块'));}
    this.buttons.amount.root.visible=this.draftKind!=='house';this.buttons.amount.set('数量 '+(this.draftKind==='craft'?Math.min(3,this.draftAmount):this.draftAmount));
    this.labels.draftTitle.text=this.draftKind==='house'?'木石小屋 · 选择一块建设用地':this.draftKind==='craft'?'制作并由居民自行装备工具':'采集营地的基础物资';
    this.labels.requirements.pos(this.draftKind==='house'?344:469,379);this.labels.requirements.width=this.draftKind==='house'?374:250;
    this.labels.requirements.text=this.draftKind==='house'?'总需 12木材 + 8石料 · 地基 → 墙体 → 屋顶':this.draftKind==='craft'?'每件：'+materialText(recipe.cost):'居民可自由选择参与';
    this.labels.draftHelp.text=this.draftKind==='house'?'材料集中存入公共仓储；居民到地块分阶段施工。建成后门廊休息更快。':this.draftKind==='craft'?'先读工作台配方；消耗自己的随身材料。成品归制作者，需要自行持握。':'采集计入目标，入库由居民自主搬运。';
    this.labels.taskSummary.text=`营地目标 ${tasks.filter(t=>t.status==='done').length}/${tasks.length} 已完成${state.pendingTasks?` · ${state.pendingTasks}项待写入公告`:''}`;
    this.labels.taskList.text=tasks.slice(-6).map(t=>`${t.status==='done'?'✓':'○'} ${taskTitle(t)} ${t.progress}/${t.amount}${t.kind==='house'&&t.status==='open'?' · 待'+HOUSE_STEPS[t.progress]?.label:''}\n   ${t.acceptedBy.map(id=>state.world.residents.find(r=>r.id===id)?.name).join('、')||'尚无人接受'}${t.note?' · '+t.note.slice(0,24):''}`).join('\n');
    this.labels.stock.text='公共仓储：'+(materialText(state.world.camp?.stock??{})||'暂无材料');
    this.labels.taskNotice.text=state.pendingTasks?`已排队${state.pendingTasks}项，世界恢复后写入`:(state.error??'').slice(0,70);
    this.renderHistory(state);
    this.timeline.graphics.clear();this.timeline.graphics.drawRoundRect(0,0,880,8,4,4,4,4,'#c8d4c2');const progress=state.maxTick>0?Math.max(0,Math.min(1,state.playbackTick/state.maxTick)):0;
    if(progress>0)this.timeline.graphics.drawRoundRect(0,0,880*progress,8,4,4,4,4,'#4c8970');this.timeline.graphics.drawCircle(880*progress,4,6,'#4c8970');
    this.labels.timeline.text=state.maxTick?`${state.playbackTick}/${state.maxTick}`:'暂无回放';
  }
  private humanStatus(status:string):string{const map:Record<string,string>={RUNNING:'世界运行中',PAUSED:'观察者已暂停',THINKING:'居民正在思考 · 世界已冻结',COMMITTING:'完整决策批次正在提交 · 世界保持冻结',READY:'准备开始',PLAYING:'回放播放中 · 不调用模型',BUFFERING:'回放缓冲中',ERROR_PAUSED:'认知请求失败 · 世界保持冻结',WAITING_FOR_MODEL:'模型思考中 · 世界已冻结',WAITING:'模型思考中 · 世界已冻结',ERROR:'认知请求失败 · 世界保持冻结',IDLE:'准备开始',STOPPED:'已停止',UNCONFIGURED:'未配置真实模型'};return map[status]||status;}
}
