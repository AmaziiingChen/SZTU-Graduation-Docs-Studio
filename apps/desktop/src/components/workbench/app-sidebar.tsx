import * as React from "react"
import {
  BookOpenIcon,
  ClipboardCheckIcon,
  MessageCircleIcon,
} from "lucide-react"

import maintainerWechatQr from "@/assets/maintainer-wechat-qr.jpg"
import {
  NavDocuments,
  type CreateDocumentRequest,
} from "@/components/workbench/nav-documents"
import { NavMain } from "@/components/workbench/nav-main"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  useSidebar,
} from "@/components/ui/sidebar"
import type { DocumentRecord } from "@/types/desktop-api"

export function AppSidebar({
  profileActive,
  toolsActive,
  inspectionActive,
  activeDocumentId,
  documents,
  deletedDocuments,
  onSelectProfile,
  onSelectTools,
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
  inspectionActive: boolean
  activeDocumentId: string | null
  documents: DocumentRecord[]
  deletedDocuments: DocumentRecord[]
  onSelectProfile: () => void
  onSelectTools: () => void
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
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              tooltip="SZTU文档工作台"
            >
              <BookOpenIcon className="size-5!" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate text-base font-semibold">SZTU文档工作台</span>
                <span className="truncate text-xs text-muted-foreground">
                  让毕业论文自然成章
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          profileActive={profileActive}
          toolsActive={toolsActive}
          disabled={disabled}
          onSelectProfile={() => finishNavigation(onSelectProfile)}
          onSelectTools={() => finishNavigation(onSelectTools)}
        />
        <NavDocuments
          profileActive={profileActive}
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
        <SidebarMenu>
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
            <DialogDescription>
              使用过程中遇到问题，可以扫码添加维护者微信。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <img
              src={maintainerWechatQr}
              alt="维护者微信二维码"
              className="w-full max-w-56 rounded-lg border"
              draggable={false}
            />
            <p className="text-center text-xs text-muted-foreground">
              添加时请备注年级、学院、专业和姓名。软件不会自动上传文档或问题内容。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
