# 中期检查目录编号预设设计

## 数据模型

`sections.numbering_style` 为可选枚举：

- `chinese_hierarchy`
- `chapter_hierarchy`
- `chapter_section_hierarchy`
- `part_chapter_section_hierarchy`
- `decimal_hierarchy`

目录条目继续使用 `level`、可选 `number` 和 `title`。新文档选择预设后，前端显示自动编号；导出边界重新计算编号，不信任可变界面文本。旧文档没有 `numbering_style` 时保留原 `number`。

严格中期检查 Schema 仍为兼容的 `0.1`，新增字段为可选字段；目录最大层级从 4 扩展到 6。模板工作区与应用镜像 Schema 必须保持字节一致。

## 模块边界

- 前端 `lib/outline-numbering.ts`：格式元数据、中文序数、自动编号和深度约束。
- 前端 `OutlineEditor`：默认 shadcn `Select`、只读编号、结构操作。
- `App.tsx`：保存/恢复 `numbering_style`，导出前传递层级与标题。
- 模板公共层 `templates/common/python/outline_numbering.py`：Word/LaTeX 共用的规范编号实现。
- 中期检查 Word/LaTeX：在数据规范化阶段调用公共实现；旧数据走显式编号兼容分支。
- 应用后端：在导出边界验证格式、最大深度和自动编号一致性。

## 兼容策略

旧草稿读取为 `numbering_style = null`，编号字段保持可见但只读；用户选择任一预设后，系统写入样式并自动编号。新建中期检查默认使用第五种阿拉伯数字分级格式。

## UI 规范

使用默认 shadcn `Select`，不新增颜色、字体、阴影或自定义原语。选择器放在论文目录顶部；选项展示“第 N 种”和一行编号示例。目录编号以次要样式只读显示，原“重新编号”按钮和编号输入框移除。

## 验证

- 五种格式黄金用例、同级递增、子级归零、中文数字边界。
- 新增/删除/移动/缩进自动编号及各格式最大深度。
- 旧草稿无样式兼容、保存后恢复样式。
- 后端 Schema/校验、Word/LaTeX 同编号断言。
- 前端测试、类型检查、lint、构建和真实 Electron 界面操作。
- 模板结构测试、LaTeX PDF 编译、中文字形门禁和中文密集页检查；Word/WPS 最终验收单列。
