# 线上模型网络故障排查

线上网关接到POST /api/decide后300ms内3次失败，返回502。脱敏诊断日志先定位FETCH_INVALID_RECEIVER：类成员调用改变原生fetch的this。修复为globalThis.fetch包装后，日志定位第二处FETCH_REDIRECT_ERROR：Workers不支持redirect:error。改为manual并显式拒绝3xx，凭据不跟随跳转。

新增网络异常分类及traceId，浏览器控制台与错误面板显示HTTP状态、错误码、请求编号。13项网关/Worker单元与Mock测试、类型检查、构建通过。已公开部署。生产网关使用纯合成输入，真实glm-4.5-air调用返回200且通过决策校验。此前过窄的合成输入返回决策校验失败，单独保留，不当作网络故障或成功决策。

携带居民私人上下文的线上复现被自动审批拦截，未继续该复现；使用不含私人信息的纯合成输入完成网络诊断。本次不声明线上浏览器两居民闭环、微信真机或发布验收通过。详细状态见evidence/network-fix.json。
