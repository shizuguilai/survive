# Survive · 独立居民观察场

当前试玩已加入**居民历史、工作台配方、石斧/石锄、资源置换和分阶段建房**，保留饥饿、生命与疲劳系统。左侧「历史 / 档案」可翻页、筛选、点开详情；右上「工作台配方」查看材料表，「规划 / 建房」发布采集、制作或小屋项目。居民亲自阅读后自主决定参与，材料和工程进度按实际动作结算。详见[本轮实现与验收](agent-system/docs/implementation/WORKSHOP_PROGRESS.md)。

当前分支的主实现位于 **[`agent-system/`](agent-system/README.md)**，使用 **LayaAir 3.3.12 + TypeScript 原生 3D**。先完成两名居民相遇、打招呼、有限感官可视化与回放，再扩展区域规划和营地协作。仓库根目录原有的 Cocos 工程保留为历史实现。

## 核心规则

- **任何居民需要大模型思考时，全世界模拟暂停。** 网络和观察者界面继续运行，完整决策批次提交后才恢复，禁止补跑等待时间。
- 每名居民独立调用真实模型，只获得自己的有限感官、私人记忆和已知物品。共享模型服务不共享居民上下文；模型失败时保持暂停，不用规则或 Mock 代替居民决定。
- 居民初始化就穿衣，之后由自己的模型决定穿换衣、持拿和收纳装备。没有玩家换装面板；装备有归属、双手占位和背包容量限制，动作耗费模拟时间。
- 观察者可以选人、移动镜头、查看视野扇形与听力参考环，并按模拟时间播放已有回放。感官显示开关不改变模型输入，回放不重新调用模型。

角色、场景和界面均采用 Laya 原生能力。武器目前只有外观与持拿规则，尚未实现攻击或伤害。

## 安装与本地运行

需要 **Node.js 24 或更高版本**。从仓库根目录执行：

```sh
cd agent-system
npm ci
npm run engine:install
npm run build
npm start
```

`engine:install` 根据锁定文件校验 Laya 运行时；若缺少文件，需要参考仓库的读取权限，或设置 `LAYA_REFERENCE_ROOT` 指向带有 `vendor/` 的本地参考工程。详见 [安装与配置说明](agent-system/README.md)。

`npm start` 启动本机服务并输出一次性登录链接，默认本地端口为 `8787`。没有真实模型配置时可以观察静止场景，不能据此判断真实对话已完成。

真实模型凭据只放服务端。将 `agent-system/.env.example` 复制为该目录下的 `.env`，填写 `SURVIVE_MODEL_API_KEY`，然后在 `agent-system/` 执行：

```sh
npm run start:env
```

普通 `npm start` 使用进程环境，不自动读取 `.env`。当前模型适配为智谱 `glm-4.5-air`；密钥不能进入前端、微信包或 Git 提交。

## LayaAir 与微信入口

使用 **LayaAir IDE 3.3.12** 打开 [`agent-system/apps/laya-client/LayaProject.laya`](agent-system/apps/laya-client/LayaProject.laya)。本项目的微信 AppID、HTTPS 网关和合法域名需要单独配置，不沿用参考推币机工程的业务配置。

Web 打包、浏览器交互、真实模型闭环、Laya IDE 构建、微信真机和正式发布分别验收。本地真实核心闭环与真实记录浏览器播放已通过；T14仍为partial，实时模型浏览器、线上浏览器及完整验收尚待完成，微信未发布；详细结果见 [实施任务记录](agent-system/docs/implementation/task-board.json) 与 [范围和阻塞](agent-system/docs/implementation/SCOPE_AND_BLOCKERS.md)。完整存档恢复、自由区域划定、承诺协商及长期营地协作仍待实现；本轮按用户要求先交付三个预设建设地块和木石小屋项目。可复现实测脚本与脱敏统计随代码同步；包含私人上下文的原始回放和截图只留在本地，不在GitHub。

## 部署状态

| 项目 | 记录 |
|---|---|
| Web 部署地址 | [https://survive-agent.drtdengruiting.chatgpt.site](https://survive-agent.drtdengruiting.chatgpt.site)（公开访问；无需登录即可启动真实自治） |
| 当前发布版本 | v0.3已公开发布（工作台、档案、小屋），见 [工作台与建房部署记录](agent-system/evidence/workshop-deployment.json)，公开站点沿用原地址和服务端配置 |
| 前一轮营地真实模型 | 45次独立请求；亲读公告、自主接受、实际采集令目标进度+1；8821次冻结检查无违规，非完整长期营地验收 |
| 本轮工作台与建房 | [真实模型分场景统计](agent-system/evidence/workshop-real.json)；明确区分准备材料夹具、实际动作和未测的完整自主备料协作 |
| 本地真实核心闭环 | `glm-4.5-air` 独立请求10次、接受10个决定；2居民双方发声并听见后再决定，2023次冻结检查无变化且不追帧，无Mock |
| 本地浏览器回放 | 播放真实记录、seek、选人和感官通过，0模型请求；不是实时模型或线上浏览器验收 |
| 微信真机与正式发布 | 待平台独立验收 |

## 目录与历史实现

| 入口 | 用途 |
|---|---|
| [`agent-system/`](agent-system/README.md) | 当前 LayaAir 3D 主实现、模拟内核、真实模型网关和测试 |
| [`agent-system/docs/implementation/`](agent-system/docs/implementation/) | 实施记录、基线、角色装备说明及阻塞项 |
| `assets/scripts/` | 保留的旧版 Cocos Creator 3.8.6 / TypeScript 2D 工程 |
| [`README_SETUP.md`](README_SETUP.md) | 旧 Cocos 工程的启动说明 |
| [`docs/项目架构.md`](docs/项目架构.md) / [`docs/游戏介绍.md`](docs/游戏介绍.md) | 旧 Project Outpost（末日营地）的架构与玩法说明 |

旧版采用采集、建设、固定职业、人口发展与尸潮防御循环；这些历史能力不代表已经迁入新的独立居民系统。旧工程文件与旧存档保留，新功能从 `agent-system/` 进入。
