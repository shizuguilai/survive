# Survive Agent · 独立居民观察场

LayaAir 3.3.12 + TypeScript 原生 3D。先实现两名居民相遇、真实模型决策、打招呼、有限感官可视化和回放，再推进区域规划与营地协作。

**任何居民需要模型思考，全世界模拟暂停。** 网络与观察者界面继续；完整决策批次提交后恢复，不补跑 API 等待时间。每名居民独立请求模型，只获得自己的感官、已知目标和私人记忆。模型缺失或失败时保持暂停，不用规则或 Mock 代替居民决策。

本目录位于 `shizuguilai/survive` 仓库的 `agent-system/`。旧 `assets/`、旧工程配置及旧存档保留。工作分支、提交号和实际同步结果由交付记录列出，不直接改远端 `main`。

## 本地启动

需要 Node.js 24 或更高版本。进入本目录；在最终仓库结构中即 `survive/agent-system`。

```sh
npm ci
npm run engine:install
npm run build
npm start
```

`engine:install` 校验 `apps/laya-client/engine-lock.json` 中的四个运行时脚本。已存在且哈希正确时直接复用。缺少文件时，可通过拥有参考仓库读取权限的 `GITHUB_TOKEN` 获取，或将 `LAYA_REFERENCE_ROOT` 设置为本地参考工程根目录（其中应包含 `vendor/`）；安装前校验文件大小和 SHA-256。

`build` 执行 TypeScript 检查并产生 Web 包。`npm start` 启动本地网关并输出一次性登录链接；用该链接打开页面建立会话，默认地址为 `http://127.0.0.1:8787/`。该命令运行本机网关；线上采用独立的 Worker 入口和服务端密钥。

没有模型凭据也能打开观察界面、选择居民和查看感官，但世界保持静止；此时不能验收真实相遇或对话。

## 真实模型配置

下列配置仅进入服务端进程环境，模型密钥不放前端、IDE 配置或小游戏包。

| 环境变量 | 用途 / 默认值 |
|---|---|
| `SURVIVE_MODEL_API_KEY` | 真实模型调用必需；仅在服务端配置；已更换凭据并通过认证及本地真实核心验收 |
| `SURVIVE_MODEL_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` |
| `SURVIVE_MODEL_NAME` | `glm-4.5-air` |
| `SURVIVE_PORT` | 本地端口，默认 `8787` |

当前服务端只允许上表中的提供方地址与 `glm-4.5-air` 组合，没有fallback模型。共享提供方连接不共享居民上下文。网关明确continue及私人记忆证据格式，并按每名居民allowedActions裁剪schema；使用该模型支持的thinking disabled与max_tokens 4096降低响应时延。无效决定仍拒绝，工程不改写模型决定，全世界仍在真实请求期间冻结。

`npm start` **不会自动读取 `.env`**。若采用本地 `.env` 文件，使用 Node.js 自带加载方式启动：

```sh
node --env-file=.env services/brain-gateway/src/server.ts
```

`.env` 已被 Git 忽略。启动时的登录令牌为一次性会话入口，与模型 API key 不同；会话有效期一小时。`/api/health` 区分模型是否配置和当前观察者是否登录，不返回密钥。模型配置成功仍需要真实运行验证。

## 思考状态诊断

v0.3.1减少无意义的感官唤醒，保留人物、语音、身体和行动结果等重要触发。顶部显示认知批次、已返回人数、等待居民、累计秒数及重试次数；左侧显示实际动作和已执行模拟时长。真实请求期间仍全局冻结，提交后不补跑。详见 [THINKING_FIX.md](docs/implementation/THINKING_FIX.md)。

## 观察与居民装备

场景支持拖动镜头、滚轮缩放、选择居民、开关感官显示，以及按模拟时间查看已有回放。视觉扇形、听力参考环和最后已知位置用于解释有限感知；开关不改变居民实际输入。

居民初始化就穿衣。原生角色由圆头、圆润或修长身体和两个圆手构成，初始化可配置肤色、尺寸、发型、胡须和衣物颜色。**后续穿换衣、持拿武器与收纳物品由居民自己的模型决定，没有玩家换装面板。** 装备动作具有模拟时长、归属与容量限制；武器目前仅为造型和持拿，不包含攻击或伤害实现。

## 居民历史、工作台与建房

- 左侧「历史 / 档案」：按居民查看计划、实际行动、发声和私人记忆；点击条目打开详情，翻页或切换之前轮次。本机自动保存最近2000条；仅是观察者档案，不会给居民增加知识，也不等于恢复现场存档。
- 右上「工作台配方」：石斧需要2木材+3石料，石锄需要2木材+2石料。本人装备后，木材或浆果采收每份由1秒降为0.6秒。置换支持3木材→2石料、3石料→2木材、2木材→2浆果。
- 「规划 / 建房」：发布采集或制作目标，或在东/北/西三个预设地块建立木石小屋项目。总需12木材+8石料，按地基、墙体、屋顶顺序施工；材料从公共仓储扣除，建成后门廊休息恢复更快。
- 居民必须亲自读公告、工作台配方，自愿接取任务，自己取料、合成、装备和施工。程序只处理规则和原子结算。加工与建造熟练度每3点升一级，每级缩短4%耗时，最高5级。
- 世界思考冻结期间可以翻历史、拖镜头、查看配方或发布目标；发布仅进队列，完整模型批次提交后下一模拟步才写入世界。

具体范围及分项证据见 [WORKSHOP_PROGRESS.md](docs/implementation/WORKSHOP_PROGRESS.md)。

## 工程入口

| 路径 | 内容 |
|---|---|
| `apps/laya-client/` | LayaAir 工程、原生 3D 场景与观察界面 |
| `packages/sim-core/` | 模拟时钟、认知屏障、动作、有限感官、角色装备与回放 |
| `packages/contracts/` | 私人输入、模型动作与决策格式校验 |
| `services/brain-gateway/` | 真实模型适配、本机会话、云端鉴权与请求处理 |
| `tests/` | 工程测试；Mock 明确用于测试 |
| `docs/implementation/` | 基线、范围、阻塞与实施记录 |

## LayaAir IDE 与微信

使用 **LayaAir IDE 3.3.12** 打开 `apps/laya-client/LayaProject.laya`。运行时版本、参考提交与文件哈希见 `apps/laya-client/engine-lock.json`。

微信版还需要本项目自己的 AppID、微信开发者工具、可访问的 HTTPS 网关及合法域名配置。`src/platform-config.ts` 中的微信网关地址尚待配置。Web站点已按用户要求公开，服务端开启公开试玩；微信鉴权和合法域名仍需另行配置。

本环境缺少 LayaAir IDE 和微信真机。Web 打包、浏览器交互、IDE 构建、微信真机和正式发布分别记录，不能互相代替。

## 范围与验收

```sh
npm test
npm run typecheck
```

本地真实核心闭环已通过：2名居民独立发起10次 `glm-4.5-air` 请求，接受10个真实决定；双方发声并听见后再次决定，2023次冻结检查无世界变化、无补跑，0个Mock决定。真实记录无损保存在本地 `evidence/real-meeting-replay.json.gz`，包含居民私人上下文，不上传GitHub。本地浏览器播放该记录、seek、选人和感官检查通过，期间0次模型请求。

**T14仍为partial**：上述浏览器结果是播放已有真实记录，不是实时模型浏览器、线上浏览器或真机验收；完整L01–L04等仍待核对。普通衣物自主换装案例仍待专项验收；本轮石斧/石锄真实制作与装备单独记录。按用户追加要求，实现T15/T16的最小任务、工作台和小屋项目；完整区域规划及协作仍未验收。9项网关测试通过；旧HTTP401及后续协议/超时失败保留为已解决的历史记录。可复现实测脚本和脱敏统计随代码同步；原始回放与截图仅保留本地。发布的模型审计记录保留decisionHash等校验信息，不包含原始私人决定。

T18 完整存档恢复尚未实现。浏览器写入的提交 checkpoint 不是已完成的启动读档、断电恢复或旧存档迁移；回放读取也不等于恢复现场模拟。当前已接入 `haul`、`withdraw`、`eat`、`craft`、`exchange`、`build`。战斗、交易谈判、任意建筑蓝图及救援尚未实现。

详见 [范围与阻塞](docs/implementation/SCOPE_AND_BLOCKERS.md)、[仓库基线](docs/implementation/baseline.md)、[角色装备说明](docs/implementation/character-system.md) 和 [任务记录](docs/implementation/task-board.json)。最终验收以实际运行证据为准。

### 本机填写模型配置

复制 `.env.example` 为 `.env`，仅填写本项目的 `SURVIVE_MODEL_API_KEY`。随后运行 `npm run start:env`；真实模型验收运行 `npm run verify:real:env`。`.env` 已排除在 Git 外，不能放进微信客户端。

## 云端发布

已发布：[https://survive-agent.drtdengruiting.chatgpt.site](https://survive-agent.drtdengruiting.chatgpt.site)（公开访问，无需登录即可启动真实自治）。密钥仅保存在服务端，固定使用 `glm-4.5-air`。最新部署记录见 [workshop-deployment.json](evidence/workshop-deployment.json)，早期部署保留为历史。

`services/brain-gateway/src/worker.ts` 仅在服务端明确开启 `SURVIVE_PUBLIC_PLAY` 时接受公开试玩请求；仍校验同源、输入合同及指定模型。`/api/health` 不返回密钥。线上实时模型浏览器验收与本地真实模型验证分开记录，不能用页面可访问代替真实行为验证。

带有 `.openai/hosting.json` 的托管检出目录运行 `npm run build` 会生成 `dist/client` 与 `dist/server/index.js`；普通本地目录仍生成原有 Web 包。密钥通过发布平台的运行时 secret 配置，不能打包进产物。
