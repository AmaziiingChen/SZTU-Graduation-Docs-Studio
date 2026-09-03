import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from "@tiptap/react"
import { EditorState, TextSelection } from "@tiptap/pm/state"
import {
  BoldIcon,
  ImagePlusIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  Redo2Icon,
  SubscriptIcon,
  SuperscriptIcon,
  Undo2Icon,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  MAX_STRUCTURED_LIST_DEPTH,
  createRestrictedEditorExtensions,
  editorShortcutLabels,
  listDepthAtSelection,
  structuredBodyFingerprint,
  structuredBodyToTiptap,
  tiptapToStructuredBody,
  type FigureNumberingContext,
  type StructuredEditorMode,
  type StructuredFigureCatalogItem,
} from "@/lib/structured-content-editor"
import { cn } from "@/lib/utils"
import type { StructuredBodyValue } from "@/types/structured-content"
import type { ImageAssetImportResult, SztuDesktopApi } from "@/types/desktop-api"

type StoredExternalValue = {
  document: JSONContent
  fingerprint: string
}

function replaceExternalContent(editor: Editor, document: JSONContent) {
  editor.commands.setContent(document, {
    emitUpdate: false,
    errorOnInvalidContent: true,
  })
  const nextState = editor.state
  editor.view.updateState(
    EditorState.create({
      schema: editor.schema,
      doc: nextState.doc,
      selection: nextState.selection,
      storedMarks: nextState.storedMarks,
      plugins: nextState.plugins,
    }),
  )
}

type ToolbarState = {
  bold: boolean
  italic: boolean
  subscript: boolean
  superscript: boolean
  orderedList: boolean
  bulletList: boolean
  listDepth: number
  canIndent: boolean
  canOutdent: boolean
  canUndo: boolean
  canRedo: boolean
  empty: boolean
  figures: Array<{ id: string; label: string; caption: string }>
  selectedFigure: FigureFormValue | null
  characterCount: number
  paragraphCount: number
}

function documentStatistics(editor: Editor) {
  const text = editor.state.doc.textBetween(
    0,
    editor.state.doc.content.size,
    " ",
  )
  let paragraphCount = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" && node.textContent.trim()) {
      paragraphCount += 1
    }
  })
  return {
    characterCount: Array.from(text.replace(/\s/gu, "")).length,
    paragraphCount,
  }
}

export type FigureChapterOption = { value: number; label: string }

type FigureFormValue = {
  figureId: string
  path: string
  previewUrl: string
  alt: string
  caption: string
  chapter: number
  widthMm: number
  sourceCitationKey: string
}

export type StructuredContentEditorProps = {
  value: StructuredBodyValue
  onChange: (value: StructuredBodyValue) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  ariaInvalid?: boolean
  className?: string
  mode?: StructuredEditorMode
  selectionSnapshot?: EditorSelectionSnapshot
  restoreFocus?: boolean
  onSelectionChange?: (selection: EditorSelectionSnapshot) => void
  fillHeight?: boolean
  enableFigures?: boolean
  figureChapters?: FigureChapterOption[]
  figureCatalog?: StructuredFigureCatalogItem[]
  figureNumbering?: FigureNumberingContext
}

export type EditorSelectionSnapshot = {
  anchor: number
  head: number
}

function selectToolbarState(
  editor: Editor,
  documentFigureCatalog?: StructuredFigureCatalogItem[],
): ToolbarState {
  const statistics = documentStatistics(editor)
  const listDepth = listDepthAtSelection(editor)
  const inList = listDepth > 0
  const figures: ToolbarState["figures"] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "figureBlock") return
    figures.push({
      id: String(node.attrs.figureId),
      label: String(node.attrs.label),
      caption: String(node.attrs.captionText ?? ""),
    })
  })
  const selectedAttrs = editor.isActive("figureBlock")
    ? editor.getAttributes("figureBlock")
    : null
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    subscript: editor.isActive("subscript"),
    superscript: editor.isActive("superscript"),
    orderedList: editor.isActive("orderedList"),
    bulletList: editor.isActive("bulletList"),
    listDepth,
    canIndent:
      inList &&
      listDepth < MAX_STRUCTURED_LIST_DEPTH &&
      editor.can().sinkListItem("listItem"),
    canOutdent: inList && editor.can().liftListItem("listItem"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    empty: editor.isEmpty,
    figures: documentFigureCatalog ?? figures,
    selectedFigure: selectedAttrs
      ? {
          figureId: String(selectedAttrs.figureId),
          path: String(selectedAttrs.path),
          previewUrl: String(selectedAttrs.previewUrl ?? ""),
          alt: String(selectedAttrs.alt),
          caption: String(selectedAttrs.captionText ?? ""),
          chapter: Number(selectedAttrs.chapter ?? 1),
          widthMm: Number(selectedAttrs.widthMm ?? 120),
          sourceCitationKey: String(selectedAttrs.sourceCitationKey ?? ""),
        }
      : null,
    ...statistics,
  }
}

function FigureDialog({
  value,
  chapters,
  onCancel,
  onSave,
}: {
  value: FigureFormValue
  chapters: FigureChapterOption[]
  onCancel: () => void
  onSave: (value: FigureFormValue) => void
}) {
  const [draft, setDraft] = useState(value)
  const valid = draft.alt.trim().length > 0 && draft.caption.trim().length > 0
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>图片排版</DialogTitle>
          <DialogDescription>题注位于图片下方，图号按所属章自动生成。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="figure-caption">题注</label>
            <Input
              id="figure-caption"
              value={draft.caption}
              onChange={(event) => setDraft({ ...draft, caption: event.target.value })}
              placeholder="输入图片标题"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="figure-alt">替代文字</label>
            <Input
              id="figure-alt"
              value={draft.alt}
              onChange={(event) => setDraft({ ...draft, alt: event.target.value })}
              placeholder="说明图片内容"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="figure-chapter">所属章</label>
              <Select
                value={String(draft.chapter)}
                onValueChange={(value) => {
                  if (value !== null) setDraft({ ...draft, chapter: Number(value) })
                }}
              >
                <SelectTrigger id="figure-chapter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((chapter) => (
                    <SelectItem key={chapter.value} value={String(chapter.value)}>
                      {chapter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="figure-width">宽度（毫米）</label>
              <Input
                id="figure-width"
                type="number"
                min={20}
                max={146}
                value={draft.widthMm}
                onChange={(event) => setDraft({ ...draft, widthMm: Number(event.target.value) })}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="figure-source">来源文献键（可选）</label>
            <Input
              id="figure-source"
              value={draft.sourceCitationKey}
              onChange={(event) => setDraft({ ...draft, sourceCitationKey: event.target.value })}
              placeholder="例如：zhang2025"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
          <Button type="button" disabled={!valid || draft.widthMm < 20 || draft.widthMm > 146} onClick={() => onSave(draft)}>
            保存图片
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ToolbarButton({
  label,
  shortcut,
  unavailableReason,
  disabled,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "aria-label"> & {
  label: string
  shortcut?: readonly string[]
  unavailableReason?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          type="button"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        className={unavailableReason ? "flex-col items-start gap-1" : undefined}
      >
        <span className="inline-flex items-center gap-1.5">
          <span>{label}</span>
          {shortcut ? (
            <KbdGroup>
              {shortcut.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          ) : null}
        </span>
        {unavailableReason ? (
          <span className="text-background/70">{unavailableReason}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ToolbarToggle({
  value,
  label,
  shortcut,
  disabled,
  children,
}: {
  value: string
  label: string
  shortcut?: readonly string[]
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToggleGroupItem
            value={value}
            aria-label={label}
            disabled={disabled}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
        {shortcut ? (
          <KbdGroup>
            {shortcut.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function currentEditorShortcutLabels() {
  const userAgentPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform
  const platform = userAgentPlatform || navigator.platform || navigator.userAgent
  return editorShortcutLabels(platform)
}

export function StructuredContentEditor({
  value,
  onChange,
  disabled = false,
  placeholder = "输入正文内容",
  ariaLabel = "正文内容",
  ariaDescribedBy,
  ariaInvalid = false,
  className,
  mode = "body",
  selectionSnapshot,
  restoreFocus = false,
  onSelectionChange,
  fillHeight = false,
  enableFigures = false,
  figureChapters = [{ value: 1, label: "第 1 章" }],
  figureCatalog,
  figureNumbering = {},
}: StructuredContentEditorProps) {
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const restoredSelectionRef = useRef("")
  const composingRef = useRef(false)
  const compositionBaselineRef = useRef("")
  const compositionFingerprintsRef = useRef(new Set<string>())
  const pendingExternalRef = useRef<StoredExternalValue | null>(null)
  const compositionTimerRef = useRef<number | null>(null)
  const effectiveFigureChapters = figureChapters.length
    ? figureChapters
    : [{ value: 1, label: "第 1 章" }]
  const [initialFigureNumbering] = useState(() => figureNumbering)
  const [initialContent] = useState(() => structuredBodyToTiptap(value, initialFigureNumbering))
  const [figureDraft, setFigureDraft] = useState<FigureFormValue | null>(null)
  const [extensions] = useState(() => createRestrictedEditorExtensions(mode, initialFigureNumbering))
  const editorClass =
    mode === "inline"
      ? "min-h-12 whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 outline-none [&_p]:min-h-6"
      : cn(
          fillHeight
            ? "min-h-full focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring/50"
            : "min-h-96",
          "whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 outline-none [&>p+p]:mt-2 [&_figure]:my-4 [&_figure]:rounded-lg [&_figure]:border [&_figure]:bg-muted/20 [&_figure]:p-3 [&_figure]:text-center [&_figure_img]:mx-auto [&_figure_img]:max-h-96 [&_figure_img]:max-w-full [&_figcaption]:mt-2 [&_figcaption]:text-muted-foreground [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:min-h-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_[data-figure-reference]]:rounded [&_[data-figure-reference]]:bg-muted [&_[data-figure-reference]]:px-1",
        )

  const editor = useEditor(
    {
      extensions,
      content: initialContent,
      editable: !disabled,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": ariaLabel,
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
          "aria-invalid": String(ariaInvalid),
          "aria-disabled": String(disabled),
          "aria-multiline": String(mode !== "inline"),
          class: editorClass,
        },
      },
      onUpdate: ({ editor: updatedEditor }) => {
        const nextValue = tiptapToStructuredBody(updatedEditor.getJSON())
        const fingerprint = JSON.stringify(nextValue)
        if (composingRef.current || updatedEditor.view.composing) {
          compositionFingerprintsRef.current.add(fingerprint)
          return
        }
        onChangeRef.current(nextValue)
      },
      onSelectionUpdate: ({ editor: updatedEditor }) => {
        const { anchor, head } = updatedEditor.state.selection
        onSelectionChangeRef.current?.({ anchor, head })
      },
    },
    [],
  )

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => selectToolbarState(currentEditor, figureCatalog),
  })

  const externalFingerprint = structuredBodyFingerprint(value)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    if (!selectionSnapshot) return
    const selectionKey = `${selectionSnapshot.anchor}:${selectionSnapshot.head}:${restoreFocus}`
    if (restoredSelectionRef.current === selectionKey) return
    const maximum = editor.state.doc.content.size
    const anchor = Math.max(0, Math.min(selectionSnapshot.anchor, maximum))
    const head = Math.max(0, Math.min(selectionSnapshot.head, maximum))
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.between(
          editor.state.doc.resolve(anchor),
          editor.state.doc.resolve(head),
        ),
      ),
    )
    if (restoreFocus) editor.commands.focus()
    restoredSelectionRef.current = selectionKey
  }, [editor, restoreFocus, selectionSnapshot])

  useEffect(() => {
    editor.setEditable(!disabled, false)
  }, [disabled, editor])

  useEffect(() => {
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...editor.options.editorProps.attributes,
          "aria-label": ariaLabel,
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
          "aria-invalid": String(ariaInvalid),
          "aria-disabled": String(disabled),
        },
      },
    })
  }, [ariaDescribedBy, ariaInvalid, ariaLabel, disabled, editor])

  useEffect(() => {
    const currentFingerprint = JSON.stringify(
      tiptapToStructuredBody(editor.getJSON()),
    )
    if (currentFingerprint === externalFingerprint) {
      pendingExternalRef.current = null
      return
    }

    const external: StoredExternalValue = {
      document: structuredBodyToTiptap(value, initialFigureNumbering),
      fingerprint: externalFingerprint,
    }
    if (composingRef.current || editor.view.composing) {
      if (
        externalFingerprint !== compositionBaselineRef.current &&
        !compositionFingerprintsRef.current.has(externalFingerprint)
      ) {
        pendingExternalRef.current = external
      }
      return
    }

    pendingExternalRef.current = null
    replaceExternalContent(editor, external.document)
  }, [editor, externalFingerprint, initialFigureNumbering, value])

  useEffect(
    () => () => {
      if (compositionTimerRef.current !== null) {
        window.clearTimeout(compositionTimerRef.current)
      }
    },
    [],
  )

  const formattingValues = [
    ...(toolbarState.bold ? ["bold"] : []),
    ...(toolbarState.italic ? ["italic"] : []),
    ...(toolbarState.subscript ? ["subscript"] : []),
    ...(toolbarState.superscript ? ["superscript"] : []),
  ]
  const listValues = toolbarState.orderedList
    ? ["orderedList"]
    : toolbarState.bulletList
      ? ["bulletList"]
      : []
  const shortcuts = currentEditorShortcutLabels()

  const changeFormatting = (nextValues: string[]) => {
    const currentValues = new Set(formattingValues)
    const next = new Set(nextValues)
    const changed = ["bold", "italic", "subscript", "superscript"].find(
      (format) => currentValues.has(format) !== next.has(format),
    )
    if (!changed) return

    if (changed === "bold") editor.chain().focus().toggleBold().run()
    if (changed === "italic") editor.chain().focus().toggleItalic().run()
    if (changed === "subscript") {
      const chain = editor.chain().focus()
      if (toolbarState.subscript) chain.unsetSubscript().run()
      else chain.unsetSuperscript().setSubscript().run()
    }
    if (changed === "superscript") {
      const chain = editor.chain().focus()
      if (toolbarState.superscript) chain.unsetSuperscript().run()
      else chain.unsetSubscript().setSuperscript().run()
    }
  }

  const changeList = (nextValues: string[]) => {
    const next = nextValues[0]
    if (next === "orderedList") {
      editor.chain().focus().toggleOrderedList().run()
      return
    }
    if (next === "bulletList") {
      editor.chain().focus().toggleBulletList().run()
      return
    }
    if (toolbarState.orderedList) editor.chain().focus().toggleOrderedList().run()
    if (toolbarState.bulletList) editor.chain().focus().toggleBulletList().run()
  }

  const importFigure = async () => {
    if (toolbarState.selectedFigure) {
      setFigureDraft(toolbarState.selectedFigure)
      return
    }
    const api = (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
    if (!api) {
      toast.error("当前环境不能选择本机图片。")
      return
    }
    try {
      const asset: ImageAssetImportResult | null = await api.importImageAsset()
      if (!asset) return
      const defaultTitle = asset.originalName.replace(/\.[^.]+$/, "")
      setFigureDraft({
        figureId: `fig-${crypto.randomUUID()}`,
        path: asset.path,
        previewUrl: asset.previewUrl,
        alt: defaultTitle,
        caption: defaultTitle,
        chapter: effectiveFigureChapters[0].value,
        widthMm: 120,
        sourceCitationKey: "",
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片导入失败。")
    }
  }

  const saveFigure = (next: FigureFormValue) => {
    const attrs = {
      ...next,
      previewUrl: next.previewUrl || `sztu-asset://asset/${encodeURIComponent(next.path.split(/[\\/]/).at(-1) ?? "")}`,
      caption: next.caption,
      captionText: next.caption,
      label: toolbarState.selectedFigure ? editor.getAttributes("figureBlock").label : "图（待编号）",
    }
    if (toolbarState.selectedFigure) {
      editor.chain().focus().updateAttributes("figureBlock", attrs).run()
    } else {
      editor.chain().focus().insertContent([
        { type: "figureBlock", attrs },
        { type: "paragraph" },
      ]).run()
    }
    setFigureDraft(null)
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          fillHeight
            ? "flex h-full min-h-0 min-w-0 flex-col bg-background"
            : "overflow-clip rounded-lg border border-input bg-background transition-all focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          disabled && "opacity-75",
          className,
        )}
        onCompositionStartCapture={() => {
          composingRef.current = true
          pendingExternalRef.current = null
          compositionBaselineRef.current = JSON.stringify(
            tiptapToStructuredBody(editor.getJSON()),
          )
          compositionFingerprintsRef.current = new Set([
            compositionBaselineRef.current,
          ])
        }}
        onCompositionEndCapture={() => {
          if (compositionTimerRef.current !== null) {
            window.clearTimeout(compositionTimerRef.current)
          }
          compositionTimerRef.current = window.setTimeout(() => {
            compositionTimerRef.current = null
            composingRef.current = false
            const pending = pendingExternalRef.current
            pendingExternalRef.current = null
            if (editor.isDestroyed) return

            const currentValue = tiptapToStructuredBody(editor.getJSON())
            const currentFingerprint = JSON.stringify(currentValue)
            if (
              pending &&
              pending.fingerprint !== currentFingerprint &&
              pending.fingerprint !== compositionBaselineRef.current &&
              !compositionFingerprintsRef.current.has(pending.fingerprint)
            ) {
              replaceExternalContent(editor, pending.document)
              return
            }
            onChangeRef.current(currentValue)
          }, 0)
        }}
      >
        <div
          role="toolbar"
          aria-label={`${ariaLabel}格式工具栏`}
          className="z-10 flex h-(--header-height) shrink-0 flex-wrap items-center gap-1 border-b bg-muted/30 px-1.5"
        >
          <ToggleGroup
            multiple
            size="sm"
            value={formattingValues}
            disabled={disabled}
            onValueChange={changeFormatting}
          >
            <ToolbarToggle
              value="bold"
              label="粗体"
              shortcut={shortcuts.bold}
              disabled={disabled}
            >
              <BoldIcon />
            </ToolbarToggle>
            <ToolbarToggle
              value="italic"
              label="斜体"
              shortcut={shortcuts.italic}
              disabled={disabled}
            >
              <ItalicIcon />
            </ToolbarToggle>
            <ToolbarToggle
              value="subscript"
              label="下标"
              shortcut={shortcuts.subscript}
              disabled={disabled}
            >
              <SubscriptIcon />
            </ToolbarToggle>
            <ToolbarToggle
              value="superscript"
              label="上标"
              shortcut={shortcuts.superscript}
              disabled={disabled}
            >
              <SuperscriptIcon />
            </ToolbarToggle>
          </ToggleGroup>

          {mode === "body" ? (
            <>
              <Separator
                orientation="vertical"
                className="mx-1 h-5 data-vertical:self-center"
              />

              <ToggleGroup
                size="sm"
                value={listValues}
                disabled={disabled}
                onValueChange={changeList}
              >
                <ToolbarToggle value="orderedList" label="有序列表" disabled={disabled}>
                  <ListOrderedIcon />
                </ToolbarToggle>
                <ToolbarToggle value="bulletList" label="无序列表" disabled={disabled}>
                  <ListIcon />
                </ToolbarToggle>
              </ToggleGroup>

              <ToolbarButton
                label="减少缩进"
                shortcut={shortcuts.outdent}
                unavailableReason={
                  disabled
                    ? "当前为只读状态"
                    : toolbarState.canOutdent
                      ? undefined
                      : toolbarState.listDepth === 0
                        ? "请先将光标放入列表"
                        : "当前已是一级列表"
                }
                variant="ghost"
                disabled={disabled || !toolbarState.canOutdent}
                onClick={() => editor.chain().focus().liftListItem("listItem").run()}
              >
                <IndentDecreaseIcon />
              </ToolbarButton>
              <ToolbarButton
                label="增加缩进"
                shortcut={shortcuts.indent}
                unavailableReason={
                  disabled
                    ? "当前为只读状态"
                    : toolbarState.canIndent
                      ? undefined
                      : toolbarState.listDepth === 0
                        ? "请先将光标放入列表"
                        : toolbarState.listDepth >= MAX_STRUCTURED_LIST_DEPTH
                          ? `最多支持 ${MAX_STRUCTURED_LIST_DEPTH} 级列表`
                          : "需要先有上一条同级列表项"
                }
                variant="ghost"
                disabled={disabled || !toolbarState.canIndent}
                onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
              >
                <IndentIncreaseIcon />
              </ToolbarButton>
            </>
          ) : null}

          {mode === "body" && enableFigures ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
              <ToolbarButton
                label={toolbarState.selectedFigure ? "编辑图片" : "插入图片"}
                variant="ghost"
                disabled={disabled}
                onClick={() => void importFigure()}
              >
                <ImagePlusIcon />
              </ToolbarButton>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="引用图片"
                      disabled={disabled || toolbarState.figures.length === 0}
                    />
                  }
                >
                  <LinkIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {toolbarState.figures.map((figure) => (
                    <DropdownMenuItem
                      key={figure.id}
                      onClick={() => editor.chain().focus().insertContent([
                        {
                          type: "figureReference",
                          attrs: { figureId: figure.id, label: figure.label },
                        },
                        { type: "text", text: " " },
                      ]).run()}
                    >
                      {figure.label}{figure.caption ? ` ${figure.caption}` : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}

          <Separator
            orientation="vertical"
            className="mx-1 h-5 data-vertical:self-center"
          />

          <ToolbarButton
            label="撤销"
            shortcut={shortcuts.undo}
            unavailableReason={
              disabled
                ? "当前为只读状态"
                : toolbarState.canUndo
                  ? undefined
                  : "暂无可撤销的操作"
            }
            variant="ghost"
            disabled={disabled || !toolbarState.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2Icon />
          </ToolbarButton>
          <ToolbarButton
            label="重做"
            shortcut={shortcuts.redo}
            unavailableReason={
              disabled
                ? "当前为只读状态"
                : toolbarState.canRedo
                  ? undefined
                  : "暂无可重做的操作"
            }
            variant="ghost"
            disabled={disabled || !toolbarState.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2Icon />
          </ToolbarButton>

        </div>

        {fillHeight ? (
          <>
            <ScrollArea className="min-h-0 flex-1">
              <div className="relative min-h-full">
                {toolbarState.empty ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-3 left-3 text-sm text-muted-foreground"
                  >
                    {placeholder}
                  </span>
                ) : null}
                <EditorContent className="min-h-full" editor={editor} />
              </div>
            </ScrollArea>
            <div
              role="status"
              aria-live="polite"
              className="flex shrink-0 justify-end gap-3 border-t px-3 py-1.5 text-xs tabular-nums text-muted-foreground"
            >
              <span>字数 {toolbarState.characterCount}</span>
              <span>段落 {toolbarState.paragraphCount}</span>
            </div>
          </>
        ) : (
          <div className="relative">
            {toolbarState.empty ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-3 left-3 text-sm text-muted-foreground"
              >
                {placeholder}
              </span>
            ) : null}
            <EditorContent editor={editor} />
          </div>
        )}
      </div>
      {figureDraft ? (
        <FigureDialog
          key={`${figureDraft.figureId}-${figureDraft.path}`}
          value={figureDraft}
          chapters={effectiveFigureChapters}
          onCancel={() => setFigureDraft(null)}
          onSave={saveFigure}
        />
      ) : null}
    </TooltipProvider>
  )
}
