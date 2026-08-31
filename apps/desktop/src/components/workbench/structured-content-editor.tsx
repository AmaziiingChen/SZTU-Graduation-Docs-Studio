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
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  Redo2Icon,
  SubscriptIcon,
  SuperscriptIcon,
  Undo2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
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
  type StructuredEditorMode,
} from "@/lib/structured-content-editor"
import { cn } from "@/lib/utils"
import type { StructuredBodyValue } from "@/types/structured-content"

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
}

export type EditorSelectionSnapshot = {
  anchor: number
  head: number
}

function selectToolbarState(editor: Editor): ToolbarState {
  const listDepth = listDepthAtSelection(editor)
  const inList = listDepth > 0
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
  }
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
}: StructuredContentEditorProps) {
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const restoredSelectionRef = useRef("")
  const composingRef = useRef(false)
  const compositionBaselineRef = useRef("")
  const compositionFingerprintsRef = useRef(new Set<string>())
  const pendingExternalRef = useRef<StoredExternalValue | null>(null)
  const compositionTimerRef = useRef<number | null>(null)
  const [initialContent] = useState(() => structuredBodyToTiptap(value))
  const [extensions] = useState(() => createRestrictedEditorExtensions(mode))
  const editorClass =
    mode === "inline"
      ? "min-h-12 whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 outline-none [&_p]:min-h-6"
      : cn(
          fillHeight ? "min-h-full" : "min-h-96",
          "whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 outline-none [&>p+p]:mt-2 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:min-h-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
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
    selector: ({ editor: currentEditor }) => selectToolbarState(currentEditor),
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
      document: structuredBodyToTiptap(value),
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
  }, [editor, externalFingerprint, value])

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

  const status = mode === "paragraphs"
    ? "多段内容"
    : toolbarState.orderedList
    ? `有序列表 · 第 ${toolbarState.listDepth} 级`
    : toolbarState.bulletList
      ? `无序列表 · 第 ${toolbarState.listDepth} 级`
      : "正文"

  return (
    <TooltipProvider>
      <div
        className={cn(
          "overflow-clip rounded-lg border border-input bg-background transition-all focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          fillHeight && "flex h-full min-h-0 flex-col",
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
          className="z-10 flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/30 p-1.5"
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

          {mode === "inline" ? null : (
            <Badge variant="outline" className="ml-auto">
              {status}
            </Badge>
          )}
        </div>

        {fillHeight ? (
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
    </TooltipProvider>
  )
}
