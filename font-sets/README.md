# 工作台字体集

本目录维护字体用途及引入状态；清单见 `catalog.json`。它不包含商业字体文件。模板中的实际字号、字重和字体角色仍由模板仓库 `templates/*/spec/layout.json` 与 `templates/common/typography/font-policy-2026.json` 控制。

## 当前采用方式

| 字体集 | 字体 | 用途 | 当前方式 |
| --- | --- | --- | --- |
| 界面 | Geist Variable | 软件界面中的西文、数字 | 已内置，SIL OFL 1.1 |
| 界面 | 苹方、微软雅黑、Noto Sans CJK/SC | 界面中文回退 | 使用系统已有字体 |
| 通用文档 | 宋体 | 过程文档中文正文 | 使用本机字体 |
| 通用文档 | 黑体 | 多类文档标题、字段标签 | 使用本机字体 |
| 通用文档 | Times New Roman 四种字形 | 西文、数字、粗体和斜体 | 使用本机字体 |
| 任务书专用 | 华文行楷 | 封面“深圳技术大学”校名 | 使用本机字体 |
| 任务书 Word 专用 | Wingdings 2 | Word 勾选框 | 使用本机字体；PDF 不靠它绘制勾选框 |
| 中期检查专用 | 方正小标宋简体 | 最顶部两行大标题，小二 18 pt、居中、不加粗 | 用户提供，应用私有字体 |
| 独立论文工程 | 楷体、华文中宋 | 论文封面字段、中文摘要、题目等模板指定位置 | 外部 LaTeX 编译时按模板准备 |

## 方正小标宋影响范围

只有中期检查模板的 `typography.title` 使用 `cjk_form_title`。Word 与 LaTeX 两个渲染器均引用该角色；当前渲染前统一检查所需字体，因此不只是 Word/WPS 打开时才需要它。

缺少它不影响界面文字、正文编辑、任务书、开题报告或四类评审表。中期检查内容仍可填写和保存；保持原模板排版的预览和导出，需要先确定字体方案。

2026-10-05 用户提供字体文件并明确要求随软件内置，取代此前暂缓决定。文件保存为 `local-fonts/FZXiaoBiaoSong-B05S.ttf`，内部字体族为 `FZXiaoBiaoSong-B05S`，SHA-256 为 `c52d577dd3aa719ef5fb9ff2043b7f7ca36fae468ef34a47628a3a555d006a49`。字体二进制保持 Git 忽略，不上传仓库。此记录表示用户要求随附，不表示已核验分发许可。

## 私有字体与未来随附字体

- 本地开发：将已合法取得的字体放在应用仓库 `local-fonts/`。目录已被 Git 忽略，软件将其传给文档引擎；无需为了软件自身生成 PDF 而安装到操作系统。
- 显式覆盖：`SZTU_FONT_DIR` 指定字体目录；已有 `SZTU_SIMSUN_FONT`、`SZTU_FZXIAOBIAOSONG_FONT` 等变量可指定单个文件。环境检查与渲染器使用同一文件配置。
- 随软件提供：普通和离线打包配置均将上述指定文件复制到 `resources/document-fonts/`，运行时自动发现。本轮只完成本地接入，未打包；在其他构建机器上需另行提供这份私有文件。
- PDF 与 DOCX 分开验证：软件能读取私有字体并生成 PDF，不代表另一台电脑上的 Word/WPS 自动获得该字体；DOCX 的字体嵌入或接收端字体仍需单独解决。

## 来源

- 字体角色：模板仓库 `templates/common/typography/font-policy-2026.json`。
- 中期检查标题：`templates/midterm/spec/artifact.md` 与 `templates/midterm/spec/layout.json`。
- Geist：本机 `@fontsource-variable/geist/LICENSE`，SIL Open Font License 1.1。
- [方正小标宋官方信息](https://www.foundertype.com/index.php/FontInfo/index/id/164)。
- [方正公文个人家庭版](https://www.foundertype.com/index.php/FontInfo/get_font_office_buy)：查询时标价 ¥59，个人设备授权不包含随软件向他人分发。
- [方正许可说明](https://www.foundertype.com/index.php/About/powerAllowPro.html)。
