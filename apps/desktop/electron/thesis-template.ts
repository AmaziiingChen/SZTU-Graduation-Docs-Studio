import { createHash, randomUUID } from "node:crypto"
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

const FILE_NAME = "sztu-thesis-2026.zip"

export class ThesisTemplateError extends Error {
  constructor(readonly code: "THESIS_TEMPLATE_INVALID" | "THESIS_TEMPLATE_SAVE_FAILED", message: string) {
    super(message)
    this.name = "ThesisTemplateError"
  }
}

/** 读取随应用分发的固定源码包；下载不依赖 Python、TeX 或学生档案。 */
export async function downloadThesisTemplate(
  resourceDirectory: string,
  chooseTarget: (fileName: string) => Promise<string | null>,
): Promise<{ saved: boolean }> {
  let bytes: Buffer
  try {
    const archivePath = path.join(resourceDirectory, FILE_NAME)
    const metadata = JSON.parse(await readFile(path.join(resourceDirectory, "sztu-thesis-2026.json"), "utf8")) as Record<string, unknown>
    const stat = await lstat(archivePath)
    if (!stat.isFile() || stat.size < 4 || stat.size > 10 * 1024 * 1024
      || metadata.filename !== FILE_NAME || metadata.sizeBytes !== stat.size
      || typeof metadata.version !== "string" || typeof metadata.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error("Invalid template metadata")
    bytes = await readFile(archivePath)
    if (bytes.subarray(0, 4).toString("hex") !== "504b0304"
      || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) {
      throw new Error("Template integrity mismatch")
    }
  } catch {
    throw new ThesisTemplateError("THESIS_TEMPLATE_INVALID", "LaTeX 模板资源缺失或损坏，请重新安装软件后重试。")
  }

  // 路径只由主进程的系统保存对话框提供，不接受网页传入路径。
  const destination = await chooseTarget(FILE_NAME)
  if (!destination) return { saved: false }
  const temporary = path.join(path.dirname(destination), `.thesis-${randomUUID()}.part`)
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 })
    // 先完整写入临时文件，再替换用户在保存对话框明确选择的目标。
    await rename(temporary, destination)
    return { saved: true }
  } catch {
    throw new ThesisTemplateError("THESIS_TEMPLATE_SAVE_FAILED", "模板未保存，请检查目标目录权限和剩余空间后重试。")
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
