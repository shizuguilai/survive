import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {postTask} from '../packages/sim-core/src/camp.ts';
import {DEFAULT_CONTROL} from '../packages/contracts/src/command.ts';
import {writeFileSync} from 'node:fs';
const w=createCrewWorld(2);postTask(w,{kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:-26,maxX:0,minZ:-26,maxZ:-12}});
const p=new ColonyProvider({...DEFAULT_CONTROL,mode:'local'},{async plan(){throw Error('Remote forbidden in local test');}}),s=new Simulation(p,{world:w,controlMode:'local'});
const start=performance.now();await s.bootstrap();let last=0;
const finished=()=>s.world.residents.every(r=>s.world.objects.some(o=>o.id===r.homeId&&o.kind==='house'&&(o.homeLevel??1)>=2&&['bed','lamp','cabinet','mop'].every(k=>o.furniture?.[k as 'bed'])));
while(s.world.tick<30000&&!finished()){
 if(s.status==='ERROR_PAUSED')throw Error(JSON.stringify(s.barrier?.errors));if(s.paused)await s.settled();else s.step();
 if(s.world.tick-last>=2000){last=s.world.tick;console.log(JSON.stringify({tick:last,ms:Math.round(performance.now()-start),homes:s.world.objects.filter(o=>o.ownerId).map(h=>({stage:h.buildStage,level:h.homeLevel,furniture:h.furniture})),stock:s.world.camp?.stock,goals:s.world.residents.map(r=>r.goal)}));}
}
s.stop();const result={mode:'LOCAL_ALGORITHM',finished:finished(),tick:s.world.tick,wallMs:Math.round(performance.now()-start),remoteCalls:p.remoteCalls,homes:s.world.objects.filter(o=>o.ownerId),residents:s.world.residents.map(r=>({name:r.name,home:r.homeId,goal:r.goal,health:r.health,mood:r.mood,hunger:r.hunger,fatigue:r.fatigue,living:r.living,feedback:r.actionFeedback})),lifeEvents:s.world.events.filter(e=>['construction','home_care','mental_break','mood_recovered'].includes(e.kind)),failures:s.world.events.filter(e=>e.kind==='action_failed').slice(-10)};
writeFileSync('evidence/living-local.json',JSON.stringify(result,null,2));console.log(JSON.stringify({finished:result.finished,tick:result.tick,wallMs:result.wallMs,remoteCalls:p.remoteCalls,failures:result.failures}));if(!result.finished)process.exitCode=1;
