# ADR 0002：使用 shadcn 官方 Blocks 与默认组件构建工作台

- 状态：Accepted
- 日期：2026-08-30
- 更新：2026-08-31
- 决策者：项目维护者

## 背景

产品会逐步增加开题报告、任务书、中期检查和毕业论文。界面需要保持一致、可理解和易维护，当前没有建立独立品牌设计系统的需求。

## 决策

使用默认 `shadcn/ui` 主题和组件，并采用官方 `dashboard-01` Block 作为页面级骨架。固定层级为 `SidebarProvider`、inset `AppSidebar`、`SidebarInset`、`SiteHeader` 和业务内容容器；业务区由固定宽度的文档板块导航、文档编辑主区及克制的顶部操作区组成。文档板块导航不向用户提供拖拽调宽。内容检查和唯一的“预览&导出”入口集中在 `SiteHeader` 右侧，不再占用第二行工具栏。分页预览和导出格式选择通过该入口进入右侧默认 shadcn `Sheet`，复用唯一的 `PaginatedPreviewPanel`。环境检查、质量门禁、导出状态、历史记录和相关说明复用一个 `InspectionPanel`，通过 `SidebarFooter` 底部的“检查与导出”入口在主内容区显示。

inset 模式由 `SidebarProvider` 独占视口高度并截断页面级溢出；`SidebarInset` 在该高度内弹性伸展，让 shadcn 默认的上下边距计入视口，不再单独设置 `h-svh`。因此窗口本身不产生第二条滚动条，文档正文和编辑器的 `ScrollArea` 才是常规滚动面。

窄窗口只使用官方 Sidebar 自身的移动端机制，并把固定的文档板块导航替换为紧凑 `Select`。排版预览继续使用同一个右侧 `Sheet`，不复制检查或预览业务实现，也不增加可拖拽分栏。

预览不随输入实时变化。用户点击“预览&导出”后，工作台立即打开 `Sheet`；没有当前有效预览时自动保存并检查当前输入，使用与正式 PDF 导出相同的受信任模板快照生成 150 DPI 分页图，已有有效结果时直接复用。导出格式放在 `Sheet` 固定底部；继续编辑后旧预览立即标记为过期，下次打开时自动重新生成。详细一致性和安全边界见 ADR 0007。

Block 作为经过官方维护的结构基线，不等于原样安装全部演示功能。图表、拖拽数据表、示例用户和示例记录与当前文档工作流无关，因此不引入其依赖。项目只保留实际业务需要的 Block 文件边界：`AppSidebar`、`NavMain`、`NavDocuments` 和 `SiteHeader`。

业务组件只能组合 shadcn 组件，不自研通用 UI 原语，不自定义品牌配色、字体、圆角、阴影或装饰动效。默认生成的 UI 原语位于 `components/ui/`；基于 Block 的业务组合位于 `components/workbench/`，两者不得混写。

保存成功状态是唯一批准的语义颜色例外：使用 Tailwind `emerald` 色阶的浅色背景、边框和绿色前景，只作用于“已保存”徽标，并为深色模式提供对应层级。徽标同时保留保存图标和状态文字，不把绿色扩展为品牌色或通用装饰色。

若 shadcn 无法覆盖必要交互，先记录 gap 与无障碍需求，获得明确批准后才能增加其他前端依赖或原语。

## 后果

- 降低不同文档页面形成多套视觉语言的风险；
- 页面骨架可直接对照 shadcn 官方 Block 更新，避免形成无法追溯的自定义工作台；
- 前端评审重点转向工作流、状态、可访问性和真实错误反馈；
- 个性化视觉不属于当前产品范围。

## 验证

依赖与源码检查不得发现第二套 UI 目录、自定义设计 token、任意颜色或未经批准的基础组件；组件测试必须断言 inset Sidebar、SidebarInset、一级 SiteHeader、顶部操作入口、固定宽度且不可拖拽的文档板块导航、右侧预览 `Sheet`、显式预览生成、编辑后过期和 SidebarFooter 检查入口存在，并确认不存在重复预览或检查实现。端到端测试继续覆盖键盘焦点、字段错误及空白/加载/保存/预览/导出/失败/完成状态。

结构来源：

- [shadcn 官方 dashboard Blocks](https://ui.shadcn.com/blocks?category=dashboard)
- [shadcn Sidebar 文档](https://ui.shadcn.com/docs/components/sidebar)
