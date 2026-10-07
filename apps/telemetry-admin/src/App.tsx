import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { useCallback, useEffect, useState, type CSSProperties } from "react"
import {
  ActivityIcon,
  BarChart3Icon,
  DatabaseIcon,
  FileSearchIcon,
  PackageCheckIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SiteHeader } from "@/components/workbench/site-header"

import { DiagnosticsDashboard, MetricCard } from "./diagnostics-dashboard"
import { ReleaseManagement } from "./release-management"
import type {
  DiagnosticDashboardData,
  DiagnosticDashboardResponse,
  TelemetryDashboardData,
  TelemetryDashboardResponse,
  TelemetryRecentPage,
  TelemetryRecentResponse,
} from "./types"

type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: TelemetryDashboardData }
  | { status: "error"; message: string }

type DiagnosticState =
  | { status: "loading" }
  | { status: "ready"; data: DiagnosticDashboardData }
  | { status: "error"; message: string }

type AdminView = "telemetry" | "diagnostics" | "release"

const trendConfig = {
  activeInstallations: {
    label: "活跃安装",
    color: "var(--chart-4)",
  },
  eventCount: {
    label: "事件数",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

const actionConfig = {
  success: { label: "成功", color: "var(--chart-4)" },
  failure: { label: "失败", color: "var(--chart-2)" },
  cancelled: { label: "取消", color: "var(--chart-1)" },
} satisfies ChartConfig

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value))
}

function EmptyAnalysis({ children }: { children: string }) {
  return (
    <Alert>
      <DatabaseIcon />
      <AlertTitle>数据量不足</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

function RecentEventsTable({ rangeDays, refreshKey }: { rangeDays: 7 | 30 | 90; refreshKey: string }) {
  const [page, setPage] = useState<TelemetryRecentPage | null>(null)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(async (cursor: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const parameters = new URLSearchParams({ days: String(rangeDays) })
      if (cursor) parameters.set("cursor", cursor)
      const response = await fetch(`/api/telemetry/events?${parameters.toString()}`, {
        headers: { Accept: "application/json" },
      })
      const result = (await response.json()) as TelemetryRecentResponse
      if (result.status !== "ready") {
        setError(result.message)
        return
      }
      setPage(result.data)
    } catch {
      setError("无法连接本机遥测分析服务。")
    } finally {
      setLoading(false)
    }
  }, [rangeDays])

  useEffect(() => {
    setCursorHistory([null])
    setPageIndex(0)
    void loadPage(null)
  }, [loadPage, refreshKey])

  const goBack = () => {
    if (pageIndex === 0) return
    const nextIndex = pageIndex - 1
    setPageIndex(nextIndex)
    void loadPage(cursorHistory[nextIndex] ?? null)
  }

  const goForward = () => {
    if (!page?.nextCursor) return
    const nextIndex = pageIndex + 1
    setCursorHistory((current) => [...current.slice(0, nextIndex), page.nextCursor])
    setPageIndex(nextIndex)
    void loadPage(page.nextCursor)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>最近事件</CardTitle>
        <CardDescription>不显示安装 ID、会话 ID 或任何文档内容</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>最近事件暂不可用</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>接收时间</TableHead>
                  <TableHead>事件</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead>版本与平台</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !page ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={4}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : page?.items.length ? (
                  page.items.map((item, index) => (
                    <TableRow key={`${item.receivedAt}-${item.eventName}-${index}`}>
                      <TableCell>{formatTimestamp(item.receivedAt)}</TableCell>
                      <TableCell>{item.eventName}</TableCell>
                      <TableCell className="max-w-md truncate">{item.summary}</TableCell>
                      <TableCell>{`${item.appVersion} · ${item.platform}/${item.arch}`}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">暂无事件</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            第 {pageIndex + 1} 页 · 每页最多 {page?.pageSize ?? 20} 条
          </p>
          <Pagination className="mx-0 w-auto" aria-label="列表分页"><PaginationContent><PaginationItem><PaginationPrevious href="#" text="上一页" aria-label="上一页事件" aria-disabled={loading || pageIndex === 0} tabIndex={(loading || pageIndex === 0) ? -1 : 0} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={event => { event.preventDefault(); if (!(loading || pageIndex === 0)) (goBack)() }} /></PaginationItem>
<PaginationItem><PaginationNext href="#" text="下一页" aria-label="下一页事件" aria-disabled={loading || !page?.nextCursor} tabIndex={(loading || !page?.nextCursor) ? -1 : 0} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={event => { event.preventDefault(); if (!(loading || !page?.nextCursor)) (goForward)() }} /></PaginationItem></PaginationContent></Pagination>
        </div>
      </CardContent>
    </Card>
  )
}

function Dashboard({ data }: { data: TelemetryDashboardData }) {
  const trendReady = data.daily.length >= 8
  const actionReady = data.actions.length > 0
  const summaryGroups = [
    { title: "常见错误码", values: data.errors },
    { title: "页面访问", values: data.views },
    { title: "更新结果", values: data.updates },
  ]
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      {data.truncated ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>查询结果已截断</AlertTitle>
          <AlertDescription>当前时间范围超过 50000 条事件，请缩短时间范围。</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          title="活跃安装"
          value={data.kpis.activeInstallations.toLocaleString()}
          description={`最近 ${data.rangeDays} 天使用过应用的安装数`}
        />
        <MetricCard
          title="会话数"
          value={data.kpis.sessions.toLocaleString()}
          description="匿名会话去重计数"
        />
        <MetricCard
          title="启动次数"
          value={data.kpis.launches.toLocaleString()}
          description="应用启动次数"
        />
        <MetricCard
          title="导出尝试"
          value={data.kpis.exportAttempts.toLocaleString()}
          description="成功、失败和取消均计入"
        />
        <MetricCard
          title="导出成功率"
          value={
            data.kpis.exportSuccessRate === null
              ? "—"
              : `${data.kpis.exportSuccessRate.toFixed(1)}%`
          }
          description="成功导出次数 / 全部导出尝试"
        />
        <MetricCard
          title="失败事件"
          value={data.kpis.errorEvents.toLocaleString()}
          description="按错误码统计失败次数"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>每日使用趋势</CardTitle>
            <CardDescription>按收到数据的日期统计</CardDescription>
          </CardHeader>
          <CardContent>
            {trendReady ? (
              <ChartContainer config={trendConfig} className="h-72 w-full aspect-auto">
                <LineChart data={data.daily} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    dataKey="activeInstallations"
                    type="monotone"
                    stroke="var(--color-activeInstallations)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    dataKey="eventCount"
                    type="monotone"
                    stroke="var(--color-eventCount)"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <EmptyAnalysis>趋势图至少需要 8 天数据。</EmptyAnalysis>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>文档操作结果</CardTitle>
            <CardDescription>按文档类型和操作拆分成功、失败与取消</CardDescription>
          </CardHeader>
          <CardContent>
            {actionReady ? (
              <ChartContainer config={actionConfig} className="h-72 w-full aspect-auto">
                <BarChart data={data.actions} layout="vertical" margin={{ left: 24, right: 8 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="action"
                    tickLine={false}
                    axisLine={false}
                    width={64}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="success" stackId="outcome" fill="var(--color-success)" />
                  <Bar dataKey="failure" stackId="outcome" fill="var(--color-failure)" />
                  <Bar dataKey="cancelled" stackId="outcome" fill="var(--color-cancelled)" />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyAnalysis>尚未收到检查、预览、同步、导出或验收事件。</EmptyAnalysis>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {summaryGroups.map(({ title, values }) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
              {values.length > 0 ? (
                <div className="grid gap-3">
                  {values.slice(0, 8).map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-4">
                      <span className="truncate text-sm">{item.label}</span>
                      <Badge variant="secondary">{item.count.toLocaleString()}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无数据</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>版本与平台</CardTitle>
          <CardDescription>匿名安装数和事件量按版本、系统和架构汇总</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>版本</TableHead>
                <TableHead>平台</TableHead>
                <TableHead>架构</TableHead>
                <TableHead className="text-right">安装数</TableHead>
                <TableHead className="text-right">事件数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.versions.map((item) => (
                <TableRow key={item.key}>
                  <TableCell>{item.appVersion}</TableCell>
                  <TableCell>{item.platform}</TableCell>
                  <TableCell>{item.arch}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.installations}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.events}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>学院与专业分布</CardTitle>
          <CardDescription>按区间内每个安装标识最后一次记录统计。标识每 30 天轮换，安装数不代表学生人数。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>学院</TableHead><TableHead>专业</TableHead><TableHead className="text-right">安装数</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.academicDistribution.map((item) => <TableRow key={`${item.college}|${item.major}`}>
                <TableCell>{item.college === "unknown" ? "未知" : item.college}</TableCell>
                <TableCell>{item.major === "unknown" ? "未知" : item.major}</TableCell>
                <TableCell className="text-right tabular-nums">{item.installations}</TableCell>
              </TableRow>)}
              {data.academicDistribution.length === 0 ? <TableRow><TableCell colSpan={3}>暂无数据</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <RecentEventsTable rangeDays={data.rangeDays} refreshKey={data.generatedAt} />
    </div>
  )
}

export default function App() {
  const [activeView, setActiveView] = useState<AdminView>("telemetry")
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30)
  const [state, setState] = useState<DashboardState>({ status: "loading" })
  const [diagnosticRangeDays, setDiagnosticRangeDays] = useState<7 | 30>(30)
  const [diagnosticState, setDiagnosticState] = useState<DiagnosticState>({ status: "loading" })

  const load = useCallback(async () => {
    setState({ status: "loading" })
    try {
      const response = await fetch(`/api/telemetry/overview?days=${rangeDays}`, {
        headers: { Accept: "application/json" },
      })
      const result = (await response.json()) as TelemetryDashboardResponse
      if (result.status !== "ready") {
        setState({ status: "error", message: result.message })
        return
      }
      setState({ status: "ready", data: result.data })
    } catch {
      setState({ status: "error", message: "无法连接本机遥测分析服务。" })
    }
  }, [rangeDays])

  const loadDiagnostics = useCallback(async () => {
    setDiagnosticState({ status: "loading" })
    try {
      const response = await fetch(`/api/diagnostics/overview?days=${diagnosticRangeDays}`, {
        headers: { Accept: "application/json" },
      })
      const result = (await response.json()) as DiagnosticDashboardResponse
      if (result.status !== "ready") {
        setDiagnosticState({ status: "error", message: result.message })
        return
      }
      setDiagnosticState({ status: "ready", data: result.data })
    } catch {
      setDiagnosticState({ status: "error", message: "无法连接本机诊断报告服务。" })
    }
  }, [diagnosticRangeDays])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (activeView === "diagnostics") void loadDiagnostics()
  }, [activeView, loadDiagnostics])

  const activeState = activeView === "telemetry"
    ? state
    : activeView === "diagnostics"
      ? diagnosticState
      : { status: "ready" as const }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "14rem",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <Sidebar variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="SZTU 遥测分析">
                <ActivityIcon className="size-5!" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate text-base font-semibold">遥测分析</span>
                  <span className="truncate text-xs text-muted-foreground">仅供开发者本机使用</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>分析视图</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={activeView === "telemetry"}
                    tooltip="使用概览"
                    onClick={() => setActiveView("telemetry")}
                  >
                    <BarChart3Icon />
                    <span>使用概览</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={activeView === "release"}
                    tooltip="版本发布"
                    onClick={() => setActiveView("release")}
                  >
                    <PackageCheckIcon />
                    <span>版本发布</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={activeView === "diagnostics"}
                    tooltip="诊断报告"
                    onClick={() => setActiveView("diagnostics")}
                  >
                    <FileSearchIcon />
                    <span>诊断报告</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <SiteHeader
          title={activeView === "telemetry" ? "使用概览" : activeView === "diagnostics" ? "诊断报告" : "版本发布"}
          status={
            activeView === "telemetry" && state.status === "ready" ? (
              <Badge variant="secondary">{state.data.sourceRowCount} 条事件</Badge>
            ) : activeView === "diagnostics" && diagnosticState.status === "ready" ? (
              <Badge variant="secondary">{diagnosticState.data.kpis.reports} 份报告</Badge>
            ) : undefined
          }
          actions={
            <>
              {activeView === "telemetry" ? (
                <Select
                  value={String(rangeDays)}
                  onValueChange={(value) => setRangeDays(Number(value) as 7 | 30 | 90)}
                >
                  <SelectTrigger aria-label="统计时间范围" size="sm">
                    <span>{`最近 ${rangeDays} 天`}</span>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="7">最近 7 天</SelectItem>
                    <SelectItem value="30">最近 30 天</SelectItem>
                    <SelectItem value="90">最近 90 天</SelectItem>
                  </SelectContent>
                </Select>
              ) : activeView === "diagnostics" ? (
                <Select
                  value={String(diagnosticRangeDays)}
                  onValueChange={(value) => setDiagnosticRangeDays(Number(value) as 7 | 30)}
                >
                  <SelectTrigger aria-label="诊断报告时间范围" size="sm">
                    <span>{`最近 ${diagnosticRangeDays} 天`}</span>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="7">最近 7 天</SelectItem>
                    <SelectItem value="30">最近 30 天</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {activeView !== "release" ? <Button
                variant="outline"
                size="sm"
                disabled={activeState.status === "loading"}
                onClick={() => void (activeView === "telemetry" ? load() : loadDiagnostics())}
              >
                <RefreshCwIcon className={activeState.status === "loading" ? "animate-spin" : ""} />
                刷新
              </Button> : null}
            </>
          }
        />
        <main className="flex min-h-0 flex-1 overflow-auto">
          {activeState.status === "loading" ? (
            <div className="grid w-full gap-4 p-4 lg:grid-cols-3 lg:p-6">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-28" />
              ))}
            </div>
          ) : activeState.status === "error" ? (
            <div className="w-full p-4 lg:p-6">
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>{activeView === "telemetry" ? "遥测分析暂不可用" : "诊断报告暂不可用"}</AlertTitle>
                <AlertDescription>{activeState.message}</AlertDescription>
              </Alert>
            </div>
          ) : activeView === "release" ? (
            <ReleaseManagement />
          ) : activeView === "diagnostics" && diagnosticState.status === "ready" ? (
            <DiagnosticsDashboard data={diagnosticState.data} />
          ) : state.status === "ready" ? (
            <Dashboard data={state.data} />
          ) : (
            <Alert><ShieldCheckIcon /><AlertTitle>只读管理后台</AlertTitle></Alert>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
