import * as React from "react"
import {
  ClipboardCheckIcon,
  LibraryBigIcon,
  MessageCircleIcon,
  PaletteIcon,
} from "lucide-react"

import maintainerWechatQr from "@/assets/maintainer-wechat-qr.jpg"
import sztuLogo from "@/assets/sztu-logo.svg"
import {
  NavDocuments,
  type CreateDocumentRequest,
} from "@/components/workbench/nav-documents"
import { NavMain } from "@/components/workbench/nav-main"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import type { DocumentRecord } from "@/types/desktop-api"
import type { ThesisToolId } from "@/lib/thesis-tools"

export function AppSidebar({
  profileActive,
  toolsActive,
  appearanceActive,
  inspectionActive,
  generatedDocumentCount,
  thesisToolsActive,
  activeThesisTool,
  activeDocumentId,
  documents,
  deletedDocuments,
  onSelectProfile,
  onSelectTools,
  onSelectAppearance,
  onSelectInspection,
  onSelectDocument,
  onSelectThesisTool,
  onCreateDocument,
  onRenameDocument,
  onDeleteDocument,
  onRestoreDocument,
  onPurgeDocument,
  disabled,
  inspectionDisabled,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  profileActive: boolean
  toolsActive: boolean
  appearanceActive: boolean
  inspectionActive: boolean
  generatedDocumentCount: number | null
  thesisToolsActive: boolean
  activeThesisTool: ThesisToolId
  activeDocumentId: string | null
  documents: DocumentRecord[]
  deletedDocuments: DocumentRecord[]
  onSelectProfile: () => void
  onSelectTools: () => void
  onSelectAppearance: () => void
  onSelectInspection: () => void
  onSelectDocument: (documentId: string) => Promise<void>
  onSelectThesisTool: (toolId: ThesisToolId) => void
  onCreateDocument: (request: CreateDocumentRequest) => Promise<void>
  onRenameDocument: (documentId: string, title: string) => Promise<void>
  onDeleteDocument: (documentId: string) => Promise<void>
  onRestoreDocument: (documentId: string) => Promise<void>
  onPurgeDocument: (documentId: string) => Promise<void>
  disabled: boolean
  inspectionDisabled: boolean
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const [contactOpen, setContactOpen] = React.useState(false)
  const finishNavigation = (navigate: () => void) => {
    navigate()
    if (isMobile) setOpenMobile(false)
  }
  const finishAsyncNavigation = async (navigate: () => Promise<void>) => {
    await navigate()
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="items-center px-4 pt-4 pb-2">
        <div className="flex w-full items-center justify-center gap-2.5 leading-tight">
          <img
            src={sztuLogo}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-9 w-auto shrink-0 select-none object-contain"
          />
          <div className="flex min-w-0 flex-col items-start gap-0.5 text-left">
            <span className="text-base font-semibold">SZTU文档工作台</span>
            <span className="text-xs text-muted-foreground">
              让毕业论文自然成章
            </span>
          </div>
        </div>
        <SidebarSeparator className="mx-auto mt-2 w-3/4 opacity-60" />
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          profileActive={profileActive}
          disabled={disabled}
          onSelectProfile={() => finishNavigation(onSelectProfile)}
        />
        <SidebarSeparator className="mx-4 w-auto opacity-60" />
        <NavDocuments
          profileActive={profileActive}
          toolsActive={toolsActive}
          inspectionActive={inspectionActive}
          thesisToolsActive={thesisToolsActive}
          activeThesisTool={activeThesisTool}
          activeDocumentId={activeDocumentId}
          documents={documents}
          deletedDocuments={deletedDocuments}
          disabled={disabled}
          onSelectDocument={(documentId) =>
            finishAsyncNavigation(() => onSelectDocument(documentId))
          }
          onSelectThesisTool={(toolId) => finishNavigation(() => onSelectThesisTool(toolId))}
          onCreateDocument={onCreateDocument}
          onRenameDocument={onRenameDocument}
          onDeleteDocument={onDeleteDocument}
          onRestoreDocument={onRestoreDocument}
          onPurgeDocument={onPurgeDocument}
        />
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator className="mx-2 w-auto opacity-60" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="效率工具"
              isActive={toolsActive}
              disabled={disabled}
              className="pl-8"
              onClick={() => finishNavigation(onSelectTools)}
            >
              <LibraryBigIcon />
              <span>效率工具</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="主题外观"
              isActive={appearanceActive}
              className="pl-8"
              onClick={() => finishNavigation(onSelectAppearance)}
            >
              <PaletteIcon />
              <span>主题外观</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="联系作者"
              className="pl-8"
              onClick={() => setContactOpen(true)}
            >
              <MessageCircleIcon />
              <span>联系作者</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="导出记录"
              isActive={inspectionActive}
              disabled={inspectionDisabled}
              className="pl-8"
              onClick={() => finishNavigation(onSelectInspection)}
            >
              <ClipboardCheckIcon />
              <span>导出记录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {generatedDocumentCount !== null ? (
          <p className="px-2 pt-1 text-center text-xs text-muted-foreground" aria-live="polite">
            已帮助生成{" "}
            <span className="font-medium text-foreground tabular-nums">
              {generatedDocumentCount.toLocaleString("zh-CN")}
            </span>{" "}
            份过程文档
          </p>
        ) : null}
      </SidebarFooter>
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>联系作者</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <img
              src={maintainerWechatQr}
              alt="作者微信二维码"
              className="w-full max-w-56 rounded-lg border"
              draggable={false}
            />
            <div className="space-y-1.5 text-center text-xs text-muted-foreground">
              <p
                aria-label="欢迎交流 LaTeX 排版经验和提交问题反馈！"
                className="flex items-baseline justify-center gap-1"
              >
                <span>欢迎交流</span>
                <span
                  data-slot="latex-wordmark"
                  aria-hidden="true"
                  className="inline-flex items-baseline text-base leading-none font-medium tracking-tight text-foreground"
                >
                  L
                  <span className="-mx-0.5 -translate-y-0.5 text-[0.625rem]">A</span>
                  T
                  <span className="-mx-0.5 translate-y-0.5 text-xs">E</span>
                  X
                </span>
                <span>排版经验和提交问题反馈！</span>
              </p>
              <p>添加时请备注年级、学院、专业和姓名～</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
