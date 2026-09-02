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

export function AppSidebar({
  profileActive,
  toolsActive,
  appearanceActive,
  inspectionActive,
  activeDocumentId,
  documents,
  deletedDocuments,
  onSelectProfile,
  onSelectTools,
  onSelectAppearance,
  onSelectInspection,
  onSelectDocument,
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
  activeDocumentId: string | null
  documents: DocumentRecord[]
  deletedDocuments: DocumentRecord[]
  onSelectProfile: () => void
  onSelectTools: () => void
  onSelectAppearance: () => void
  onSelectInspection: () => void
  onSelectDocument: (documentId: string) => Promise<void>
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
          activeDocumentId={activeDocumentId}
          documents={documents}
          deletedDocuments={deletedDocuments}
          disabled={disabled}
          onSelectDocument={(documentId) =>
            finishAsyncNavigation(() => onSelectDocument(documentId))
          }
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
              tooltip="工具箱"
              isActive={toolsActive}
              disabled={disabled}
              onClick={() => finishNavigation(onSelectTools)}
            >
              <LibraryBigIcon />
              <span>工具箱</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="外观"
              isActive={appearanceActive}
              onClick={() => finishNavigation(onSelectAppearance)}
            >
              <PaletteIcon />
              <span>外观</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="联系维护者"
              onClick={() => setContactOpen(true)}
            >
              <MessageCircleIcon />
              <span>联系维护者</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="检查与导出"
              isActive={inspectionActive}
              disabled={inspectionDisabled}
              onClick={() => finishNavigation(onSelectInspection)}
            >
              <ClipboardCheckIcon />
              <span>检查与导出</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>联系维护者</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <img
              src={maintainerWechatQr}
              alt="维护者微信二维码"
              className="w-full max-w-56 rounded-lg border"
              draggable={false}
            />
            <p className="text-center text-xs text-muted-foreground">
              添加时请备注年级、学院、专业和姓名。
              <br />
              软件不会自动上传文档或问题内容。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
