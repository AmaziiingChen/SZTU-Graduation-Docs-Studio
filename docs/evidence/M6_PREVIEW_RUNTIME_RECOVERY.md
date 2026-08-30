# M6 分页预览运行时与本地字体故障修复记录

- 日期：2026-08-30
- 现象：中期检查点击“生成排版预览”后返回 `RENDER_FAILED`
- 数据边界：仅对当前本地数据库的只读副本执行诊断；日志和本文不记录姓名、学号或正文

## 根因

故障由两个连续条件造成：

1. Electron sidecar 默认使用 PATH 中的 Homebrew Python 3.14，而自动化集成测试使用另一份已经
   安装依赖的 Python。Homebrew Python 缺少 `python-docx` 和 `Pillow`，但原环境检查把它们标为
   非阻断警告，因此界面仍允许开始预览。
2. 切换到依赖完整的 Python 后，当前中期检查模板仍找不到所需的“方正小标宋简体”。字体文件
   实际存在于模板工程的私有 `templates/midterm/fonts.local/`，但内容寻址模板快照按许可边界不
   复制商业字体，渲染器也没有收到原始本地字体目录。

第二项证明原来的 `RENDER_FAILED` 通用文案掩盖了两类不同错误。诊断期间只保留错误类型，未把
渲染 stderr 中的正文或主机绝对路径发送到 Renderer。

## 修复

- 新增 `scripts/setup_backend_runtime.py`，从 `backend/pyproject.toml` 读取依赖并建立 Git 忽略的
  项目私有 `.venv`；依赖指纹未变化且 import 检查通过时直接复用。
- `pnpm dev` 启动前自动准备运行时；`pnpm verify` 的 Python 测试也切换到同一 `.venv`。
- Electron sidecar 优先选择 macOS/Linux 的 `.venv/bin/python` 或 Windows 的
  `.venv/Scripts/python.exe`，仍允许 `SZTU_DOCS_PYTHON` 显式覆盖。
- 增加中期模板和字体环境变量的受控透传。
- 开发模板快照继续不复制、提交或发布商业字体，但 `EngineDescriptor` 会携带经过路径与符号链接
  检查的源 `fonts.local` 目录，仅在本机渲染子进程中使用。
- Python 依赖、XeLaTeX 和 Poppler 工具改为分页预览必需的阻断环境检查；环境未通过时右侧直接
  显示可执行的修复说明并禁止预览和导出。
- 已知缺依赖和缺字体 stderr 分别映射为 `PYTHON_RENDER_DEPENDENCY_MISSING` 与
  `REQUIRED_FONT_MISSING`，不再一律显示模糊的 `RENDER_FAILED`。

## 验证

- `pnpm setup:backend` 在项目 `.venv` 安装 `Pillow 12.3.0`、`python-docx 1.2.0` 及其依赖；
- 使用当前应用数据库的 SQLite 只读备份、当前中期检查草稿和当前 `/Users/chen/Thesis` 模板工程
  生成 3 页 PDF 预览；
- 该真实预览的内容检查、PDF 结构检查和中文字形检查均通过；逐页人工版式与 Word/WPS 验收未
  因本次运行时修复而自动宣称通过；
- `corepack pnpm verify` 通过：33 项前端测试、110 项 Python 测试和生产构建完成。

## 使用影响

已经运行的 Electron 进程仍持有旧 sidecar，必须停止当前 `pnpm dev` 后重新执行
`corepack pnpm dev`。重新启动时会自动选择项目 `.venv`，无需全局安装 Python 包，也无需把
授权字体复制进开源应用仓库。
