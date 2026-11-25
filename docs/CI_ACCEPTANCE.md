# 云端构建与安装包验收

开发者提交代码后，由 GitHub Actions 的 Windows x64 与 macOS ARM64 环境分别构建和验证；Windows 是主要交付目标，macOS 保留同源验证。本流程只生成内部安装包和合成测试证据，不上传腾讯云发布文件，不修改正式更新清单。

2026-11-16 已实际跑通双系统，代码提交与产物哈希见 [本次验收记录](evidence/CI_ACCEPTANCE_2026-11-16.md)。任务书原故障的旧版/候选版对照，以及后续腾讯云生产入库读回，见 [0.1.15 任务书修复验证](evidence/WINDOWS_TASK_BOOK_FIX_0.1.15.md)。

## 如何使用

当前已在 `codex/thesis-workbench` 分支启用，推送该分支会触发基础 CI 和安装包验收。配置监听 `main` 和 `codex/**`；其他分支需要包含对应 workflow 文件才会执行，默认 `main` 尚未合并本次改动。拉取请求只跑不需要私有字体的基础检查；私有测试资源不交给拉取请求运行。两套流程均支持手动执行，同一分支的新任务取消旧任务。仅修改 Markdown 文档不触发推送构建。

- [基础检查](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/workflows/ci.yml)
- [安装包验收和内部产物](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/workflows/package-acceptance.yml)

在安装包验收的运行页面查看失败步骤和汇总。成功后的 `internal-installers-*` 是对应提交的内部 DMG/ZIP 或 Windows 离线 EXE，保留 3 天；`acceptance-evidence-*` 保留 7 天，失败时也尽量保存；开题报告源码集成测试失败时，另保留 `source-proposal-failure.zip`，避免临时工作区清理后丢失底层输出。只有源码检查通过，不能认定安装包验收通过。

在现有运行页面可使用 Re-run all jobs 重新执行。默认 `main` 尚未合并 workflow，因此当前网页不一定显示 Run workflow 按钮；[GitHub 事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)允许已运行过的 workflow 通过命令行指定分支执行，不需要切到 Windows：

```sh
gh workflow run package-acceptance.yml --ref codex/thesis-workbench --repo AmaziiingChen/SZTU-Graduation-Docs-Studio
gh run list --branch codex/thesis-workbench --repo AmaziiingChen/SZTU-Graduation-Docs-Studio
```

## 资源与来源

模板提交固定在 `d041706ed7b49241c1900225398b99fb5fcf3aa7`（与各 workflow 的 checkout ref 和 `config/ci-resources.json` 的 `template_commit` 同步）。升级模板时同时更新 workflow 的 checkout ref 和 `config/ci-resources.json`，保留 LF 字节。pnpm 11 的依赖安装脚本许可使用 `allowBuilds`，不使用已失效的 `onlyBuiltDependencies`；Electron 44 不再提供下载二进制的 postinstall，Windows 打包脚本显式执行项目依赖中的 `install-electron`。Windows 的 `node_modules`、Python 引擎和 EXE 全部在 Windows x64 构建；macOS 的引擎和 DMG 在 ARM64 macOS 构建。Windows 构建和安装后验收使用 PowerShell，避免 Git Bash 自带的旧 Xpdf 抢占 Poppler；中文字形检查需要 Poppler 的 `pdftotext -bbox-layout`。

用户授权用于云端验收的字体和离线运行时位于**私有应用仓库的单独资源预发布**，不进入 Git 源码。文件清单、资源编号、大小和 SHA-256 固定在 `config/ci-resources.json`；下载后先校验，再使用。只使用 GitHub 为当前任务提供的只读令牌，没有复制腾讯云管理密钥或更新签名私钥。资源预发布仅在私有仓库可见，不是应用版本发布；只读任务令牌可以下载，不能修改发布。

Windows 运行时取自已分发的 0.1.14 离线 EXE，原安装包 SHA-256 为 `46ad47cb87a9a6539988f9b91b2c9183bbb63d659048b3c693cad2f10d803ca8`，不是另行拼装的未知工具链。macOS 使用校验值固定的 TinyTeX 2026.11，并安装过程文档所需宏包；PDF 工具使用构建机上的 Poppler。实际工具版本和命令应以运行记录为准。

资源编号和哈希变化需要重新核对来源，不允许下载失败时换成空目录、自动替换必需字体或将缺失步骤记为通过。私有字体下载只在可信分支构建中运行；仓库若变成公开仓库，资源准备会停止，不能直接把私有资源公开。

## 已接入的验证

1. 安装项目依赖，执行 lint、桌面/后端/管理端/更新工具测试及代码构建；另运行接收端测试。
2. 构建本平台冻结 Python 引擎、七类模板和安装包，复用已有包内容检查。
3. Windows 在临时虚拟机静默安装新的离线 EXE；macOS 校验并只读挂载新的 DMG。核对安装后/挂载后 `app.asar` 与刚构建的内容逐字节一致。
4. 从安装包提取实际 SidecarClient 和 FullDiagnostics 模块，启动安装包内的原生引擎，在独立合成工作区运行七类文档预览及 PDF/Word 导出；对 PDF 提取中文并在 150 DPI 执行字形检查，版式逐页人工检查仍单独记录。
5. 触发导出目录无效和编译器非零退出两类故障；编译器故障在 Windows 使用原生测试 EXE，避免把批处理当作原生进程替身。
6. 从生成的原始 ZIP 核对失败步骤、冻结引擎标记和编译原始输出；用安装包的 FullDiagnostics 发送到回环地址上的实际生产接收端代码，读回接收后的原始字节并核对 SHA-256。
7. 保存当前提交、引擎哈希、安装包大小与 SHA-256、每类文档结果和诊断回读结果。

回环接收器是在本次构建机上运行的接收服务代码，**不代表腾讯云线上数据库已完成写入验收**。`acceptance.json` 单独记录 `production_cloud_verified: false`。完整应用界面交互、Word/WPS 排版和苹果公证/Windows 签名也不是这份引擎测试的结论；它们需要对应的独立证据。

## 仍应补充的现场回归

现有线上故障和推断见 [Windows 故障交接](evidence/WINDOWS_FAILURE_HANDOFF_2026-11-16.md)。不能以普通构建机运行成功代替中文用户目录、短路径不可用、COMSPEC 缺失和未展开系统 PATH 的回归。本轮已加入安装后任务书在 COMSPEC 缺失、系统 PATH 未展开条件下的实际预览回归，并在共享渲染环境构造中补齐命令解释器与系统目录。该回归成功仍不代替原用户电脑上的最终确认。跨平台更新还需持续慢速传输、断线恢复及 Range 不支持的实际传输验证。

首次跑通云端流程后，新增故障应转化为维护端可重复的用例，在该流程中阻止再次带入公开版本。任何一项失败都应保留真实失败状态；不要使用 continue-on-error 把失败的必要步骤改成绿色。
