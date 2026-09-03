import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { Plugin } from "vite"
import { defineConfig, loadEnv } from "vite"

import {
  aggregateTelemetry,
  fetchRecentTelemetryPageFromCli,
  fetchTelemetryRowsFromCli,
  fixtureRecentTelemetryPage,
  fixtureTelemetryRows,
  parseRangeDays,
} from "./server/telemetry-data.ts"
import {
  buildDiagnosticDashboard,
  fetchDiagnosticRowsFromCli,
  fixtureDiagnosticRows,
  parseDiagnosticRangeDays,
} from "./server/diagnostic-data.ts"
import type {
  DiagnosticDashboardResponse,
  TelemetryDashboardResponse,
  TelemetryRecentResponse,
} from "./src/types.ts"
import {
  createReleaseManifest,
  getReleaseStatus,
  initializeReleaseKeys,
  readJsonBody,
} from "./server/release-management.ts"

function isTrustedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === "5180"
    )
  } catch {
    return false
  }
}

function telemetryApiPlugin(environment: Record<string, string>): Plugin {
  return {
    name: "sztu-telemetry-admin-api",
    configureServer(server) {
      const repositoryRoot = new URL("../..", import.meta.url).pathname
      server.middlewares.use("/api/release/status", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Cache-Control", "no-store")
        if (request.method !== "GET") {
          response.statusCode = 405
          response.end(JSON.stringify({ status: "error", message: "仅支持 GET 请求。" }))
          return
        }
        response.end(JSON.stringify({ status: "ready", data: await getReleaseStatus(environment) }))
      })
      server.middlewares.use("/api/release/keys", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Cache-Control", "no-store")
        if (request.method !== "POST") {
          response.statusCode = 405
          response.end(JSON.stringify({ status: "error", message: "仅支持 POST 请求。" }))
          return
        }
        if (!isTrustedLocalOrigin(request.headers.origin)) {
          response.statusCode = 403
          response.end(JSON.stringify({ status: "error", message: "拒绝非本机页面请求。" }))
          return
        }
        try {
          const data = await initializeReleaseKeys(environment, repositoryRoot)
          response.end(JSON.stringify({ status: "ready", data }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "密钥初始化失败。" }))
        }
      })
      server.middlewares.use("/api/release/manifest", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Cache-Control", "no-store")
        if (request.method !== "POST") {
          response.statusCode = 405
          response.end(JSON.stringify({ status: "error", message: "仅支持 POST 请求。" }))
          return
        }
        if (!isTrustedLocalOrigin(request.headers.origin)) {
          response.statusCode = 403
          response.end(JSON.stringify({ status: "error", message: "拒绝非本机页面请求。" }))
          return
        }
        try {
          const data = await createReleaseManifest(
            await readJsonBody(request),
            environment,
            repositoryRoot,
          )
          response.end(JSON.stringify({ status: "ready", data }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "发布清单生成失败。" }))
        }
      })
      server.middlewares.use("/api/telemetry/overview", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Cache-Control", "no-store")
        if (request.method !== "GET") {
          response.statusCode = 405
          response.end(JSON.stringify({ status: "error", message: "仅支持 GET 请求。" }))
          return
        }
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
        const rangeDays = parseRangeDays(requestUrl.searchParams.get("days"))
        const envId = environment.CLOUDBASE_ENV_ID || "amazingapp-d5giro9ac73398410"
        const useFixture = environment.SZTU_TELEMETRY_DASHBOARD_FIXTURE === "1"
        try {
          const result = useFixture
            ? { rows: fixtureTelemetryRows(), truncated: false }
            : await fetchTelemetryRowsFromCli({ envId, rangeDays })
          const dashboard = aggregateTelemetry(result.rows, rangeDays, {
            truncated: result.truncated,
          })
          const body: TelemetryDashboardResponse = {
            status: "ready",
            data: { ...dashboard, recent: [] },
          }
          response.statusCode = 200
          response.end(JSON.stringify(body))
        } catch {
          const body: TelemetryDashboardResponse = {
            status: "error",
            message: "遥测数据读取失败，请先运行 tcb login，并检查网络和 CloudBase 环境状态。",
          }
          response.statusCode = 502
          response.end(JSON.stringify(body))
        }
      })
      server.middlewares.use("/api/telemetry/events", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Cache-Control", "no-store")
        if (request.method !== "GET") {
          response.statusCode = 405
          response.end(JSON.stringify({ status: "error", message: "仅支持 GET 请求。" }))
          return
        }
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
        const rangeDays = parseRangeDays(requestUrl.searchParams.get("days"))
        const cursor = requestUrl.searchParams.get("cursor")
        const envId = environment.CLOUDBASE_ENV_ID || "amazingapp-d5giro9ac73398410"
        const useFixture = environment.SZTU_TELEMETRY_DASHBOARD_FIXTURE === "1"
        try {
          const data = useFixture
            ? fixtureRecentTelemetryPage(cursor)
            : await fetchRecentTelemetryPageFromCli({ envId, rangeDays, cursor })
          const body: TelemetryRecentResponse = { status: "ready", data }
          response.statusCode = 200
          response.end(JSON.stringify(body))
        } catch {
          const body: TelemetryRecentResponse = {
            status: "error",
            message: "最近事件读取失败，请刷新后重试。",
          }
          response.statusCode = 502
          response.end(JSON.stringify(body))
        }
      })
      server.middlewares.use("/api/diagnostics/overview", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Cache-Control", "no-store")
        if (request.method !== "GET") {
          response.statusCode = 405
          response.end(JSON.stringify({ status: "error", message: "仅支持 GET 请求。" }))
          return
        }
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
        const rangeDays = parseDiagnosticRangeDays(requestUrl.searchParams.get("days"))
        const envId = environment.CLOUDBASE_ENV_ID || "amazingapp-d5giro9ac73398410"
        const useFixture = environment.SZTU_TELEMETRY_DASHBOARD_FIXTURE === "1"
        try {
          const rows = useFixture
            ? fixtureDiagnosticRows()
            : await fetchDiagnosticRowsFromCli({ envId, rangeDays })
          const body: DiagnosticDashboardResponse = {
            status: "ready",
            data: buildDiagnosticDashboard(rows, rangeDays),
          }
          response.statusCode = 200
          response.end(JSON.stringify(body))
        } catch {
          const body: DiagnosticDashboardResponse = {
            status: "error",
            message: "诊断报告读取失败，请确认本机已经登录 CloudBase。",
          }
          response.statusCode = 502
          response.end(JSON.stringify(body))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "")
  return {
    plugins: [react(), tailwindcss(), telemetryApiPlugin(environment)],
    server: {
      strictPort: true,
    },
    resolve: {
      alias: {
        "@": new URL("../desktop/src", import.meta.url).pathname,
      },
    },
  }
})
