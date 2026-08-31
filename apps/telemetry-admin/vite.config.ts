import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { Plugin } from "vite"
import { defineConfig, loadEnv } from "vite"

import {
  aggregateTelemetry,
  fetchTelemetryRowsFromCli,
  fixtureTelemetryRows,
  parseRangeDays,
} from "./server/telemetry-data.ts"
import type { TelemetryDashboardResponse } from "./src/types.ts"

function telemetryApiPlugin(environment: Record<string, string>): Plugin {
  return {
    name: "sztu-telemetry-admin-api",
    configureServer(server) {
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
          const body: TelemetryDashboardResponse = {
            status: "ready",
            data: aggregateTelemetry(result.rows, rangeDays, {
              truncated: result.truncated,
            }),
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
