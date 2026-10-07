import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2Icon,
  Clock3Icon,
  FileSearchIcon,
  SearchIcon,
  ServerCogIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import type {
  DiagnosticDashboardData,
  DiagnosticOutcome,
  DiagnosticReportItem,
  DiagnosticStatus,
} from "./types"

type ReportFilter = "all" | "ready" | "attention" | "failure"

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatFullTimestamp(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value))
}

function shortReportId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function statusBadge(status: DiagnosticStatus) {
  if (status === "pass") return <Badge variant="outline">通过</Badge>
  if (status === "warn") return <Badge variant="secondary">建议处理</Badge>
  return <Badge variant="destructive">缺失</Badge>
}

function outcomeBadge(outcome: DiagnosticOutcome) {
  if (outcome === "failure") return <Badge variant="destructive">失败</Badge>
  if (outcome === "cancelled") return <Badge variant="secondary">取消</Badge>
  return <Badge variant="outline">成功</Badge>
}

export function MetricCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  )
}

function ReportDetails({ report }: { report: DiagnosticReportItem }) {
  const [operationPage, setOperationPage] = useState(0)
  const operationPageSize = 10
  const operationPageCount = Math.max(1, Math.ceil(report.recentOperations.length / operationPageSize))
  const visibleOperations = report.recentOperations.slice(
    operationPage * operationPageSize,
    (operationPage + 1) * operationPageSize,
  )
  const passedChecks = report.environment.checks.length === 0
    ? 0
    : Math.round((report.environment.passCount / report.environment.checks.length) * 100)

  useEffect(() => {
    setOperationPage(0)
  }, [report.reportId])

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>报告详情</CardTitle>
            <CardDescription className="mt-1 break-all tabular-nums">{report.reportId}</CardDescription>
          </div>
          {report.environment.ready && report.failedOperationCount === 0 ? (
            <Badge variant="outline"><CheckCircle2Icon />运行正常</Badge>
          ) : (
            <Badge variant="destructive"><TriangleAlertIcon />需要关注</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 pt-5">
        <section className="grid gap-3">
          <h3 className="text-sm font-medium">设备与版本</h3>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">应用版本：</span>{report.application.version}</div>
            <div><span className="text-muted-foreground">运行模式：</span>{report.application.packaged ? "正式构建" : "开发构建"}</div>
            <div><span className="text-muted-foreground">系统：</span>{report.device.platformLabel} {report.device.osRelease}</div>
            <div><span className="text-muted-foreground">架构：</span>{report.device.architecture}</div>
            <div><span className="text-muted-foreground">处理器：</span>{report.device.cpuCountLabel}</div>
            <div><span className="text-muted-foreground">内存：</span>{report.device.memoryLabel}</div>
            <div><span className="text-muted-foreground">Python：</span>{report.environment.pythonVersion}</div>
            <div><span className="text-muted-foreground">Electron：</span>{report.application.electronVersion}</div>
          </div>
          <Separator />
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <span>收到：{formatFullTimestamp(report.receivedAt)}</span>
            <span>自动删除：{formatFullTimestamp(report.expiresAt)}</span>
          </div>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">本机环境</h3>
            <span className="text-xs text-muted-foreground">
              {report.environment.passCount}/{report.environment.checks.length} 项通过
            </span>
          </div>
          <Progress value={passedChecks}>
            <ProgressLabel>环境完整度</ProgressLabel>
            <ProgressValue>{() => `${passedChecks}%`}</ProgressValue>
          </Progress>
          <div className="grid gap-2 sm:grid-cols-2">
            {report.environment.checks.map((check) => (
              <div key={check.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <span className="truncate text-sm">{check.label}</span>
                {statusBadge(check.status)}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">操作统计</h3>
            <span className="text-xs text-muted-foreground">共 {report.operationCount} 次</span>
          </div>
          {report.operationSummary.length > 0 ? (
            <div className="grid gap-2">
              {report.operationSummary.map((item) => (
                <div key={item.operation} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{item.label}</div>
                    <div className="text-xs text-muted-foreground">
                      成功 {item.success} · 失败 {item.failure} · 取消 {item.cancelled}
                    </div>
                  </div>
                  <Badge variant={item.failure > 0 ? "destructive" : "secondary"}>{item.total}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无操作记录</p>
          )}
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-medium">最近操作</h3>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>错误与上下文</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOperations.map((item, index) => (
                  <TableRow key={`${item.occurredAt}-${item.operation}-${index}`}>
                    <TableCell className="whitespace-nowrap">{formatTimestamp(item.occurredAt)}</TableCell>
                    <TableCell>{item.label}</TableCell>
                    <TableCell>{outcomeBadge(item.outcome)}</TableCell>
                    <TableCell className="whitespace-nowrap">{item.durationMs !== undefined ? `${item.durationMs} ms` : item.durationLabel}</TableCell>
                    <TableCell className="max-w-sm whitespace-normal break-all text-xs tabular-nums">{item.errorCode ?? "—"}
                      {item.context?.request_id ? <div>请求：{item.context.request_id}</div> : null}
                      {item.context?.stage ? <div>阶段：{item.context.stage}</div> : null}
                      {item.context?.document_type ? <div>文档：{item.context.document_type}</div> : null}
                      {item.context?.template_version ? <div>模板：{item.context.template_version}</div> : null}
                      {item.context?.field ? <div>字段：{item.context.field}</div> : null}
                      {item.context?.trace?.map((frame, index) => <div key={index}>{frame.module}:{frame.line}</div>)}
                      {item.context?.structure ? <div>结构：{Object.entries(item.context.structure).map(([key, count]) => `${key}=${count}`).join("；")}</div> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {report.recentOperations.length > operationPageSize ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                第 {operationPage + 1}/{operationPageCount} 页 · 共 {report.recentOperations.length} 条
              </p>
              <Pagination className="mx-0 w-auto" aria-label="列表分页"><PaginationContent><PaginationItem><PaginationPrevious href="#" text="上一页" aria-label="上一页操作记录" aria-disabled={operationPage === 0} tabIndex={(operationPage === 0) ? -1 : 0} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={event => { event.preventDefault(); if (!(operationPage === 0)) (() => setOperationPage((current) => Math.max(0, current - 1)))() }} /></PaginationItem>
<PaginationItem><PaginationNext href="#" text="下一页" aria-label="下一页操作记录" aria-disabled={operationPage >= operationPageCount - 1} tabIndex={(operationPage >= operationPageCount - 1) ? -1 : 0} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={event => { event.preventDefault(); if (!(operationPage >= operationPageCount - 1)) (() => setOperationPage((current) => Math.min(operationPageCount - 1, current + 1)))() }} /></PaginationItem></PaginationContent></Pagination>
            </div>
          ) : null}
        </section>

        <Alert>
          <ServerCogIcon />
          <AlertTitle>服务状态</AlertTitle>
          <AlertDescription>
            遥测{report.services.telemetryConfigured ? "已配置" : "未配置"}，更新检查{report.services.updateConfigured ? "已配置" : "未配置"}；隐私扫描已通过，移除了 {report.privacy.sourceFieldsRemoved} 个来源字段。
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

export function DiagnosticsDashboard({ data }: { data: DiagnosticDashboardData }) {
  const [query, setQuery] = useState("")
  const [platform, setPlatform] = useState("all")
  const [filter, setFilter] = useState<ReportFilter>("all")
  const [selectedId, setSelectedId] = useState(data.reports[0]?.reportId ?? "")
  const [reportPage, setReportPage] = useState(0)
  const reportPageSize = 20

  const filteredReports = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return data.reports.filter((report) => {
      if (platform !== "all" && report.device.platform !== platform) return false
      if (filter === "ready" && !report.environment.ready) return false
      if (filter === "attention" && report.environment.ready && report.failedOperationCount === 0) return false
      if (filter === "failure" && report.failedOperationCount === 0) return false
      return !normalizedQuery ||
        report.reportId.toLowerCase().includes(normalizedQuery) ||
        report.application.version.toLowerCase().includes(normalizedQuery)
    })
  }, [data.reports, filter, platform, query])

  const reportPageCount = Math.max(1, Math.ceil(filteredReports.length / reportPageSize))
  const visibleReports = useMemo(
    () => filteredReports.slice(
      reportPage * reportPageSize,
      (reportPage + 1) * reportPageSize,
    ),
    [filteredReports, reportPage],
  )

  useEffect(() => {
    setReportPage(0)
  }, [filter, platform, query])

  useEffect(() => {
    if (reportPage >= reportPageCount) setReportPage(reportPageCount - 1)
  }, [reportPage, reportPageCount])

  useEffect(() => {
    if (!visibleReports.some((report) => report.reportId === selectedId)) {
      setSelectedId(visibleReports[0]?.reportId ?? "")
    }
  }, [selectedId, visibleReports])

  const selected = filteredReports.find((report) => report.reportId === selectedId)
  const readyRate = data.kpis.reports === 0
    ? null
    : Math.round((data.kpis.readyReports / data.kpis.reports) * 100)

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="诊断报告" value={String(data.kpis.reports)} description={`最近 ${data.rangeDays} 天收到的报告`} />
        <MetricCard title="环境可用率" value={readyRate === null ? "—" : `${readyRate}%`} description={`${data.kpis.readyReports} 份报告环境检查通过`} />
        <MetricCard title="失败操作" value={String(data.kpis.failedOperations)} description="全部报告内的失败操作合计" />
        <MetricCard title="即将删除" value={String(data.kpis.expiringSoon)} description="将在 7 天内按策略自动清理" />
      </div>

      <Card size="sm">
        <CardContent className="grid gap-3 pt-4 md:grid-cols-[minmax(16rem,1fr)_12rem_12rem]">
          <InputGroup>
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索报告编号或应用版本"
              aria-label="搜索诊断报告"
            />
          </InputGroup>
          <Select value={platform} onValueChange={(value) => value && setPlatform(value)}>
            <SelectTrigger className="w-full" aria-label="筛选操作系统">
              <span>{({ all: "全部系统", darwin: "macOS", win32: "Windows", linux: "Linux" })[platform] ?? platform}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部系统</SelectItem>
              <SelectItem value="darwin">macOS</SelectItem>
              <SelectItem value="win32">Windows</SelectItem>
              <SelectItem value="linux">Linux</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={(value) => value && setFilter(value as ReportFilter)}>
            <SelectTrigger className="w-full" aria-label="筛选报告状态">
              <span>{({ all: "全部状态", ready: "环境可用", attention: "需要关注", failure: "存在失败操作" })[filter]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="ready">环境可用</SelectItem>
              <SelectItem value="attention">需要关注</SelectItem>
              <SelectItem value="failure">存在失败操作</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filteredReports.length === 0 ? (
        <Alert>
          <FileSearchIcon />
          <AlertTitle>没有匹配的诊断报告</AlertTitle>
          <AlertDescription>调整搜索词或筛选条件后再试。</AlertDescription>
        </Alert>
      ) : (
        <div className="grid min-h-0 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Card className="min-h-[36rem] overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle>报告列表</CardTitle>
              <CardDescription>{filteredReports.length} 份匹配结果，点击查看详情</CardDescription>
            </CardHeader>
            <ScrollArea className="h-[calc(100vh-23rem)] min-h-[28rem]">
              <CardContent className="grid gap-2 p-3">
                {visibleReports.map((report) => {
                  const needsAttention = !report.environment.ready || report.failedOperationCount > 0
                  return (
                    <Button
                      key={report.reportId}
                      variant={selectedId === report.reportId ? "secondary" : "ghost"}
                      className="h-auto justify-start px-3 py-3 text-left"
                      onClick={() => setSelectedId(report.reportId)}
                    >
                      <div className="grid w-full min-w-0 gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs tabular-nums">{shortReportId(report.reportId)}</span>
                          {needsAttention ? (
                            <TriangleAlertIcon className="size-4 shrink-0 text-destructive" />
                          ) : (
                            <CheckCircle2Icon className="size-4 shrink-0 text-foreground" />
                          )}
                        </div>
                        <span className="truncate text-sm font-medium">
                          {report.device.platformLabel} · {report.application.version}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock3Icon className="size-3" />{formatFullTimestamp(report.receivedAt)}
                        </span>
                      </div>
                    </Button>
                  )
                })}
              </CardContent>
            </ScrollArea>
            <div className="flex items-center justify-between gap-2 border-t p-3">
              <span className="text-xs text-muted-foreground">
                第 {reportPage + 1}/{reportPageCount} 页
              </span>
              <Pagination className="mx-0 w-auto" aria-label="列表分页"><PaginationContent><PaginationItem><PaginationPrevious href="#" text="上一页" aria-label="上一页诊断报告" aria-disabled={reportPage === 0} tabIndex={(reportPage === 0) ? -1 : 0} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={event => { event.preventDefault(); if (!(reportPage === 0)) (() => setReportPage((current) => Math.max(0, current - 1)))() }} /></PaginationItem>
<PaginationItem><PaginationNext href="#" text="下一页" aria-label="下一页诊断报告" aria-disabled={reportPage >= reportPageCount - 1} tabIndex={(reportPage >= reportPageCount - 1) ? -1 : 0} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={event => { event.preventDefault(); if (!(reportPage >= reportPageCount - 1)) (() => setReportPage((current) => Math.min(reportPageCount - 1, current + 1)))() }} /></PaginationItem></PaginationContent></Pagination>
            </div>
          </Card>
          {selected ? <ReportDetails report={selected} /> : null}
        </div>
      )}
    </div>
  )
}
