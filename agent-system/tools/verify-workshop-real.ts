/** Prepared-state real-provider checks. No rule agent, no mock responses, no raw private exports. */
import {RealModelGateway,loadConfig} from '../services/brain-gateway/src/gateway.ts';
import {Simulation} from '../packages/sim-core/src/cognition.ts';import {createCampWorld} from '../packages/sim-core/src/world.ts';
import {readBoard,postTask,grantKnown,ownReceipt} from '../packages/sim-core/src/camp.ts';import {readWorkbench} from '../packages/sim-core/src/workshop.ts';
import {equippedItem} from '../packages/sim-core/src/character.ts';import {hashCanonical} from '../packages/contracts/src/canonical.ts';import {writeFile,readFile} from 'node:fs/promises';
console.log('Ready for real-model credential on stdin');let input='';for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}const secret=JSON.parse(input).apiKey;input='';if(!secret)throw Error('Missing credential');
const reports:any[]=[];const houseOnly=process.argv.includes('--house-only');let previousHouseAttempt:any;
if(houseOnly){const previous=JSON.parse(await readFile('evidence/workshop-real.json','utf8'));reports.push(...previous.reports.filter((r:any)=>r.scenario==='tools'));const h=previous.reports.find((r:any)=>r.scenario==='house');previousHouseAttempt=h?{status:h.status,requests:h.requests,tick:h.tick,constructionStages:h.constructionStages,freezeViolation:h.freezeViolation}:undefined;}
for(const scenario of (houseOnly?['house']:['tools','house']) as ('tools'|'house')[]){
 const world=createCampWorld();world.camp!.tasks=[];world.camp!.stock={};const board=world.objects.find(o=>o.kind==='board')!,bench=world.objects.find(o=>o.kind==='workbench')!;
 if(scenario==='tools'){
  for(const [i,r]of world.residents.entries()){
   r.position={...bench.position,x:bench.position.x+(i?-.8:.8)};r.supplies={wood:2,stone:3};r.inventory=5;r.hunger=.1;
   r.personalGoal=i?'今天希望亲手做一把石锄，持握起来，准备改善采收。':'今天希望亲手做一把石斧，持握起来，准备改善伐木。';
   grantKnown(r,bench.id,bench.appearance,bench.position,0);readWorkbench(world,r,bench);ownReceipt(r,world,'今天已经向熟人问候过，现在想把自己的工具做出来。');
  }
  postTask(world,{kind:'craft',resource:'wood',amount:1,recipeId:'stone_axe',note:'工具制作验证'});postTask(world,{kind:'craft',resource:'wood',amount:1,recipeId:'stone_hoe',note:'工具制作验证'});
 }else{
  // Prepared-stock single-builder scenario isolates model-selected construction phases.
  world.residents=world.residents.slice(0,1);postTask(world,{kind:'house',resource:'wood',amount:3,siteId:'east',note:'建成这间小屋'});world.camp!.stock={wood:12,stone:8};
  const r=world.residents[0],plot=world.objects.find(o=>o.kind==='plot')!;r.position={...plot.position};r.hunger=.1;r.personalGoal='今天希望完成公告上的木石小屋。仓储材料准备情况以本人读到的信息为准，按步骤动手施工。';
 }
 for(const r of world.residents)readBoard(world,r,board);
 let requests=0,freezeChecks=0,freezeViolation=false,lastBarrier='',lastHash='';const audit:any[]=[];
 const gateway=new RealModelGateway(loadConfig({SURVIVE_MODEL_API_KEY:secret}),{audit:record=>{const entry={agentId:record.agentId,accepted:record.accepted,code:record.code,attempts:record.attempts,ops:record.decision?.actions.map(a=>a.op),validationIssues:record.validationIssues};audit.push(entry);console.log(JSON.stringify({scenario,...entry}));}});
 const sim=new Simulation({async decide(request,signal){if(++requests>24)throw Error('Scoped verification request budget reached');return gateway.decide(request,signal);}},{world,maxRetries:0});
 const timer=setInterval(()=>{if(['THINKING','COMMITTING'].includes(sim.status)){const id=sim.barrier!.id,h=hashCanonical(sim.world);if(lastBarrier===id&&lastHash!==h)freezeViolation=true;lastBarrier=id;lastHash=h;freezeChecks++;}},25);
 const complete=()=>scenario==='house'?sim.world.objects.some(o=>o.kind==='house'):sim.world.residents.every((r,i)=>(['leftHand','rightHand'] as const).some(slot=>equippedItem(r.character!,slot)?.item.catalogId===(i?'stone_hoe':'stone_axe')));
 try{
  await sim.bootstrap();while(sim.world.tick<1400&&requests<=24&&sim.status!=='ERROR_PAUSED'&&!complete()){if(['THINKING','COMMITTING'].includes(sim.status))await sim.settled();else sim.step();}
  const report={scenario,status:complete()&&!freezeViolation?'passed':'partial',model:'glm-4.5-air',execution:'node-local-real-provider-prepared-fixture',mockUsed:false,requests,freezeChecks,freezeViolation,tick:sim.world.tick,craftCount:sim.world.events.filter(e=>e.kind==='craft').length,constructionStages:sim.world.events.filter(e=>e.kind==='construction').length,taskProgress:sim.world.camp!.tasks.map(t=>({kind:t.kind,progress:t.progress,amount:t.amount,status:t.status})),equippedTools:sim.world.residents.map(r=>({agentId:r.id,tools:(['leftHand','rightHand'] as const).map(slot=>equippedItem(r.character!,slot)?.item.catalogId).filter(Boolean)})),audit,browser:'not_run',physicalDevice:'not_run',scope:scenario==='tools'?'Two independent real residents; prepared personal materials, prior read recipe and notice fixtures; verifies voluntary craft and equip, not autonomous sourcing':'Single real builder; prepared public stock and prior notice fixture; verifies actual phased construction, not end-to-end cooperative material gathering'};
  reports.push(report);console.log(JSON.stringify({scenario,status:report.status,requests,freezeViolation,tick:sim.world.tick}));
 }finally{clearInterval(timer);sim.stop();}
}
await writeFile('evidence/workshop-real.json',JSON.stringify({checkedAt:new Date().toISOString(),status:reports.every(r=>r.status==='passed')?'passed_scoped':'partial',previousHouseAttempt,reports},null,2)+'\n');
