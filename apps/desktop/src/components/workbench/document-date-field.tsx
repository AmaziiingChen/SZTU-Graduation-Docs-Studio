import { Field, FieldContent, FieldError, FieldLabel } from "@/components/ui/field"
import { useState } from "react"
import { format, isValid, parseISO } from "date-fns"
import { zhCN } from "date-fns/locale"

import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { CalendarDaysIcon } from "@/components/ui/calendar-days"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function parseDocumentDate(value: string, minYear?: number, maxYear?: number): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const parsed = parseISO(value)
  if (!isValid(parsed) || format(parsed, "yyyy-MM-dd") !== value) return undefined
  if (minYear !== undefined && parsed.getFullYear() < minYear) return undefined
  if (maxYear !== undefined && parsed.getFullYear() > maxYear) return undefined
  return parsed
}

export function DocumentDateField({
  id,
  label,
  value,
  onChange,
  error,
  disabled = false,
  labelVisible = false,
  placeholder,
  minYear,
  maxYear,
  allowedRange,
  orientation = "vertical",
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
  labelVisible?: boolean
  placeholder: string
  minYear?: number
  maxYear?: number
  allowedRange?: { startDate: string; endDate: string }
  orientation?: "vertical" | "horizontal"
}) {
  const [open, setOpen] = useState(false)
  const selectedDate = parseDocumentDate(value, minYear, maxYear)
  const startDate = allowedRange ? parseDocumentDate(allowedRange.startDate) : undefined
  const endDate = allowedRange ? parseDocumentDate(allowedRange.endDate) : undefined
  const selectedInRange = selectedDate && (!startDate || selectedDate >= startDate) && (!endDate || selectedDate <= endDate)

  return (
    <Field orientation={orientation} data-invalid={Boolean(error)} data-disabled={disabled} className={orientation === "horizontal" ? "grid grid-cols-2 items-center gap-3" : undefined}>
      <FieldLabel className={orientation === "horizontal" ? "min-h-8 items-center font-normal text-muted-foreground" : labelVisible ? undefined : "sr-only"} htmlFor={id}>
        {label}
      </FieldLabel>
      <FieldContent className="min-w-0">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                id={id}
                type="button"
                variant="outline"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                data-empty={!selectedDate}
                disabled={disabled}
                className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
              />
            }
          >
            <AnimatedActionIcon icon={CalendarDaysIcon} />
            {selectedDate ? format(selectedDate, "yyyy年M月d日", { locale: zhCN }) : <span>{placeholder}</span>}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedInRange ? selectedDate : undefined}
              defaultMonth={selectedInRange ? selectedDate : startDate}
              startMonth={startDate ?? (minYear === undefined ? undefined : new Date(minYear, 0))}
              endMonth={endDate ?? (maxYear === undefined ? undefined : new Date(maxYear, 11))}
              disabled={startDate && endDate ? [{ before: startDate }, { after: endDate }] : undefined}
              locale={zhCN}
              onSelect={(date) => {
                if (!date) {
                  onChange("")
                  setOpen(false)
                  return
                }
                if (minYear !== undefined && date.getFullYear() < minYear) return
                if (maxYear !== undefined && date.getFullYear() > maxYear) return
                if (startDate && date < startDate) return
                if (endDate && date > endDate) return
                onChange(format(date, "yyyy-MM-dd"))
                setOpen(false)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="m-2"
              disabled={!value}
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
            >
              清空日期
            </Button>
          </PopoverContent>
        </Popover>
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </FieldContent>
    </Field>
  )
}
