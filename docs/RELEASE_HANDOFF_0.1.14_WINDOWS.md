# Windows 0.1.14 构建交接

本轮交付目标是 Windows x64 离线安装包。0.1.14 包含多档案管理和完整诊断包。「创建诊断包」是用户入口。近期故障的原始材料保存在本机，用户查看文件清单后可保存或主动发送。

## 1. 拉取两个仓库

应用仓库和模板仓库应并列，模板目录名为 `Thesis`。已有检出先运行 `git status --short`，保留 Windows 本地改动。以下命令在两个目录的共同父目录中运行。

```powershell
git -C SZTU-Graduation-Docs-Studio switch codex/thesis-workbench
git -C SZTU-Graduation-Docs-Studio pull --ff-only origin codex/thesis-workbench
git -C Thesis switch codex/thesis-workbench
git -C Thesis pull --ff-only origin codex/thesis-workbench
git -C SZTU-Graduation-Docs-Studio rev-parse HEAD
git -C Thesis rev-parse HEAD
```

以包含本文的应用提交和模板提交 `35f4b0ffc97fce5ebe36fc58a962da9138370386` 为本轮基线。核对应用根目录及 `apps/desktop/package.json` 里的版本均为 `0.1.14`。全新检出模板用 `git -c core.autocrlf=false clone --branch codex/thesis-workbench --single-branch`，避免换行转换影响模板校验。

- [应用仓库](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/tree/codex/thesis-workbench)
- [模板仓库](https://github.com/AmaziiingChen/SZTU-Thesis-Latex-Template/tree/codex/thesis-workbench)

## 2. 在 Windows x64 构建

使用 Windows 本机的 Node.js 24、pnpm 11.19.0、Python 3.11 或更新版本。从已成功打出 0.1.13 的 Windows 机器复用 `build/offline-runtime`。如果没有 `build/offline-runtime/runtime-manifest.json`，先按 [Windows 开发与打包](WINDOWS_DEVELOPMENT.md#离线安装包分享给-windows-使用者) 准备离线运行时和合法文档字体。

```powershell
Set-Location SZTU-Graduation-Docs-Studio
pnpm install --frozen-lockfile
pnpm package:win:offline
```

打包命令会运行全量校验、冻结 Python 引擎、准备模板和离线运行时，并核验包内容。预期产物为 `release/offline/SZTU-Docs-Studio-0.1.14-win-x64-offline.exe`。

## 3. 验证打包产物

使用独立的测试工作区和虚构数据。运行包内引擎验收，并用生成的安装程序测试实际安装。

```powershell
.venv/Scripts/python.exe scripts/accept_windows_bundle.py --bundle release/offline/win-unpacked --runtime-source build/offline-runtime --output tmp/windows-acceptance-0.1.14
Get-FileHash release/offline/SZTU-Docs-Studio-0.1.14-win-x64-offline.exe -Algorithm SHA256
(Get-Item release/offline/SZTU-Docs-Studio-0.1.14-win-x64-offline.exe).Length
```

验收脚本借用指定的构建运行时。安装后可用实际安装目录替换 `--bundle`，使用新的 `--output`，并省去 `--runtime-source`，验证安装后的运行时。

- 在隔离的新工作区确认内置样例；再用有合成资料的 0.1.13 工作区升级，确认旧文档仍可编辑。
- 建立两份合成档案，各建一份任务书，切换、保存、重开、导出并分别核对姓名、学号、题目和正文。删除并恢复一份档案，核对两份文档的归属。
- 验证任务书正常预览，再用可重复的合成故障验证「创建诊断包」列出出错环节、原始输入和对应日志。先保存 ZIP 检查内容。若提交合成包，记录回执编号并确认维护端可按该编号读回 ZIP。真实学生材料留在本机验收环境。
- 分别记录 PDF 中文字形检查、逐页版式和 Word/WPS 中的验证结果。

## 4. 交回发布产物

把离线 EXE、字节数、SHA-256、两个仓库的提交号及验收结果交回。已有腾讯云上传权限时，可上传到 `releases/0.1.14/SZTU-Docs-Studio-0.1.14-win-x64-offline.exe` 并附下载链接。现有签名更新清单由发布端统一切换，两个平台的文件均验收且公开读回校验通过后再更新。
