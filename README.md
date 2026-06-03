# Project Outpost（末日营地）

像素风末日生存经营游戏 —— 类 RimWorld / They Are Billions。
玩家作为营地领袖，采集资源、建设基地、分配职业、发展人口，并抵御不断增强的尸潮。

- 引擎：Cocos Creator 3.8 + TypeScript（2D）
- 目标平台：抖音小游戏 / 微信小游戏 / Web

## 架构

代码驱动 + 逻辑/渲染分离：

- `assets/scripts/core/` — 纯 TypeScript 模拟内核（地图、寻路、资源、建筑、各系统、存档），不依赖引擎。
- `assets/scripts/render/` — Cocos 适配层（入口组件、地形/实体渲染、输入）。
- `assets/scripts/ui/` — HUD（资源栏、建筑菜单、变速）。

详见 [docs/项目架构.md](docs/项目架构.md) 与 [docs/游戏介绍.md](docs/游戏介绍.md)。

## 运行

见 [README_SETUP.md](README_SETUP.md)：用 Cocos Creator 3.8 打开，在场景里挂上 `GameRoot` 组件即可预览。

## 核心循环

采集 → 建设 → 人口增长 → 职业分配 → 尸潮进攻 → 扩建防御 → 更大规模尸潮 → 长期生存
