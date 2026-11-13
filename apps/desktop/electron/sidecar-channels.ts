import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { SidecarClient, SidecarError, type SidecarMethod, type SidecarDiagnosticObserver } from "./sidecar-client.js"

const RENDER_METHODS = new Set<SidecarMethod>(["preview.generate", "export.preflight", "export.run"])

/** Separate process queues keep draft persistence available during TeX rendering. */
export class SidecarChannels {
  private mode: "persistent" | "temporary" | undefined
  private controlReady = false
  private allDocuments = false
  private renderReady = false
  private renderDocument: string | undefined
  private renderTask: Promise<unknown> | undefined
  private renderCancellationFile: string | undefined
  private shuttingDown = false

  constructor(
    private readonly control: SidecarClient,
    private readonly render: SidecarClient,
    private readonly dataRoot: string,
  ) {}

  async request<T>(method: SidecarMethod, params: Record<string, unknown>, timeoutMs?: number, onDiagnostic?: SidecarDiagnosticObserver): Promise<T> {
    if (this.shuttingDown) throw new SidecarError("SIDECAR_STOPPING", "文档服务正在关闭。")
    if (RENDER_METHODS.has(method)) return this.requestRender<T>(method, params, timeoutMs, onDiagnostic)
    if (this.renderTask && (
      method === "template.install" || method === "workspace.deleteProfile" || method === "workspace.createDocument" || method === "workspace.selectDocument" || method === "workspace.selectProfile" ||
      (method === "workspace.open" && params.mode === "temporary") ||
      method === "workspace.closeTemporary" ||
      (method === "workspace.purgeDocument" && params.document_id === this.renderDocument)
    )) throw new SidecarError("RENDER_BUSY", "文档正在生成预览或导出，请等待任务完成后再操作。")
    if (!this.control.running) this.controlReady = false
    if (!this.controlReady && this.mode && method !== "workspace.open") {
      const workspace = { mode: this.mode, ...(this.allDocuments ? { all_documents: true } : {}) }
      if (onDiagnostic) await this.control.request("workspace.open", workspace, undefined, { onDiagnostic })
      else await this.control.request("workspace.open", workspace)
      this.controlReady = true
    }
    const result = await (onDiagnostic
      ? this.control.request<T>(method, params, timeoutMs, { onDiagnostic })
      : this.control.request<T>(method, params, timeoutMs))
    if (method === "workspace.open") {
      this.mode = params.mode as "persistent" | "temporary"
      this.allDocuments = params.all_documents === true
      this.controlReady = true
    } else if (method === "workspace.closeTemporary") this.mode = "persistent"
    return result
  }

  private requestRender<T>(method: SidecarMethod, params: Record<string, unknown>, timeoutMs?: number, onDiagnostic?: SidecarDiagnosticObserver): Promise<T> {
    if (this.mode !== "persistent") return Promise.reject(new SidecarError("PREVIEW_UNAVAILABLE", "临时工作区暂不支持预览或导出，请先保存到文档工作区。"))
    if (this.renderTask) return Promise.reject(new SidecarError("RENDER_BUSY", "已有预览或导出任务正在运行，请等待完成。"))
    this.renderDocument = typeof params.document_id === "string" ? params.document_id : undefined
    this.renderCancellationFile = typeof params.cancellation_file === "string" ? params.cancellation_file : undefined
    const task = (async () => {
      if (!this.render.running) this.renderReady = false
      if (!this.renderReady) {
        const result = await this.render.request<{ mode: string; render_ready: boolean }>("workspace.open", { mode: "persistent" }, undefined, { onDiagnostic })
        if (result.mode !== "persistent" || result.render_ready !== true || Object.keys(result).length !== 2) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "文档服务初始化失败，请重启应用。")
        }
        this.renderReady = true
      }
      return this.render.request<T>(method, params, timeoutMs, {
        onDiagnostic,
        ...(this.renderCancellationFile ? { onDeadline: () => this.writeCancellation(this.renderCancellationFile, "timeout") } : {}),
      })
    })()
    this.renderTask = task
    return task.finally(() => {
      this.renderTask = undefined
      this.renderDocument = undefined
      this.renderCancellationFile = undefined
    })
  }

  private async writeCancellation(marker: string | undefined, reason = "cancel"): Promise<void> {
    const directory = path.resolve(this.dataRoot, "cancellations")
    if (!marker || path.dirname(path.resolve(marker)) !== directory ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.cancel$/i.test(path.basename(marker))) {
      throw new SidecarError("INVALID_CANCELLATION_FILE", "取消操作失败，请等待任务结束。")
    }
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try { await writeFile(marker, `${reason}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.renderTask) {
      try { await this.writeCancellation(this.renderCancellationFile) } catch { /* stop below confirms worker exit */ }
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        this.renderTask.catch(() => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 10_000) }),
      ])
      if (timer) clearTimeout(timer)
    }
    await Promise.all([this.control.stop(), this.render.stop()])
  }
}
