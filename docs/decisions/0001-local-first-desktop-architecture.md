# ADR 0001：采用本地优先桌面工作台架构

- 状态：Accepted
- 日期：2026-08-30
- 决策者：项目维护者

## 背景

产品需要保存学生档案、驱动 Word/LaTeX 渲染器、调用本机目标编辑器并在 macOS 与 Windows 分发。学生材料具有明显隐私属性，不应为了基础导出能力依赖云账户或远程服务。

## 决策

采用 Electron + React + TypeScript + Vite 桌面端，Python 作为受主进程管理的本地 sidecar，二者以版本化 JSONL IPC 通信。SQLite 保存本地档案、草稿、模板版本、导出任务与检查回执。生产环境不开放固定 HTTP 端口，默认不联网且不采集遥测。

## 后果

- 能复用现有 Python 文档引擎，并支持本机 Word/WPS 与 XeLaTeX；
- 必须同时处理 Electron、Python 和跨平台打包的生命周期与安全边界；
- 本地运行不等于可信，IPC、路径、模板包和子进程输入仍须校验；
- 云同步、多人协作与在线账户不属于 MVP。

## 验证

通过跨进程协议测试、Electron 安全配置断言、离线运行测试、sidecar 异常测试和 macOS/Windows 安装验证确认实施情况。
