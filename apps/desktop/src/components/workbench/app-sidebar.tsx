import type * as React from "react"
import { BookOpenIcon, ClipboardCheckIcon } from "lucide-react"

import {
  NavDocuments,
  type CreateDocumentRequest,
} from "@/components/workbench/nav-documents"
import { NavMain } from "@/components/workbench/nav-main"
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
  inspectionActive,
  activeDocumentId,
  documents,
  deletedDocuments,
  onSelectProfile,
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
  inspectionActive: boolean
  activeDocumentId: string | null
  documents: DocumentRecord[]
  deletedDocuments: DocumentRecord[]
  onSelectProfile: () => void
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
              tooltip="毕业设计文档工作台"
            >
              <BookOpenIcon className="size-5!" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate text-base font-semibold">SZTU 文档工作台</span>
                <span className="truncate text-xs text-muted-foreground">
                  本地毕业设计文档工具
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          profileActive={profileActive}
          disabled={disabled}
          onSelectProfile={() => finishNavigation(onSelectProfile)}
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
    </Sidebar>
  )
}
