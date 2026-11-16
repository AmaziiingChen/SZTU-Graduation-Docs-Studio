# Windows 任务书预览失败的旧版与候选版对照

2026-11-16，北京时间。针对报告 `d67e88f0-497c-4f8d-a6e6-00ea96959d1f`，复用现有安装包验收 workflow，未建立新的验收服务或上传真实学生材料。

[实际 Windows 对照运行：通过](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43815700322)。验收脚本提交 `fc1c32837a9254db35005307d88280843dc85bb8`。安装原公开 0.1.14 后保存其安装目录副本，再安装候选包，避免同一个应用标识的升级安装移除旧版文件。

## 对照结果

两套包使用相同合成任务书，保留原报告的段落/列表、10 条参考文献、6 行进度安排等结构，正文与档案值均替换为合成内容。原始用户材料仅在维护端私有目录读取；原始输入用可信模板在 macOS 生成 PDF，中文提取和字形检查通过，不等同于原电脑复测。

| 应用与环境 | 相关环境检查 | 实际预览 |
| --- | --- | --- |
| 公开 0.1.14，正常系统 PATH | 通过 | 成功，4 页 |
| 同一公开 0.1.14，COMSPEC 缺失、PATH 保留未展开的 `%SystemRoot%` | 通过 | `pdf_compile` 失败，`RENDER_FAILED`；日志包含 `I can't write on file` 和 `main.pdf` |
| 修复候选包，同一故障环境 | 通过 | 成功，4 页；PDF/页面大小和 SHA-256 核对通过 |

Word/WPS 检查显示 warn（构建机未安装编辑器），不是任务书编译前置失败。XeLaTeX、PDF 工具、过程文档宏包、字体和任务书引擎检查均通过。因此已实际重现“环境检查通过，随后 PDF 输出失败”的行为。

旧版包内引擎 SHA-256 为 `a213a46a9115ee57a8ea66fab624c36ff664ae6f0e28af786b09348656bd64db`，与原用户报告一致。旧版有效渲染环境确实缺失 COMSPEC 且保留未展开系统路径；候选版实际传入 `C:\Windows\System32\cmd.exe`，PATH 中的系统目录已展开。两次成功生成的 PDF 都由包内冻结引擎执行，未以源码模拟代替。

修复集中在 `runtime_paths.py` 与 `exporter.py`：保留 COMSPEC/PATHEXT，展开系统目录变量，按 SYSTEMROOT 补齐合法命令解释器和 System32。可确认这组软件运行环境处理缺陷可以造成本次记录的错误，修复消除了受控对照中的同类失败。原用户电脑没有远程复测；该结果不覆盖所有 Windows 预览故障。

## 原包与候选包溯源

| 对象 | SHA-256 |
| --- | --- |
| 原公开 Windows 0.1.14 离线安装包，429438195 字节 | `46ad47cb87a9a6539988f9b91b2c9183bbb63d659048b3c693cad2f10d803ca8` |
| 候选内部安装包，428903812 字节 | `233aa81db7cbf6a0f6f91a0fb27f22c6ff01b30db849cb50019fc1e5736f50bd` |
| 候选冻结引擎 | `cd689c56e2102a5ed695e8bb2accb301c7baef3f4d7f04286acd234c3a26f38f` |

候选包源自 `b3e0c67adb1aefe0fbca2dbe023f85b10830d64f`，内测版本号仍为 0.1.14。对照确认后，应用提交 `c3e8b03` 将根目录与桌面包版本升为 0.1.15；生产运行环境修复与受验候选代码一致。0.1.15 最终安装包需通过正常双系统安装包流程后才允许发布，最终文件及发布状态见本版发布记录。

## 腾讯云生产入库与维护端读回

本次 Windows 对照中真实产生的故障 ZIP，由旧版安装包内 FullDiagnostics 直接发送到现有生产 HTTPS 接收端。服务回执后，维护端通过 CloudBase PG 按编号读取完整 `archive_base64`，解码并与本次 GitHub 验收材料逐字节比较，结果一致。

- 报告编号：`fd80c318-05b2-4f1d-85ba-addcb414b696`。
- 生产接收时间：2026-11-16 14:21:01.232034 +08；到期时间：2026-12-16 14:21:01.232034 +08。
- ZIP：104633 字节，52 个文件，`missing: []`。
- SHA-256：`3a6c2e2d57ce6067a3a936e363623fb19acd676aec08685a766f9408d9af73e1`。
- 原始步骤确认 `pdf_compile` 失败，包内日志确认同一 `main.pdf` 输出错误，运行时引擎哈希匹配原公开版。

CI 文件中的 `maintenance_cloud_readback_verified: false` 表示 CI 自身只能确认接收回执。维护端后续独立读回已完成，结果保存在本地 `tmp/windows-preview-investigation/comparison-readback/cloud-readback.json`，不是回环模拟接收器。

## 范围

本次只处理该任务书运行环境问题及真实诊断入库验证。中文用户路径下 `texmf.cnf` / `xelatex.fmt` 定位失败、更新下载总时限属于另外的已有问题，未在本次扩展。模板版式、界面和档案功能没有改动。
