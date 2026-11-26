const FEEDBACK_CATEGORIES = new Set(["bug", "suggestion", "other"])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RETENTION_DAYS = 180

export type FeedbackCategory = "bug" | "suggestion" | "other"

export type FeedbackInput = {
  category: FeedbackCategory
  message: string
  contact: string
  diagnosticReportId?: string
}

export type FeedbackReceipt = {
  receiptId: string
  retentionDays: number
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MOBILE_PATTERN = /^1[3-9]\d{9}$/

function isValidContact(value: string): boolean {
  if (EMAIL_PATTERN.test(value)) return true
  const normalized = value.replace(/[\s\-()]/g, "").replace(/^\+?86/, "")
  return MOBILE_PATTERN.test(normalized)
}

export class FeedbackError extends Error {
  readonly code = "FEEDBACK_FAILED"
}

function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === "string" && FEEDBACK_CATEGORIES.has(value)
}

export class FeedbackService {
  constructor(
    private readonly endpoint: string | undefined,
    private readonly appVersion: string,
    private readonly platform: string,
    private readonly arch: string,
  ) {}

  private feedbackUrl(): URL {
    if (!this.endpoint) throw new FeedbackError("当前版本没有配置反馈接收服务，可以先把问题记录下来，稍后联系维护者。")
    const url = new URL(this.endpoint)
    const suffix = "/v1/reports"
    if (!url.pathname.endsWith(suffix)) throw new FeedbackError("反馈接收地址无效。")
    url.pathname = url.pathname.slice(0, -suffix.length) + "/v1/feedback"
    return url
  }

  async submit(input: FeedbackInput): Promise<FeedbackReceipt> {
    if (!isFeedbackCategory(input.category)) throw new FeedbackError("请选择反馈类型。")
    const message = input.message.trim()
    if (message.length < 10 || message.length > 2000) throw new FeedbackError("请把问题描述清楚一些，字数在 10 到 2000 之间。")
    const contact = input.contact.trim()
    if (contact.length > 200 || /[\r\n\0]/.test(contact) || !isValidContact(contact)) {
      throw new FeedbackError("请填写有效的邮箱或手机号，例如 name@example.com 或 13800138000。")
    }
    if (input.diagnosticReportId && !UUID_RE.test(input.diagnosticReportId)) {
      throw new FeedbackError("诊断包编号无效，请重新创建诊断包。")
    }

    const url = this.feedbackUrl()
    const payload: Record<string, unknown> = {
      schema_version: "1.0",
      category: input.category,
      message,
      contact,
      app_version: this.appVersion,
      platform: this.platform,
      arch: this.arch,
    }
    if (input.diagnosticReportId) payload.diagnostic_report_id = input.diagnosticReportId

    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      throw new FeedbackError("连接反馈服务失败，请检查网络后再试。")
    })

    const result = (await response.json().catch(() => null)) as
      | { ok?: boolean; receipt_id?: string; retention_days?: number }
      | null
    if (response.status !== 202 || result?.ok !== true || typeof result.receipt_id !== "string"
      || !UUID_RE.test(result.receipt_id) || result.retention_days !== RETENTION_DAYS) {
      throw new FeedbackError(`反馈没有提交成功（服务返回 ${response.status}），请稍后再试。`)
    }
    return { receiptId: result.receipt_id, retentionDays: RETENTION_DAYS }
  }
}
