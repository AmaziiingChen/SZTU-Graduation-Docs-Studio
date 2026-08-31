import { useCallback, useEffect, useState, type CSSProperties } from "react"
import {
  ActivityIcon,
  BarChart3Icon,
  DatabaseIcon,
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
  SelectValue,
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

import type {
  TelemetryDashboardData,
  TelemetryDashboardResponse,
} from "./types"

type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: TelemetryDashboardData }
  | { status: "error"; message: string }

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

function MetricCard({
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

function EmptyAnalysis({ children }: { children: string }) {
  return (
    <Alert>
      <DatabaseIcon />
      <AlertTitle>数据量不足</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
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
          description={`最近 ${data.rangeDays} 天的轮换匿名安装标识`}
        />
        <MetricCard
          title="会话数"
          value={data.kpis.sessions.toLocaleString()}
          description="匿名会话去重计数"
        />
        <MetricCard
          title="启动次数"
          value={data.kpis.launches.toLocaleString()}
          description="app_started 事件"
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
          description="仅统计稳定错误码对应的失败结果"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>每日使用趋势</CardTitle>
            <CardDescription>按 CloudBase 接收时间统计活跃安装和事件量</CardDescription>
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
              <EmptyAnalysis>至少积累 8 个日期点后才展示趋势图；当前保留精确指标卡和事件表。</EmptyAnalysis>
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
          <CardTitle>最近事件</CardTitle>
          <CardDescription>不显示安装 ID、会话 ID或任何文档内容</CardDescription>
        </CardHeader>
        <CardContent>
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
              {data.recent.map((item, index) => (
                <TableRow key={`${item.receivedAt}-${item.eventName}-${index}`}>
                  <TableCell>{formatTimestamp(item.receivedAt)}</TableCell>
                  <TableCell>{item.eventName}</TableCell>
                  <TableCell className="max-w-md truncate">{item.summary}</TableCell>
                  <TableCell>{`${item.appVersion} · ${item.platform}/${item.arch}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default function App() {
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30)
  const [state, setState] = useState<DashboardState>({ status: "loading" })

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

  useEffect(() => {
    void load()
  }, [load])

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
                  <SidebarMenuButton isActive tooltip="使用概览">
                    <BarChart3Icon />
                    <span>使用概览</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="隐私边界">
                    <ShieldCheckIcon />
                    <span>匿名聚合数据</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <SiteHeader
          title="使用概览"
          status={
            state.status === "ready" ? (
              <Badge variant="secondary">{state.data.sourceRowCount} 条事件</Badge>
            ) : undefined
          }
          actions={
            <>
              <Select
                value={String(rangeDays)}
                onValueChange={(value) => setRangeDays(Number(value) as 7 | 30 | 90)}
              >
                <SelectTrigger aria-label="统计时间范围" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="7">最近 7 天</SelectItem>
                  <SelectItem value="30">最近 30 天</SelectItem>
                  <SelectItem value="90">最近 90 天</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={state.status === "loading"}
                onClick={() => void load()}
              >
                <RefreshCwIcon className={state.status === "loading" ? "animate-spin" : ""} />
                刷新
              </Button>
            </>
          }
        />
        <main className="flex min-h-0 flex-1 overflow-auto">
          {state.status === "loading" ? (
            <div className="grid w-full gap-4 p-4 lg:grid-cols-3 lg:p-6">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-28" />
              ))}
            </div>
          ) : state.status === "error" ? (
            <div className="w-full p-4 lg:p-6">
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>遥测分析暂不可用</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            </div>
          ) : (
            <Dashboard data={state.data} />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
