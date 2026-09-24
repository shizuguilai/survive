# Survive Agent · 独立居民观察场

LayaAir 3.3.12 + TypeScript 原生 3D。先实现两名居民相遇、真实模型决策、打招呼、有限感官可视化和回放，再推进区域规划与营地协作。

**任何居民需要模型思考，全世界模拟暂停。** 网络与观察者界面继续；完整决策批次提交后恢复，不补跑 API 等待时间。每名居民独立请求模型，只获得自己的感官、已知目标和私人记忆。模型缺失或失败时保持暂停，不用规则或 Mock 代替居民决策。

本目录将在原 `shizuguilai/survive` 仓库中作为 `agent-system/` 存在。旧 `assets/`、旧工程配置及旧存档保留。工作分支、提交号和实际同步结果由交付记录列出，不直接改远端 `main`。

## 本地启动

需要 Node.js 24 或更高版本。进入本目录；在最终仓库结构中即 `survive/agent-system`。

```sh
npm ci
npm run engine:install
npm run build
npm start
```

`engine:install` 校验 `apps/laya-client/engine-lock.json` 中的四个运行时脚本。已存在且哈希正确时直接复用。缺少文件时，可通过拥有参考仓库读取权限的 `GITHUB_TOKEN` 获取，或将 `LAYA_REFERENCE_ROOT` 设置为本地参考工程根目录（其中应包含 `vendor/`）；安装前校验文件大小和 SHA-256。

`build` 执行 TypeScript 检查并产生 Web 包。`npm start` 启动本地网关并输出一次性登录链接；用该链接打开页面建立会话，默认地址为 `http://127.0.0.1:8787/`。当前服务仅绑定本机，并不是已经部署的公网网关。

没有模型凭据也能打开观察界面、选择居民和查看感官，但世界保持静止；此时不能验收真实相遇或对话。

## 真实模型配置

下列配置仅进入服务端进程环境，模型密钥不放前端、IDE 配置或小游戏包。

| 环境变量 | 用途 / 默认值 |
|---|---|
| `SURVIVE_MODEL_API_KEY` | 真实模型调用必需；当前交付环境缺少此项 |
| `SURVIVE_MODEL_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` |
| `SURVIVE_MODEL_NAME` | `glm-4.5-air` |
| `SURVIVE_PORT` | 本地端口，默认 `8787` |

当前服务端只允许上表中的提供方地址与模型组合。共享提供方连接不共享居民上下文。

`npm start` **不会自动读取 `.env`**。若采用本地 `.env` 文件，使用 Node.js 自带加载方式启动：

```sh
node --env-file=.env services/brain-gateway/src/server.ts
```

`.env` 已被 Git 忽略。启动时的登录令牌为一次性会话入口，与模型 API key 不同；会话有效期一小时。`/api/health` 区分模型是否配置和当前观察者是否登录，不返回密钥。模型配置成功仍需要真实运行验证。

## 观察与居民装备

场景支持拖动镜头、滚轮缩放、选择居民、开关感官显示，以及按模拟时间查看已有回放。视觉扇形、听力参考环和最后已知位置用于解释有限感知；开关不改变居民实际输入。

居民初始化就穿衣。原生角色由圆头、圆润或修长身体和两个圆手构成，初始化可配置肤色、尺寸、发型、胡须和衣物颜色。**后续穿换衣、持拿武器与收纳物品由居民自己的模型决定，没有玩家换装面板。** 装备动作具有模拟时长、归属与容量限制；武器目前仅为造型和持拿，不包含攻击或伤害实现。

## 工程入口

| 路径 | 内容 |
|---|---|
| `apps/laya-client/` | LayaAir 工程、原生 3D 场景与观察界面 |
| `packages/sim-core/` | 模拟时钟、认知屏障、动作、有限感官、角色装备与回放 |
| `packages/contracts/` | 私人输入、模型动作与决策格式校验 |
| `services/brain-gateway/` | 真实模型适配、本机会话与请求处理 |
| `tests/` | 工程测试；Mock 明确用于测试 |
| `docs/implementation/` | 基线、范围、阻塞与实施记录 |

## LayaAir IDE 与微信

使用 **LayaAir IDE 3.3.12** 打开 `apps/laya-client/LayaProject.laya`。运行时版本、参考提交与文件哈希见 `apps/laya-client/engine-lock.json`。

微信版还需要本项目自己的 AppID、微信开发者工具、可访问的 HTTPS 网关及合法域名配置。`src/platform-config.ts` 中的微信网关地址尚待配置。当前本地网关的本机会话限制需要另行完成适用于部署环境的服务配置与验收。

本环境缺少 LayaAir IDE 和微信真机。Web 打包、浏览器交互、IDE 构建、微信真机和正式发布分别记录，不能互相代替。

## 范围与验收

```sh
npm test
npm run typecheck
```

测试通过不能代替真实模型验收。当前 T14 缺少真实 API key；按用户要求，T15–T21 区域规划、营地合作及人口扩展先等待两居民真实闭环通过。

T18 完整存档恢复尚未实现。浏览器写入的提交 checkpoint 不是已完成的启动读档、断电恢复或旧存档迁移；回放读取也不等于恢复现场模拟。`haul`、`build`、`eat` 等设计动作尚未接入时不能被当作可运行功能。

详见 [范围与阻塞](docs/implementation/SCOPE_AND_BLOCKERS.md)、[仓库基线](docs/implementation/baseline.md)、[角色装备说明](docs/implementation/character-system.md) 和 [任务记录](docs/implementation/task-board.json)。最终验收以实际运行证据为准。

### 本机填写模型配置

复制 `.env.example` 为 `.env`，仅填写本项目的 `SURVIVE_MODEL_API_KEY`。随后运行 `npm run start:env`；真实模型验收运行 `npm run verify:real:env`。`.env` 已排除在 Git 外，不能放进微信客户端。
