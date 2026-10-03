# Survive Agent · 独立居民观察场

**营地存档与个性住宅：每10秒及关键操作自动保存，重新进入恢复现场后点击「继续营地」。运行设置中可手动保存、读取。新住宅有六种占地、屋顶、配色和家具布局，扩建沿用各自风格。** [使用、兼容与验证](docs/implementation/SAVE_AND_PERSONAL_HOMES.md)。

**观察体验更新：缩放按钮下方可左转、右转和复位视角；地标文字固定，不再随居民避让。修正树墩残留的大阴影，灯具改为支架式玻璃灯罩；已发布目标支持完整列表滑动。** [操作与验证](docs/implementation/SCENE_OBSERVATION.md)。

**地图导航更新：右下小地图显示居民、建筑和当前视野，可点击/拖动定位或一键回营地。双指同向平移、张合缩放，过滤指距抖动并限制镜头边界，避免拖出地面。** [操作与验证](docs/implementation/MAP_NAVIGATION.md)。

**交互与居住区更新：双指缩放和移动、仓储侧栏、角色分区详情及背包清单、重叠轮选、物体采集量、居住区自主安家、房门寻路、屋顶开关与建造动作。** [操作说明和分项验收](docs/implementation/SETTLEMENT_INTERACTION.md)。

**在线性能更新：取消回放按钮、时间轴和后台逐步录制，保留私人记忆与居民档案。默认流畅画面，可切回精细画面。** 四居民对照测试至2000步约67秒降至7秒（测试总耗时，不是手机帧率），同一步世界哈希一致。见[原因、实测与分项验收](docs/implementation/LIVE_PERFORMANCE.md)。

最新：左侧居民信息默认折叠，底部保留档案/地图/感官；人物双手、持物和身体起伏由模拟时间驱动，冻结时一起停住。[使用与验收](docs/implementation/INSPECTOR_AND_GAIT.md)。

最新美术：高清画布与抗锯齿、俯视圆头居民、地块/木石材质和深色观察界面。[改动与分项验收](docs/implementation/ART_DIRECTION.md)。

**v0.4.0：三种运行模式。默认由一个glm-4.5-air统筹4名居民，按阶段执行任务；保留独立居民模式，另有免远程的本地算法。** 右上「运行设置」可切换、设置人数/阶段工作量/调用间隔/失败降级；「规划 / 居住区」布置任务。真实验证仅3次模型调用完成8木材和整间小屋。见[模式说明与分项验收](docs/implementation/CONTROL_MODES.md)。

v0.3.3新增每名居民独立的**地图记忆 + 文字记忆**。左侧「地图记忆 · 个人探索」查看走过的路线、曾见资源和障碍；暗色区域未知，旧记忆可能过时。文字继续保留对话、约定和行动结果。修复认出过的树被模糊视角覆盖、原地walk反复记成成功的问题。见[实现与分项验收](docs/implementation/MAP_MEMORY_AND_WALK_LOOP.md)。

新增「阶段总结」：真实glm-4.5-air归纳关键进展，点开可核对原始记录；档案翻页固定当前列表，支持旧轮次。见[本轮说明](docs/implementation/ARCHIVE_SUMMARY.md)。

v0.3.2相遇与讲话去重，允许沉默继续做事；见[触发规则与验收](docs/implementation/ENCOUNTER_TRIGGERS.md)。

LayaAir 3.3.12 + TypeScript 原生 3D。先实现两名居民相遇、真实模型决策、打招呼、有限感官可视化和回放，再推进区域规划与营地协作。

**任何居民需要模型思考，全世界模拟暂停。** 网络与观察者界面继续；完整决策批次提交后恢复，不补跑 API 等待时间。独立模式下每名居民独立请求模型，只获得自己的感官、已知目标和私人记忆，失败保持暂停。统筹模式可按设置显式转本地算法，本地模式无需远程模型；两者不冒充独立模型。

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

没有模型凭据也能选择本地算法运行、选择居民和查看感官；统筹失败可按开关明确降级。独立居民模式仍需真实模型，不把算法运行当成真实相遇验收。

## 真实模型配置

下列配置仅进入服务端进程环境，模型密钥不放前端、IDE 配置或小游戏包。

| 环境变量 | 用途 / 默认值 |
|---|---|
| `SURVIVE_MODEL_API_KEY` | 真实模型调用必需；仅在服务端配置；已更换凭据并通过认证及本地真实核心验收 |
| `SURVIVE_MODEL_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` |
| `SURVIVE_MODEL_NAME` | `glm-4.5-air` |
| `SURVIVE_PORT` | 本地端口，默认 `8787` |

当前远程服务只允许上表中的提供方地址与 `glm-4.5-air` 组合，不切换其他模型。统筹模式的可选降级是明确标注的本地任务算法。共享提供方连接不共享居民上下文。网关明确continue及私人记忆证据格式，并按每名居民allowedActions裁剪schema；使用该模型支持的thinking disabled与max_tokens 4096降低响应时延。无效决定仍拒绝，工程不改写模型决定，全世界仍在真实请求期间冻结。

`npm start` **不会自动读取 `.env`**。若采用本地 `.env` 文件，使用 Node.js 自带加载方式启动：

```sh
node --env-file=.env services/brain-gateway/src/server.ts
```

`.env` 已被 Git 忽略。启动时的登录令牌为一次性会话入口，与模型 API key 不同；会话有效期一小时。`/api/health` 区分模型是否配置和当前观察者是否登录，不返回密钥。模型配置成功仍需要真实运行验证。

## 思考状态诊断

v0.3.1减少无意义的感官唤醒，保留人物、语音、身体和行动结果等重要触发。顶部显示认知批次、已返回人数、等待居民、累计秒数及重试次数；左侧显示实际动作和已执行模拟时长。真实请求期间仍全局冻结，提交后不补跑。详见 [THINKING_FIX.md](docs/implementation/THINKING_FIX.md)。

## 观察与居民装备

场景支持单指拖动、双指缩放与平移、滚轮缩放、点击角色自动打开详情及重叠轮选、点击树石查看余量、选择居民、开关感官显示，以及查看私人地图和历史档案；在线回放与后台录制已移除。视觉扇形、听力参考环和最后已知位置用于解释有限感知；开关不改变居民实际输入。

居民初始化就穿衣。原生角色由圆头、圆润或修长身体和两个圆手构成，初始化可配置肤色、尺寸、发型、胡须和衣物颜色。**后续穿换衣、持拿武器与收纳物品由居民自己的模型决定，没有玩家换装面板。** 装备动作具有模拟时长、归属与容量限制；武器目前仅为造型和持拿，不包含攻击或伤害实现。

## 居民历史、工作台与建房

- 左侧「历史 / 档案」：按居民查看计划、实际行动、发声和私人记忆；点击条目打开详情，翻页或切换之前轮次。本机自动保存最近2000条；档案是独立的观察者记录。另有完整营地存档保存现场和私人状态，不会给居民增加未经历的知识。
- 右上「工作台配方」：石斧需要2木材+3石料，石锄需要2木材+2石料。本人装备后，木材或浆果采收每份由1秒降为0.6秒。置换支持3木材→2石料、3石料→2木材、2木材→2浆果。
- 「规划 / 居住区」：发布采集或制作目标；选择「划居住区」，在地图拖出至少6×6格的任意矩形并确认。居民亲自阅读后可为自己申请住处，区域可容纳多间房，避开树石、池塘、现有建筑并预留门口通路。新住宅按居民风格分配不同大小；基础建材为12–18木材、8–12石料，实际配方由已读建房任务说明，从公共仓储扣除。按地基、墙体、屋顶施工，已拥有住处者不重复申请；较大的房屋需要更宽敞的用地。右上可隐藏屋顶，居民从门口进出。
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

T18 已实现本机完整营地保存、启动读档、双份校验回退和旧版决策 checkpoint 恢复。未提交的模型批次重新请求；已提交动作按保存进度继续，离线时间不补跑。本机保存不跨设备同步；清除浏览器数据会删除它。更早项目格式转换、真实浏览器崩溃和微信真机恢复仍待验收，见[存档说明](docs/implementation/SAVE_AND_PERSONAL_HOMES.md)。当前已接入 `haul`、`withdraw`、`eat`、`craft`、`exchange`、`build`。战斗、交易谈判、任意建筑蓝图及救援尚未实现。

详见 [范围与阻塞](docs/implementation/SCOPE_AND_BLOCKERS.md)、[仓库基线](docs/implementation/baseline.md)、[角色装备说明](docs/implementation/character-system.md) 和 [任务记录](docs/implementation/task-board.json)。最终验收以实际运行证据为准。

### 本机填写模型配置

复制 `.env.example` 为 `.env`，仅填写本项目的 `SURVIVE_MODEL_API_KEY`。随后运行 `npm run start:env`；真实模型验收运行 `npm run verify:real:env`。`.env` 已排除在 Git 外，不能放进微信客户端。

## 云端发布

已发布：[https://survive-agent.drtdengruiting.chatgpt.site](https://survive-agent.drtdengruiting.chatgpt.site)（公开访问，无需登录即可启动真实自治）。密钥仅保存在服务端，固定使用 `glm-4.5-air`。最新部署记录见 [inspector-deployment.json](evidence/inspector-deployment.json)，早期部署保留为历史。

`services/brain-gateway/src/worker.ts` 仅在服务端明确开启 `SURVIVE_PUBLIC_PLAY` 时接受公开试玩请求；仍校验同源、输入合同及指定模型。`/api/health` 不返回密钥。线上实时模型浏览器验收与本地真实模型验证分开记录，不能用页面可访问代替真实行为验证。

带有 `.openai/hosting.json` 的托管检出目录运行 `npm run build` 会生成 `dist/client` 与 `dist/server/index.js`；普通本地目录仍生成原有 Web 包。密钥通过发布平台的运行时 secret 配置，不能打包进产物。

## 生活、昼夜与住房成长

背包和生活详情可单指滑动，带可拖动滚动条；顶部统筹简介点击展开全文。提示自动消失，所有身体状态条都以100%为好。居民有住房与生活心愿，气泡和详情显示原因；长期需求未满足会影响心情。加入昼夜、床、柜子、灯、拖把，以及备料后自主拆旧扩建。详见 [生活系统说明与验证](docs/implementation/LIVING_SYSTEM.md)。


## Reference-painted interface · 2026-10-03

The existing LayaAir 3.3.12 client now uses the selected warm green illustrated camp reference: textured meadow, illustrated foliage/resources/pond, standard resident portraits, blue HUD panels, green primary controls, right-hand warehouse and map. Sprites are projected from existing world coordinates and sorted by ground depth. All simulation, model barriers, saving and private resident memories stay in the existing engine.

- Generated assets and prompt provenance: `apps/laya-client/assets/art/`; crop anchors: `src/art-atlas.json`. Standard characters use stable resident IDs. Edited appearances or changed equipment retain their full native model; this avoids erasing hair/body/clothing/equipment customization. Walking sprite motion is derived from simulation ticks.
- Original PNG bytes are stored in `apps/laya-client/assets/art-parts/` to fit transfer limits. `tools/copy-art.mjs` automatically reconstructs them into the build output and verifies each SHA-256. No image quality is lost and no extra setup is required.
- Completed houses retain design colors and footprint-dependent proportions. Rotated views, construction stages and roof-hidden interiors use the existing native house with all furniture. These native customization/cutaway views have not yet been fully converted to modular painted artwork.
- Map pan, pinch, zoom, selection, minimap and roof controls remain live. Selection uses painted sprite bounds at close zoom. Ground is tiled with explicit UVs to avoid non-power-of-two repeat/clamp artefacts on WebGL devices.
- Chinese interface subset: Noto Sans CJK SC, SIL OFL 1.1, source `https://github.com/notofonts/noto-cjk`; license is included alongside the WOFF. System font fallback handles characters outside the subset.
- Verification: targeted camera/minimap/touch/scenery/character/pose/save/barrier regression files; typecheck + production build; real Laya WebGL rendering at 1536×864 and 844×390/DPR2, checking resource loading, yaw, zoom, cutaway and unchanged world hash. `tools/verify-painted-ui.mjs` uses an explicit visual fixture, no live model requests. Set `BROWSER_EXECUTABLE_PATH` to an installed Chromium. Physical handset and WeChat IDE builds were not run for this visual change.
