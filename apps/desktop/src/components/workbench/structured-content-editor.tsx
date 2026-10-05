import { Field, FieldLabel } from "@/components/ui/field"
import { ThesisInsertControls } from "@/components/workbench/thesis-insert-controls"
import { hasUnescapedMathDelimiter } from "@/lib/process-math-source"
import { recoverManagedImagePreview } from "@/lib/managed-image-preview"
import { tidyFormatting } from "@/lib/editor-cleanup"
import { ArticleMediumIcon } from "@/components/ui/icons/article-medium"
import type { ThesisReferenceOption } from "@/lib/thesis-draft"
import { AlignJustifyIcon } from "@/components/ui/align-justify-icon"
import { LayoutGridIcon } from "@/components/ui/layout-grid-icon"
import { TableGridIcon } from "@/components/workbench/table-grid-icon"
import { ImageIcon } from "@/components/ui/image-icon"
import { DeleteIcon } from "@/components/ui/delete"
import { BodyToolDialog } from "@/components/workbench/body-tool-dialog"
import type { StructuredToolBlock } from "@/types/structured-content"
import { AnimatedListIcon } from "@/components/workbench/animated-list-icon"
import { PilcrowIcon as PilcrowIconAnimated } from "@/components/ui/animateicons/pilcrow"
import { ListOrderedIcon as ListOrderedIconAnimated } from "@/components/ui/animateicons/list-ordered"
import { IndentIncreaseIcon as IndentIncreaseIconAnimated } from "@/components/ui/animateicons/indent-increase"
import { IndentDecreaseIcon as IndentDecreaseIconAnimated } from "@/components/ui/animateicons/indent-decrease"
import { FeatherIcon } from "@/components/ui/feather"
import { PlusIcon } from "@/components/ui/plus"
import { UndoIcon } from "@/components/ui/undo"
import { RedoIcon } from "@/components/ui/redo"
import { LinkIcon as LinkIconAnimated } from "@/components/ui/link"
import { ItalicIcon as ItalicIconAnimated } from "@/components/ui/italic"
import { BoldIcon as BoldIconAnimated } from "@/components/ui/bold"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { useActionFeedback } from "@/hooks/use-action-feedback"
import { FileTextIcon } from "@/components/ui/file-text"
import { useReducedMotion } from "motion/react"
import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react"
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus"
import { Card } from "@/components/ui/card"
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from "@tiptap/react"
import { EditorState, TextSelection } from "@tiptap/pm/state"
import { SubscriptIcon, SuperscriptIcon } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"
import { ContentStatistics } from "@/components/workbench/content-statistics"
import { FadingScrollArea } from "@/components/workbench/fading-scroll-area"
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
  AUTHORING_GUIDANCE_COMPOSITION,
  createRestrictedEditorExtensions,
  editorShortcutLabels,
  listDepthAtSelection,
  structuredBodyFingerprint,
  structuredBodyToTiptap,
  tiptapToStructuredBody,
  structuredAuthoringFingerprint,
  structuredAuthoringToTiptap,
  tiptapToStructuredAuthoring,
  type FigureNumberingContext,
  type StructuredEditorMode,
  type StructuredFigureCatalogItem,
} from "@/lib/structured-content-editor"
import { cn } from "@/lib/utils"
import type { ParagraphInput, StructuredBodyValue } from "@/types/structured-content"
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
  equationSelected: boolean
  selectedTool: string | null
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
  chineseCharacterCount: number
  englishWordCount: number
  paragraphCount: number
  orderedListItemCount: number
  bulletListItemCount: number
  imageCount: number
  selectedCharacterCount: number
}

function documentStatistics(editor: Editor) {
  const text = editor.state.doc.textBetween(
    0,
    editor.state.doc.content.size,
    " ",
  )
  let paragraphCount = 0
  let orderedListItemCount = 0
  let bulletListItemCount = 0
  let imageCount = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" && node.textContent.trim()) {
      paragraphCount += 1
    }
    if (node.type.name === "orderedList") orderedListItemCount += node.childCount
    if (node.type.name === "bulletList") bulletListItemCount += node.childCount
    if (node.type.name === "figureBlock") imageCount += 1
  })
  const characters = Array.from(text.replace(/\s/gu, ""))
  const selection = editor.state.selection
  const selectedText = selection.empty
    ? ""
    : editor.state.doc.textBetween(selection.from, selection.to, " ")
  return {
    characterCount: characters.length,
    chineseCharacterCount: characters.filter((character) => /\p{Script=Han}/u.test(character)).length,
    englishWordCount: text.match(/[\p{Script=Latin}\p{Number}]+(?:['’-][\p{Script=Latin}\p{Number}]+)*/gu)?.length ?? 0,
    paragraphCount,
    orderedListItemCount,
    bulletListItemCount,
    imageCount,
    selectedCharacterCount: Array.from(selectedText.replace(/\s/gu, "")).length,
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
  /** Undefined keeps the existing ordinary editor; null means a deliberately removed guide. */
  guidance?: ParagraphInput | null
  onChange: (value: StructuredBodyValue, guidance?: ParagraphInput | null) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  ariaInvalid?: boolean
  footerMessage?: string
  footerMessageId?: string
  footerStatus?: ReactNode
  className?: string
  mode?: StructuredEditorMode
  selectionSnapshot?: EditorSelectionSnapshot
  restoreFocus?: boolean
  startOnNewParagraph?: boolean
  onSelectionChange?: (selection: EditorSelectionSnapshot) => void
  fillHeight?: boolean
  contentHeader?: ReactNode
  toolbarActions?: ReactNode
  contentFooter?: ReactNode
  thesisReferences?: ThesisReferenceOption[]
  enableDocumentTools?: boolean
  enableProcessEquations?: boolean
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
    equationSelected: editor.isActive("equationBlock"),
    selectedTool: editor.isActive("dataTableBlock") ? JSON.stringify(editor.getAttributes("dataTableBlock")) : selectedAttrs?.groupItems ? JSON.stringify(selectedAttrs) : null,
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
    selectedFigure: selectedAttrs && !selectedAttrs.groupItems
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
  const valid = draft.caption.trim().length > 0
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>图片排版</DialogTitle>
          <DialogDescription>题注位于图片下方，图号按所属章自动生成。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <img
            src={draft.previewUrl}
            alt={draft.alt || draft.caption || "待插入图片"}
            className="max-h-48 w-full rounded-md border object-contain"
            onError={(event) => void recoverManagedImagePreview(event.currentTarget)}
          />
          <Field>
            <FieldLabel  htmlFor="figure-caption">题注</FieldLabel>
            <Input
              id="figure-caption"
              value={draft.caption}
              onChange={(event) => setDraft({ ...draft, caption: event.target.value })}
              placeholder="输入图片标题"
            />
          </Field>
          <Field>
            <FieldLabel  htmlFor="figure-alt">图片内容说明（可选）</FieldLabel>
            <Input
              id="figure-alt"
              value={draft.alt}
              onChange={(event) => setDraft({ ...draft, alt: event.target.value })}
              placeholder="留空时自动使用题注"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel  htmlFor="figure-chapter">所属章</FieldLabel>
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
            </Field>
            <Field>
              <FieldLabel  htmlFor="figure-width">宽度（毫米）</FieldLabel>
              <Input
                id="figure-width"
                type="number"
                min={20}
                max={146}
                value={draft.widthMm}
                onChange={(event) => setDraft({ ...draft, widthMm: Number(event.target.value) })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel  htmlFor="figure-source">来源文献键（可选）</FieldLabel>
            <Input
              id="figure-source"
              value={draft.sourceCitationKey}
              onChange={(event) => setDraft({ ...draft, sourceCitationKey: event.target.value })}
              placeholder="例如：zhang2025"
            />
          </Field>
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
  guidance,
  onChange,
  disabled = false,
  placeholder = "输入正文内容",
  ariaLabel = "正文内容",
  ariaDescribedBy,
  ariaInvalid = false,
  footerMessage,
  footerMessageId,
  footerStatus,
  className,
  mode = "body",
  selectionSnapshot,
  restoreFocus = false,
  startOnNewParagraph = false,
  onSelectionChange,
  fillHeight = false,
  contentHeader,
  toolbarActions,
  contentFooter,
  enableFigures = false,
  enableDocumentTools = false,
  enableProcessEquations = false,
  thesisReferences,
  figureChapters = [{ value: 1, label: "第 1 章" }],
  figureCatalog,
  figureNumbering = {},
}: StructuredContentEditorProps) {
  const historyFeedback = useActionFeedback()
  const reducedMotion = useReducedMotion()
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const [guidanceMode] = useState(guidance !== undefined)
  const initialNewParagraphFocusRef = useRef(startOnNewParagraph || (guidanceMode && guidance != null && value.length === 0))
  const initialSelectionSnapshotRef = useRef(selectionSnapshot)
  const restoredSelectionRef = useRef("")
  const composingRef = useRef(false)
  const compositionBaselineRef = useRef("")
  const compositionFingerprintsRef = useRef(new Set<string>())
  const pendingExternalRef = useRef<StoredExternalValue | null>(null)
  const compositionTimerRef = useRef<number | null>(null)
  const pointerSelectingRef = useRef(false)
  const selectionMenuDismissedRef = useRef(false)
  const [formattingMarksVisible, setFormattingMarksVisible] = useState(false)
  const [menuScrollTarget, setMenuScrollTarget] = useState<HTMLElement | null>(null)
  const formatToolbarRef = useRef<HTMLDivElement | null>(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  const selectionMenuRef = useRef<HTMLDivElement | null>(null)
  const selectionMenuParentRef = useRef<HTMLElement | null>(null)
  const selectionMenuAnimationRef = useRef<Animation | null>(null)
  const animateSelectionMenu = useCallback((open: boolean) => {
    const element = selectionMenuRef.current
    const surface = element?.firstElementChild
    if (!element || !(surface instanceof HTMLElement)) return
    const previous = selectionMenuAnimationRef.current
    const from = previous ? { opacity: getComputedStyle(surface).opacity, transform: getComputedStyle(surface).transform } : undefined
    previous?.cancel()
    selectionMenuAnimationRef.current = null
    element.dataset.state = open ? "open" : "closed"
    element.setAttribute("aria-hidden", String(!open))
    element.inert = !open
    if (open) selectionMenuParentRef.current = element.parentElement
    if (reducedMotion || typeof surface.animate !== "function") return
    if (!open) {
      // Tiptap removes the menu before onHide. Keep the same inert element only
      // for its exit frames; positioning and selection remain owned by BubbleMenu.
      const parent = selectionMenuParentRef.current
      if (!parent?.isConnected) return
      parent.appendChild(element)
      element.style.visibility = "visible"
      element.style.opacity = "1"
    }
    const hidden = { opacity: 0, transform: "translateY(4px) scale(0.98)" }
    const visible = { opacity: 1, transform: "translateY(0) scale(1)" }
    const animation = surface.animate([from ?? (open ? hidden : visible), open ? visible : hidden], {
      duration: open ? 180 : 140,
      easing: open ? "cubic-bezier(0.22, 1, 0.36, 1)" : "ease-in",
      fill: "both",
    })
    selectionMenuAnimationRef.current = animation
    animation.onfinish = () => {
      if (selectionMenuAnimationRef.current !== animation) return
      if (!open) element.remove()
      animation.cancel()
      selectionMenuAnimationRef.current = null
    }
  }, [reducedMotion])
  const destroySelectionMenu = useCallback(() => {
    selectionMenuAnimationRef.current?.cancel()
    selectionMenuAnimationRef.current = null
    selectionMenuRef.current?.remove()
    selectionMenuParentRef.current = null
  }, [])
  const selectionMenuOptions = useMemo(() => ({
    strategy: "fixed" as const,
    placement: "top" as const,
    offset: 8,
    flip: { padding: { top: fillHeight ? toolbarHeight + 8 : 8, right: 8, bottom: 8, left: 8 }, boundary: menuScrollTarget ?? ("clippingAncestors" as const) },
    shift: { padding: { top: fillHeight ? toolbarHeight + 8 : 8, right: 8, bottom: 8, left: 8 }, boundary: menuScrollTarget ?? ("clippingAncestors" as const) },
    hide: true,
    scrollTarget: menuScrollTarget ?? window,
    onShow: () => animateSelectionMenu(true),
    onHide: () => animateSelectionMenu(false),
    onDestroy: destroySelectionMenu,
  }), [menuScrollTarget, animateSelectionMenu, destroySelectionMenu, fillHeight, toolbarHeight])
  const shouldShowSelectionMenu = useCallback<NonNullable<BubbleMenuProps["shouldShow"]>>(
    ({ editor, view, state, element, from, to }) =>
      !pointerSelectingRef.current && !selectionMenuDismissedRef.current && editor.isEditable &&
      state.selection instanceof TextSelection && !state.selection.empty &&
      Boolean(state.doc.textBetween(from, to).length) &&
      (view.hasFocus() || element.contains(document.activeElement)),
    [],
  )
  const effectiveFigureChapters = figureChapters.length
    ? figureChapters
    : [{ value: 1, label: "第 1 章" }]
  const [initialFigureNumbering] = useState(() => ({ ...figureNumbering }))
  const [initialContent] = useState(() => {
    const document = structuredAuthoringToTiptap(value, initialFigureNumbering, guidanceMode ? guidance : undefined)
    if (startOnNewParagraph && !guidanceMode) document.content?.push({ type: "paragraph" })
    return document
  })
  const [toolDraft, setToolDraft] = useState<{ block: StructuredToolBlock; from: number; to: number; editing: boolean; document: string } | null>(null)
  const [figureDraft, setFigureDraft] = useState<FigureFormValue | null>(null)
  const [extensions] = useState(() => createRestrictedEditorExtensions(mode, initialFigureNumbering, enableProcessEquations, guidanceMode))
  const editorClass =
    mode === "inline"
      ? "min-h-12 whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 outline-none [&_p]:min-h-6"
      : cn(
          fillHeight
            ? "flex-1 cursor-text focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring/50"
            : "min-h-96",
          "[&_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-selectednode]:ring-ring whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 outline-none [&>p+p]:mt-2 [&_figure]:my-4 [&_figure]:rounded-lg [&_figure]:border [&_figure]:bg-muted/20 [&_figure]:p-3 [&_figure]:text-center [&_figure_img]:mx-auto [&_figure_img]:max-h-96 [&_figure_img]:max-w-full [&_figcaption]:mt-2 [&_figcaption]:text-muted-foreground [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:min-h-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_[data-figure-reference]]:rounded [&_[data-figure-reference]]:bg-muted [&_[data-figure-reference]]:px-1",
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
        const nextValue = guidanceMode ? tiptapToStructuredAuthoring(updatedEditor.getJSON()) : { body: tiptapToStructuredBody(updatedEditor.getJSON()) }
        const fingerprint = JSON.stringify(guidanceMode ? nextValue : nextValue.body)
        if (composingRef.current || updatedEditor.view.composing) {
          compositionFingerprintsRef.current.add(fingerprint)
          return
        }
        if (guidanceMode) onChangeRef.current(nextValue.body, "guidance" in nextValue ? nextValue.guidance : null)
        else onChangeRef.current(nextValue.body)
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
  const mathDraftMessage = enableProcessEquations && hasUnescapedMathDelimiter(editor.getText())
    ? "公式尚未完成或写法不受支持：行内用 $...$，行间单独一段用 $$...$$。"
    : undefined

  const externalFingerprint = guidanceMode ? structuredAuthoringFingerprint(value, guidance ?? null) : structuredBodyFingerprint(value)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    if (!initialNewParagraphFocusRef.current) return
    if (initialSelectionSnapshotRef.current) {
      initialNewParagraphFocusRef.current = false
      return
    }
    if (disabled) return
    initialNewParagraphFocusRef.current = false
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.view.focus()
  }, [disabled, editor])

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

  const numberingFingerprint = JSON.stringify(figureNumbering)
  useEffect(() => {
    const numbering = JSON.parse(numberingFingerprint) as FigureNumberingContext
    initialFigureNumbering.startCounts = numbering.startCounts
    initialFigureNumbering.equationStartCounts = numbering.equationStartCounts
    initialFigureNumbering.knownLabels = numbering.knownLabels
    // Refresh view-only labels without replacing content, selection or undo history.
    editor.view.dispatch(editor.state.tr.setMeta("figureNumbering", true).setMeta("addToHistory", false))
  }, [editor, initialFigureNumbering, numberingFingerprint])

  useEffect(() => {
    editor.setEditable(!disabled, false)
    if (disabled) editor.commands.setMeta("selection-formatting", "hide")
  }, [disabled, editor])

  useLayoutEffect(() => {
    const toolbar = formatToolbarRef.current
    if (!fillHeight || !toolbar || typeof ResizeObserver === "undefined") return
    // The toolbar can wrap at narrow widths. Its measured height reserves the
    // scrollbar track and caret/selection clearance, not an opaque spacer.
    const observer = new ResizeObserver(() => setToolbarHeight(toolbar.getBoundingClientRect().height))
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [editor, fillHeight])

  useLayoutEffect(() => {
    setMenuScrollTarget(editor.view.dom.closest<HTMLElement>('[data-slot="scroll-area-viewport"]'))
  }, [editor, fillHeight])

  useEffect(() => {
    let frame: number | undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      selectionMenuDismissedRef.current = false
      pointerSelectingRef.current = true
      editor.commands.setMeta("selection-formatting", "hide")
    }
    const finishPointerSelection = () => {
      if (!pointerSelectingRef.current) return
      pointerSelectingRef.current = false
      frame = window.requestAnimationFrame(() => {
        if (editor.isDestroyed || !editor.isEditable || !editor.isFocused || selectionMenuDismissedRef.current) return
        const { selection, doc } = editor.state
        if (!(selection instanceof TextSelection) || selection.empty || !doc.textBetween(selection.from, selection.to).length) return
        // Tiptap owns placement, visibility, scrolling and viewport collision handling.
        editor.commands.setMeta("selection-formatting", "show")
        editor.commands.setMeta("selection-formatting", "updatePosition")
      })
    }
    const dismissMenu = () => {
      selectionMenuDismissedRef.current = true
      pointerSelectingRef.current = false
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      if (!editor.isDestroyed) editor.commands.setMeta("selection-formatting", "hide")
    }
    const handleOutsideInteraction = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (editor.view.dom.contains(target)) {
        if (event.type === "focusin") selectionMenuDismissedRef.current = false
        return
      }
      if (selectionMenuRef.current?.contains(target)) return
      dismissMenu()
    }
    editor.view.dom.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("pointerdown", handleOutsideInteraction, true)
    document.addEventListener("focusin", handleOutsideInteraction, true)
    window.addEventListener("blur", dismissMenu)
    window.addEventListener("pointerup", finishPointerSelection)
    window.addEventListener("pointercancel", finishPointerSelection)
    return () => {
      editor.view.dom.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("pointerdown", handleOutsideInteraction, true)
      document.removeEventListener("focusin", handleOutsideInteraction, true)
      window.removeEventListener("blur", dismissMenu)
      window.removeEventListener("pointerup", finishPointerSelection)
      window.removeEventListener("pointercancel", finishPointerSelection)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      pointerSelectingRef.current = false
    }
  }, [editor])

  useEffect(() => {
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        scrollThreshold: fillHeight ? { top: toolbarHeight + 8, right: 0, bottom: 0, left: 0 } : 0,
        scrollMargin: fillHeight ? { top: toolbarHeight + 12, right: 5, bottom: 5, left: 5 } : 5,
        attributes: {
          ...editor.options.editorProps.attributes,
          "aria-label": ariaLabel,
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
          "aria-invalid": String(ariaInvalid),
          "aria-disabled": String(disabled),
        },
      },
    })
  }, [ariaDescribedBy, ariaInvalid, ariaLabel, disabled, editor, fillHeight, toolbarHeight])

  useEffect(() => {
    const currentFingerprint = JSON.stringify(
      guidanceMode ? tiptapToStructuredAuthoring(editor.getJSON()) : tiptapToStructuredBody(editor.getJSON()),
    )
    if (currentFingerprint === externalFingerprint) {
      pendingExternalRef.current = null
      return
    }

    const external: StoredExternalValue = {
      document: structuredAuthoringToTiptap(value, initialFigureNumbering, guidanceMode ? guidance : undefined),
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
  }, [editor, externalFingerprint, guidance, guidanceMode, initialFigureNumbering, value])

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

  function tidyContent() {
    if (disabled || composingRef.current || editor.view.composing) return
    const result = tidyFormatting(editor)
    const target = result.selected ? "选区" : "当前栏目"
    const changes = [
      result.citations.changed ? `${result.citations.changed} 处引用上标` : "",
      result.punctuation.changed ? `${result.punctuation.changed} 处中文标点` : "",
      result.lists.groups ? `${result.lists.groups} 组列表` : "",
    ].filter(Boolean)
    const description = [
      result.citations.skipped || result.punctuation.skipped || result.lists.skipped
        ? "已保留受保护或含义不明确的内容。" : "",
      result.citations.limited ? "部分段落的格式片段已达上限，请分段后重试。" : "",
      result.lists.limited ? "列表超过 100 项，请分成较短的列表后重试。" : "",
    ].filter(Boolean).join(" ")
    toast.info(changes.length
      ? `已整理${target}中的${changes.join("、")}，可一次撤销。`
      : `${target}中没有需要整理的排版问题。`, description ? { description } : undefined)
  }

  const toggleFormatting = (
    format: "bold" | "italic" | "subscript" | "superscript",
  ) => {
    if (format === "bold") editor.chain().focus().toggleBold().run()
    if (format === "italic") editor.chain().focus().toggleItalic().run()
    if (format === "subscript") {
      const chain = editor.chain().focus()
      if (toolbarState.subscript) chain.unsetSubscript().run()
      else chain.unsetSuperscript().setSubscript().run()
    }
    if (format === "superscript") {
      const chain = editor.chain().focus()
      if (toolbarState.superscript) chain.unsetSuperscript().run()
      else chain.unsetSubscript().setSuperscript().run()
    }
  }

  const changeFormatting = (nextValues: string[]) => {
    const currentValues = new Set(formattingValues)
    const next = new Set(nextValues)
    const changed = ["bold", "italic", "subscript", "superscript"].find(
      (format) => currentValues.has(format) !== next.has(format),
    )
    if (!changed) return
    toggleFormatting(changed as "bold" | "italic" | "subscript" | "superscript")
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

  const openTool = (kind?: "grid" | "three_line" | "figure_group") => {
    const { from, to } = editor.state.selection
    const selectedNode = editor.state.doc.nodeAt(from)
    const selected = !kind && selectedNode ? tiptapToStructuredBody({ type: "doc", content: [selectedNode.toJSON()] })[0] : null
    const block: StructuredToolBlock = selected && typeof selected !== "string" && (selected.type === "data_table" || selected.type === "figure_group") ? selected : kind === "figure_group"
      ? { type: "figure_group", id: `fig-${crypto.randomUUID()}`, chapter: effectiveFigureChapters[0].value, columns: 2, items: [], caption: "" }
      : { type: "data_table", style: kind === "three_line" ? "three_line" : "grid", columns: [{ header: "项目" }, { header: "结果" }], rows: [{ cells: ["", ""] }] }
    setToolDraft({ block, from, to, editing: !kind, document: JSON.stringify(editor.getJSON()) })
  }

  const saveTool = (block: StructuredToolBlock) => {
    if (!toolDraft || disabled) return
    if (JSON.stringify(editor.getJSON()) !== toolDraft.document) {
      toast.error("正文已发生变化，请关闭弹窗后重新选择插入位置。")
      return
    }
    const node = structuredBodyToTiptap([block]).content![0]
    const success = editor.chain().focus().insertContentAt({ from: toolDraft.from, to: toolDraft.to }, toolDraft.editing ? node : [node, { type: "paragraph" }]).run()
    if (!success) { toast.error("此处无法插入图表，请将光标移到正文段落。") ; return }
    setToolDraft(null)
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
        alt: "",
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
      alt: next.alt.trim() || next.caption.trim(),
      previewUrl: next.previewUrl || `sztu-asset://asset/${encodeURIComponent(next.path.split(/[\\/]/).at(-1) ?? "")}`,
      caption: next.caption,
      captionText: next.caption,
      label: toolbarState.selectedFigure ? editor.getAttributes("figureBlock").label : "图（待编号）",
    }
    if (toolbarState.selectedFigure) {
      editor.chain().focus().updateAttributes("figureBlock", attrs).run()
    } else {
      const inserted = editor.chain().focus().insertContent([
        { type: "figureBlock", attrs },
        { type: "paragraph" },
      ]).run()
      if (inserted) {
        const figure = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("figure[data-figure-id]"))
          .find((element) => element.dataset.figureId === next.figureId)
        // View-only feedback: no animation attributes enter the saved document.
        figure?.animate?.([
          { opacity: reducedMotion ? 1 : 0.65, outline: "2px solid var(--ring)", outlineOffset: "2px" },
          { opacity: 1, outline: "2px solid transparent", outlineOffset: "2px" },
        ], { duration: reducedMotion ? 0 : 1100, easing: "ease-out" })
      }
    }
    setFigureDraft(null)
  }

  const formatToolbar = (
    <div
      ref={formatToolbarRef}
      data-slot="editor-format-toolbar"
      role="toolbar"
      aria-label={`${ariaLabel}格式工具栏`}
      className={cn(
        "z-10 flex shrink-0 items-center border-b bg-background supports-backdrop-filter:bg-background/70 supports-backdrop-filter:backdrop-blur-md",
        fillHeight ? "sticky top-0" : "relative rounded-t-lg",
        toolbarActions
          ? "h-(--header-height) gap-2 px-4"
          : "flex-wrap gap-1 px-1.5",
        !toolbarActions && (thesisReferences ? "min-h-(--header-height) py-1" : "h-(--header-height)"),
      )}
    >
      <div
        data-slot="editor-format-controls"
        className={toolbarActions
          ? "flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [&>*]:shrink-0"
          : "contents"}
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
          <AnimatedActionIcon icon={BoldIconAnimated} />
        </ToolbarToggle>
        <ToolbarToggle
          value="italic"
          label="斜体"
          shortcut={shortcuts.italic}
          disabled={disabled}
        >
          <AnimatedActionIcon icon={ItalicIconAnimated} />
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

      {mode !== "inline" ? (
        <ToolbarButton
          label="一键整理排版"
          variant="ghost"
          disabled={disabled}
          unavailableReason="整理选区或当前栏目的引用上标、中文标点和列表，可一次撤销。"
          onMouseDown={(event) => event.preventDefault()}
          onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" })}
          onClick={tidyContent}
        >
          <AnimatedActionIcon icon={ArticleMediumIcon} disabled={disabled} className="pointer-events-none" />
        </ToolbarButton>
      ) : null}

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
              <AnimatedActionIcon icon={ListOrderedIconAnimated} />
            </ToolbarToggle>
            <ToolbarToggle value="bulletList" label="无序列表" disabled={disabled}>
              <AnimatedActionIcon icon={AnimatedListIcon} />
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
            <AnimatedActionIcon icon={IndentDecreaseIconAnimated} />
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
            <AnimatedActionIcon icon={IndentIncreaseIconAnimated} />
          </ToolbarButton>
        </>
      ) : null}

      {thesisReferences && <ThesisInsertControls editor={editor} references={thesisReferences} disabled={disabled} equationSelected={toolbarState.equationSelected} />}
      {mode === "body" && enableDocumentTools ? <>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label="插入图表" disabled={disabled || toolbarState.listDepth > 0} />}>
                <AnimatedActionIcon icon={PlusIcon} />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>插入图表{toolbarState.listDepth > 0 ? "：请先将光标移出列表" : ""}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => void importFigure()}><AnimatedActionIcon icon={ImageIcon} />单张图片</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openTool("three_line")}><AnimatedActionIcon icon={AlignJustifyIcon} />三线表</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openTool("grid")}><AnimatedActionIcon icon={TableGridIcon} />表格</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openTool("figure_group")}><AnimatedActionIcon icon={LayoutGridIcon} />多图排版</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {toolbarState.selectedTool ? <>
          <ToolbarButton label="编辑图表" variant="ghost" disabled={disabled} onClick={() => openTool()}><AnimatedActionIcon icon={FeatherIcon} /></ToolbarButton>
          <ToolbarButton label="删除图表" variant="ghost" disabled={disabled} onClick={() => editor.chain().focus().deleteSelection().run()}><AnimatedActionIcon icon={DeleteIcon} /></ToolbarButton>
        </> : null}
      </> : null}

      {mode === "body" && enableFigures ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
          {!enableDocumentTools || toolbarState.selectedFigure ? <ToolbarButton
            label={toolbarState.selectedFigure ? "编辑图片" : "插入图片"}
            variant="ghost"
            disabled={disabled}
            onClick={() => void importFigure()}
          >
            <AnimatedActionIcon icon={toolbarState.selectedFigure ? FeatherIcon : PlusIcon} />
          </ToolbarButton> : null}
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
              <AnimatedActionIcon icon={LinkIconAnimated} />
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

      {mode !== "inline" ? (
        <>
          <Separator
            orientation="vertical"
            className="mx-1 h-5 data-vertical:self-center"
          />
          <ToolbarButton
            label="显示格式标记"
            aria-pressed={formattingMarksVisible}
            variant={formattingMarksVisible ? "secondary" : "ghost"}
            disabled={disabled}
            onClick={() => setFormattingMarksVisible((visible) => !visible)}
          >
            <AnimatedActionIcon icon={PilcrowIconAnimated} />
          </ToolbarButton>
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
        onClick={() => {
          if (editor.chain().focus().undo().run()) historyFeedback.complete("undo")
        }}
      >
        <AnimatedActionIcon key={historyFeedback.completed.undo || 0} icon={UndoIcon} playOnMount={Boolean(historyFeedback.completed.undo)} />
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
        onClick={() => {
          if (editor.chain().focus().redo().run()) historyFeedback.complete("redo")
        }}
      >
        <AnimatedActionIcon key={historyFeedback.completed.redo || 0} icon={RedoIcon} playOnMount={Boolean(historyFeedback.completed.redo)} />
      </ToolbarButton>

      </div>
      {toolbarActions ? (
        <div data-slot="document-toolbar-actions" className="flex shrink-0 items-center gap-2">
          {toolbarActions}
        </div>
      ) : null}
    </div>
  )

  return (
    <TooltipProvider>
      <div
        data-formatting-marks={formattingMarksVisible ? "true" : "false"}
        onErrorCapture={(event) => {
          if (event.target instanceof HTMLImageElement) void recoverManagedImagePreview(event.target)
        }}
        className={cn(
          fillHeight
            ? "flex h-full min-h-0 min-w-0 flex-col bg-background"
            : "overflow-clip rounded-lg border border-input bg-background transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 motion-reduce:transition-none",
          disabled && "opacity-75",
          className,
        )}
        onCompositionStartCapture={() => {
          composingRef.current = true
          pendingExternalRef.current = null
          if (guidanceMode) editor.view.dispatch(editor.state.tr.setMeta(AUTHORING_GUIDANCE_COMPOSITION, true))
          compositionBaselineRef.current = JSON.stringify(
            guidanceMode ? tiptapToStructuredAuthoring(editor.getJSON()) : tiptapToStructuredBody(editor.getJSON()),
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
            const pending = pendingExternalRef.current
            pendingExternalRef.current = null
            if (editor.isDestroyed) return
            // Normalize an emptied guide only after the IME has committed. Keep
            // callbacks suspended while that normalization joins the edit.
            if (guidanceMode) editor.view.dispatch(editor.state.tr.setMeta(AUTHORING_GUIDANCE_COMPOSITION, false))
            composingRef.current = false
            const currentValue = guidanceMode ? tiptapToStructuredAuthoring(editor.getJSON()) : { body: tiptapToStructuredBody(editor.getJSON()) }
            const currentFingerprint = JSON.stringify(guidanceMode ? currentValue : currentValue.body)
            if (
              pending &&
              pending.fingerprint !== currentFingerprint &&
              pending.fingerprint !== compositionBaselineRef.current &&
              !compositionFingerprintsRef.current.has(pending.fingerprint)
            ) {
              replaceExternalContent(editor, pending.document)
              return
            }
            if (guidanceMode) onChangeRef.current(currentValue.body, "guidance" in currentValue ? currentValue.guidance : null)
            else onChangeRef.current(currentValue.body)
          }, 0)
        }}
      >
        {!fillHeight && formatToolbar}

        <BubbleMenu
          ref={selectionMenuRef}
          editor={editor}
          pluginKey="selection-formatting"
          appendTo={() => editor.view.dom.closest<HTMLElement>('[role="dialog"]') ?? document.body}
          updateDelay={0}
          resizeDelay={0}
          options={selectionMenuOptions}
          shouldShow={shouldShowSelectionMenu}
          className="z-50"
          role="toolbar"
          aria-label="选中文字格式工具栏"
          onMouseDown={event => event.preventDefault()}
        >
          <Card className="p-1">
            <ToggleGroup multiple size="sm" spacing={0} value={formattingValues} disabled={disabled} onValueChange={changeFormatting}>
              <ToolbarToggle value="bold" label="选区粗体"><AnimatedActionIcon icon={BoldIconAnimated} /></ToolbarToggle>
              <ToolbarToggle value="italic" label="选区斜体"><AnimatedActionIcon icon={ItalicIconAnimated} /></ToolbarToggle>
              <ToolbarToggle value="subscript" label="选区下标"><SubscriptIcon /></ToolbarToggle>
              <ToolbarToggle value="superscript" label="选区上标"><SuperscriptIcon /></ToolbarToggle>
            </ToggleGroup>
          </Card>
        </BubbleMenu>

        {fillHeight ? (
          <>
            <FadingScrollArea
              fadeMode="overlay"
              wrapperClassName="min-h-0 flex-1"
              style={{ "--editor-toolbar-height": toolbarHeight ? `${toolbarHeight}px` : "var(--header-height)" } as CSSProperties}
              // Sticky toolbar shares the scroll viewport so text actually passes
              // behind its blur. The official scrollbar track starts below it.
              // Flex sizing makes the actual contenteditable fill the viewport,
              // so blank-space clicks and the cursor stay native to the editor.
              className="h-full min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:flex [&_[data-slot=scroll-area-viewport]]:flex-col [&_[data-slot=scroll-area-viewport]]:scroll-pt-(--editor-toolbar-height) [&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:top-(--editor-toolbar-height)! [&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:h-auto!"
            >
              <div className="relative flex flex-1 flex-col">
                {formatToolbar}
                {contentHeader}
                <div className="relative flex flex-1 flex-col">
                  {toolbarState.empty ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <AnimatedActionIcon icon={FileTextIcon} interactionTarget={editor.view.dom} disabled={disabled} />
                      {placeholder}
                    </span>
                  ) : null}
                  <EditorContent className="flex flex-1 flex-col" editor={editor} />
                </div>
              </div>
            </FadingScrollArea>
            {contentFooter}
            <div data-slot="editor-status-footer" className="flex min-h-8 shrink-0 items-center justify-between gap-3 px-3 py-1">
              {footerMessage || mathDraftMessage ? (
                <p
                  id={footerMessageId}
                  className="min-w-0 truncate text-xs text-destructive"
                  title={footerMessage || mathDraftMessage}
                >
                  {footerMessage || mathDraftMessage}
                </p>
              ) : null}
              <ContentStatistics
                className="ml-auto"
                summary={
                  toolbarState.selectedCharacterCount > 0
                    ? `已选 ${toolbarState.selectedCharacterCount} 字`
                    : `字数 ${toolbarState.characterCount} · 段落 ${toolbarState.paragraphCount}`
                }
                details={[
                  { label: "总字数", value: toolbarState.characterCount },
                  { label: "中文字符", value: toolbarState.chineseCharacterCount },
                  { label: "英文单词", value: toolbarState.englishWordCount },
                  { label: "段落", value: toolbarState.paragraphCount },
                  { label: "有序列表项", value: toolbarState.orderedListItemCount },
                  { label: "无序列表项", value: toolbarState.bulletListItemCount },
                  { label: "图片", value: toolbarState.imageCount },
                ]}
              />
              {footerStatus}
            </div>
          </>
        ) : (
          <div className="relative">
            {toolbarState.empty ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-2 text-sm text-muted-foreground"
              >
                <AnimatedActionIcon icon={FileTextIcon} interactionTarget={editor.view.dom} disabled={disabled} />
                    {placeholder}
              </span>
            ) : null}
            <EditorContent editor={editor} />
            {mathDraftMessage ? <p role="status" className="px-3 py-1 text-xs text-destructive">{mathDraftMessage}</p> : null}
          </div>
        )}
      </div>
      {toolDraft ? <BodyToolDialog value={toolDraft.block} chapters={effectiveFigureChapters} onCancel={() => { setToolDraft(null); editor.commands.focus() }} onSave={saveTool} /> : null}
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
