# ADR 0002：使用 shadcn 官方 Blocks 与默认组件构建工作台

- 状态：Accepted
- 日期：2026-08-30
- 决策者：项目维护者

## 背景

产品会逐步增加开题报告、任务书、中期检查和毕业论文。界面需要保持一致、可理解和易维护，当前没有建立独立品牌设计系统的需求。

## 决策

使用默认 `shadcn/ui` 主题和组件，并采用官方 `dashboard-01` Block 作为页面级骨架。固定层级为 `SidebarProvider`、inset `AppSidebar`、`SidebarInset`、`SiteHeader` 和业务内容容器；业务区由文档编辑主区、检查/导出侧栏及克制的顶部操作栏组成。窄窗口下检查/导出区使用默认 `Sheet`，不复制第二套页面。

Block 作为经过官方维护的结构基线，不等于原样安装全部演示功能。图表、拖拽数据表、示例用户和示例记录与当前文档工作流无关，因此不引入其依赖。项目只保留实际业务需要的 Block 文件边界：`AppSidebar`、`NavMain`、`NavDocuments` 和 `SiteHeader`。

业务组件只能组合 shadcn 组件，不自研通用 UI 原语，不自定义品牌配色、字体、圆角、阴影或装饰动效。默认生成的 UI 原语位于 `components/ui/`；基于 Block 的业务组合位于 `components/workbench/`，两者不得混写。

若 shadcn 无法覆盖必要交互，先记录 gap 与无障碍需求，获得明确批准后才能增加其他前端依赖或原语。

## 后果

- 降低不同文档页面形成多套视觉语言的风险；
- 页面骨架可直接对照 shadcn 官方 Block 更新，避免形成无法追溯的自定义工作台；
- 前端评审重点转向工作流、状态、可访问性和真实错误反馈；
- 个性化视觉不属于当前产品范围。

## 验证

依赖与源码检查不得发现第二套 UI 目录、自定义设计 token、任意颜色或未经批准的基础组件；组件测试必须断言 inset Sidebar、SidebarInset、一级 SiteHeader 和窄窗口 Sheet 路径存在。端到端测试继续覆盖键盘焦点、字段错误及空白/加载/保存/导出/失败/完成状态。

结构来源：

- [shadcn 官方 dashboard Blocks](https://ui.shadcn.com/blocks?category=dashboard)
- [shadcn Sidebar 文档](https://ui.shadcn.com/docs/components/sidebar)
