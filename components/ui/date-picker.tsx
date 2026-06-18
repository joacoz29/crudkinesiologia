"use client"

import { useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar, type CalendarProps } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DatePickerProps {
  date: Date | undefined
  setDate: (date: Date) => void
  disabled?: CalendarProps["disabled"]
  defaultMonth?: Date
  placeholder?: string
  className?: string
}

export function DatePicker({ date, setDate, disabled, defaultMonth, placeholder = "Seleccionar fecha", className }: DatePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-[220px] justify-start text-left font-normal", !date && "text-muted-foreground", className)}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {date
            ? format(date, "dd 'de' MMMM 'de' yyyy", { locale: es })
            : <span>{placeholder}</span>
          }
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(newDate) => {
            if (newDate) {
              setDate(newDate)
              setOpen(false)
            }
          }}
          disabled={disabled}
          defaultMonth={defaultMonth}
          weekStartsOn={1}
          locale={es}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}
