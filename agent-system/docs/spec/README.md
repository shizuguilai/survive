# Survive 多居民 Agent 实施包 v1.0

**核心：任意居民思考→全世界模拟暂停；完整决策提交→世界继续。角色永远不经历API等待时间。**

编码Agent从 `AGENT_START_HERE.md` 开始，使用 `task-board.json` 的依赖关系执行。不要一次性读全部大文件。

主设计：`SYSTEM_DESIGN.md`。最重要的技术协议：`TIME_BARRIER_PROTOCOL.md`。

包内有22个待实施任务、57个待执行验收用例、3个JSON Schema和5个合法样例。所有数字是规格数量，不是完成数量。

本次只制作实施文档，没有修改/推送仓库、实现游戏、连接真实模型或构建Laya项目。实际文档包自检见 `VALIDATION_REPORT.json`。

可在装有Python和jsonschema的环境运行 `python tools/validate_package.py` 检查包结构。该命令不运行游戏测试。
