import * as React from "react"
import { AlertTriangleIcon, CopyIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { enableSafeMode } from "@/lib/safe-mode"
import { writeClipboardText } from "@/lib/desktop-clipboard"

type ErrorBoundaryState = {
  error: Error | null
  errorId: string | null
  asyncNote: string | null
  copied: boolean
}

function newErrorId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && "randomUUID" in cryptoApi) {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Fall through to the timestamp-based identifier.
    }
  }
  return `renderer-${Date.now().toString(36)}`
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    errorId: null,
    asyncNote: null,
    copied: false,
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, errorId: newErrorId() }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Renderer crashed", this.state.errorId, error, info.componentStack)
  }

  componentDidMount(): void {
    window.addEventListener("error", this.handleWindowError)
    window.addEventListener("unhandledrejection", this.handleRejection)
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError)
    window.removeEventListener("unhandledrejection", this.handleRejection)
  }

  private handleWindowError = (event: ErrorEvent): void => {
    console.error("Unhandled renderer error", event.error ?? event.message)
    this.setState((state) =>
      state.error ? state : { ...state, asyncNote: describeError(event.error ?? event.message) },
    )
  }

  private handleRejection = (event: PromiseRejectionEvent): void => {
    console.error("Unhandled renderer rejection", event.reason)
    this.setState((state) =>
      state.error ? state : { ...state, asyncNote: describeError(event.reason) },
    )
  }

  private reload = (): void => {
    try {
      window.location.reload()
    } catch {
      // Reloading is unavailable in tests; the fallback stays visible.
    }
  }

  private enterSafeMode = (): void => {
    enableSafeMode()
    this.reload()
  }

  private copyDetails = async (): Promise<void> => {
    const details = [
      `诊断编号: ${this.state.errorId ?? "unknown"}`,
      `错误: ${describeError(this.state.error ?? this.state.asyncNote)}`,
    ].join("\n")
    try {
      await writeClipboardText(details)
      this.setState({ copied: true })
    } catch {
      this.setState({ copied: false })
    }
  }

  render(): React.ReactNode {
    const { error, errorId, asyncNote, copied } = this.state
    if (!error) {
      return (
        <>
          {this.props.children}
          {asyncNote ? (
            <Alert className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl shadow-lg">
              <AlertTriangleIcon />
              <AlertTitle>刚刚遇到一个错误</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>已记录，可以继续使用；如果反复出现，请通过「帮助支持 → 反馈问题」告诉我们。</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void this.copyDetails()}>
                  <CopyIcon aria-hidden="true" />
                  {copied ? "已复制" : "复制信息"}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )
    }

    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>页面遇到了一个问题</CardTitle>
            <CardDescription>
              你的文档保存在本机，不会丢失。可以先重新加载；如果反复出现，请进入安全模式，再通过「帮助支持 → 反馈问题」告诉我们。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <code className="rounded-md bg-muted px-2 py-1 text-xs">诊断编号：{errorId ?? "unknown"}</code>
            <p className="text-sm text-muted-foreground">{describeError(error)}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={this.reload}>
                <RefreshCwIcon aria-hidden="true" />
                重新加载页面
              </Button>
              <Button type="button" variant="outline" onClick={this.enterSafeMode}>
                <ShieldCheckIcon aria-hidden="true" />
                进入安全模式
              </Button>
              <Button type="button" variant="ghost" onClick={() => void this.copyDetails()}>
                <CopyIcon aria-hidden="true" />
                {copied ? "已复制" : "复制错误信息"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              安全模式会关闭新手引导和自动弹窗，保留编辑、预览与导出；需要时可以在页面顶部退出。
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }
}
