export type TelemetryKpis = {
  activeInstallations: number
  sessions: number
  launches: number
  exportAttempts: number
  exportSuccessRate: number | null
  errorEvents: number
}

export type TelemetryDailyPoint = {
  day: string
  activeInstallations: number
  eventCount: number
  launches: number
  exports: number
}

export type TelemetryActionPoint = {
  key: string
  documentType: string
  action: string
  success: number
  failure: number
  cancelled: number
  total: number
}

export type TelemetryCountPoint = {
  key: string
  label: string
  count: number
}

export type TelemetryVersionPoint = {
  key: string
  appVersion: string
  platform: string
  arch: string
  installations: number
  events: number
}

export type TelemetryRecentEvent = {
  receivedAt: string
  eventName: string
  appVersion: string
  platform: string
  arch: string
  summary: string
}

export type TelemetryDashboardData = {
  generatedAt: string
  rangeDays: 7 | 30 | 90
  sourceRowCount: number
  truncated: boolean
  kpis: TelemetryKpis
  daily: TelemetryDailyPoint[]
  actions: TelemetryActionPoint[]
  errors: TelemetryCountPoint[]
  views: TelemetryCountPoint[]
  uptime: TelemetryCountPoint[]
  updates: TelemetryCountPoint[]
  versions: TelemetryVersionPoint[]
  recent: TelemetryRecentEvent[]
}

export type TelemetryDashboardResponse =
  | { status: "ready"; data: TelemetryDashboardData }
  | { status: "unconfigured"; message: string }
  | { status: "error"; message: string }
