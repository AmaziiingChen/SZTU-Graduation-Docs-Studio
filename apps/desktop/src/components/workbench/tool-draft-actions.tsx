import { useState } from "react"
import { EraserIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SaveStatusBadge, type SaveState } from "@/components/workbench/save-status-badge"

export function ToolDraftActions({
  saveState,
  draftName,
  onClear,
}: {
  saveState: SaveState
  draftName: string
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <SaveStatusBadge state={saveState} />
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <EraserIcon />
          清空草稿
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空{draftName}草稿？</DialogTitle>
            <DialogDescription>
              当前输入和本机保存的草稿都会被清除，此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
            >
              清空草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
