# 实施路线与文件落点

## 1. 现有代码改造对应关系

| 基线文件 | 处理建议 | 不能做的简化 |
|---|---|---|
| `core/World.ts` | 提取纯模拟状态与固定步进；建造入口转为验证后的世界命令 | 在tick里直接await网络；继续让UI直接扣资源造建筑 |
| `core/Entities.ts` | 迁移为身体、个体资料、私人认知与动作状态 | 只增加一个personality字符串仍按旧job执行 |
| `core/systems/JobSystem.ts` | 用模型意图+ActionExecutor替换职业switch | 工程算最高分后替居民选工作 |
| `core/systems/BuildSystem.ts` | 依据真实任务参与/工序/资源结算 | 依旧要求Farmer/Worker身份 |
| `core/Pathfinding.ts` / `GameMap.ts` | 可复用算法思路，输入改为个人已知地图 | 每人拿全图寻路获得隐藏信息 |
| `core/ResourceStore.ts` | 原子资源与项目预留账本 | 并行模型重复花掉同一批物资 |
| `core/SaveManager.ts` | 新版本事务存档，保留旧档并显式迁移 | 吞异常、覆盖旧档、保存半批次执行 |
| `render/GameRoot.ts` | Laya入口与SimulationRunner，分别管理UI/世界时钟 | 只暂停人物，其他系统照跑；恢复追帧 |
| `render/InputController.ts` / `ui/HUD.ts` | 原生Laya划区、公告、观察者与感官UI | 继续把手动建筑菜单当主玩法 |

这些是提议的新结构，不是仓库已经存在的文件。编码前重新核对实际main并调整落点，不能照抄旧路径覆盖用户改动。

## 2. 推荐目录

```text
packages/contracts/        # DTO、schema与能力契约
packages/sim-core/         # 无引擎依赖的唯一模拟/感官/记忆/项目
apps/laya-client/          # Laya原生3D、UI、暂停适配、回放
services/brain-gateway/    # 鉴权、独立请求、密钥、错误与诊断
scenarios/                 # 小场景、固定回复夹具、真实模型场景
tests/                     # 单测、集成、隔离与回放测试
docs/implementation/       # 基线、逐任务证据、版本、阻塞
```

T01决定实际Laya IDE项目结构与产物目录，不为了目录好看破坏IDE标准构建。保留旧工程，不把Cocos和Laya同时装进运行时。

## 3. 依赖顺序

以 `task-board.json` 为调度依据。任务编号不是严格执行序号，例如T09可先于T08完成。依赖满足以需要的接口、代码和局部检查已具备为准；完整跨模块验收可在集成阶段执行，但必须保持对应结果为not_run/blocked，不能提前填passed。任务可以标记code_complete并继续依赖工作，全部验收完成才标记accepted。只有依赖完成或明确具备任务所需接口时继续；未具备真实模型权限可以开发Mock测试，但依赖真实模型验收的演示任务不能记完成。

### T00 · 核对唯一仓库与保存迁移基线

依赖：无。

交付：记录HEAD/main/改动、旧工程可运行性与未知配置；禁止破坏现有修改。

建议文件：`docs/implementation/baseline.md`、`docs/implementation/status.json`。

验收：B01。

### T01 · 建立LayaAir原生3D壳与锁定版本

依赖：T00。

交付：用选定IDE创建可打开场景、摄像机、地面和两个人；保留旧工程独立目录。

建议文件：`apps/laya-client/`、`docs/implementation/engine-lock.md`。

验收：B02。

### T02 · 提取纯TS模拟与唯一时钟

依赖：T00。

交付：消除模拟层真实时间结算与引擎依赖，建立固定步进和独立随机流。

建议文件：`packages/sim-core/src/clock/`、`packages/sim-core/src/world/`、`packages/sim-core/src/random/`。

验收：TM01, TM02, S03。

### T03 · 实现契约与个人信息能力边界

依赖：T00。

交付：从本包schema建立运行时验证，分离WorldTruth/CharacterContext/传输metadata。

建议文件：`packages/contracts/`、`packages/sim-core/src/knowledge/`。

验收：K01, K02。

### T04 · 实现全局认知屏障事务

依赖：T02, T03。

交付：先使用受控Promise测试全部冻结、批次提交、失败暂停、幂等和嵌套暂停；不接规则脑。

建议文件：`packages/sim-core/src/cognition/GlobalCognitionBarrier.ts`、`packages/sim-core/src/cognition/DecisionCommitter.ts`。

验收：TM01, TM02, TM03, TM04, TM05, TM06, TM07, TM09, TM10。

### T05 · 实现模型意图动作执行器

依赖：T02, T03。

交付：支持移动/采集/搬运/休息/观察等技能，所有目标来自明确决策，保留中断进度。

建议文件：`packages/sim-core/src/actions/`、`packages/sim-core/src/agents/`。

验收：A01, A02, A03。

### T06 · 实现视觉与个人已知地图

依赖：T02, T03, T05。

交付：扇形/垂直角、遮挡、识别分级、最后已知、主动转头；无后台全知工具。

建议文件：`packages/sim-core/src/perception/VisionSensor.ts`、`packages/sim-core/src/knowledge/KnownMap.ts`。

验收：P01, P02, P03, P09, K03。

### T07 · 实现听觉与身体感官

依赖：T02, T03, T05。

交付：声音传播与片段、噪声/隔墙、感到疼痛不知幕后原因；全部模拟计时。

建议文件：`packages/sim-core/src/perception/HearingSensor.ts`、`packages/sim-core/src/perception/BodySensor.ts`、`packages/sim-core/src/sound/`。

验收：P04, P05, P06, P07。

### T08 · 连接注意力与独立认知心跳

依赖：T04, T06, T07, T09。

交付：事件去重/迟滞、感官唤醒、每人模拟心跳、模型关注条件，触发后全局暂停。

建议文件：`packages/sim-core/src/cognition/AttentionGate.ts`、`packages/sim-core/src/cognition/CognitionScheduler.ts`。

验收：P08, TM09, L04。

### T09 · 实现服务端网关并验证真实独立调用

依赖：T03, T04。

交付：配置真实供应商与模型、服务端保密鉴权、schema修复、各人独立调用；缺权限登记阻塞。

建议文件：`services/brain-gateway/`、`packages/contracts/src/BrainProvider.ts`、`docs/implementation/model-config.md`。

验收：L01, E01, TM04, TM06。

### T10 · 实现私人记忆检索与上下文审计

依赖：T03, T06, T07, T09。

交付：来源/转述/推测分离、权限与最终payload审计；不索取模型完整隐藏思维链。

建议文件：`packages/sim-core/src/memory/`、`packages/sim-core/src/cognition/ContextBuilder.ts`。

验收：K01, K02, K03, K04, K05, K07, TM07。

### T11 · 实现声学介导的真实对话

依赖：T05, T07, T08, T09, T10。

交付：两人独立看见、决定、发声、听见、回应；同刻不能无限聊天。

建议文件：`packages/sim-core/src/dialogue/`、`packages/sim-core/src/actions/SpeakAction.ts`。

验收：D01, D02, D03, L03, P06。

### T12 · 实现记录与无模型回放

依赖：T02, T03, T04, T05, T06, T07, T01。

交付：记录权威状态/感官/接受决策，按模拟时间播放，保留动作与台词时长。

建议文件：`packages/sim-core/src/replay/`、`apps/laya-client/src/playback/`。

验收：R01, R02, R03, R04, S03。

### T13 · 实现感官可视化与现场观察UI

依赖：T01, T06, T07, T08, T12。

交付：选人扇形、遮挡、参考听觉环、波纹、触控开关；暂停中UI可操作且不泄漏信息。

建议文件：`apps/laya-client/src/observer/`、`apps/laya-client/src/render/SensoryOverlay.ts`、`apps/laya-client/src/render/EngineWorldPauseAdapter.ts`。

验收：V01, V02, V03, K06, TM08。

### T14 · 完成两居民真实端到端演示

依赖：T11, T13。

交付：实际接模型并录制相遇、问候、感官与冻结；Mock演示不能完成本任务。

建议文件：`scenarios/two-residents/`、`docs/implementation/evidence/T14/`。

验收：TM01, TM02, TM03, L01, L02, L03, L04, D01, V03。

### T15 · 实现区域规划与世界内公告

依赖：T05, T06, T10, T13。

交付：只划用途与目标，已知地图布局、预算和公告；无固定职业与瞬间全图同步。

建议文件：`packages/sim-core/src/zones/`、`packages/sim-core/src/notices/`、`apps/laya-client/src/planning/`。

验收：Z01, Z02, Z03, K04, TM10。

### T16 · 实现项目、承诺、资源竞争与协作

依赖：T11, T15。

交付：个人提案与接受；程序只保障依赖/原子账本；资源竞争不按API返回快慢。

建议文件：`packages/sim-core/src/projects/`、`packages/sim-core/src/resources/ReservationLedger.ts`。

验收：C01, C02, C03, K04。

### T17 · 扩展个性、技能、长期目标与营地纪要

依赖：T10, T16。

交付：性格真实影响模型选择，技能随经历变，纪要可追溯而不伪造因果。

建议文件：`packages/sim-core/src/agents/Personality.ts`、`packages/sim-core/src/memory/Commitments.ts`、`apps/laya-client/src/observer/Chronicle.ts`。

验收：A03, K05, L02, D03。

### T18 · 新存档、屏障崩溃恢复与旧档转换

依赖：T04, T10, T12, T16。

交付：原始档备份、prepare/commit事务、随机状态与队列恢复、密钥排除。

建议文件：`packages/sim-core/src/save/`、`packages/sim-core/src/migrations/`。

验收：S01, S02, S03, TM06。

### T19 · 扩展8—12居民营地闭环

依赖：T14, T16, T17, T18。

交付：每人独立模型；通过住宅/粮食项目验证非固定职业；记录问题不以复杂场景掩盖缺陷。

建议文件：`scenarios/small-colony/`、`docs/implementation/evidence/T19/`。

验收：L01, L02, L04, C01, C02, C03, R01。

### T20 · 构建、浏览器和真机验收

依赖：T19。

交付：按已确认范围做构建/浏览器/真机，分别记录；未来小程序发布另列环境。

建议文件：`docs/implementation/device-matrix.md`、`docs/implementation/evidence/T20/`。

验收：E02, TM08, V03, R03。

### T21 · 交付审计与实施报告

依赖：T20。

交付：逐项变更/命令/证据/配置/阻塞/状态，明确尚未发布，不伪造外部写入。

建议文件：`docs/implementation/final-report.md`、`docs/implementation/status.json`。

验收：E03, E01。

## 4. 不要先做的内容

先完成两居民真实模型闭环，再扩展营地。首版不做自由生成任意建筑模型、复杂尸潮、精细经济、多人联机、真实语音识别、完整声场、无限规模人口。它们不属于证明全局屏障和私人感知正确的前置条件。

新玩法不是只做聊天，也不是只做感官展示。最终必须跑通区域→居民获知→提案→真实交流→自主承诺→物资与施工→结果记忆的因果链。

## 5. 最终报告必须包含

基线与最终HEAD；变更文件；真实命令/退出码；每个验收ID结果；模型与引擎配置；浏览器/真机区别；未完成项及原因；文档与存档兼容；提交/推送/发布是否真实发生。

本包不给实施者授权使用其他仓库、上传密钥或擅自正式发布。外部写入遵循当前用户授权。
