import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type ContentStatisticItem = {
  label: string
  value: number | string
}

export function ContentStatistics({
  summary,
  details,
  className,
}: {
  summary: string
  details: ContentStatisticItem[]
  className?: string
}) {
  return (
    <div className={cn("flex shrink-0 justify-end", className)}>
      <span role="status" aria-live="polite" className="sr-only">
        {summary}
      </span>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="font-normal tabular-nums text-muted-foreground"
              aria-label={`查看内容统计：${summary}`}
            />
          }
        >
          {summary}
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-52">
          <PopoverHeader>
            <PopoverTitle>内容统计</PopoverTitle>
          </PopoverHeader>
          <dl className="grid gap-1.5">
            {details.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-4 text-xs"
              >
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="font-medium tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  )
}
