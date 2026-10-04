# 前端设计系统使用规范

## 目标与边界

学生工作台只使用项目通过 shadcn CLI 安装的 `base-nova`、`neutral`、CSS Variables
主题，以及官方 `dashboard-01` 页面层级。本规范不是第二套设计系统，而是对默认
shadcn 组件和 Tailwind 语义类的使用约束。

本规范管理 Electron 工作台及复用其组件的管理端界面。Word、PDF 和 LaTeX 正式文档中的字体、字号和颜色
由各文档模板规范与渲染门禁管理，不能从界面字体设置推导。

### 特别批准的外观主题例外

根据用户在 2026-09-02 明确提出的特殊新增要求，工作台允许在“外观”入口提供一组
命名主题预设。这是对默认 shadcn 配色限制的窄范围例外，不是开放业务页面自由配色：

- 主题颜色字面量只能集中维护在 `lib/appearance-themes.ts` 和 `index.css`；
- 主题通过覆盖 shadcn 语义 token 生效，业务组件仍只能使用语义类；
- 每个主题必须成套定义浅色和深色配色，由基础外观统一切换，不允许跨主题混搭；
- 新用户默认使用 Notion 主题并跟随系统外观，shadcn 默认浅色和深色作为可选主题保留；
- 主题不得更改文档内容、正式模板、导出产物、界面字体或状态色语义；
- 新增或修改主题必须同时更新外观测试，并至少检查一个浅色和一个深色预设。

## 颜色

- 页面和业务组件使用 `background`、`foreground`、`card`、`popover`、`primary`、
  `secondary`、`muted`、`accent`、`destructive`、`border`、`input`、`ring` 和
  `sidebar` 等 shadcn 语义 token。
- 业务代码不得直接使用 Hex、RGB、HSL、OKLCH 或 Tailwind 固定色阶。
- 固定色阶只允许出现在三个集中管理的状态组件中：
  `save-status-badge.tsx` 使用 `emerald` 表示内容已持久化；
  `export-history-status-badge.tsx` 使用 `emerald`、`amber` 和 `sky` 分别表示
  产物可用、文件状态发生变化和正在处理。缺失与失败继续使用 shadcn
  `destructive`；`section-completion-mark.tsx` 使用单一 `emerald` 圆形对勾表示
  文档板块已完成。未完成板块不显示可见状态，需修改板块使用 `destructive`。
  这些颜色只表达状态，不得作为品牌色或主按钮色。
- 错误、冲突和校验失败继续使用 shadcn `destructive`，禁用和辅助状态使用
  `muted`，不要为相近状态新增颜色。

## 字体与文字层级

全局界面字体保持 Geist，不增加品牌字体或打包中文字体。中文字符按以下系统字体顺序
回退：苹方、微软雅黑、Noto Sans CJK SC、Noto Sans SC、系统无衬线字体。该规则降低
macOS、Windows 和常见 Linux 环境中的随机回退，但不承诺不同平台像素级一致。

业务页面使用以下文字角色：

| 角色 | Tailwind 组合 | 用途 |
| --- | --- | --- |
| 工作台标题 | `text-base font-medium` | 顶部当前文档标题 |
| 区域标题和字段标签 | `text-sm font-medium` | 导航标题、表单标签、卡片内标题 |
| 正文和编辑内容 | `text-sm leading-6` | 结构化正文、参考文献预览 |
| 辅助说明和状态补充 | `text-xs text-muted-foreground` | 约束、提示、数量和次要信息 |
| BibTeX 源码 | `font-mono text-xs` | 只用于 BibTeX 单条、批量和高级源码输入 |

不要增加 Typography UI 原语，也不要在业务组件内使用 `font-family`、`font-sans`、
`font-serif` 或任意字体类。字号和字重服务于上述信息层级，不通过缩小文字规避空间问题。

## 组件与状态

- 默认 shadcn 原语保留在 `components/ui/`，业务组合保留在
  `components/workbench/`。
- 保存状态统一通过 `SaveStatusBadge` 展示，业务页面不重复状态颜色、图标和标签判断。
- 导出历史状态统一通过 `ExportHistoryStatusBadge` 展示，不在表格中散落颜色判断。
- 文档板块状态统一通过 `SectionCompletionMark` 展示。可留空且尚未填写的板块显示静态
  绿色对号，并以“可留空”说明其有效状态；对勾只在同一文档的必填板块状态变为完成时
  播放一次，红色警号只在状态刚变为错误时短促摇摆一次。初次载入和切换文档时静态显示，
  系统启用“减少动态效果”后禁用动画。可见文字由 Tooltip 补充，无障碍名称继续保留状态语义。
- 等宽字体是源码语义，不是视觉装饰；当前只允许参考文献 BibTeX 编辑器使用。

## 新组件约束与官方来源

优先复用项目已有组件，其次使用已选组件库的官方组件。未经用户明确允许，不新增自定义 UI 组件、视觉封装、基础原语或独立交互控件，也不复制现有组件另做样式。能力缺口应说明现有组件为何不适用及具体替代方案后取得允许；抽象、重构和统一风格不构成新增授权。

2026-10-03 补齐的 Field、Label、Collapsible、Empty、Pagination 来自官方 base-nova registry，仅做项目导入别名、cn 和 Lucide 图标占位转换。动画适配器从 workbench 移到 components 公共层，供原语和业务层共用；UI 层不得反向依赖 workbench。

现有排序行合并为公共 sortable-content-row；已有 2×2、3×3 图标共用动画 Hook。选区工具栏使用已经安装的 Tiptap BubbleMenu，预览抽屉使用现有 Resizable，渐隐使用已安装 shadcn scroll-fade-b。功能组合与逐项修复见 [复用审计与修复记录](./FRONTEND_COMPONENT_REUSE_AUDIT.md)。

2026-10-04 用户明确要求保留并改进选区工具栏、导航折叠及下拉选择的交互动效。组件复用整改不得以恢复默认样式为由移除这些过渡。继续使用现有组件、主题、字体和布局，不增加视觉原语或依赖。

- 选区工具栏沿用 Tiptap BubbleMenu 定位和选区管理。入场 180ms、退场 140ms，淡入/淡出配合轻微浮起和缩放；反向操作从当前帧继续。定位碰撞边界采用正文滚动视口，靠近顶部时翻转到文字下方，避免盖住主工具栏。Tiptap 当前版本在 onHide 前同步移除节点，因此用生命周期回调短暂保留同一个节点播放退场；退场节点立即 aria-hidden/inert，完成或编辑器卸载时移除，重新打开时取消旧动画。
- 文档分类、排版工具、回收站共用已有 Collapsible 的内容高度/透明度过渡，250ms；箭头同步旋转。尺寸测量、关闭和中途反转由 Base UI 管理。
- 所有现有 Select 共用 200ms 淡入/轻微缩放、150ms 退场，箭头随展开状态旋转。保留选中项与触发器对齐，不再因该对齐模式禁用动画。使用 Base UI starting/ending 属性和可中断 CSS transition。
- 三种交互均遵循 prefers-reduced-motion，系统减少动态效果时立即显示/隐藏，不播放过渡。

参考：[Animate UI Collapsible](https://animate-ui.com/docs/primitives/base/collapsible)、[Base UI Animation](https://base-ui.com/react/handbook/animation)、[Tiptap BubbleMenu](https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu)。参考动效和生命周期方案，不复制另一套控件。

2026-10-04 用户指定 [Animate UI ThemeToggler](https://animate-ui.com/docs/primitives/effects/theme-toggler) 的明暗主题切换效果。在现有主题外观按钮上接入同样的左到右整页遮罩过渡（700ms、ease-in-out），使用原生 View Transition 快照与 clip-path，不新增 UI 原语或依赖。颜色、布局、命名主题预设和 next-themes 保持原有实现。

- 在快照更新回调中同步调用 next-themes，界面状态、根节点主题和本地存储同时生效，不延迟到动画结束才保存。
- 快速点击跳过旧快照并取消旧动画；被跳过的快照仍可能调用更新回调，因此回调始终应用最后一次选择。离开主题页面清理视觉过渡，已经选择的主题仍生效。
- 当前明暗外观不变、减少动态效果开启、浏览器不支持 API 或快照失败时直接应用主题。“跟随系统”保留系统色彩模式监听；命名配色预设切换沿用原有行为。
- 原生快照伪元素需要全局 CSS，样式仅在 data-theme-transition 存在期间生效；旧/新快照关闭默认淡化混合，遮罩播放期间不拦截按钮交互。

验证：主题外观 9 项测试通过，覆盖旧快照晚到、减少动态效果、快照失败、卸载清理和原有预设保存。后台 Chrome 检查浅色→深色、深色→浅色的切换，700ms 中点 clip-path 为 inset(0px 50% 0px 0px)，截图已检查；连续真实点击、重复模式、系统模式监听、减少动态效果、不支持 API 的回退及 Everforest 配色保留均通过，页面错误为零。证据位于 tmp/theme-transition-20261004/；属于浏览器界面验收，未重新打包安装。

## 编辑器工具栏磨砂效果

2026-10-04 用户明确要求恢复编辑器磨砂玻璃。沿用既有 StructuredContentEditor 的格式工具栏，使用 `background/70` 和 `backdrop-blur-md`；不支持背景模糊时使用不透明的 `background`。浅色、深色及命名配色均继承当前主题 token，不新增组件、依赖、颜色或阴影。

仅工具栏表面获得此例外。格式工具栏在同一正文视口内 sticky 定位，滚动文字实际经过它的后方；初始正文仍自然排在工具栏下面。ResizeObserver 测量换行后的实际工具栏高度，用于滚动条上沿、光标滚动间距和选区浮层碰撞留白；滚动条止于状态栏上沿，不使用负边距或重复正文。组件复用检查仅允许该文件的 `editor-format-toolbar` 使用此模糊等级，其他业务表面仍禁止新增玻璃与装饰渐变。后续整理不得删除已获授权的效果。

Chromium 中祖先 viewport 的 mask-image 会阻止工具栏背景模糊，不能仅凭 backdrop-filter 的计算样式判断效果。已有 FadingScrollArea 为编辑器提供 overlay 模式，用独立、不拦截点击的底部渐隐层替代 viewport mask；复用 Base UI 的 overflow-y-end 状态，在到底时隐藏，保留减少动态效果支持。该渐变只用于原有滚动边缘提示，复用 background token，无新增颜色或装饰用途。其他滚动区沿用原来的 mask 模式。

## 同类界面的复用规则

- 学生档案保留现有两张圆角 Card、页面宽度及外部留白。题目卡片使用已有 sm 尺寸；仅该页的内联题目编辑器缩短工具栏和正文初始高度，长题目自然换行增长，不限制内容高度。基础字段按姓名/学号、学院/专业、毕业届别/班级配对；指导信息在同一基础信息卡片内复用 Separator、FieldSet 分组，教师增删操作属于该组。页面不显示“基础信息”和“指导信息”分组标题，FieldSet 保留可访问名称；论文题目与各字段标签均使用 text-sm/font-medium。不新增容器、组件、阴影或常驻解释。
- 用户要求顶部栏和正文工具栏不展示文档名称；预览与导出入口位于右侧，不再添加当前文件名称标签。
- 学生档案中的完整表单按两列字段排列；文档基本信息中的编辑字段与只读信息保持同一行的左标签、右值布局，统一复用 `FormField` 和 `DocumentDateField`。预设加自定义输入使用同一个 Combobox，固定选项使用 Select。
- 当前板块已在导航中命名时，内容区不再添加同名卡片标题；保留区分并列操作或内容所需的分组名称。无障碍名称继续保留。
- 常驻说明仅保留当前操作所需的输入方式、实际限制和不可逆后果；内部开发状态与实现细节留在开发文档。
- 添加、删除、移动、导入、确认和清空等同类动作复用已有动画图标及 `AnimatedActionIcon`，覆盖文档编辑、排版工具和弹窗。动画仅在悬停或键盘聚焦时触发，并遵守禁用状态和系统减少动态效果设置。
- 教师和答辩成员列表使用连续编号字段，底部提供添加与删除最后一项；问答、章节等需要表达顺序的内容列表保留逐项排序动作。

## 自动检查与人工复核

`pnpm lint` 会运行 `scripts/check_frontend_design_system.mjs`，阻止业务代码新增：

- 固定 Tailwind 调色板类；
- 颜色字面量；
- 局部字体族覆盖；
- 未记录用途的等宽字体；
- 不完整或被移动的保存状态颜色；
- UI 原语反向依赖 workbench；
- 业务层原生 label、自行设置视觉的原生 button（官方 render 裸目标例外）；
- 业务层新增玻璃或装饰渐变（上述已获授权的编辑器格式工具栏除外）。

复用检查器的回归测试已接入 lint。检查器不能判断用户是否授权新组件，该约束仍由 AGENTS.md 和审查共同执行。

自动检查只能防止代码层漂移。涉及可见层级的改动仍应至少复核正文编辑、参考文献列表和
对话框三类界面；涉及深色模式或跨平台字体时，应分别在对应系统上检查，不能用单一
macOS 截图代替 Windows 验收。
