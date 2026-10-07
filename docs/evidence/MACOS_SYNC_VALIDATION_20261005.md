# macOS 接续检查 · 2026-10-05

应用基线 `fc1a12d`（0.1.6），配套模板 `edffbdf`，均为 `codex/thesis-workbench`。本轮仅完成开发环境自动检查及私有字体准备。

## 检查结果

- `pnpm install --frozen-lockfile`、`pnpm setup:backend` 完成；使用 Mac 本机 Python。现有 `.venv` 链接到主 checkout 的 Mac 环境，本轮补装了渲染回归所需 pdfplumber。
- `pnpm verify` 返回 0：lint、桌面 65 个文件 / 597 项测试、遥测管理端 10 项、更新工具 4 项、后端 255 项（252 通过、3 跳过）、桌面及管理端构建通过。
- 后端跳过项为两项未显式启用的 submitted task-book 集成，以及 Windows portable toolchain 检查。
- `templates/reviewer-review/test_prompt_spacing.py` 通过：静态/可编辑提示均编译，PDF 字形门禁各 17/17；自动断言行距和页数。
- `templates/task-book/test_cover_alignment.py` 通过：三个合成标题用例的封面基线和下划线间距满足断言。
- `templates/common/test_assessment_forms.py` 共享契约检查通过。
- 保留既有 React lint 和前端体积提示；没有为消除提示而调整产品实现。

## 私有字体

本机已有小标宋 SHA-256 与发布清单不同，因此保留原字体。从 GitHub 私有 Windows 验收安装包提取指定字体：安装包 SHA-256 `b855e822af43150308acae331601609b42b82b644c379e16713b70dadc6af187`；字体 SHA-256 `c52d577dd3aa719ef5fb9ff2043b7f7ca36fae468ef34a47628a3a555d006a49`，与 catalog 一致。

字体保存至已被 Git 忽略的 `local-fonts/FZXiaoBiaoSong-B05S.ttf`。下载包、提取工具及自动检查日志保存在被忽略的 `tmp/`，没有修改系统字体。

## 尚未完成

本轮未打包、安装、启动桌面界面、逐页视觉检查或执行 WPS 验收，未提交、推送或更改 stable 更新清单。自动断言和字形门禁不代表目标编辑器验收。下一步为 Mac 安装包构建及包内运行验证。
