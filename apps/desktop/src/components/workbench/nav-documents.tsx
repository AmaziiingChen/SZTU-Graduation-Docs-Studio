import { Field, FieldLabel } from "@/components/ui/field"
import { useId } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { EllipsisIcon } from "@/components/ui/animateicons/ellipsis"
import { FeatherIcon } from "@/components/ui/feather"
import { RotateCCWIcon as RotateCcwIconAnimated } from "@/components/ui/rotate-ccw"
import { PlusIcon } from "@/components/ui/plus"
import { DeleteIcon } from "@/components/ui/delete"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { FileTextIcon } from "@/components/ui/file-text"
import { FolderOpenIcon } from "@/components/ui/folder-open"
import { SlidersHorizontal } from "@/components/animate-ui/icons/sliders-horizontal"
import { useReducedMotion } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import { AlignJustifyIcon } from "@/components/ui/align-justify-icon"
import { LayoutGridIcon } from "@/components/ui/layout-grid-icon"
import { TableGridIcon } from "@/components/workbench/table-grid-icon"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import type { DocumentRecord, DocumentType, StudentProfileSummary } from "@/types/desktop-api"
import { thesisToolOptions, type ThesisToolId } from "@/lib/thesis-tools"
import { assessmentDocumentRegistry } from "@/lib/assessment-documents"
import { defaultDocumentTitle } from "@/lib/document-names"

const documentGroups: Array<{
  type: DocumentType
  label: string
}> = [
  { type: "task_book", label: "任务书" },
  { type: "proposal", label: "开题报告" },
  { type: "midterm", label: "中期检查" },
  { type: "thesis", label: "毕业论文" },
  ...Object.entries(assessmentDocumentRegistry).map(([type, { label }]) => ({ type: type as DocumentType, label })),
]

function ThesisToolIcon({ toolId }: { toolId: ThesisToolId }) {
  const icon = toolId === "general_table" ? TableGridIcon
    : toolId === "multi_figure" ? LayoutGridIcon : AlignJustifyIcon
  return <AnimatedActionIcon icon={icon} />
}

export type CreateDocumentRequest = {
  type: DocumentType
  title: string
  profileId: string | null
  sourceDocumentId?: string
}

type ConfirmAction =
  | { kind: "recycle"; document: DocumentRecord }
  | { kind: "purge"; document: DocumentRecord }
  | null

export function NavDocuments({
  studentName,
  profileActive,
  toolsActive,
  inspectionActive,
  thesisToolsActive,
  activeThesisTool,
  activeDocumentId,
  documents,
  profiles,
  activeProfileId,
  deletedDocuments,
  documentsHasMore = false,
  deletedDocumentsHasMore = false,
  documentsLoading = false,
  deletedDocumentsLoading = false,
  onLoadMoreDocuments,
  disabled,
  onSelectDocument,
  onSelectThesisTool,
  onCreateDocument,
  onRenameDocument,
  onDeleteDocument,
  onRestoreDocument,
  onPurgeDocument,
}: {
  studentName: string
  profileActive: boolean
  toolsActive: boolean
  inspectionActive: boolean
  thesisToolsActive: boolean
  activeThesisTool: ThesisToolId
  activeDocumentId: string | null
  documents: DocumentRecord[]
  profiles: StudentProfileSummary[]
  activeProfileId: string | null
  deletedDocuments: DocumentRecord[]
  documentsHasMore?: boolean
  deletedDocumentsHasMore?: boolean
  documentsLoading?: boolean
  deletedDocumentsLoading?: boolean
  onLoadMoreDocuments?: (deleted: boolean) => Promise<void>
  disabled: boolean
  onSelectDocument: (documentId: string) => Promise<void>
  onSelectThesisTool: (toolId: ThesisToolId) => void
  onCreateDocument: (request: CreateDocumentRequest) => Promise<void>
  onRenameDocument: (documentId: string, title: string) => Promise<void>
  onDeleteDocument: (documentId: string) => Promise<void>
  onRestoreDocument: (documentId: string) => Promise<void>
  onPurgeDocument: (documentId: string) => Promise<void>
}) {
  const componentFieldId = useId()
  const activeRecordType = documents.find((item) => item.id === activeDocumentId)?.document_type
  const activeType = documentGroups.find(group => group.type === activeRecordType)?.type
  const [expanded, setExpanded] = useState<Record<DocumentType, boolean>>({
    proposal: activeType === "proposal" || activeType === undefined,
    task_book: activeType === "task_book",
    midterm: activeType === "midterm",
    thesis: activeType === "thesis",
    advisor_review: activeType === "advisor_review",
    reviewer_review: activeType === "reviewer_review",
    defense_record: activeType === "defense_record",
    grade_assessment: activeType === "grade_assessment",
  })
  const [expandedSelection, setExpandedSelection] = useState({ id: activeDocumentId, type: activeType })
  if (expandedSelection.id !== activeDocumentId || expandedSelection.type !== activeType) {
    setExpandedSelection({ id: activeDocumentId, type: activeType })
    if (activeType && !expanded[activeType]) {
      setExpanded({ ...expanded, [activeType]: true })
    }
  }
  const activeDocumentButton = useRef<HTMLElement | null>(null)
  const activeGroupExpanded = activeType ? expanded[activeType] : false
  useEffect(() => {
    if (activeGroupExpanded) activeDocumentButton.current?.scrollIntoView?.({ block: "nearest" })
  }, [activeDocumentId, activeGroupExpanded])
  const [layoutToolsExpanded, setLayoutToolsExpanded] = useState(thesisToolsActive)
  const [layoutIconActive, setLayoutIconActive] = useState(false)
  const reducedMotion = useReducedMotion()
  const [trashExpanded, setTrashExpanded] = useState(false)
  const [createType, setCreateType] = useState<DocumentType | null>(null)
  const [createTitle, setCreateTitle] = useState("")
  const [customTitle, setCustomTitle] = useState(false)
  const [createProfileId, setCreateProfileId] = useState<string | null>(null)
  const [createSource, setCreateSource] = useState("blank")
  const [renameTarget, setRenameTarget] = useState<DocumentRecord | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groupedDocuments = useMemo(
    () =>
      Object.fromEntries(
        documentGroups.map((group) => [
          group.type,
          documents.filter((document) => document.document_type === group.type),
        ]),
      ) as Record<DocumentType, DocumentRecord[]>,
    [documents],
  )

  const openCreate = (type: DocumentType) => {
    setCreateType(type)
    const profile = profiles.find(item => item.id === activeProfileId) ?? (profiles.length === 1 ? profiles[0] : null)
    setCreateProfileId(profile?.id ?? null)
    setCustomTitle(false)
    const name = profile?.id === activeProfileId && studentName.trim() ? studentName
      : profile?.full_name ?? (profiles.length ? "" : studentName)
    setCreateTitle(defaultDocumentTitle(type, name))
    setCreateSource("blank")
    setError(null)
  }

  const initialContentOptions = createType && (createProfileId || profiles.length === 0)
    ? groupedDocuments[createType].filter(item => item.profile_id === createProfileId || item.profile_id === null)
    : []

  const changeCreateProfile = (id: string | null) => {
    setCreateProfileId(id)
    setCreateSource("blank")
    if (createType && !customTitle) {
      setCreateTitle(defaultDocumentTitle(createType, profiles.find(item => item.id === id)?.full_name ?? ""))
    }
  }

  const run = async (operation: () => Promise<void>, onSuccess: () => void) => {
    setPending(true)
    setError(null)
    try {
      await operation()
      onSuccess()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "文档操作失败，请重试。"
      setError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          {documentGroups.map((group) => {
            const groupDocuments = groupedDocuments[group.type]
            const isExpanded = expanded[group.type]
            return (
              <Collapsible
                key={group.type}
                open={isExpanded}
                onOpenChange={open => setExpanded(current => ({ ...current, [group.type]: open }))}
                render={<SidebarMenuItem />}
              >
                <CollapsibleTrigger
                  render={<SidebarMenuButton tooltip={group.label} />}
                  aria-label={group.label}
                  title={group.type === "thesis" ? "毕业论文：下载 LaTeX 模板" : undefined}
                  aria-description={group.type === "thesis" ? "下载 LaTeX 工程，在外部编辑器中撰写论文" : undefined}
                >
                  <ChevronRightIcon
                    className={isExpanded
                      ? "rotate-90 transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                      : "transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"}
                  />
                  <AnimatedActionIcon icon={FolderOpenIcon} />
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                </CollapsibleTrigger>
                <SidebarMenuAction
                  aria-label={`新建${group.label}`}
                  title={`新建${group.label}`}
                  disabled={disabled}
                  showOnHover
                  onClick={(event) => {
                    event.stopPropagation()
                    openCreate(group.type)
                  }}
                >
                  <AnimatedActionIcon icon={PlusIcon} />
                </SidebarMenuAction>
                <CollapsibleContent>
                    <SidebarMenuSub className="mr-0 pr-0">
                    {groupDocuments.length === 0 ? (
                      <SidebarMenuSubItem>
                        <span className="block px-2 py-1 text-xs text-muted-foreground">{documentsHasMore ? "当前未载入此类文档" : "暂无文档"}</span>
                      </SidebarMenuSubItem>
                    ) : null}
                    {groupDocuments.map((item) => (
                      <SidebarMenuSubItem key={item.id}>
                        <SidebarMenuSubButton
                          ref={item.id === activeDocumentId ? (node) => { activeDocumentButton.current = node } : undefined}
                          render={<button type="button" disabled={disabled} />}
                          className="w-full justify-start pr-8 text-left"
                          isActive={
                            !profileActive &&
                            !toolsActive &&
                            !inspectionActive &&
                            !thesisToolsActive &&
                            item.id === activeDocumentId
                          }
                          onClick={() => void onSelectDocument(item.id)}
                        >
                          <AnimatedActionIcon icon={FileTextIcon} />
                          <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                        </SidebarMenuSubButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <SidebarMenuAction
                                type="button"
                                aria-label={`管理文档 ${item.title}`}
                                disabled={disabled}
                              />
                            }
                          >
                            <AnimatedActionIcon icon={EllipsisIcon} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              onClick={() => {
                                setRenameTarget(item)
                                setRenameTitle(item.title)
                                setError(null)
                              }}
                            >
                              <AnimatedActionIcon icon={FeatherIcon} />
                              重命名
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                setConfirmAction({ kind: "recycle", document: item })
                                setError(null)
                              }}
                            >
                              <AnimatedActionIcon icon={DeleteIcon} />
                              移到回收站
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuSubItem>
                    ))}
                    </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
          {documentsHasMore ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                disabled={disabled || documentsLoading || !onLoadMoreDocuments}
                aria-label="加载更多文档"
                onClick={() => void onLoadMoreDocuments?.(false)}
              >
                {documentsLoading ? "正在加载文档…" : "加载更多文档"}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarSeparator className="mx-4 mt-auto w-auto opacity-60" />
      <SidebarGroup>
        <SidebarMenu>
          <Collapsible open={layoutToolsExpanded} onOpenChange={setLayoutToolsExpanded} render={<SidebarMenuItem />}>
            <CollapsibleTrigger
              render={<SidebarMenuButton tooltip="排版工具" />}
              onMouseEnter={() => setLayoutIconActive(true)}
              onMouseLeave={() => setLayoutIconActive(false)}
              onFocus={() => setLayoutIconActive(true)}
              onBlur={() => setLayoutIconActive(false)}
            >
              <ChevronRightIcon
                className={layoutToolsExpanded
                  ? "rotate-90 transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                  : "transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"}
              />
              <SlidersHorizontal size={16} animate={!reducedMotion && layoutIconActive} aria-hidden="true" />
              <span>排版工具</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <SidebarMenuSub className="mr-0 pr-0">
                {thesisToolOptions.map((tool) => (
                  <SidebarMenuSubItem key={tool.id}>
                    <SidebarMenuSubButton
                      render={<button type="button" />}
                      className="w-full justify-start text-left"
                      isActive={thesisToolsActive && activeThesisTool === tool.id}
                      onClick={() => onSelectThesisTool(tool.id)}
                    >
                      <ThesisToolIcon toolId={tool.id} />
                      <span>{tool.navigationLabel}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
                </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={trashExpanded} onOpenChange={setTrashExpanded} render={<SidebarMenuItem />}>
            <CollapsibleTrigger
              render={<SidebarMenuButton tooltip="回收站" className="pr-8" />}
              aria-label={deletedDocumentsHasMore ? `回收站（已载入 ${deletedDocuments.length} 个文档，还有更多）` : `回收站（${deletedDocuments.length} 个文档）`}
            >
              <ChevronRightIcon
                className={trashExpanded
                  ? "rotate-90 transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                  : "transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"}
              />
              <AnimatedActionIcon icon={DeleteIcon} />
              <span>回收站</span>
            </CollapsibleTrigger>
            {deletedDocuments.length > 0 ? (
              <SidebarMenuBadge className="text-muted-foreground">
                {deletedDocuments.length}{deletedDocumentsHasMore ? "+" : ""}
              </SidebarMenuBadge>
            ) : null}
            <CollapsibleContent>
                <SidebarMenuSub className="mr-0 pr-0">
                {deletedDocuments.length === 0 && !deletedDocumentsHasMore ? (
                  <SidebarMenuSubItem>
                    <span className="block px-2 py-1 text-xs text-muted-foreground">回收站为空</span>
                  </SidebarMenuSubItem>
                ) : null}
                {deletedDocuments.map((item) => (
                  <SidebarMenuSubItem key={item.id}>
                    <span
                      className="block truncate py-1 pr-8 pl-2 text-xs text-muted-foreground"
                      title={item.title}
                    >
                      {item.title}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <SidebarMenuAction
                            type="button"
                            aria-label={`管理回收站文档 ${item.title}`}
                            disabled={disabled}
                          />
                        }
                      >
                        <AnimatedActionIcon icon={EllipsisIcon} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => void run(() => onRestoreDocument(item.id), () => undefined)}>
                          <AnimatedActionIcon icon={RotateCcwIconAnimated} />
                          恢复
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            setConfirmAction({ kind: "purge", document: item })
                            setError(null)
                          }}
                        >
                          <AnimatedActionIcon icon={DeleteIcon} />
                          永久删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuSubItem>
                ))}
                {deletedDocumentsHasMore ? (
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      render={<button type="button" disabled={disabled || deletedDocumentsLoading || !onLoadMoreDocuments} />}
                      aria-label="加载更多回收站文档"
                      onClick={() => void onLoadMoreDocuments?.(true)}
                    >
                      {deletedDocumentsLoading ? "正在加载文档…" : "加载更多回收站文档"}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ) : null}
                </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroup>

      <Dialog open={createType !== null} onOpenChange={(open) => !open && setCreateType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建{documentGroups.find((item) => item.type === createType)?.label}</DialogTitle>
            <DialogDescription>{createType === "thesis" ? "下载 LaTeX 模板后，可在 LaTeX 编辑器或 Agent 中撰写论文。" : "新建空白文档，或复制一份已有内容后独立编辑。"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {profiles.length > 0 ? (
              <Field>
                <FieldLabel htmlFor={`${componentFieldId}-profile`}>使用档案</FieldLabel>
                <Select value={createProfileId} onValueChange={changeCreateProfile} disabled={pending}>
                  <SelectTrigger id={`${componentFieldId}-profile`} className="w-full">
                    <SelectValue placeholder="选择档案">
                      {value => {
                        const selected = profiles.find(item => item.id === value)
                        return selected ? `${selected.full_name} · ${selected.student_number}` : "选择档案"
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map(item => (
                      <SelectItem key={item.id} value={item.id} onClick={() => {
                        if (item.id !== createProfileId) changeCreateProfile(item.id)
                      }}>
                        {item.full_name} · {item.student_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field>
                  <FieldLabel htmlFor={`${componentFieldId}-1`}>文件名</FieldLabel>
                  <Input id={`${componentFieldId}-1`} value={createTitle} maxLength={240} onChange={(event) => { setCustomTitle(true); setCreateTitle(event.target.value) }} />
                </Field>
            <Field>
                  <FieldLabel htmlFor={`${componentFieldId}-2`}>初始内容</FieldLabel>
                  <Select value={createSource} disabled={pending || (profiles.length > 0 && !createProfileId)} onValueChange={(value) => setCreateSource(value ?? "blank")}>
                <SelectTrigger id={`${componentFieldId}-2`} className="w-full">
                  <SelectValue>
                    {createSource === "blank" ? "空白文档" : `基于：${documents.find(item => item.id === createSource)?.title ?? "已有文档"}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">
                    <AnimatedActionIcon icon={PlusIcon} />
                    空白文档
                  </SelectItem>
                  {initialContentOptions.map((item) => (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      onClick={() => setCreateSource(item.id)}
                    >
                      {`基于：${item.title}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
                </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setCreateType(null)}>取消</Button>
            <Button
              disabled={pending || !createType || !createTitle.trim() || (profiles.length > 0 && !createProfileId)}
              onClick={() => {
                if (!createType) return
                void run(
                  () => onCreateDocument({
                    type: createType,
                    title: createTitle.trim(),
                    profileId: createProfileId,
                    sourceDocumentId: createSource === "blank" ? undefined : createSource,
                  }),
                  () => {
                    setExpanded(current => ({ ...current, [createType]: true }))
                    setCreateType(null)
                  },
                )
              }}
            >
              新建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名文档</DialogTitle>
            <DialogDescription>只修改工作台中的文件名，不改变正文和已导出的文件。</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="新文件名"
            value={renameTitle}
            maxLength={240}
            onChange={(event) => setRenameTitle(event.target.value)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setRenameTarget(null)}>取消</Button>
            <Button
              disabled={pending || !renameTarget || !renameTitle.trim()}
              onClick={() => {
                if (!renameTarget) return
                void run(
                  () => onRenameDocument(renameTarget.id, renameTitle.trim()),
                  () => setRenameTarget(null),
                )
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && !pending && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction?.kind === "purge" ? "永久删除文档？" : "移到回收站？"}</DialogTitle>
            <DialogDescription>
              {confirmAction?.kind === "purge"
                ? "将永久删除软件内的正文、草稿和历史记录，且无法恢复。已经导出的文件不会被删除。"
                : "文档会从当前列表移入回收站，之后仍可恢复。已经导出的文件不会被删除。"}
            </DialogDescription>
          </DialogHeader>
          <p className="truncate text-sm font-medium">{confirmAction?.document.title}</p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmAction(null)}>取消</Button>
            <Button
              variant="destructive"
              disabled={pending || disabled || !confirmAction}
              onClick={() => {
                if (!confirmAction || pending || disabled) return
                const action = confirmAction
                void run(
                  () => action.kind === "purge"
                    ? onPurgeDocument(action.document.id)
                    : onDeleteDocument(action.document.id),
                  () => setConfirmAction(null),
                )
              }}
            >
              {confirmAction?.kind === "purge" ? "永久删除" : "移到回收站"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
