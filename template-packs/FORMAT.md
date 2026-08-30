# 模板包格式与信任边界

## 必需文件

模板包根目录必须包含非符号链接的 `manifest.json`。清单遵循
`contracts/template-manifest.schema.json`，其中：

- `manifest_version` 当前只接受 `1.0`；
- `contract_versions.app_contract` 当前接受 `1.0`；
- `contract_versions.document_schema` 当前开题报告只接受 `0.2`；
- `entrypoints` 和 `qa_policy` 必须指向 `files` 中已声明且哈希匹配的普通文件；
- 除 `manifest.json` 外，包内每个文件都必须在 `files` 中声明，且不得重复声明。

## 必须拒绝

校验器对以下情况返回稳定错误码并把模板标为不可信：

- `PATH_INVALID`：绝对路径、反斜杠、空段、`.` / `..`、NUL 或逃逸包根目录；
- `SYMLINK_FORBIDDEN`：清单、目录或已声明文件是符号链接；
- `FILE_MISSING` / `UNDECLARED_FILE`：缺文件或出现清单外文件；
- `HASH_MISMATCH`：任何已声明文件的 SHA-256 不一致；
- `MANIFEST_INVALID` / `QA_POLICY_INVALID`：结构、入口点或 QA 门禁缺失；
- `CONTRACT_VERSION_TOO_NEW` / `CONTRACT_VERSION_UNSUPPORTED`：合同版本不可安全读取；
- `DUPLICATE_FILE`：同一路径被声明多次。

校验顺序不跟随包内脚本执行任何命令。`qa-policy.json` 的 `command` 只是参数数组声明，执行器
还必须按自己的 allowlist 验证；绝不能拼接 shell 字符串。

## 本地验证

```bash
python3 template-packs/validate_pack.py template-packs/sztu-proposal-2026-dev
python3 template-packs/validate_pack.py --discover template-packs
```

输出为稳定 JSON。命令退出码为 0 只表示所有目标模板包通过结构、版本、路径与哈希门禁，
不表示渲染或文档验收通过。
