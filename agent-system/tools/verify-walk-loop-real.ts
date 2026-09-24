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
const audit:any[]=[];let requests=0;let zeroDistanceWalkAccepted=0;let freezeChecks=0;let freezeViolation=false;
const gateway=new RealModelGateway(loadConfig({SURVIVE_MODEL_API_KEY:secret}),{audit:r=>{audit.push({agentId:r.agentId,accepted:r.accepted,code:r.code,attempts:r.attempts,ops:r.decision?.actions.map(a=>a.op),validationIssues:r.validationIssues});console.log(JSON.stringify(audit.at(-1)));}});
const sim=new Simulation({async decide(req,signal){if(++requests>36)throw Error('Real verification budget reached');const response=await gateway.decide(req,signal);const firstWalk=response.decision.actions.find(a=>a.op==='walk');if(firstWalk&&req.context.knownTargets.find(t=>t.ref===firstWalk.params.targetRef)?.atLastKnownPosition)zeroDistanceWalkAccepted++;return response;}},{world:createCampWorld(),maxRetries:0});
let lastHash='',lastBarrier='';
const timer=setInterval(()=>{if(['THINKING','COMMITTING'].includes(sim.status)){const id=sim.barrier!.id,h=hashCanonical(sim.world);if(lastBarrier===id&&lastHash!==h)freezeViolation=true;lastBarrier=id;lastHash=h;freezeChecks++;}},25);
try{await sim.bootstrap();while(sim.world.tick<1600&&requests<=36&&sim.status!=='ERROR_PAUSED'){
 if(sim.status==='THINKING'||sim.status==='COMMITTING'){await sim.settled();continue;}
 if((sim.world.camp!.tasks[0].progress)>0)break;
 sim.step();
}
const progress=sim.world.camp!.tasks[0].progress;
const report={mapMemory:sim.world.residents.map(r=>({residentId:r.id,cells:Object.keys(r.spatialMemory?.cells??{}).length,landmarks:Object.keys(r.spatialMemory?.landmarks??{}).length,trail:r.spatialMemory?.trail.length??0,textMemories:r.memories.length})),simVersion:SIM_VERSION,zeroDistanceWalkAccepted,checkedAt:new Date().toISOString(),status:progress>0&&!freezeViolation&&zeroDistanceWalkAccepted===0?'passed_real_movement_then_gather':'partial',model:'glm-4.5-air',mockUsed:false,execution:'node-local-real-provider',requests,freezeChecks,freezeViolation,tick:sim.world.tick,taskProgress:progress,taskAcceptedBy:sim.world.camp!.tasks[0].acceptedBy,completedOperations:[...new Set(sim.world.events.filter(e=>e.kind==='action_completed').map(e=>e.text))],failedActions:[...new Set(sim.world.events.filter(e=>e.kind==='action_failed').map(e=>e.text))],inventories:sim.world.residents.map(r=>({agentId:r.id,supplies:r.supplies})),operations:[...new Set(audit.flatMap(a=>a.ops??[]))],audit,browser:'not_run',physicalDevice:'not_run',scope:'Default unprepared camp, independent real residents: read notice / voluntary accept / actual gather; no accepted initial walk to already reached location. Not long-duration or physical-device acceptance'};
await writeFile('evidence/walk-loop-real.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,requests,progress,freezeViolation}));
}finally{clearInterval(timer);sim.stop();}
