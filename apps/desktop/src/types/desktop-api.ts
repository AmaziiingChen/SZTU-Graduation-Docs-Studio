import type { StructuredBodyValue } from "@/types/structured-content"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export type EnvironmentCheck = {
  id: string
  required: boolean
  status: "pass" | "warn" | "fail"
  message: string
  details?: Record<string, unknown>
}

export type EnvironmentResult = {
  ready: boolean
  platform: {
    system: string
    release: string
    machine: string
    python: string
  }
  checks: EnvironmentCheck[]
}

export type AppInfo = {
  appVersion: string
  electronVersion: string
  platform: string
}

export type FullDiagnosticCase = {
  reportId: string
  operation: string
  createdAt: number
  files: { name: string; sizeBytes: number }[]
  missing: string[]
  excluded?: string[]
  sizeBytes: number
  uploadLimitBytes: number
}

export type DiagnosticSaveResult = {
  saved: boolean
}

export type DiagnosticSendResult = {
  reportId: string
  retentionDays: number
}

export type PrivacyNoticeStatus = {
  noticeVersion: string
  acknowledged: boolean
  acceptedAt: string | null
  telemetryConfigured: boolean
  updateConfigured: boolean
  configurationRequired: boolean
}

export type TelemetryUsageEvent =
  | {
      name: "view_opened"
      view: "profile" | DocumentType | "inspection"
    }
  | {
      name: "document_action"
      action: "check" | "preview" | "template_sync" | "export" | "qa_record"
      documentType: DocumentType
      outcome: "success" | "failure" | "cancelled"
      errorCode?: string
      formatCount?: number
      // 失败阶段（content/render/export/...），只放固定枚举，不含用户内容
      stage?: string
      // 结构性原因（如 validation_reason），只放固定枚举，不含用户内容
      reason?: string
    }

export type DocumentCompletionInput = {
  documentId: string
  documentType: DocumentType
}

export type DocumentCompletionResult = {
  recorded: boolean
  total: number | null
}

export type UpdateStatus =
  | { state: "unconfigured" }
  | { state: "idle" }
  | { state: "checking"; control?: ReleaseControl }
  | { state: "up_to_date"; checkedAt: string; control?: ReleaseControl }
  | { state: "available"; version: string; sizeBytes: number; downloadFailed?: boolean; control?: ReleaseControl }
  | { state: "downloading"; version: string; downloadedBytes: number; sizeBytes: number; phase: "transferring" | "verifying"; control?: ReleaseControl }
  | { state: "downloaded"; version: string; downloadedAt: string; control?: ReleaseControl }
  | {
      state: "error"
      code: "CHECK_FAILED" | "MANIFEST_INVALID" | "DOWNLOAD_FAILED"
      control?: ReleaseControl
    }

export type ReleaseAnnouncement = {
  id: string
  title: string
  body: string
  severity: "info" | "important" | "critical"
  startsAt: string
  endsAt: string | null
  dismissible: boolean
}

export type ReleaseControl = {
  updatePolicy: "optional" | "recommended" | "required"
  minimumSupportedVersion: string | null
  requiresUpgrade: boolean
  serviceStatus: "normal" | "maintenance" | "retired"
  helpUrl: string | null
  announcement: ReleaseAnnouncement | null
}

export type MidtermDateRule = {
  college: string
  startDate: string
  endDate: string
}

export type MidtermDatePolicyStatus = {
  state: "unconfigured" | "loading" | "ready" | "error"
  rules: MidtermDateRule[]
}

export type WorkspaceMode = "persistent" | "temporary"
export type DocumentType = "proposal" | "task_book" | "midterm" | "thesis" | "advisor_review" | "reviewer_review" | "defense_record" | "grade_assessment"
export type ToolLinkId =
  | "xmind"
  | "draw-io"
  | "simpletex"
  | "seekall"
  | "vcaptions"
  | "voyager"
  | "immersive-translate"
  | "easyscholar"
  | "tabbit"
  | "deepl"
  | "islide"
  | "zotero"
  | "metaso"
  | "perplexity"
  | "deepseek"
  | "doubao"
  | "qianwen"
  | "gemini"
  | "mactex"
  | "texlive"
  | "poppler"
  | "homebrew-poppler"
  | "font-book-help"
  | "windows-font-help"
  | "wps-office"

export type ImageAssetImportResult = {
  path: string
  previewUrl: string
  originalName: string
  mimeType: "image/png" | "image/jpeg"
  sizeBytes: number
  sha256: string
}

export type StudentProfileInput = {
  id?: string
  full_name: string
  student_number: string
  college: string
  major: string
  class_name?: string | null
  advisor_name?: string | null
  advisor_title?: string | null
  graduation_cohort?: string | null
  thesis_title?: StructuredBodyValue | null
  thesis_title_en?: string | null
}

export type StudentProfile = {
  id: string
  full_name: string
  student_number: string
  college: string
  major: string
  class_name: string | null
  advisor_name: string | null
  advisor_title: string | null
  graduation_cohort: string | null
  thesis_title: StructuredBodyValue | null
  thesis_title_en: string | null
  created_at: string
  updated_at: string
}

export type StudentProfileDraft = {
  full_name: string
  student_number: string
  college: string
  major: string
  class_name: string
  advisor_name: string
  advisor_title: string
  graduation_cohort: string
  thesis_title: StructuredBodyValue | null
  thesis_title_en: string | null
}

export type DocumentInput = {
  profile_id?: string | null
  document_type: DocumentType
  template_version: string
  schema_version: string
  title: string
  source_document_id?: string
}

export type DocumentRecord = {
  id: string
  profile_id: string | null
  document_type: string
  template_version: string
  schema_version: string
  title: string
  status: string
  is_temporary: boolean
  current_revision: number
  content: JsonObject | null
  save_reason: "auto" | "manual" | "restore" | "import" | null
  saved_at: string | null
  created_at: string
  updated_at: string
  soft_deleted_at?: string | null
  restored_from_revision?: number
}

export type DocumentListCursor = { updated_at: string; id: string }

export type DocumentListPageState = {
  profile_id: string | null
  next_cursor: DocumentListCursor | null
  has_more: boolean
}

export type DocumentListInput = {
  profileId: string | null
  deleted: boolean
  cursor?: DocumentListCursor
  limit?: number
}

export type DocumentListResult = DocumentListPageState & {
  documents: DocumentRecord[]
  deleted: boolean
}

export type StudentProfileSummary = Pick<StudentProfile, "id" | "full_name" | "student_number">

export type WorkspaceState = {
  mode: WorkspaceMode
  profile: StudentProfile | null
  profiles?: StudentProfileSummary[]
  deleted_profiles?: StudentProfileSummary[]
  profile_draft: StudentProfileDraft | null
  document: DocumentRecord | null
  documents: DocumentRecord[]
  deleted_documents: DocumentRecord[]
  documents_page?: DocumentListPageState
  deleted_documents_page?: DocumentListPageState
}

export type DemoSampleResult = {
  installed: string[]
  skipped: string[]
  removed?: number
  titles?: string[]
  profile_id?: string | null
}

export type DemoDocumentsState = WorkspaceState & { demo: DemoSampleResult }

export type RenameDocumentInput = {
  documentId: string
  title: string
}

export type SaveDraftInput = {
  documentId: string
  content: JsonObject
  expectedRevision: number
  reason?: "auto" | "manual"
}

export type SaveDraftResult = {
  document_id: string
  revision: number
  save_reason: "auto" | "manual"
  saved_at: string
}

export type ExportFormat = "docx" | "pdf" | "tex"

export type CheckResult = {
  schema_version: "1.0"
  check_id: string
  gate:
    | "structure"
    | "cjk_glyph"
    | "full_page_layout"
    | "target_editor"
    | "content"
    | "template_integrity"
    | "environment"
  status: "not_checked" | "running" | "pass" | "warn" | "fail" | "blocked"
  blocking: boolean
  message: string
  code?: string
  details?: Record<string, unknown>
  checked_at?: string | null
}

export type DocumentCheckResult = {
  checks: CheckResult[]
  diagnostic_case_id?: string
}

export type PreviewGenerateInput = {
  requestId: string
  documentId: string
}

export type PreviewPage = {
  page_number: number
  sha256: string
  size_bytes: number
  data_url: string
}

export type PreviewResult = {
  schema_version: "1.0"
  preview_id: string
  document_id: string
  document_revision: number
  input_sha256: string
  template: {
    template_id: string
    version: string
    pack_sha256: string
  }
  pages: PreviewPage[]
  checks: CheckResult[]
  generated_at: string
}

export type ExportArtifact = {
  format: ExportFormat
  path: string
  sha256: string
  size_bytes: number
}

export type ExportReceipt = {
  schema_version: "1.0"
  export_id: string
  request_id: string
  status: "succeeded" | "partial" | "failed"
  template: {
    template_id: string
    version: string
    pack_sha256: string
  }
  input_sha256: string
  artifacts: ExportArtifact[]
  checks: CheckResult[]
  generated_at: string
}

export type ExportDocumentInput = {
  requestId: string
  documentId: string
  previewId: string
  outputDirectory: string
  formats: ExportFormat[]
  overwriteConfirmed: boolean
  preflightToken: string
}

export type ExportPreflightInput = {
  documentId: string
  previewId: string
  formats: ExportFormat[]
  outputDirectory: string
}

export type ExportPreflightResult = {
  schema_version: "1.0"
  ready: true
  document_id: string
  document_revision: number
  formats: ExportFormat[]
  input_sha256: string
  template: ExportReceipt["template"]
  targets: Array<{
    format: ExportFormat
    filename: string
    path: string
    exists: boolean
  }>
  overwrite_required: boolean
  checks: CheckResult[]
  blocking_codes: string[]
  preflight_token: string
  expires_at: string
}

export type ExportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type ExportArtifactRecord = {
  artifact_id: string
  format: ExportFormat
  display_name: string
  sha256: string
  size_bytes: number
  file_state: "available" | "missing" | "modified"
  replaced_existing: boolean
  checks: CheckResult[]
}

export type ExportJobSummary = {
  export_id: string
  request_id: string | null
  status: ExportJobStatus
  progress: number
  error_code: string | null
  requested_formats: ExportFormat[]
  input_sha256: string | null
  template: ExportReceipt["template"] | null
  snapshot_available: boolean
  overwrite_confirmed: boolean
  artifacts: ExportArtifactRecord[]
  created_at: string
  completed_at: string | null
}

export type ExportHistoryInput = {
  documentId: string
  limit?: number
}

export type ExportHistoryResult = {
  schema_version: "1.0"
  history: ExportJobSummary[]
}

export type ExportCancelResult = {
  request_id: string
  accepted: boolean
  status: "cancel_requested" | "not_running"
  cancel_requested_at: string | null
}

export type RevealArtifactResult = {
  artifact_id: string
  revealed: true
}

export type DeleteExportHistoryInput = {
  documentId: string
  exportId: string
}

export type DeleteExportHistoryResult = {
  export_id: string
  deleted: true
}

export type TemplateInstallResult = {
  status: "linked" | "updated" | "already_current"
  template_id: string
  version: string
  pack_sha256: string
  installed_at: string
  source: "linked-workspace"
}

export type RecordQaInput =
  | {
      exportId: string
      artifactId?: string
      gate: "full_page_layout"
      status: "pass" | "fail"
      message: string
    }
  | {
      artifactId: string
      gate: "target_editor"
      editor: "word" | "wps"
      status: "pass" | "fail"
      message: string
    }

export type RecordQaResult = {
  record_id: string
  export_id: string
  artifact_id: string | null
  check: CheckResult
  recorded_at: string
}

export type SztuDesktopApi = {
  downloadThesisTemplate: () => Promise<{ saved: boolean }>
  getAppInfo: () => Promise<AppInfo>
  checkEnvironment: () => Promise<EnvironmentResult>
  prepareDiagnosticReport: (reportId?: string) => Promise<FullDiagnosticCase>
  saveDiagnosticReport: (reportId: string) => Promise<DiagnosticSaveResult>
  sendDiagnosticReport: (reportId: string) => Promise<DiagnosticSendResult>
  getPrivacyNoticeStatus: () => Promise<PrivacyNoticeStatus>
  acceptPrivacyNotice: () => Promise<PrivacyNoticeStatus>
  quitApp: () => Promise<null>
  onCloseRequest: (callback: (requestId: string) => void) => () => void
  completeCloseRequest: (input: {
    requestId: string
    outcome: "saved" | "failed"
    reason?: "conflict" | "save_failed"
  }) => Promise<{ accepted: boolean }>
  recordTelemetry: (input: TelemetryUsageEvent) => Promise<null>
  getAnonymousDocumentCount: () => Promise<number | null>
  recordDocumentCompletion: (
    input: DocumentCompletionInput,
  ) => Promise<DocumentCompletionResult>
  getUpdateStatus: () => Promise<UpdateStatus>
  downloadUpdate: () => Promise<UpdateStatus>
  getMidtermDatePolicyStatus: () => Promise<MidtermDatePolicyStatus>
  revealDownloadedUpdate: () => Promise<null>
  installUpdate: () => Promise<null>
  openReleaseHelp: () => Promise<null>
  openToolLink: (toolId: ToolLinkId) => Promise<null>
  writeClipboardText: (text: string) => Promise<null>
  writeClipboardPng: (dataUrl: string) => Promise<null>
  importImageAssets?: () => Promise<ImageAssetImportResult[]>
  importImageAsset: () => Promise<ImageAssetImportResult | null>
  readImageAssetPreview?: (fileName: string) => Promise<string>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
  onMidtermDatePolicyStatus: (callback: (status: MidtermDatePolicyStatus) => void) => () => void
  openWorkspace: (mode: WorkspaceMode) => Promise<WorkspaceState>
  listDocuments: (input: DocumentListInput) => Promise<DocumentListResult>
  saveProfileDraft: (profile: StudentProfileDraft, profileId?: string | null) => Promise<StudentProfileDraft>
  createProfile: (profile: StudentProfileInput) => Promise<WorkspaceState>
  selectProfile: (profileId: string | null) => Promise<WorkspaceState>
  deleteProfile: (profileId: string) => Promise<WorkspaceState>
  restoreProfile: (profileId: string) => Promise<WorkspaceState>
  saveProfile: (profile: StudentProfileInput) => Promise<StudentProfile>
  createDocument: (document: DocumentInput) => Promise<DocumentRecord>
  selectDocument: (documentId: string) => Promise<WorkspaceState>
  renameDocument: (input: RenameDocumentInput) => Promise<WorkspaceState>
  deleteDocument: (documentId: string) => Promise<WorkspaceState>
  restoreDocument: (documentId: string) => Promise<WorkspaceState>
  purgeDocument: (documentId: string) => Promise<WorkspaceState>
  installDemoDocuments: () => Promise<DemoDocumentsState>
  removeDemoDocuments: () => Promise<DemoDocumentsState>
  saveDraft: (input: SaveDraftInput) => Promise<SaveDraftResult>
  closeTemporary: (documentId: string) => Promise<WorkspaceState>
  checkDocument: (documentId: string) => Promise<DocumentCheckResult>
  generatePreview: (input: PreviewGenerateInput) => Promise<PreviewResult>
  chooseExportDirectory: () => Promise<string | null>
  preflightExport: (input: ExportPreflightInput) => Promise<ExportPreflightResult>
  exportDocument: (input: ExportDocumentInput) => Promise<ExportReceipt>
  cancelExport: (requestId: string) => Promise<ExportCancelResult>
  listExportHistory: (input: ExportHistoryInput) => Promise<ExportHistoryResult>
  revealExportArtifact: (artifactId: string) => Promise<RevealArtifactResult>
  deleteExportHistory: (input: DeleteExportHistoryInput) => Promise<DeleteExportHistoryResult>
  installTemplatePack: (documentType: DocumentType) => Promise<TemplateInstallResult | null>
  recordQa: (input: RecordQaInput) => Promise<RecordQaResult>
}
