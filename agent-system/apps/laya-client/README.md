# Survive · LayaAir 原生客户端

引擎固定 **3.3.12**，来源和哈希见 `engine-lock.json`。直接打开 `LayaProject.laya`。入口 `src/Main.ts` 导出 IDE 所需 `main()`；代码在运行时用原生 `Scene3D`、摄像机、网格、灯光生成地面、居民、树和墙。`assets/Scene.ls` 是启动容器，避免它另建摄像机覆盖运行时观察场。

`src/view.ts` 的 `initialize(callbacks)` 返回 `ObserverView`；`render(state)` 只消费世界和感官快照，绝不推进权威模拟。3D 与所有界面都由 Laya 渲染。拖动镜头、选人和查看感官在认知屏障期间仍可使用。按住场景拖动平移，滚轮缩放，点击居民或左侧名字切换观察对象。回放使用底部时间轴、暂停和播放倍速。居民没有玩家换装入口，衣着与装备随真实模型批准的动作变化，左侧只显示可见穿着。

运行时四个脚本按 `laya.core.js → laya.d3.js → laya.webgl_2D.js → laya.webgl_3D.js` 加载。Web 构建由项目根目录工具提供；浏览器运行成功不等于 IDE 或微信构建成功。

微信构建：使用 LayaAir IDE 3.3.12 打开该项目，配置**本项目**的小游戏 AppID，再在 IDE 选择微信小游戏构建。项目未复制推币机的 AppID。网关 URL 必须使用已配置合法域名的 HTTPS 服务，模型密钥只放网关。IDE、微信开发者工具、真机和正式发布须分别验收；当前环境缺少 IDE 和小游戏后台配置，不宣称完成这些步骤。
