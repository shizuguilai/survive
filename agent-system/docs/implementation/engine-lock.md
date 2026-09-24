# 引擎版本与工程壳证据

版本固定为 **LayaAir 3.3.12**。2026-09-23 通过 GitHub API 读取参考工程 `shizuguilai/laya-coin-pusher-wechat` 的提交 `4fd69fde35ba7248b2faf434f535bf1aba1abe1d`：`LayaProject.laya` 的版本字段为 `3.3.12`，纯引擎 `vendor/laya.core.js` 内 `LayaEnv.version` 也为 `3.3.12`。

本工程仅复用经过 Git blob SHA 比对的四份纯引擎文件，不复制推币机玩法。逐文件 Git blob 和 SHA-256 见 `apps/laya-client/engine-lock.json`。携带 LayaAir MIT 许可证。

客户端使用原生 `Scene3D`、`Camera`、`MeshSprite3D`、`PrimitiveMesh`、`PixelLineSprite3D`、`Sprite`、`Text`。世界模拟无引擎物理、自主动画或引擎补帧；渲染只读取世界 tick 和位置。衣着等角色网格由已提交模拟数据驱动。感官参考环与经过遮挡裁剪的视野多边形不参与碰撞或模型输入。

`LayaProject.laya`、`settings/`、`assets/Scene.ls`、`src/Main.ts`、微信构建模板构成可供 IDE 导入核验的工程壳。使用全新资源 UUID；微信 AppID 留空等待此项目后台配置。

`LAYA_IDE_HOME`、`LAYA_ENGINE_PATH` 未配置，常见安装目录没有 Laya IDE。因此当前 **IDE 打开/IDE 构建/微信导出/真机/正式发布均未验证**；Web bundle 与浏览器验证单独记录，不替代上述状态。入口编译器对仓库内跨包 TypeScript 导入的兼容性也须在 IDE 3.3.12 实机核验。
