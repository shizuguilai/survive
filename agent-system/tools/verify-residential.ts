import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {createCrewWorld} from '../packages/sim-core/src/world.ts';
import {ColonyProvider} from '../packages/sim-core/src/colony.ts';
import {postTask} from '../packages/sim-core/src/camp.ts';
import {DEFAULT_CONTROL} from '../packages/contracts/src/command.ts';
import {writeFileSync} from 'node:fs';
const w=createCrewWorld(2);postTask(w,{kind:'residential',resource:'wood',amount:1,note:'',bounds:{minX:-7,maxX:23,minZ:-24,maxZ:-16}});
const p=new ColonyProvider({...DEFAULT_CONTROL,mode:'local'},{async plan(){throw Error('Remote forbidden in local test');}}),s=new Simulation(p,{world:w,controlMode:'local'});const start=performance.now();await s.bootstrap();let last=0;
while(s.world.tick<12000&&!s.world.residents.every(r=>r.homeId)){if(s.status==='ERROR_PAUSED')throw Error(JSON.stringify(s.barrier?.errors));if(s.paused)await s.settled();else s.step();if(s.world.tick-last>=2000){last=s.world.tick;console.log(JSON.stringify({tick:last,ms:Math.round(performance.now()-start),homes:s.world.objects.filter(o=>o.kind==='house').length,stock:s.world.camp?.stock,goals:s.world.residents.map(r=>r.goal)}));}}
s.stop();const result={mode:'LOCAL_ALGORITHM',tick:s.world.tick,wallMs:Math.round(performance.now()-start),remoteCalls:p.remoteCalls,homes:s.world.objects.filter(o=>o.kind==='house').length,residents:s.world.residents.map(r=>({name:r.name,home:r.homeId,goal:r.goal,feedback:r.actionFeedback})),tasks:s.world.camp?.tasks,failures:s.world.events.filter(e=>e.kind==='action_failed').slice(-10)};console.log(JSON.stringify(result));writeFileSync('evidence/residential-local.json',JSON.stringify(result,null,2));if(result.homes!==2)process.exitCode=1;
