# 前端组件复用审计与修复记录

更新：2026-10-03。原审计发现的桌面端 20 项、管理端 4 项已落实代码修复。下表沿用原编号，便于对照。

## 约束与范围

- 全局与仓库 AGENTS.md 均明确：先复用已有组件，再使用已选组件库的官方组件。未经用户明确允许，不新增自定义 UI 组件、视觉封装、基础原语或独立交互控件；抽象和重构不构成默认授权。
- 本轮没有新增前端依赖。Field、Label、Collapsible、Empty、Pagination 来自官方 base-nova registry；BubbleMenu 已随现有 @tiptap/react 安装。原审计中“BubbleMenu 未安装”的判断已更正。
- 公共目录中的动画适配和排序行属于既有实现的移动、合并；没有建立新组件库。
- 本次处理工作台与管理端界面，不改变正式文档模板的版式或渲染规则。

## 桌面端逐项修复

| 编号 | 原问题 | 修复与当前实现 |
| --- | --- | --- |
| 1 | 基础组件反向引用工作台 | 移动既有动画适配器到 components/ 公共层，所有消费者引用同一实现；ui/ 不再导入 workbench/。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/animated-action-icon.tsx) |
| 2 | Accordion、SidebarTrigger 局部视觉 | 恢复 base-nova 默认样式；保留已有无障碍名称、展开状态与已授权图标动画。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/ui/accordion.tsx) |
| 3 | 弹层动画重复定制 | Dialog、DropdownMenu、Popover、Select、Tooltip 恢复官方时长，保留减少动态效果支持。Sheet 使用原有官方时长。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/ui/dialog.tsx) |
| 4 | 选区浮动工具栏 | 使用已经安装的 Tiptap BubbleMenu 定位、碰撞处理和滚动更新；复用现有 ToolbarToggle 与格式切换函数，删除手工坐标和浮层 CSS。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/structured-content-editor.tsx) |
| 5 | 正文工具栏玻璃效果 | 当时移除半透明背景与 backdrop-blur；2026-10-04 按用户要求恢复，见本文末尾恢复记录。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/structured-content-editor.tsx) |
| 6 | 三套导航折叠 | 改用官方 Collapsible，组合已有 Sidebar，保持分类状态。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/nav-documents.tsx) |
| 7 | 导航自定义菜单按钮 | 文档与回收站动作复用 SidebarMenuAction 和 DropdownMenuTrigger。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/nav-documents.tsx) |
| 8 | 表格尺寸矩阵自定义按钮 | 矩阵格使用现有 Button 的 default/outline 和 icon-xs；范围选择保持业务逻辑。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/visual-table-editor.tsx) |
| 9 | 多图缩略图选择样式 | 复用合并后的既有排序行及 Button secondary/ghost，保留缩略图业务内容。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/multi-figure-generator.tsx) |
| 10 | 两份字段外壳 | FormField 与 DocumentDateField 内部复用官方 Field、FieldLabel、FieldContent、FieldError。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/form-field.tsx) |
| 11 | 十个文件各自拼接字段 | 原生 label 改用官方 FieldLabel，嵌套控件拆为关联的标签与控件，使用稳定 ID；多字段行保留业务网格。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/body-tool-dialog.tsx) |
| 12 | 两套排序列表行 | 将既有 SortableScheduleRow 移到公共位置供进度计划和多图复用，删除重复行实现；未新增视觉原语。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/sortable-content-row.tsx) |
| 13 | 两套图标交互桥接 | 移除 use-sidebar-icon-animation，导航与编辑器统一使用既有 AnimatedActionIcon。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/animated-action-icon.tsx) |
| 14 | LaTeX 动作重复 | 复制、下载及成功/失败反馈归到既有 LatexSourceSheet，表格和多图共用。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/latex-source-sheet.tsx) |
| 15 | 空状态各自设计 | 参考文献、表格、多图、正文工具使用官方 Empty 组合。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/reference-importer.tsx) |
| 16 | 滚动渐隐手工实现 | 既有 FadingScrollArea 改为 ScrollArea 与已安装 shadcn scroll-fade-b 工具类，移除手工监听、Observer 和渐变覆盖层。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/fading-scroll-area.tsx) |
| 17 | 空白区单独图标动画 | 正文空白图标复用 AnimatedActionIcon，静态说明图标保持静态；删除 writing-welcome 和 tool-open-arrow 遗留 CSS。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/index.css) |
| 18 | 预览抽屉自制手柄 | 使用现有 ResizablePanelGroup/Panel/Handle，Sheet 保留关闭与焦点管理；透明占位面板支持从左边缘调宽。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/App.tsx) |
| 19 | 表格图标复制动画 | 保留原有 3×3 图形，和 2×2 图标共享动画 Hook，采用唯一渐变 ID；未新增 UI 控件。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/hooks/use-grid-icon-animation.ts) |
| 20 | 编辑表格自制视觉网格 | 复用 Card、Table、TableHeader/Body/Row/Head/Cell、Input，保留批量粘贴与单元格键盘导航。 [源码](/Users/chen/Thesis/.worktrees/thesis-workbench/SZTU-Graduation-Docs-Studio/apps/desktop/src/components/workbench/visual-table-editor.tsx) |

## 管理端修复

| 原问题 | 修复 |
| --- | --- |
| 两份指标卡 | App 直接复用 diagnostics-dashboard 中已有 MetricCard。 |
| 自行拼接搜索框 | 使用现有 InputGroup、InputGroupAddon、InputGroupInput。 |
| 三处手写分页 | 使用官方 Pagination、PaginationContent、PaginationItem、PaginationPrevious、PaginationNext；保留中文操作名与边界禁用判断。 |
| 发布表单缺少统一标签 | 使用官方 Field/FieldLabel，16 个字段关联稳定 ID。 |

## 删除与保留

删除零运行时引用的 LatexSourceCard、ui/panel-left-open、ui/panel-left-close、ui/message-circle-more；动作反馈测试转向实际复用的 LatexSourceSheet。删除重复的 use-sidebar-icon-animation 及其测试，统一桥接由 AnimatedActionIcon 测试覆盖。

保留尚未接入的 ThesisDocumentEditor 和关联论文插入功能，它们属于先前开发内容；本轮只修正字段复用，没有将其启用。保留未使用的官方 Tabs。单消费者的领域页面也不为追求引用数量强行抽象。

保存状态、板块完成动画、导出历史状态色、命名主题，以及现有 3×3 表格图标是已经记录或指定的局部实现，继续集中维护。MathML 公式、Tiptap 编辑器、表格内容与图像编排属于领域功能，不能等同于新增视觉原语。本轮不宣称所有界面代码均为未经修改的官方组件。

## 自动约束

`pnpm lint` 先验证复用检查器，再检查源码。新增 TypeScript AST 检查覆盖桌面业务层、UI 层和管理端，拦截：

- UI 原语反向导入或导出 workbench；
- 业务层原生 label 和带 className/style 的原生 button（官方 render 的裸目标允许）；
- 业务层新增玻璃或装饰渐变。

自动检查只能阻止这些明确回归，无法判断自然语言授权。新增组件的能力缺口、替代方案和用户授权仍按 AGENTS.md 人工核对。

## 验证记录

- 桌面端：51 个测试文件、397 项测试通过。全量最终命令为 `pnpm --filter @sztu-docs/desktop exec vitest run --maxWorkers=2 --testTimeout=15000`。默认 5 秒限制下，部分含多次自动保存的 App 用例曾超时；最终复跑提高单用例时间上限，未放宽断言或修改持久化逻辑。
- 管理端：3 个测试文件、10 项测试通过；组件复用检查器：3 项 Node 测试通过，已加入桌面 lint。
- 两端 TypeScript/Vite 构建通过；设计系统检查和 `git diff --check` 通过。Lint 仍报告 React/Fast Refresh 提示，Vite 仍报告大 chunk 提示；未将这些提示写为零警告。
- 后台 Chrome 隔离测试使用虚构工作区和拦截的管理端 API；没有读取真实学生草稿，没有触发真实导出、密钥初始化或发布。最终测试无 pageerror。
- 浏览器检查：预览抽屉从 512 拖到 663 像素，键盘调整至 623 像素，关闭再打开保留宽度；1000 像素窗口遵守 500 像素上限，390 像素窄屏切为无手柄单面板。点击遮罩与 Escape 可关闭。
- 浏览器检查：选区浮层位于可视区域且可点击加粗；选区收起后浮层隐藏；浅色/深色界面截图已检查。浮层通过官方 appendTo 接口挂载到当前 Dialog 或 body，避免滚动容器遮罩及主工具栏层级遮挡。
- 浏览器检查：短内容不渐隐，长内容顶部有底部渐隐，滚动到末尾归零；新建 3×3 表格、Tab 到下一格、粘贴 2×2 内容通过；官方空状态及表单截图已检查。
- 管理端后台检查：概览分页前进与边界禁用通过；发布表单当前显示的 16 个标签均关联控件，截图无明显遮挡。
- 证据保留在本地 `tmp/component-reuse-*.png`、测试日志及浏览器脚本。临时页面已移出应用目录，两个本轮 Vite 服务已停止。

这些结果是前端结构、交互和后台浏览器布局证据。预览测试使用占位 SVG，不是正式 PDF，也不构成 Word/WPS 或打包 Electron 验收。未打包安装或发布应用。

## 官方来源与功能性组合

新增组件取自 `https://ui.shadcn.com/r/styles/base-nova/{name}.json`。只做生成器等价转换：registry 别名映射至项目路径、cn 指向现有 lib/utils、图标占位替换为项目已选 lucide-react。不覆盖既有 Button/Separator，不引入另一份工具包。

- [Field](https://ui.shadcn.com/docs/components/base/field)、[Collapsible](https://ui.shadcn.com/docs/components/base/collapsible)、[Empty](https://ui.shadcn.com/docs/components/base/empty)、[Pagination](https://ui.shadcn.com/docs/components/base/pagination)
- [Tiptap BubbleMenu](https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu)
- [shadcn Resizable](https://ui.shadcn.com/docs/components/base/resizable)

预览抽屉的透明占位面板只用于适配现有 Sheet 的左侧调宽需求：组宽取当前最大抽屉宽度，右面板使用像素上下限，只有实际内容和手柄接收指针事件；初始尺寸不随拖动状态变化。窄屏切换为单面板。FadingScrollArea 仅将已有 scroll-fade-b 工具类应用于真正滚动的 viewport。两者不新增样式 token。

## 2026-10-04 交互动效修正

此前整改遗漏了选区工具栏的入场/退场与导航折叠过渡；Select 默认对齐模式禁用动画，导致实际下拉没有过渡。用户明确要求恢复并改进这些交互动效。方案和授权范围记录在 FRONTEND_DESIGN_SYSTEM.md 与 AGENTS.md，后续组件复用检查不得移除已指定的行为。

- 在既有 BubbleMenu 生命周期中补齐可中断的 180ms 入场与 140ms 退场；退场期间立即 inert/aria-hidden，快速重开取消旧动画，卸载清理节点。使用正文视口作为碰撞边界，首行选区浮层落在文字下方，不遮挡主工具栏。
- 在已有 Collapsible 上补充 250ms 高度/透明度过渡，导航箭头同步旋转。文档、排版工具和回收站共用同一实现。
- 在已有 Select 上使用 Base UI 起始/结束状态，补充 200ms 入场、150ms 退场及箭头旋转，保留选中项对齐。
- 没有增加依赖或 UI 原语；系统减少动态效果时三种交互均立即切换。

验证：编辑器和文档导航 62 项测试通过，定位边界调整后选区工具栏用例再次通过；两轮桌面构建均通过，lint/设计系统检查通过，仍有既有 React 提示与大 chunk 提示。后台 Chrome 使用隔离合成工作区，断言三个导航分组开/关中间帧及中途反转、三个 Select 开/关中间帧、浮层入场/退场/快速重选/格式操作/页面切换无残留，以及三类 reduced-motion 下动画数为零。页面错误为零。修复前后的属性与尺寸证据、截图和可重跑断言保留于 tmp/motion-refinement-20261004/。不构成打包 Electron 验收；未重新安装或发布。

## 2026-10-04 编辑器磨砂恢复

此前组件复用整改删除了正文工具栏的透明磨砂，用户明确要求恢复。现有 StructuredContentEditor 格式工具栏恢复主题 background 的 70% 透明度和 12px 背景模糊；不支持模糊时保留不透明主题背景。没有新增组件、依赖或阴影。复用检查只对该文件的 editor-format-toolbar 放行 backdrop-blur-md，其他表面和渐变仍拦截；AGENTS.md 与 FRONTEND_DESIGN_SYSTEM.md 同步记录此授权。

保留此前修复的工具栏、正文滚动视口、底部状态栏三段布局。工具栏不覆盖正文，正文不会从它背后滚过；当前磨砂处理只采样工具栏背后的实际背景。

验证：共享编辑器 44 项测试、复用检查 4 项测试、lint/设计系统检查和桌面构建通过；仍有既有 React 与大 chunk 提示。后台 Chrome 检查 12 个正文板块的长内容滚动和 900×700 窄窗口，滚动条始终位于工具栏下沿与状态栏上沿之间。浅色/深色 Everforest 的实际样式均为 blur(12px)、背景透明度 0.7、box-shadow: none，截图已检查，页面错误为零。脚本、合成测试页面和几何证据保留于 tmp/editor-glass-20261004/；未打包安装或发布。

## 2026-10-04 可见磨砂修正

用户在实际界面指出上一轮看不到磨砂。上一轮只确认透明度和 backdrop-filter 的计算样式，工具栏后方是纯色背景，截图不能证明实际背景模糊。该验收不足，以上恢复记录描述的是当时的实现。

本次将同一个格式工具栏置于正文滚动视口，采用原生 sticky；正文真实经过工具栏后方。工具栏高度由 ResizeObserver 跟随窄窗口换行，滚动条轨道从测量后的工具栏下沿开始，光标 scrollThreshold/scrollMargin 和选区菜单碰撞留白同步更新。状态栏仍固定在视口外，没有复制正文或使用负边距。

实际截图还发现 Chromium 在 viewport mask-image 下不执行后代 backdrop-filter，即使计算样式仍显示 blur(12px)。已有 FadingScrollArea 增加 overlay 模式，以独立且 pointer-events:none 的底部渐隐层保留滚动提示，复用 Base UI overflow-y-end 状态，到底时隐藏；其他滚动区继续采用原有 mask。仅用 background token，没有新增 UI 原语、依赖、阴影或装饰配色。

验收包含真实渲染像素：固定滚动位置下，磨砂与不透明版本有 20228 个像素、与透明但无模糊版本有 19905 个像素的通道差大于 2；正文段落几何确实落在工具栏后方。12 个正文板块、浅色/深色 Everforest、900×700 窄窗口截图已检查。宽/窄窗口原生滚动条拖动到底、渐隐消失、140 次光标上移、首行选区菜单定位及粗体切换均通过，页面错误为零。共享编辑器 44 项测试、复用门禁 4 项测试、最终 lint/设计检查与桌面构建通过；既有 React 与大 chunk 提示保留。证据位于 tmp/editor-glass-visible-20261004/。旧开发应用经正常退出保存协调后重启；未打包或发布。
