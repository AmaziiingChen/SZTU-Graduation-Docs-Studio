# 毕业论文 LaTeX 模板下载

## 用户行为

在毕业论文页面点击“下载 LaTeX 模板”，通过系统保存对话框选择 ZIP 位置。下载不读取学生档案、
不修改已有草稿，不依赖 Python、TeX 或字体环境。取消后不提示成功，失败后恢复按钮并显示可操作错误。
编译环境由学生在解压后按 README 准备。

工作台环境检查复用下载前的 ZIP/大小/SHA-256 校验，显示“毕业论文 LaTeX 源码包”。不再因旧论文编辑渲染器源码缺失而产生 `thesis_engine` 提示；资源损坏仍会如实提示。

## 资源与生成

源工程为同级 `Thesis`，显式清单位于 `templates/thesis/package/files.json`；其中维护占位稿、中文注释、
README、AGENTS 和写作说明。禁止直接压缩整个维护仓库。

```bash
pnpm build:thesis-template
# 模板工程位于其他目录时：
python3 scripts/stage_thesis_template.py --source /path/to/Thesis
```

输出固定为 `apps/desktop/resources/thesis-template/sztu-thesis-2026.zip` 与同名 JSON。
两者是成对维护的内置发布资源，electron-builder 的 files 清单会将它们收进 app.asar。
模板修改后需显式重新生成资源；普通前端构建不自动依赖另一仓库。源提交仅记录出处，包内逐文件哈希
标识实际内容，包含尚未提交的工作区修改时不能把源提交号解释为已经发布的版本。

主进程在保存前验证文件类型、大小、版本字段、ZIP 头与 SHA-256。仅原生保存对话框提供目标路径；
preload 无路径参数。先写同目录临时文件，再替换用户所选目标；失败清理临时文件。
资源损坏与保存失败分别使用 `THESIS_TEMPLATE_INVALID`、`THESIS_TEMPLATE_SAVE_FAILED` 稳定错误码。

## 2026-10-04 验证

- 下载后端测试 5 项通过，含实际资源、覆盖指定文件、取消、损坏及失败清理。
- 论文入口及下载交互的定向测试共 16 项通过，含无档案下载、保留草稿、失败/取消恢复与重试。
- 桌面端 TypeScript、Electron 和 Vite 构建通过；lint 通过，现有代码仍有提示性警告。
- 首次 App 与导航测试运行中，另有两项非下载断言失败：toolbar 的 contents 类，以及评审表档案的“基础信息”标题。
  这些界面已有本地修改，本任务未修改其实现或放宽其断言，因此不宣称全量测试通过。
- 下载包已在 macOS 独立解压并编译；11 页中文字形与单页检查通过，详见模板仓库 `templates/thesis/QA.md`。
- 未生成或安装新的桌面安装包，未操作原生保存对话框；Windows 和新下载包的目标 LaTeX 编辑器未验证。

## 提交前复核

- 从 Git 暂存区导出独立源码副本，排除其他未提交的表单与编辑器改动。TypeScript、Electron、Vite 和 lint 通过。
- 在该副本运行下载后端、App、导航三个测试文件：143 项通过、2 项失败。
  对提交前 `f1bb3d2` 的 App 源码与测试单独复测，原有工具栏类名和“基础信息”标题断言同样失败，确认非本次引入。
- 重新生成的内置 ZIP 指向模板提交 `24d2f50`，包内全部文件与该提交逐字节匹配，ZIP 与 JSON 校验一致。
- 本次只同步源码开发分支，未打包安装、部署或更改主分支。
