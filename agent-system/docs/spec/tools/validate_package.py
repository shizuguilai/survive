#!/usr/bin/env python3
"""Validate this specification package only; does NOT test the future game."""
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
import copy
import hashlib
import json
import sys
try:
    from jsonschema import Draft202012Validator, ValidationError
except ImportError:
    raise SystemExit('Missing dependency: jsonschema. Install it in a local environment, then rerun this package-only checker.')

ROOT = Path(__file__).resolve().parent.parent
checks: list[dict] = []
def check(name: str, condition: bool, detail: str = '') -> None:
    checks.append({'name': name, 'passed': bool(condition), 'detail': detail})
    if not condition:
        raise AssertionError(f'{name}: {detail}')
def read_json(relative: str):
    return json.loads((ROOT / relative).read_text(encoding='utf-8'))

required = ['AGENT_START_HERE.md','SYSTEM_DESIGN.md','TIME_BARRIER_PROTOCOL.md',
'PERCEPTION_AND_MEMORY.md','LLM_CONTRACT.md','IMPLEMENTATION_PLAN.md','ACCEPTANCE_TESTS.md',
'SOURCES_AND_BASELINE.md','DELIVERY_STATUS.md','task-board.json','acceptance-tests.json',
'config/defaults.json','config/README.md','config/server.env.example','contracts/README.md']
for rel in required:
    check(f'file:{rel}', (ROOT/rel).is_file() and (ROOT/rel).stat().st_size > 0)
for p in ROOT.rglob('*.json'):
    if p.name != 'VALIDATION_REPORT.json':
        json.loads(p.read_text(encoding='utf-8'))
check('all_package_json_parse',True)

board = read_json('task-board.json')
tests = read_json('acceptance-tests.json')['tests']
tasks = board['tasks']
taskmap={t['id']:t for t in tasks}
testmap={t['id']:t for t in tests}
check('unique_task_ids',len(taskmap)==len(tasks))
check('unique_test_ids',len(testmap)==len(tests))
check('separate_task_test_namespaces',not(set(taskmap)&set(testmap)))
check('correct_target_repository',board['targetRepository']=='git@github.com:shizuguilai/survive.git')
visited=set(); active=set(); order=[]
def visit(taskid):
    check(f'task_reference:{taskid}',taskid in taskmap)
    if taskid in visited:return
    if taskid in active:raise AssertionError(f'Cycle involving {taskid}')
    active.add(taskid)
    for dep in taskmap[taskid]['dependsOn']:visit(dep)
    active.remove(taskid);visited.add(taskid);order.append(taskid)
for t in tasks:visit(t['id'])
check('acyclic_task_graph',len(visited)==len(tasks))
covered=set()
for task in tasks:
    check(f'initial_task_status:{task["id"]}',task['status']=='not_started' and all(x=='not_run' for x in task['verification'].values()))
    check(f'valid_test_links:{task["id"]}',all(x in testmap for x in task['acceptanceTests']))
    covered.update(task['acceptanceTests'])
check('all_tests_have_task_coverage',covered==set(testmap),f'{len(covered)} / {len(testmap)}')
check('all_tests_unexecuted',all(t['status']=='not_run' for t in tests))
for task in tasks:
    check(f'task_documented:{task["id"]}',f'### {task["id"]} ·' in (ROOT/'IMPLEMENTATION_PLAN.md').read_text())
for test in tests:
    check(f'test_documented:{test["id"]}',f'**{test["id"]} ·' in (ROOT/'ACCEPTANCE_TESTS.md').read_text())

validators={}
for p in sorted((ROOT/'contracts').glob('*.schema.json')):
    s=json.loads(p.read_text()); Draft202012Validator.check_schema(s)
    validators[p.name]=Draft202012Validator(s)
    check(f'schema_valid:{p.name}',True)
fixtures={
 'examples/decision.continue.json':'agent-decision.schema.json',
 'examples/decision.greet.json':'agent-decision.schema.json',
 'examples/observation.visual.json':'private-observation.schema.json',
 'examples/observation.hearing.json':'private-observation.schema.json',
 'examples/observation.pain.json':'private-observation.schema.json',
}
for rel,schema in fixtures.items():
    validators[schema].validate(read_json(rel));check(f'fixture_valid:{rel}',True)
neg=[]
d=read_json('examples/decision.continue.json');d['nextReviewAfterSimMs']=0;neg.append(('zero_heartbeat',d,'agent-decision.schema.json'))
d=read_json('examples/decision.continue.json');d['actions']=[{'op':'read_world','stage':0,'params':{}}];neg.append(('unknown_action',d,'agent-decision.schema.json'))
d=read_json('examples/decision.continue.json');d['actions']=[{'op':'speak','stage':0,'params':{'text':'hello','volume':'normal'}}];neg.append(('incomplete_speak',d,'agent-decision.schema.json'))
o=read_json('examples/observation.visual.json');o['globalEntityId']='hidden-true-id';neg.append(('global_id_field',o,'private-observation.schema.json'))
o=read_json('examples/observation.hearing.json');o['detail']['unheardFullText']='hidden';neg.append(('unheard_text_field',o,'private-observation.schema.json'))
o=read_json('examples/observation.pain.json');o['apiWaitWallMs']=30000;neg.append(('wallclock_field',o,'private-observation.schema.json'))
for name,data,schema in neg:
    check(f'negative_fixture_rejected:{name}',not validators[schema].is_valid(data))
cfg=read_json('config/defaults.json')
check('hard_global_barrier_default',cfg['simulation']['mode']=='global_cognition_barrier')
check('no_catchup_or_fallback',not cfg['simulation']['catchUpAfterCognition'] and not cfg['cognition']['autoRuleFallback'])
check('no_false_live_configuration',cfg['runtime']['initialMode']=='UNCONFIGURED')
check('read_only_replay',cfg['replay']['readOnly'] and not cfg['replay']['requeryModel'])
for section,names in [(cfg['cognition'],['defaultReviewAfterSimMs','minReviewAfterSimMs','maxReviewAfterSimMs']), (cfg['vision'],['scanEverySimMs'])]:
    check('tick_aligned:'+','.join(names),all(section[n]%cfg['simulation']['fixedDtMs']==0 for n in names))
for p in ROOT.rglob('*.md'):
    count=sum(1 for line in p.read_text().splitlines() if line.startswith('```'))
    check(f'balanced_markdown_fences:{p.relative_to(ROOT)}',count%2==0)
report={
 'scope':'specification_package_structure_only_not_game_implementation_or_game_tests',
 'generatedAtUtc':datetime.now(timezone.utc).isoformat(),
 'passed':all(x['passed'] for x in checks),'checkCount':len(checks),
 'taskCount':len(tasks),'futureGameTestCount':len(tests),'schemaCount':len(validators),'positiveFixtureCount':len(fixtures),'negativeFixtureCount':len(neg),
 'topologicalTaskOrder':order,
 'explicitlyNotRun':['game unit tests','live LLM','LayaAir build','browser gameplay','physical device','publication'],
 'checks':checks}
(ROOT/'VALIDATION_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False,indent=2))
