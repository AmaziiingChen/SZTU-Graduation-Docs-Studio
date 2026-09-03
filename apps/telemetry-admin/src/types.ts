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

export type TelemetryRecentPage = {
  items: TelemetryRecentEvent[]
  nextCursor: string | null
  pageSize: number
}

export type TelemetryRecentResponse =
  | { status: "ready"; data: TelemetryRecentPage }
  | { status: "error"; message: string }

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

export type DiagnosticStatus = "pass" | "warn" | "fail"
export type DiagnosticOutcome = "success" | "failure" | "cancelled"

export type DiagnosticEnvironmentCheck = {
  id: string
  label: string
  required: boolean
  status: DiagnosticStatus
}

export type DiagnosticOperationSummary = {
  operation: string
  label: string
  success: number
  failure: number
  cancelled: number
  total: number
}

export type DiagnosticOperation = {
  occurredAt: string
  operation: string
  label: string
  outcome: DiagnosticOutcome
  durationBucket: string
  durationLabel: string
  errorCode: string | null
}

export type DiagnosticReportItem = {
  reportId: string
  createdAt: string
  receivedAt: string
  expiresAt: string
  application: {
    version: string
    electronVersion: string
    packaged: boolean
  }
  device: {
    platform: string
    platformLabel: string
    architecture: string
    osRelease: string
    cpuCountBucket: string
    cpuCountLabel: string
    memoryBucket: string
    memoryLabel: string
  }
  environment: {
    ready: boolean
    pythonVersion: string
    checks: DiagnosticEnvironmentCheck[]
    passCount: number
    warnCount: number
    failCount: number
  }
  services: {
    telemetryConfigured: boolean
    updateConfigured: boolean
  }
  privacy: {
    sourceFieldsRemoved: number
  }
  operationCount: number
  failedOperationCount: number
  operationSummary: DiagnosticOperationSummary[]
  recentOperations: DiagnosticOperation[]
}

export type DiagnosticDashboardData = {
  generatedAt: string
  rangeDays: 7 | 30
  kpis: {
    reports: number
    readyReports: number
    failedOperations: number
    expiringSoon: number
  }
  reports: DiagnosticReportItem[]
}

export type DiagnosticDashboardResponse =
  | { status: "ready"; data: DiagnosticDashboardData }
  | { status: "error"; message: string }
