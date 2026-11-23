import { SidecarError } from "./sidecar-client.js"

/**
 * Electron 侧 export.run 的客户端期限（毫秒）。
 *
 * Python sidecar 的渲染预算见 backend/src/sztu_docs_backend/exporter.py:3875：
 * 论文（thesis）的 LaTeX 渲染单步最多 300 秒，其它文档最多 90 秒。
 * Electron 收到的导出参数只有 document_id / preview_id 等标识，不包含
 * document_type，无法可靠区分论文与其它文档类型，因此统一采用一个高于
 * 论文预算的上限：300 秒渲染 + 60 秒用于 sidecar 冷启动、PDF 校验、
 * 中文字形检查、Word 转换与文件落盘。
 *
 * 客户端期限必须长于后端预算。否则客户端会先写取消标记、等待 10 秒后
 * SIGKILL 整个渲染 sidecar，导致导出记录停留在 running，并把错误退化成
 * REQUEST_OUTCOME_UNKNOWN。
 */
export const EXPORT_RUN_TIMEOUT_MS = 360_000

const EXPORT_TIMEOUT_CODES = new Set([
  "REQUEST_TIMEOUT",
  "REQUEST_OUTCOME_UNKNOWN",
  "RENDER_TIMEOUT",
])

/**
 * 把导出链路上的超时统一成稳定的 EXPORT_TIMEOUT。
 *
 * - REQUEST_TIMEOUT：客户端期限已到，后端确认取消；
 * - REQUEST_OUTCOME_UNKNOWN：客户端期限已到，且无法确认后端是否完成；
 * - RENDER_TIMEOUT：后端自己的渲染预算耗尽。
 *
 * 原始错误码保留在 details.original_code，故障包编号保留在
 * diagnosticCaseId，避免丢失诊断信息。
 */
export function normalizeExportRunError(error: unknown): unknown {
  if (!(error instanceof SidecarError) || !EXPORT_TIMEOUT_CODES.has(error.code)) {
    return error
  }
  const mapped = new SidecarError(
    "EXPORT_TIMEOUT",
    "导出超时，已停止等待本次导出。请打开导出记录确认是否已生成文件；若记录仍显示进行中，请重启应用后重试。",
    { ...error.details, original_code: error.code },
  )
  if (error.diagnosticCaseId) mapped.diagnosticCaseId = error.diagnosticCaseId
  return mapped
}
