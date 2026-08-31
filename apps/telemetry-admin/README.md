# 遥测分析工作台

这是一个与桌面应用隔离的本机开发者工具。浏览器只访问本机 Vite 服务；服务端通过已经登录的 CloudBase CLI 执行固定的只读 SQL，不在项目中保存 API Key。

## 启动

1. 首次使用时运行 `tcb login`，按提示完成设备授权。
2. 在仓库根目录运行 `corepack pnpm telemetry:dev`。
3. 打开 `http://127.0.0.1:5180`。

需要只检查界面时，可以用脱敏模拟数据：

```bash
SZTU_TELEMETRY_DASHBOARD_FIXTURE=1 corepack pnpm telemetry:dev
```

看板执行的 SQL、环境 ID 和时间范围均由服务端固定，不接受浏览器传入 SQL。服务端只返回聚合指标和经过白名单清洗的最近事件；不会把安装 ID、会话 ID或文档内容发送给浏览器。原始遥测仍按云端的 90 天保留策略管理。

## 校验

```bash
corepack pnpm telemetry:test
corepack pnpm telemetry:build
```
