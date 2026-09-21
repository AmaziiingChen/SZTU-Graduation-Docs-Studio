# 中期检查正文图表

研究内容和进展情况的工具栏提供“插入图表”：单张图片、三线表、表格、多图排版。

- 表格复用 VisualTableEditor，支持粘贴 Excel 数据。第一行作为表头，2–8 列、1–40 行数据；空单元格须填写内容或“—”。
- 组合图支持 2–4 张本地 PNG/JPEG、批量选择、调整顺序、每行 1–4 张、子图说明、总图题和所属章节。每张最多 20 MiB。
- 新图表插入弹窗打开时的选区；已插入图表选中后可重新编辑或删除。整个内容块可以拖动和撤销。取消弹窗不更改正文。
- 图片存入 document-assets，正文保存结构化表格和组合图数据；不使用临时预览 URL 保存资源。
- PDF 长表按最多 8 条数据行分段并重复表头；组合图允许在行间分页。Word 保留真实表格和原始图片。
- 正文编辑工具只在中期检查启用，沿用现有 shadcn 组件和已安装的动画图标，没有新增依赖。

## 验证记录（2026-09-21）

- TypeScript、Electron 编译通过；设计系统及 lint 无错误，仍有现有组件的 warnings。
- 编辑器与图表专项共 34 项通过；App 恢复已保存表格和组合图的集成测试通过。
- 后端图表校验及真实 Word 渲染两项通过，包含十种非法输入、三线边框、2×2 图片网格和嵌套表数量断言。
- 导出器 35 项（1 跳过）、Word 检查器 17 项（1 跳过）通过。
- 独立持久化工作区：保存、关闭重开、正式 Word/PDF 导出成功，结构和中文字形检查通过。
- 中期模板既有回归通过；新增 normal / long PDF 回归通过，long 包含 40 行和单列 4 图。PDF 字符未越出页面。
- Electron 隔离渲染验证：4 张托管图片正常加载，编辑弹窗无横向溢出，确认按钮固定在底部。
- WPS 已打开 2×2 图、三线表和普通表格样例，原生导出 PDF 字形门禁通过，三页已检查。WPS 与 LaTeX 的教师栏分页位置不同；不声称逐像素一致。后续添加的长表分段和组合图跨行分页只进行了结构与 PDF 回归，尚未在 WPS 单独复验压力样例。

上述初轮遗留的 4 项 App 测试失败已在基线收尾时解决：保存状态断言匹配已批准配色，jsdom 明确禁用不实际运行的 CSS 动画；校验失败关闭预览抽屉并将焦点交给目标字段，重复检查同一板块也能定位。窄窗口测试按实际操作先展开侧边栏。最终全量前端 281 项通过，详见 `BASELINE_20260921.md`。

## 可重复运行

桌面仓库：
```sh
pnpm --filter @sztu-docs/desktop exec vitest run src/components/workbench/body-tools.test.tsx src/components/workbench/structured-content-editor.test.tsx
pnpm --filter @sztu-docs/desktop exec vitest run src/App.test.tsx -t 'opens persisted tables'
PYTHONPATH=backend/src .venv/bin/python -m unittest discover -s backend/tests -p 'test_embedded_tools.py'
```

模板仓库（Python 需具备 python-docx、Pillow、pdfplumber，并安装 XeLaTeX）：
```sh
python templates/midterm/test_embedded_tools.py
```

样例输出位于模板仓库 `tmp/embedded-tools/`、`tmp/embedded-tools-regression/`。图片与数据均为合成测试资料。开发应用已重启，地址 http://127.0.0.1:5173/。
