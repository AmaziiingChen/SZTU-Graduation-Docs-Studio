import {
  ClipboardCheckIcon,
  FilePenLineIcon,
  FileTextIcon,
  GraduationCapIcon,
} from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { DocumentType } from "@/types/desktop-api"

const items: Array<{
  type?: DocumentType
  label: string
  icon: typeof FilePenLineIcon
  disabled?: boolean
}> = [
  { type: "proposal", label: "开题报告", icon: FilePenLineIcon },
  { type: "task_book", label: "任务书", icon: FileTextIcon },
  { type: "midterm", label: "中期检查", icon: ClipboardCheckIcon },
  { label: "毕业论文", icon: GraduationCapIcon, disabled: true },
]

export function NavDocuments({
  profileActive,
  inspectionActive,
  activeDocumentType,
  disabled,
  onSelectDocumentType,
}: {
  profileActive: boolean
  inspectionActive: boolean
  activeDocumentType: DocumentType
  disabled: boolean
  onSelectDocumentType: (documentType: DocumentType) => void
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>毕业设计文档</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.label}>
            <SidebarMenuButton
              tooltip={item.disabled ? `${item.label}尚未开放` : item.label}
              className={item.disabled ? "text-muted-foreground" : undefined}
              aria-disabled={item.disabled || disabled}
              isActive={
                !profileActive && !inspectionActive && item.type === activeDocumentType
              }
              disabled={item.disabled || disabled}
              onClick={
                item.disabled
                  ? undefined
                  : () => {
                      if (item.type) onSelectDocumentType(item.type)
                    }
              }
            >
              <item.icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
