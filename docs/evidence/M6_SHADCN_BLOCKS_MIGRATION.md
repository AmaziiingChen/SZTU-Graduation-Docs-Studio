# M6 shadcn 官方 Blocks 工作台迁移记录

- 日期：2026-08-30
- 基线提交：`cc9d008`
- 迁移提交：本记录与实现位于同一提交，最终哈希以 `git log` 为准
- 验收对象：Electron renderer 的工作台页面骨架、宽窗口实时预览和窄窗口双标签 Sheet

## 结构依据

2026-08-30 从 shadcn 官方注册表核对 `base-nova/dashboard-01`。项目采用其页面级层级：

```text
SidebarProvider
├── AppSidebar (variant="inset")
└── SidebarInset
    ├── SiteHeader
    └── business content
```

Block 中的演示图表、拖拽表格、示例账户和示例记录与毕业设计文档工作流无关，因此没有安装对应依赖。迁移保留的 Block 文件边界为：

- `components/workbench/app-sidebar.tsx`
- `components/workbench/nav-main.tsx`
- `components/workbench/nav-documents.tsx`
- `components/workbench/site-header.tsx`

默认生成的 shadcn 原语仍位于 `components/ui/`，没有建立第二套 UI 原语、品牌 token 或自定义 CSS 体系。

结构来源：

- [shadcn 官方 Dashboard Blocks](https://ui.shadcn.com/blocks?category=dashboard)
- [shadcn Sidebar 文档](https://ui.shadcn.com/docs/components/sidebar)

## 业务迁移结果

- 左侧导航固定展示学生档案、开题报告、任务书、中期检查和毕业论文；未接入文档保持禁用并标记“待接入”。
- 顶栏承载当前页面、保存状态和“预览与检查”入口；恢复、内容检查和导出保持在克制的文档操作栏。临时模式依据一次填写、检查、导出的真实流程从前台移除。
- 宽窗口右侧使用 `LivePreviewPanel` 即时读取当前草稿，展示填写进度、结构摘要、保存状态和最近一次检查/导出状态；它不启动 Word、PDF 或 LaTeX 渲染，也不模拟最终版式。
- `InspectionPanel` 不再常驻每个页面；本机环境、五类质量门禁、导出状态和历史记录放入按需打开的默认 shadcn `Sheet`。
- 低于 768px 的窗口不复制业务实现，而是在同一个 Sheet 中用“实时预览 / 检查与导出”两个默认 `Tabs` 承载两套已有业务组件。
- 环境正常时实时预览不显示环境卡片；仅当环境阻断导出时显示简短警告并引导用户查看详细检查。
- 学生档案仍是基础信息唯一来源；本次迁移没有改变存储、检查、导出或质量门禁合同。

## 自动检查

- `pnpm --filter @sztu-docs/desktop test`：3 个测试文件、29 项测试通过。
- `pnpm --filter @sztu-docs/desktop build`：TypeScript、Electron main/preload 与 Vite 生产构建通过。
- 新增断言覆盖 inset Sidebar、SidebarInset、一级 SiteHeader、输入后预览立即更新，以及窄窗口 Sheet 的预览/检查切换。

## 浏览器视觉检查

使用可见 Chromium、Vite renderer 和仅存在于浏览器会话中的虚构 API 数据检查：

- 1440×900：应用侧栏、顶栏、文档编辑区和实时预览区完整；无横向溢出。
- 1440×900 学生档案：六项共用字段只在左侧学生档案编辑，右侧显示共用资料摘要；无横向溢出。
- 390×844：顶栏使用短标题和图标式“预览与检查”入口；文档操作栏允许自然换行；无横向溢出。
- 390×844 Sheet：默认打开实时预览，切到“检查与导出”后显示环境、五类质量门禁和导出历史；动画完成后无重影。
- 四个状态均未出现 console error 或 page error。

证据截图：

- [宽窗口工作台](M6_SHADCN_BLOCKS_DESKTOP.png)
- [窄窗口实时预览](M6_SHADCN_BLOCKS_MOBILE_PREVIEW.png)
- [窄窗口检查 Sheet](M6_SHADCN_BLOCKS_MOBILE_INSPECTION.png)

## 未声明事项

- 浏览器视觉检查使用虚构 API 数据，不等同于真实 Electron sidecar 或导出运行验收。
- 本次前端迁移不改变既有 DOCX、PDF、LaTeX 产物结论。
- Word/WPS 目标编辑器人工验收状态仍保持未检查。
