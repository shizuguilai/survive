# 来源、基线与适用范围

核对日期：2026-09-23。本文档包的架构与数值为针对用户需求提出的设计，引用资料仅支持相应基础机制，不能证明本设计已经运行、稳定或拟人化成功。

## 一、仓库已核对事实

唯一目标 `shizuguilai/survive`。远端 main 核对为 `60f5d7eb33860484065a3f98afc5693e9e69c337`，2026-06-03 初始化提交。本次没有检出/修改目标仓库，没有检查用户本机未提交改动；后续必须重新执行 T00。

- **S1 仓库分支与包配置**：main API 与固定提交的 package.json。旧工程声明 Creator 3.8.6；没有确认目标 LayaAir 小版本。
  - https://api.github.com/repos/shizuguilai/survive/branches/main
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/package.json
- **S2 World**：World 持有资源/人物/建筑，placeBuilding 由玩家输入调用并扣资源；tick 顺序驱动系统。
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/core/World.ts
- **S3 JobSystem / BuildSystem / Entities**：职业 switch 和 Worker/Farmer 判断；Survivor 尚无私人记忆、性格/关系结构。
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/core/systems/JobSystem.ts
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/core/systems/BuildSystem.ts
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/core/Entities.ts
- **S4 GameRoot**：UI_2D/Graphics 表现，真实帧 dt 累积驱动固定 tick；插入屏障须防追帧。
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/render/GameRoot.ts
- **S5 Config / WaveSystem**：旧 TICK_DT=1/20、一天45秒、第二天起生成尸潮。新认知原型不沿用这种危机节奏作为验收前提。
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/core/Config.ts
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/core/systems/WaveSystem.ts
- **S6 SaveManager**：旧 JSON 世界快照，保存异常被忽略；不是新认知事务存档实现。
  - https://github.com/shizuguilai/survive/blob/60f5d7eb33860484065a3f98afc5693e9e69c337/assets/scripts/core/SaveManager.ts

以上固定提交源码在本会话前序仓库审查中已读取；本次又核对 main、package.json、GameRoot 的关键循环，未重新宣称完成全仓测试。

## 二、一手工程依据

- **S7 SimPy 官方 Environments**：模拟环境管理自己的时间与事件，支持 step/run。仅作为模拟时间与真实时间分离的依据，不要求使用 Python/SimPy。
  - https://simpy.readthedocs.io/en/4.1.2/topical_guides/environments.html
- **S8 LayaAir 官方定时器文档（3.2）**：timer 的时间/帧回调与 pause/resume。只证明存在相关能力，不能据此假定所有子系统都由一个 timer 控制。目标 IDE 小版本须另行锁定和验证。
  - https://layaair.com/3.2/doc/basics/common/Timer/readme.html
- **S9 LayaAir 官方 3D 物理文档（3.1）**：物理组件、运动学与射线查询。仅支持适配层可用相关能力的设计方向，具体 API 以锁定版本为准。
  - https://layaair.com/3.1/doc/IDE/physicsEditor/physics3D/readme.html
- **S10 Steam Audio 官方 Guide**：距离、遮挡、透射等声学因素，作为听觉分层的参考；不要求接入 Steam Audio。
  - https://valvesoftware.github.io/steam-audio/doc/unity/guide.html
- **S11 Anthropic《Building effective agents》**：模型借助工具与环境反馈循环工作，强调工具边界与检查。不是供应商选择或本项目性能保证。
  - https://www.anthropic.com/engineering/building-effective-agents

## 三、当前未确认项

目标 LayaAir/IDE 精确版本；可用模型提供商与型号；API 凭据；网关部署地；真实模型时延；浏览器性能；手机实测；小游戏平台发布条件；旧工程在用户本机的未提交修改；任何正式发布结果。

不得把建议的 50ms 步长、3秒心跳、8—12居民说成已验证性能。不得把有限感知实现说成模型具有真实人类意识，或保证不会跳出角色。
