import { useMemo, useState } from "react"
import {
  ChevronRightIcon,
  FilePlus2Icon,
  FileTextIcon,
  FolderIcon,
  Grid3X3Icon,
  ImagesIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Table2Icon,
  Trash2Icon,
} from "lucide-react"
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import type { DocumentRecord, DocumentType } from "@/types/desktop-api"
import { thesisToolOptions, type ThesisToolId } from "@/lib/thesis-tools"

const documentGroups: Array<{
  type: DocumentType
  label: string
  defaultTitle: string
}> = [
  { type: "task_book", label: "任务书", defaultTitle: "未命名任务书" },
  { type: "proposal", label: "开题报告", defaultTitle: "未命名开题报告" },
  { type: "midterm", label: "中期检查", defaultTitle: "未命名中期检查表" },
]

function ThesisToolIcon({ toolId }: { toolId: ThesisToolId }) {
  if (toolId === "general_table") return <Grid3X3Icon />
  if (toolId === "multi_figure") return <ImagesIcon />
  return <Table2Icon />
}

export type CreateDocumentRequest = {
  type: DocumentType
  title: string
  sourceDocumentId?: string
}

type ConfirmAction =
  | { kind: "recycle"; document: DocumentRecord }
  | { kind: "purge"; document: DocumentRecord }
  | null

export function NavDocuments({
  profileActive,
  toolsActive,
  inspectionActive,
  thesisToolsActive,
  activeThesisTool,
  activeDocumentId,
  documents,
  deletedDocuments,
  disabled,
  onSelectDocument,
  onSelectThesisTool,
  onCreateDocument,
  onRenameDocument,
  onDeleteDocument,
  onRestoreDocument,
  onPurgeDocument,
}: {
  profileActive: boolean
  toolsActive: boolean
  inspectionActive: boolean
  thesisToolsActive: boolean
  activeThesisTool: ThesisToolId
  activeDocumentId: string | null
  documents: DocumentRecord[]
  deletedDocuments: DocumentRecord[]
  disabled: boolean
  onSelectDocument: (documentId: string) => Promise<void>
  onSelectThesisTool: (toolId: ThesisToolId) => void
  onCreateDocument: (request: CreateDocumentRequest) => Promise<void>
  onRenameDocument: (documentId: string, title: string) => Promise<void>
  onDeleteDocument: (documentId: string) => Promise<void>
  onRestoreDocument: (documentId: string) => Promise<void>
  onPurgeDocument: (documentId: string) => Promise<void>
}) {
  const activeType = documents.find((item) => item.id === activeDocumentId)?.document_type
  const [expanded, setExpanded] = useState<Record<DocumentType, boolean>>({
    proposal: activeType === "proposal" || activeType === undefined,
    task_book: activeType === "task_book",
    midterm: activeType === "midterm",
  })
  const [thesisExpanded, setThesisExpanded] = useState(thesisToolsActive)
  const [trashExpanded, setTrashExpanded] = useState(false)
  const [createType, setCreateType] = useState<DocumentType | null>(null)
  const [createTitle, setCreateTitle] = useState("")
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

  const openCreate = (type: DocumentType, defaultTitle: string) => {
    setCreateType(type)
    setCreateTitle(defaultTitle)
    setCreateSource("blank")
    setError(null)
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
              <SidebarMenuItem key={group.type}>
                <SidebarMenuButton
                  tooltip={group.label}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpanded((current) => ({
                      ...current,
                      [group.type]: !current[group.type],
                    }))
                  }
                >
                  <ChevronRightIcon
                    className={isExpanded ? "rotate-90 transition-transform" : "transition-transform"}
                  />
                  <FolderIcon />
                  <span>{group.label}</span>
                </SidebarMenuButton>
                <SidebarMenuAction
                  aria-label={`新建${group.label}`}
                  title={`新建${group.label}`}
                  disabled={disabled}
                  showOnHover
                  onClick={(event) => {
                    event.stopPropagation()
                    openCreate(group.type, group.defaultTitle)
                  }}
                >
                  <PlusIcon />
                </SidebarMenuAction>
                {isExpanded ? (
                  <SidebarMenuSub className="mr-0 pr-0">
                    {groupDocuments.length === 0 ? (
                      <SidebarMenuSubItem>
                        <span className="block px-2 py-1 text-xs text-muted-foreground">暂无文档</span>
                      </SidebarMenuSubItem>
                    ) : null}
                    {groupDocuments.map((item) => (
                      <SidebarMenuSubItem key={item.id}>
                        <SidebarMenuSubButton
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
                          <FileTextIcon />
                          <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                        </SidebarMenuSubButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                type="button"
                                className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50"
                                aria-label={`管理文档 ${item.title}`}
                                disabled={disabled}
                              />
                            }
                          >
                            <MoreHorizontalIcon className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              onClick={() => {
                                setRenameTarget(item)
                                setRenameTitle(item.title)
                                setError(null)
                              }}
                            >
                              <PencilIcon />
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
                              <Trash2Icon />
                              移到回收站
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            )
          })}

          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="毕业论文"
              aria-expanded={thesisExpanded}
              onClick={() => setThesisExpanded((current) => !current)}
            >
              <ChevronRightIcon
                className={thesisExpanded ? "rotate-90 transition-transform" : "transition-transform"}
              />
              <FolderIcon />
              <span>毕业论文</span>
            </SidebarMenuButton>
            {thesisExpanded ? (
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
            ) : null}
          </SidebarMenuItem>

        </SidebarMenu>
      </SidebarGroup>

      <SidebarSeparator className="mx-4 mt-auto w-auto opacity-60" />
      <SidebarGroup>
        <SidebarMenu>

          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="回收站"
              aria-label={`回收站（${deletedDocuments.length} 个文档）`}
              aria-expanded={trashExpanded}
              onClick={() => setTrashExpanded((current) => !current)}
            >
              <ChevronRightIcon
                className={trashExpanded ? "rotate-90 transition-transform" : "transition-transform"}
              />
              <Trash2Icon />
              <span>回收站</span>
              {deletedDocuments.length > 0 ? (
                <span className="ml-auto text-xs text-muted-foreground">{deletedDocuments.length}</span>
              ) : null}
            </SidebarMenuButton>
            {trashExpanded ? (
              <SidebarMenuSub className="mr-0 pr-0">
                {deletedDocuments.length === 0 ? (
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
                          <button
                            type="button"
                            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50"
                            aria-label={`管理回收站文档 ${item.title}`}
                            disabled={disabled}
                          />
                        }
                      >
                        <MoreHorizontalIcon className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => void run(() => onRestoreDocument(item.id), () => undefined)}>
                          <RotateCcwIcon />
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
                          <Trash2Icon />
                          永久删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <Dialog open={createType !== null} onOpenChange={(open) => !open && setCreateType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建{documentGroups.find((item) => item.type === createType)?.label}</DialogTitle>
            <DialogDescription>新建空白文档，或复制一份已有内容后独立编辑。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-medium">
              文件名
              <Input value={createTitle} maxLength={240} onChange={(event) => setCreateTitle(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              初始内容
              <Select value={createSource} onValueChange={(value) => setCreateSource(value ?? "blank")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">
                    <FilePlus2Icon />
                    空白文档
                  </SelectItem>
                  {(createType ? groupedDocuments[createType] : []).map((item) => (
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
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setCreateType(null)}>取消</Button>
            <Button
              disabled={pending || !createType || !createTitle.trim()}
              onClick={() => {
                if (!createType) return
                void run(
                  () => onCreateDocument({
                    type: createType,
                    title: createTitle.trim(),
                    sourceDocumentId: createSource === "blank" ? undefined : createSource,
                  }),
                  () => setCreateType(null),
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

      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
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
              disabled={pending || !confirmAction}
              onClick={() => {
                if (!confirmAction) return
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
