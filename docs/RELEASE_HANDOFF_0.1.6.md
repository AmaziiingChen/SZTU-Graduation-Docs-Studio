# 0.1.6 Windows 验收与 macOS 接续

2026-10-05。应用与模板均使用 `codex/thesis-workbench` 分支。本轮是验收构建，GitHub 安装包使用私有草稿发布；不改变 CloudBase stable 更新清单。

## 获取同一套源码

应用仓库：`AmaziiingChen/SZTU-Graduation-Docs-Studio`（私有）。模板仓库：`AmaziiingChen/SZTU-Thesis-Latex-Template`。先保护 Mac 上未提交改动，再分别 fetch、合并对应分支；不要用 Windows 工作区覆盖 Mac 本地资料。

模板源应放在应用仓库旁的 `Thesis/`，或者通过 `SZTU_DOCS_PACKAGING_TEMPLATE_ROOT` 指向该模板 checkout。不能只拉应用而沿用旧模板。以本次模板提交 `edffbdf` 或包含该提交的后续版本为基线。

## 本轮改动

- Windows x64 原生 Python sidecar、UTF-8 JSONL、TeX/Poppler 离线运行时和 Word/WPS 注册表检测。
- 内置论文 ZIP 完整性检测、私有文档字体目录、主区域轻阴影及 Windows 隐藏菜单栏。
- 紧凑编辑器、圆角聚焦边框、悬浮工具栏关闭、多段粘贴兼容、进度项直接删除、目录默认类型与按钮顺序。
- 更新先提示，再由用户点击下载；校验成功后显示安装包，支持稍后从侧栏打开、失败重试及必需更新入口。
- 评阅提示行距、任务书封面基线和下划线调整。
- 评审表 Word 检查使用与输入和规格哈希绑定的有效版式报告，支持共享规划器合法调整的标题及身份行高，保持 exact 行高、页边距、字体和签名区域。

## Windows 验证流程

`pnpm package:win:offline` 执行全量验证、sidecar 和模板构建、NSIS 打包及包完整性检查。Windows 打包复用项目已安装的同版本 Electron，避免重复下载。

`scripts/accept_windows_bundle.py` 对实际打包的 sidecar 进行七类文档的预览与 Word/PDF 导出；只使用合成资料和新的 `tmp/` 目录。可用旧安装目录验证旧版创建的合成草稿在新版恢复：

```powershell
.venv/Scripts/python.exe scripts/accept_windows_bundle.py --bundle release/offline/win-unpacked --output tmp/new-acceptance-run --previous-bundle C:/Program/SZTU-Docs-Studio
```

脚本排除开发机 Python/TeX/Poppler PATH，使用安装包依赖。文档字体仍分别来自应用私有目录和本机字体；系统字体及 Word/WPS 的存在不能由打包成功替代。详细验收结果见 `docs/evidence/WINDOWS_ACCEPTANCE_0.1.6.md`。

## macOS agent 的下一步

1. 拉取两仓库分支，确认应用版本为 `0.1.6`，模板包含上面的修复。
2. 使用 Mac 本机 `.venv`，不要复用 Windows Python 或 TeX 二进制。运行 `pnpm install`、`pnpm setup:backend`、`pnpm verify`。
3. 运行模板 `templates/reviewer-review/test_prompt_spacing.py`、`templates/task-book/test_cover_alignment.py`、`templates/common/test_assessment_forms.py`；新旧模板都应由对应解释器调用。
4. 准备 `local-fonts/FZXiaoBiaoSong-B05S.ttf`，校验字体集清单中的 SHA-256。该用户提供的字体不在 Git 中；可以使用已有合法字体文件，或从 Windows 验收安装包的 `resources/document-fonts/` 提取同一份资源。不要将字体或签名私钥提交到 Git。
5. 执行 `pnpm package:mac`，验证 Apple Silicon 安装、首次告知、编辑/保存、全部文档预览与导出、原资料升级和关闭重开。Intel Mac 目前没有单独构建与验收，不能宣称支持。
6. 使用 Mac 本机 Word/WPS 对生成文件逐页核验；PDF 字形门禁和结构检查不等于目标编辑器验收。
7. 两平台都完成后再上传公开版本化安装包，并用原 Ed25519 私钥签署含两个平台资源的更新清单，最后更新 CloudBase stable 文件。当前 GitHub 私有草稿链接需要登录，不可直接充当客户端公开更新地址。

本轮未购买系统代码签名证书。macOS 使用已有 ad-hoc 签名，Windows 安装包未做 Authenticode 签名；操作系统提示、普通权限安装和更新后数据恢复需要分别记录。不要通过关闭系统防护完成验收。

## 完成发布的标准

自动验证、安装/升级、旧资料恢复、PDF 字形和逐页版式、Word/WPS、安装包哈希、下载和更新通知各自有记录。尚未通过的项目写为待验收；GitHub 上传不代表已经向用户推送更新。
