# Mac 0.1.6 包内验证

2026-10-05，Apple Silicon arm64。应用 `fc1a12d`，模板 `edffbdf`。复用本轮已通过的 pnpm verify 结果，依次构建 sidecar、七类模板、图标及 DMG/ZIP，没有重复执行未变化源码的全量测试。

## 产物

- `release/SZTU-Docs-Studio-0.1.6-mac-arm64.dmg`：138989426 字节；SHA-256 `71515fff97754ee894de459aeaa91f8871e63578b32f31b4f431ea1800850ec5`。
- `release/SZTU-Docs-Studio-0.1.6-mac-arm64.zip`：138775164 字节；SHA-256 `472b60e1c88961d87359a305f4555bdf972c83b8e9a972df7a0225fac59c3210`。
- DMG 内部校验与 ZIP 压缩完整性检查通过；应用 codesign deep/strict 检查通过，签名为 ad-hoc，未公证。
- 包内七类模板文件哈希、Word 底稿元数据清理、论文 ZIP、sidecar 通过检查。私有字体位于独立 document-fonts，SHA-256 与 catalog 一致。包检查输出的 documentFontsBundled=false 仅指模板引擎目录不含字体，不代表整个安装包没有私有字体。

## 真实包内引擎

使用最终应用 Contents/Resources/sidecar/sztu-docs-backend，通过 JSONL 调用预览、预检及导出。合成输入和全新数据库存于 tmp/macos-package-20261005/acceptance，未打开用户真实工作区。测试调用器使用本机 Python，但业务执行使用包内冻结引擎；Mac 包仍依赖本机 TeX、Poppler 和规定的系统字体，不是 Windows 式离线工具包。

七类文档预览与 DOCX/PDF 导出通过：开题 2 页、任务书 3 页、中期 2 页、指导教师评审 1 页、评阅人评审 1 页、答辩记录 1 页、成绩考核 1 页。内容、模板完整性、结构及中文字形门禁均通过。11 页独立预览图已逐页查看，并检查中文密集区域的原始像素裁剪，未发现明显裁切或重叠；结论仅限这些合成样例。

使用保留的 0.1.5 包内引擎创建合成档案及草稿，再由 0.1.6 包内引擎打开，档案/文档 ID 与草稿内容一致。此项是引擎层数据兼容检查，不等于实际安装升级验收。

## 保留项与下一步

旧 release/mac-arm64 已保留至 tmp/macos-package-20261005/previous-mac-arm64；旧版本 DMG/ZIP 保持原位。构建、验收与校验日志均保存在同一 tmp 目录。

未安装或启动新版桌面界面，未验证首次告知、剪贴板、关闭重开、真实用户资料升级或 Word/WPS 版式。引擎环境的 office_editor 返回 warn，目标编辑器验收仍待进行。未测试 Intel Mac，未上传安装包、提交源码或更新 stable 清单。
