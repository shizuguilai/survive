/** Real model only. Secret is read from stdin, never persisted. Outputs aggregate evidence only. */
import {RealModelGateway,loadConfig} from '../services/brain-gateway/src/gateway.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';
import {createCampWorld} from '../packages/sim-core/src/world.ts';
import {hashCanonical} from '../packages/contracts/src/canonical.ts';
import {SIM_VERSION} from '../packages/sim-core/src/config-version.ts';
import {writeFile} from 'node:fs/promises';
console.log('Ready for real-model credential on stdin');
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}
const secret=JSON.parse(input).apiKey;input='';if(!secret)throw Error('Missing credential');
const audit:any[]=[];let requests=0;let freezeChecks=0;let freezeViolation=false;
const gateway=new RealModelGateway(loadConfig({SURVIVE_MODEL_API_KEY:secret}),{audit:r=>{audit.push({agentId:r.agentId,accepted:r.accepted,code:r.code,attempts:r.attempts,ops:r.decision?.actions.map(a=>a.op),validationIssues:r.validationIssues});console.log(JSON.stringify(audit.at(-1)));}});
const sim=new Simulation({async decide(req,signal){if(++requests>24)throw Error('Real verification budget reached');return gateway.decide(req,signal);}},{world:createCampWorld(),maxRetries:0});
let lastHash='',lastBarrier='';
const timer=setInterval(()=>{if(['THINKING','COMMITTING'].includes(sim.status)){const id=sim.barrier!.id,h=hashCanonical(sim.world);if(lastBarrier===id&&lastHash!==h)freezeViolation=true;lastBarrier=id;lastHash=h;freezeChecks++;}},25);
try{await sim.bootstrap();while(sim.world.tick<400&&requests<=24&&sim.status!=='ERROR_PAUSED'){
 if(sim.status==='THINKING'||sim.status==='COMMITTING'){await sim.settled();continue;}
 if(sim.world.tick>=120&&sim.world.residents.reduce((sum,r,i)=>sum+Math.hypot(r.position.x-(i?1:-1),r.position.z),0)>=3)break;
 sim.step();
}
const progress=sim.world.camp!.tasks[0].progress;const movement=sim.world.residents.reduce((sum,r,i)=>sum+Math.hypot(r.position.x-(i?1:-1),r.position.z),0);
const report={simVersion:SIM_VERSION,checkedAt:new Date().toISOString(),status:movement>=3&&!freezeViolation?'passed_real_movement':'partial',model:'glm-4.5-air',mockUsed:false,execution:'node-local-real-provider',requests,freezeChecks,freezeViolation,tick:sim.world.tick,movement,taskProgress:progress,taskAcceptedBy:sim.world.camp!.tasks[0].acceptedBy,completedOperations:[...new Set(sim.world.events.filter(e=>e.kind==='action_completed').map(e=>e.text))],failedActions:[...new Set(sim.world.events.filter(e=>e.kind==='action_failed').map(e=>e.text))],inventories:sim.world.residents.map(r=>({agentId:r.id,supplies:r.supplies})),operations:[...new Set(audit.flatMap(a=>a.ops??[]))],audit,browser:'not_run',physicalDevice:'not_run',scope:'Default unprepared camp; actual real-model movement and cadence; not full camp cooperation or online real-browser validation'};
await writeFile(process.argv.includes('--encounter')?'evidence/encounter-real.json':'evidence/thinking-real.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,requests,progress,freezeViolation}));
}finally{clearInterval(timer);sim.stop();}
