import type {BrainRequest,BrainResponse} from '../../contracts/src/types.ts';
import type {World,SensoryOverlay} from './domain.ts';
import {hashCanonical} from '../../contracts/src/canonical.ts';
import {CONFIG_HASH,SIM_VERSION,ENGINE_VERSION} from './config-version.ts';

export type RecordedFrame={tick:number;world:World;overlays:Record<string,SensoryOverlay>;hash:string};
export type RecordedBatch={tick:number;accepted:{request:BrainRequest;response:BrainResponse}[]};
export type ReplayFile={
  manifest:{schemaVersion:'1.0.0';runId:string;simCoreVersion:string;engineVersion:string;fixedDtMs:number;startTick:number;endTick:number;seed:number;configHash:string;decisionMode:'real'|'mock'|'mixed'|'directed'|'local';decisionCounts:{real:number;mock:number;directed?:number;local?:number};snapshotFiles:string[];eventLogFiles:string[];complete:boolean};
  frames:RecordedFrame[];commits:RecordedBatch[];
};
const copy=<T>(v:T):T=>structuredClone(v);

/** Observer-owned capture. No clock, provider, sensor sampling or world mutations. */
export class ReplayRecorder{
  private maxFrames:number;
  constructor(maxFrames=600){this.maxFrames=maxFrames;}
  readonly frames:RecordedFrame[]=[];
  readonly commits:RecordedBatch[]=[];
  capture(world:World,overlays:Record<string,SensoryOverlay>):void{
    const frame={tick:world.tick,world:copy(world),overlays:copy(overlays),hash:hashCanonical({world,overlays})};
    const last=this.frames.at(-1);
    if(last&&world.tick<last.tick)throw Error('回放时间不可倒退');
    if(last&&world.tick===last.tick)this.frames[this.frames.length-1]=frame;
    else {
      if(last&&world.tick!==last.tick+1)throw Error('回放必须记录每个模拟步');
      this.frames.push(frame);
      if(this.frames.length>this.maxFrames){this.frames.shift();const firstTick=this.frames[0].tick;while(this.commits.length>1&&this.commits[1].tick<firstTick)this.commits.shift();}
    }
  }
  commit(record:RecordedBatch):void{this.commits.push(copy({tick:record.tick,accepted:record.accepted}));}
  export(complete=false):ReplayFile{
    if(!this.frames.length)throw Error('没有可回放的模拟记录');
    const counts={real:0,mock:0,directed:0,local:0};
    for(const c of this.commits)for(const a of c.accepted){if(a.response.source==='REAL_MODEL')counts.real++;else if(a.response.source==='MOCK_TEST')counts.mock++;else if(a.response.source==='MODEL_DIRECTED')counts.directed++;else if(a.response.source==='LOCAL_ALGORITHM')counts.local++;else throw Error('未知决策来源');}
    if(counts.real+counts.mock+counts.directed+counts.local===0)throw Error('尚无已提交模型决策；静态场景不能作为自治演示');
    const first=this.frames[0],last=this.frames.at(-1)!;
    return copy({manifest:{schemaVersion:'1.0.0',runId:first.world.runId,simCoreVersion:SIM_VERSION,engineVersion:ENGINE_VERSION,fixedDtMs:50,startTick:first.tick,endTick:last.tick,seed:first.world.seed,configHash:CONFIG_HASH,decisionMode:sourceMode(counts),decisionCounts:counts,snapshotFiles:['embedded:frames'],eventLogFiles:['embedded:commits'],complete},frames:this.frames,commits:this.commits});
  }
}

/** Playback constructor accepts only data. Calling any model is impossible here. */
export class ReplayPlayer{
  private data:ReplayFile; private cursor=0;private remainder=0;private wall:number|null=null;
  playing=false;speed=1;
  constructor(input:ReplayFile){
    this.data=copy(input);const m=this.data.manifest;
    if(!m||m.schemaVersion!=='1.0.0'||m.simCoreVersion!==SIM_VERSION||m.engineVersion!==ENGINE_VERSION||m.configHash!==CONFIG_HASH||m.fixedDtMs!==50)throw Error('回放版本或配置不兼容');
    if(!Array.isArray(this.data.frames)||!this.data.frames.length||this.data.frames.length>24000||!Array.isArray(this.data.commits))throw Error('回放缺少有效帧');
    for(let i=0;i<this.data.frames.length;i++){
      const f=this.data.frames[i];
      if(f.tick!==m.startTick+i||f.world.tick!==f.tick||f.world.runId!==m.runId||f.hash!==hashCanonical({world:f.world,overlays:f.overlays}))throw Error('回放快照校验失败');
    }
    if(this.data.frames.at(-1)!.tick!==m.endTick)throw Error('回放终点不一致');
    let real=0,mock=0,directed=0,local=0;
    for(const b of this.data.commits){
      if(!Number.isInteger(b.tick)||b.tick<0||b.tick>m.endTick)throw Error('回放决策时刻无效');
      for(const a of b.accepted){if(a.response.source==='REAL_MODEL')real++;else if(a.response.source==='MOCK_TEST')mock++;else if(a.response.source==='MODEL_DIRECTED')directed++;else if(a.response.source==='LOCAL_ALGORITHM')local++;else throw Error('回放决策来源不明');}
    }
    const mode=sourceMode({real,mock,directed,local});
    if(real+mock+directed+local===0||directed!==(m.decisionCounts.directed??0)||local!==(m.decisionCounts.local??0)||real!==m.decisionCounts.real||mock!==m.decisionCounts.mock||mode!==m.decisionMode)throw Error('回放来源计数不一致');
  }
  get manifest(){return copy(this.data.manifest);}
  get tick(){return this.data.frames[this.cursor].tick;}
  get ended(){return this.cursor===this.data.frames.length-1;}
  get buffering(){return this.ended&&!this.data.manifest.complete;}
  current():RecordedFrame{return copy(this.data.frames[this.cursor]);}
  seek(tick:number):RecordedFrame{
    if(!Number.isFinite(tick))throw Error('回放位置无效');
    this.cursor=Math.max(0,Math.min(this.data.frames.length-1,Math.round(tick)-this.data.manifest.startTick));
    this.wall=null;this.remainder=0;return this.current();
  }
  play(){this.playing=true;this.wall=null;}
  pause(){this.playing=false;this.wall=null;this.remainder=0;}
  setSpeed(speed:number){if(![.5,1,2,4].includes(speed))throw Error('回放倍速无效');this.speed=speed;this.wall=null;}
  frame(wallMs:number):RecordedFrame{
    if(!this.playing){this.wall=null;return this.current();}
    if(this.wall===null){this.wall=wallMs;return this.current();}
    const dt=Math.min(250,Math.max(0,wallMs-this.wall));this.wall=wallMs;
    this.remainder+=dt*this.speed;
    while(this.remainder>=50&&!this.ended){this.remainder-=50;this.cursor++;}
    if(this.ended)this.pause();
    return this.current();
  }
}

function sourceMode(c:{real:number;mock:number;directed:number;local:number}):'real'|'mock'|'mixed'|'directed'|'local'{const types=(Object.keys(c) as (keyof typeof c)[]).filter(k=>c[k]>0);return types.length>1?'mixed':types[0]??'real';}
