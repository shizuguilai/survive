# 真实模型网关配置与验收

本交付未配置本项目真实模型密钥。默认模式为 `REAL_MODEL`，缺少密钥即错误暂停；没有规则脑兜底，也不会自动启用 Mock。测试中的 `MOCK_UPSTREAM` 是注入的 HTTP 测试响应，不能作为真实模型完成证据。

## 服务端配置

- Node.js 24；在项目目录运行 `npm run build`、`npm start`。
- `SURVIVE_MODEL_API_KEY`：仅本项目获授权的服务端密钥。不要复用其他项目凭据，不写入源代码、前端、回放或报告。
- `SURVIVE_MODEL_BASE_URL` 默认 `https://open.bigmodel.cn/api/paas/v4`，`SURVIVE_MODEL_NAME` 默认 `glm-4.5-air`；两者是允许清单中的唯一组合。模型偏好与真实连通性验证是不同状态。
- `SURVIVE_PORT` 默认 `8787`，服务只绑定 `127.0.0.1`。
- `npm start` 不自动读取 `.env`。如在本机用未提交的 `.env`，运行 `node --env-file=.env services/brain-gateway/src/server.ts`；验收相应使用 `node --env-file=.env tools/verify-real.ts`。密钥不应出现在命令行实参或 shell 历史中。

服务启动时显示一次性本地登录链接。访问后立即重定向到 `/` 并设置一小时 `HttpOnly; SameSite=Strict` 会话 cookie。也可用界面的本地会话令牌输入框，经 `POST /api/session {"token":"..."}` 换取 cookie。令牌使用一次后作废；过期需重启本地网关取得新令牌。该令牌与模型 API key 完全不同。不要把启动日志放入验收报告。此实现仅面向受信任的本机观察者，尚非生产多用户认证。

`GET /api/health` 返回配置和鉴权状态，不返回密钥。`POST /api/decide` 需 cookie，收到完整 `BrainRequest`，成功直接返回 `BrainResponse`。客户端无权指定 endpoint、model、密钥或响应来源。异常只给观察者 `{error:{code,message},message}`，不会注入居民上下文。拒绝外部 Host、跨来源请求、任意 URL 代理与重定向。

## 隔离和验证边界

每名居民单独请求。上游仅收到 system 能力说明和该居民 `CharacterContext`，不收到 transport envelope、真实网络耗时、其他居民私人状态。角色 DTO 和感官 DTO 严格白名单；未知字段拒绝。目标动作只允许 `knownTargets`；记忆建议证据只能引用自己的观察和已提供记忆。装备通过本人私有 `item_N` 引用，允许 `equip_item / unequip_item`，实际所有权、槽位、背包容量由执行器再次验证，动作执行消耗模拟时间。

结构/schema、引用权限、证据、正审视时间、同阶段身体通道冲突分别验证。合法但不合作、没有问好等选择不被规则改写。格式修复最多两次，每次请求网络重试最多两次，整个居民请求上限 120 秒；失败进入错误暂停。真实模式没有人为默认 `continue`。请求 ID 绑定 SHA-256 完整 envelope+context，重复进行中/成功请求共用结果，不同内容拒绝。同一居民不能并发执行不同请求。失败请求可用同 ID、同快照显式再试。

通用 `hashCanonical` 使用 FNV-1a 64 位进行浏览器/服务端一致的快照校验，**不是密码学认证**；网关幂等绑定另用 SHA-256。回放 hash 只能发现意外变化，不能证明不可信文件由真实模型生成。角色因果真实性还取决于模拟端权威感官/记忆生成器，当前本地工具不向不受信任玩家开放决策入口。

## 真实验收

`npm run verify:real` 会写 `evidence/real-model-verification.json`：

- 缺 key：`BLOCKED / MODEL_NOT_CONFIGURED`，进程退出码 2，真实请求数 0。
- 已配置：最多 24 次独立请求、最多 30 秒模拟时间；不操纵模型问候。要求两人均真实作出发言意图，并各自通过自己的听觉获得对方说出的内容后完成独立决策。
- 持续检查请求等待期间世界 hash 不变，恢复首帧无补跑；保存感官叠层快照，回放 seek 一致，manifest 只能有 real 决策。通过后生成 `real-meeting-replay.json`。
- 若服务错误、预算耗尽、模型未完成相遇问候或验证失败，退出码 1，记录 `FAILED`，不会宣称闭环成功。

脚本的 `PASS` 只覆盖代码层真实调用与模拟/回放，不代表浏览器、微信真机或正式发布通过。独立记录这些状态。审计仅含请求引用/hash、模型名、版本 unknown、温度、次数、耗时、短理由与结构化已接受决策，不记录 API key、HTTP 原始错误体或内部思维链。
