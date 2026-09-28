import {writeFile,mkdir} from 'node:fs/promises';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {DEFAULT_CONTROL} from '../packages/contracts/src/command.ts';
import {ReplayRecorder} from '../packages/sim-core/src/replay.ts';
import {getOverlay} from '../packages/sim-core/src/perception.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {ResidentJournal} from '../apps/laya-client/src/journal.ts';
import {LiveObserver,liveCheckpoint} from '../apps/laya-client/src/live-observer.ts';
import {postTask} from '../packages/sim-core/src/camp.ts';

const legacy=process.env.PERF_MODE!=='live';
const journal=new ResidentJournal(),observer=new LiveObserver(journal),recorder=legacy?new ReplayRecorder():null;
const world=createCrewWorld(4);world.runId='deterministic-performance-camp';
postTask(world,{kind:'house',siteId:'east',resource:'wood',amount:3,note:'performance test'});
const provider=new ColonyProvider({...DEFAULT_CONTROL,mode:'local'},{async plan(){throw Error('Remote calls forbidden');}});
let captureMs=0,journalMs=0,storageMs=0,snapshots=0,commits=0,checkpointCodeUnits=0;const samples:any[]=[];
const time=(fn:()=>void)=>{const t=performance.now();fn();return performance.now()-t;};
const options:any={world,controlMode:'local',onCommit:(record:any)=>{commits++;if(legacy){storageMs+=time(()=>{checkpointCodeUnits=JSON.stringify({schemaVersion:'1.0.0',world:record.nextWorld,commit:record}).length;recorder!.commit(record);});}else storageMs+=time(()=>{checkpointCodeUnits=JSON.stringify(liveCheckpoint(record)).length;});}};
if(legacy)options.onSnapshot=(w:any)=>{snapshots++;captureMs+=time(()=>recorder!.capture(w,Object.fromEntries(w.residents.map((r:any)=>[r.id,getOverlay(w,r)]))));journalMs+=time(()=>journal.collect(w));};
const sim=new Simulation(provider,options),start=performance.now();await sim.bootstrap();
for(const limit of (legacy?[500,2000,4000]:[500,2000,4000,8000])){
 while(sim.world.tick<limit){if(sim.status==='ERROR_PAUSED')throw Error(JSON.stringify(sim.barrier?.errors));if(sim.paused)await sim.settled();else sim.step();if(!legacy)journalMs+=time(()=>{observer.observe(sim.world);observer.senses(sim.world,sim.world.residents[0].id,false);});}
 const frames=recorder?.frames??[],estimate=frames.length?Math.round(frames.reduce((sum,f)=>sum+JSON.stringify(f).length,0)/1024/1024*100)/100:0;
 samples.push({tick:sim.world.tick,wallMs:Math.round(performance.now()-start),captureMs:Math.round(captureMs),journalMs:Math.round(journalMs),storageMs:Math.round(storageMs),snapshots,retainedFrames:frames.length,retainedJsonMiCodeUnits:estimate,checkpointCodeUnits,heapMiBBeforeGC:Math.round(process.memoryUsage().heapUsed/1024/1024),worldCodeUnits:JSON.stringify(sim.world).length,events:sim.world.events.length,memories:sim.world.residents.reduce((n,r)=>n+r.memories.length,0),history:journal.rows.length,worldHash:hashCanonical(sim.world)});
 console.log(JSON.stringify(samples.at(-1)));
}
sim.stop();await mkdir('evidence',{recursive:true});await writeFile(`evidence/performance-${legacy?'before':'after'}-core.json`,JSON.stringify({mode:legacy?'V15_REPLAY_HOOKS':'LIVE_OBSERVER',localAlgorithm:true,remoteCalls:provider.remoteCalls,commits,samples},null,2)+'\n');
