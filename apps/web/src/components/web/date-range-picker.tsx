import { addDays, format, getDate, getMonth, getYear, isValid } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'

import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { cn } from '@/lib/utils'

export interface DateRangePickerProps {
  /** The current date range value */
  value?: DateRange
  /** Callback when date range changes */
  onChange?: (date: DateRange | undefined) => void
  /** Placeholder text when no date is selected */
  placeholder?: string
  /** Format for displaying the date */
  dateFormat?: string
  /** Additional className for the container */
  className?: string
  /** Number of months to display in the calendar */
  numberOfMonths?: number
  /** Disable the date picker */
  disabled?: boolean
  /** Allow keyboard input */
  allowKeyboardInput?: boolean
  /** Apply changes only when popover closes */
  applyOnClose?: boolean
}

export default function DateRangePicker({
  value,
  onChange,
  placeholder = '选择日期范围',
  dateFormat = 'yyyy/MM/dd',
  className,
  disabled = false,
  allowKeyboardInput = true,
  applyOnClose = true,
}: DateRangePickerProps) {
  // Use internal state if no value/onChange provided (uncontrolled mode)
  const [internalDate, setInternalDate] = useState<DateRange | undefined>({
    from: addDays(new Date(), -30), // One month ago
    to: new Date(), // Today
  })

  // State for date components
  const [fromYear, setFromYear] = useState<string>('')
  const [fromMonth, setFromMonth] = useState<string>('')
  const [fromDay, setFromDay] = useState<string>('')
  const [toYear, setToYear] = useState<string>('')
  const [toMonth, setToMonth] = useState<string>('')
  const [toDay, setToDay] = useState<string>('')

  const [isOpen, setIsOpen] = useState(false)

  // Temporary state for date selection while popover is open
  const [tempDate, setTempDate] = useState<DateRange | undefined>(undefined)

  // Determine if component is controlled or uncontrolled
  const isControlled = value !== undefined && onChange !== undefined
  const date = isControlled ? value : internalDate

  // Initialize temporary date when popover opens
  useEffect(() => {
    if (isOpen) {
      setTempDate(date)
    }
  }, [isOpen, date])

  // Generate years, months, and days options
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: 10 }, (_, i) => (currentYear - 9 + i).toString())
  }, [])

  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'))
  }, [])

  const getDaysInMonth = (year: string, month: string) => {
    if (!year || !month) return Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0'))
    const daysInMonth = new Date(Number.parseInt(year), Number.parseInt(month), 0).getDate()
    return Array.from({ length: daysInMonth }, (_, i) => (i + 1).toString().padStart(2, '0'))
  }

  const fromDays = useMemo(() => {
    return getDaysInMonth(fromYear, fromMonth)
  }, [fromYear, fromMonth])

  const toDays = useMemo(() => {
    return getDaysInMonth(toYear, toMonth)
  }, [toYear, toMonth])

  // Handle date changes
  const handleDateChange = (newDate: DateRange | undefined) => {
    if (applyOnClose) {
      // Store in temporary state if popover is open
      setTempDate(newDate)
    } else {
      // Apply immediately if not using applyOnClose mode
      if (isControlled) {
        onChange?.(newDate)
      } else {
        setInternalDate(newDate)
      }
    }
  }

  // Apply changes when popover closes
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)

    // When closing the popover, apply the temporary date if in applyOnClose mode
    if (!open && applyOnClose && tempDate !== date) {
      if (isControlled) {
        // 结束日期不可小于开始日期
        if (
          tempDate &&
          tempDate?.from &&
          tempDate?.to &&
          tempDate.from.setHours(0, 0, 0, 0) > tempDate.to?.setHours(0, 0, 0, 0)
        ) {
          return
        }
        onChange?.(tempDate)
      } else {
        setInternalDate(tempDate)
      }
    }
  }

  // Get the date to display in the calendar and inputs
  const displayDate = isOpen && applyOnClose ? tempDate : date

  // Update select inputs when date changes
  useEffect(() => {
    const currentDate = displayDate

    if (currentDate?.from) {
      setFromYear(getYear(currentDate.from).toString())
      setFromMonth((getMonth(currentDate.from) + 1).toString().padStart(2, '0'))
      setFromDay(getDate(currentDate.from).toString().padStart(2, '0'))
    } else {
      setFromYear('')
      setFromMonth('')
      setFromDay('')
    }

    if (currentDate?.to) {
      setToYear(getYear(currentDate.to).toString())
      setToMonth((getMonth(currentDate.to) + 1).toString().padStart(2, '0'))
      setToDay(getDate(currentDate.to).toString().padStart(2, '0'))
    } else {
      setToYear('')
      setToMonth('')
      setToDay('')
    }
  }, [displayDate])

  // Handle from date select changes
  const handleFromYearChange = (value: string) => {
    setFromYear(value)
    updateFromDate(value, fromMonth, fromDay)
  }

  const handleFromMonthChange = (value: string) => {
    setFromMonth(value)
    updateFromDate(fromYear, value, fromDay)
  }

  const handleFromDayChange = (value: string) => {
    setFromDay(value)
    updateFromDate(fromYear, fromMonth, value)
  }

  const updateFromDate = (year: string, month: string, day: string) => {
    if (!year || !month || !day) return

    try {
      const newDate = new Date(Number.parseInt(year), Number.parseInt(month) - 1, Number.parseInt(day))
      if (isValid(newDate)) {
        const newRange: DateRange = {
          from: newDate,
          to: displayDate?.to,
        }
        handleDateChange(newRange)
      }
    } catch {
      // Invalid date, do nothing
    }
  }

  // Handle to date select changes
  const handleToYearChange = (value: string) => {
    setToYear(value)
    updateToDate(value, toMonth, toDay)
  }

  const handleToMonthChange = (value: string) => {
    setToMonth(value)
    updateToDate(toYear, value, toDay)
  }

  const handleToDayChange = (value: string) => {
    setToDay(value)
    updateToDate(toYear, toMonth, value)
  }

  const updateToDate = (year: string, month: string, day: string) => {
    if (!year || !month || !day) return

    try {
      const newDate = new Date(Number.parseInt(year), Number.parseInt(month) - 1, Number.parseInt(day))
      if (isValid(newDate)) {
        const newRange: DateRange = {
          from: displayDate?.from,
          to: newDate,
        }
        handleDateChange(newRange)
      }
    } catch {
      // Invalid date, do nothing
    }
  }

  return (
    <div className={cn('grid w-60 gap-2', className)}>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            id='date'
            variant={'outline'}
            className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}
            disabled={disabled}
          >
            <CalendarIcon className='mr-2 h-4 w-4' />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, dateFormat)} - {format(date.to, dateFormat)}
                </>
              ) : (
                format(date.from, dateFormat)
              )
            ) : (
              <span>{placeholder}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto p-0' align='start'>
          {allowKeyboardInput && (
            <div className='flex flex-row gap-4 p-3 pb-1'>
              <div className='mb-3 w-full'>
                <span className='mb-1 block text-muted-foreground text-xs'>开始日期</span>
                <div className='grid grid-cols-10 gap-2'>
                  <Select value={fromYear} onValueChange={handleFromYearChange} disabled={disabled}>
                    <SelectTrigger className='col-span-4 w-full'>
                      <SelectValue placeholder='年' />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={`from-year-${year}`} value={year}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={fromMonth} onValueChange={handleFromMonthChange} disabled={disabled}>
                    <SelectTrigger className='col-span-3 w-full'>
                      <SelectValue placeholder='月' />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((month) => (
                        <SelectItem key={`from-month-${month}`} value={month}>
                          {month}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={fromDay} onValueChange={handleFromDayChange} disabled={disabled}>
                    <SelectTrigger className='col-span-3 w-full'>
                      <SelectValue placeholder='日' />
                    </SelectTrigger>
                    <SelectContent>
                      {fromDays.map((day) => (
                        <SelectItem key={`from-day-${day}`} value={day}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className='mb-3 w-full'>
                <span className='mb-1 block text-muted-foreground text-xs'>结束日期</span>
                <div className='grid grid-cols-10 gap-2'>
                  <Select value={toYear} onValueChange={handleToYearChange} disabled={disabled}>
                    <SelectTrigger className='col-span-4 w-full'>
                      <SelectValue placeholder='年' />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={`to-year-${year}`} value={year}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={toMonth} onValueChange={handleToMonthChange} disabled={disabled}>
                    <SelectTrigger className='col-span-3 w-full'>
                      <SelectValue placeholder='月' />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((month) => (
                        <SelectItem key={`to-month-${month}`} value={month}>
                          {month}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={toDay} onValueChange={handleToDayChange} disabled={disabled}>
                    <SelectTrigger className='col-span-3 w-full'>
                      <SelectValue placeholder='日' />
                    </SelectTrigger>
                    <SelectContent>
                      {toDays.map((day) => (
                        <SelectItem key={`to-day-${day}`} value={day}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
