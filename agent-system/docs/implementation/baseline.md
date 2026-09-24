# 仓库与引擎基线

2026-09-23 重新读取 GitHub `shizuguilai/survive` 的 `main`、提交元数据和完整树，并获取固定提交上的全部文件。核对结果：

| 项目 | 结果 |
|---|---|
| 原仓库 | `git@github.com:shizuguilai/survive.git` |
| 原仓库 main / 参考 HEAD | `60f5d7eb33860484065a3f98afc5693e9e69c337` |
| 原始提交 | 2026-06-03 初始化提交，无父提交 |
| 根树 SHA | `ad33e4284a93932af2fa66023a5abcd33e633a0f` |
| 完整源码 | 28 文件，89,340 字节 |
| 旧引擎声明 | Cocos Creator 3.8.6 |
| 校验 | 28 个 blob、根树与原始提交 SHA 完全一致；`git fsck --full` 通过 |
| 原始检出状态 | 本地重建参考检出 main/HEAD/origin/main 一致，源码无修改 |

直接 SSH 获取当时不可用，因此通过 GitHub 连接器读取固定提交并重建精确 Git 对象；不是通过 `git clone` 获取。原始机器可见目录中没有用户正在编辑的目标工作树；无法检查用户自己电脑上的未提交改动。没有对用户本机状态作出“全部干净”的判断。

原始核对证据保留在 `baseline-evidence.json`。其中 scratch 路径用于记录本次取证位置，不是导入项目需要设置的路径。

## 合并位置与保留范围

新实现计划位于原 `survive` 仓库新增的 `agent-system/`，旧 `assets/`、`package.json`、文档和旧存档命名空间保留。新代码通过独立工作分支同步，不直接修改远端 `main`。最终工作分支、提交号和实际同步结果以交付记录为准；本说明不代表已经推送。

原代码包含世界、资源、寻路、固定职业分配、建筑、战斗和 Cocos 2D 表现。可参考其中通用数据与规则，但固定职业逻辑不能充当新居民的自主决策。旧 `GameRoot` 通过帧时间累积推动世界，新系统必须在屏障期间丢弃等待时长，避免恢复时追帧。

旧存档键为 `project_outpost_save_v1`。新工程采用自己的提交与回放键，不覆盖旧存档。新工程当前不包含旧存档迁移或完整恢复流程。

## LayaAir 基线

| 项目 | 结果 |
|---|---|
| 结构参考仓库 | `shizuguilai/laya-coin-pusher-wechat` |
| 参考提交 | `4fd69fde35ba7248b2faf434f535bf1aba1abe1d` |
| 引擎与 IDE 目标版本 | LayaAir 3.3.12 |
| 锁定证据 | `apps/laya-client/engine-lock.json` |
| 本地引擎文件 | 四个运行时脚本，以 Git blob SHA 和 SHA-256 校验 |
| 客户端渲染 | Laya 原生 3D 网格与 Laya 界面控件 |

版本来自参考项目和实际引擎文件核对，不是由原 Cocos 版本推测。参考推币机工程仅用于结构与引擎来源，不混入其玩法、用户经济、存档或小游戏 AppID。

当前环境没有 LayaAir IDE、微信开发者工具或微信真机，因此 Web 打包或浏览器结果均不能证明 IDE、微信构建和真机已通过。
