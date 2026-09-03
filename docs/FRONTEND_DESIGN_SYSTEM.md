# 前端设计系统使用规范

## 目标与边界

学生工作台只使用项目通过 shadcn CLI 安装的 `base-nova`、`neutral`、CSS Variables
主题，以及官方 `dashboard-01` 页面层级。本规范不是第二套设计系统，而是对默认
shadcn 组件和 Tailwind 语义类的使用约束。

本规范只管理 Electron 工作台界面。Word、PDF 和 LaTeX 正式文档中的字体、字号和颜色
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

## 自动检查与人工复核

`pnpm lint` 会运行 `scripts/check_frontend_design_system.mjs`，阻止业务代码新增：

- 固定 Tailwind 调色板类；
- 颜色字面量；
- 局部字体族覆盖；
- 未记录用途的等宽字体；
- 不完整或被移动的保存状态颜色。

自动检查只能防止代码层漂移。涉及可见层级的改动仍应至少复核正文编辑、参考文献列表和
对话框三类界面；涉及深色模式或跨平台字体时，应分别在对应系统上检查，不能用单一
macOS 截图代替 Windows 验收。
