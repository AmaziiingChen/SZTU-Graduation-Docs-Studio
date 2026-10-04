import { Field, FieldContent, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"

export function FormField<TField extends string>({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  error,
  disabled,
  suggestions,
  options,
  orientation = "vertical",
}: {
  id: TField
  label: string
  value: string
  onChange: (field: TField, value: string) => void
  placeholder?: string
  maxLength?: number
  error?: string
  disabled?: boolean
  suggestions?: readonly string[]
  options?: readonly { value: string; label: string }[]
  orientation?: "vertical" | "horizontal"
}) {
  const uniqueSuggestions = suggestions
    ? Array.from(new Set(suggestions))
    : []
  const emitValue = (nextValue: string) => {
    const boundedValue =
      typeof maxLength === "number" ? nextValue.slice(0, maxLength) : nextValue
    if (value === boundedValue) return
    onChange(id, boundedValue)
  }
  return (
    <Field orientation={orientation} data-invalid={Boolean(error)} data-disabled={disabled} className={orientation === "horizontal" ? "grid grid-cols-2 items-center gap-3" : undefined}>
      <FieldLabel className={orientation === "horizontal" ? "min-h-8 items-center font-normal text-muted-foreground" : undefined} htmlFor={id}>
        {label}
      </FieldLabel>
      <FieldContent className="min-w-0">
        {options ? (
          <Select value={value || null} disabled={disabled} onValueChange={next => { if (next !== null) emitValue(next) }}>
            <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}>
              <SelectValue placeholder={placeholder}>{options.find(option => option.value === value)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : uniqueSuggestions.length > 0 ? (
          <Combobox
            items={uniqueSuggestions}
            filter={null}
            inputValue={value}
            value={uniqueSuggestions.includes(value) ? value : null}
            onInputValueChange={(nextValue, eventDetails) => {
              if (eventDetails.reason === "input-change") {
                emitValue(nextValue)
              }
            }}
            onValueChange={(nextValue) => {
              if (nextValue !== null) emitValue(nextValue)
            }}
          >
            <ComboboxInput
              id={id}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              placeholder={placeholder}
              disabled={disabled}
              maxLength={maxLength}
            />
            <ComboboxContent>
              <ComboboxEmpty>
                无匹配项，可直接输入自定义内容
              </ComboboxEmpty>
              <ComboboxList>
                {(suggestion: string) => (
                  <ComboboxItem key={suggestion} value={suggestion}>
                    {suggestion}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        ) : (
          <Input
            id={id}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            onChange={(event) => emitValue(event.target.value)}
          />
        )}
        {error ? (
          <FieldError id={`${id}-error`}>
            {error}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}
