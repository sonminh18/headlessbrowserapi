import { useState, useRef, useEffect } from 'react'

// Preset date ranges
const PRESETS = [
  { label: 'Today', getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: 'Yesterday', getValue: () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) }
  }},
  { label: 'Last 7 days', getValue: () => {
    const from = new Date()
    from.setDate(from.getDate() - 7)
    return { from: startOfDay(from), to: endOfDay(new Date()) }
  }},
  { label: 'Last 30 days', getValue: () => {
    const from = new Date()
    from.setDate(from.getDate() - 30)
    return { from: startOfDay(from), to: endOfDay(new Date()) }
  }},
  { label: 'This month', getValue: () => {
    const now = new Date()
    return { 
      from: new Date(now.getFullYear(), now.getMonth(), 1), 
      to: endOfDay(new Date()) 
    }
  }},
  { label: 'Last month', getValue: () => {
    const now = new Date()
    return { 
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1), 
      to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) 
    }
  }}
]

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function formatDate(date) {
  if (!date) return ''
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function toInputDate(date) {
  if (!date) return ''
  const d = new Date(date)
  return d.toISOString().split('T')[0]
}

/**
 * Date range picker component
 * @param {object} props
 * @param {Date} props.from - Start date
 * @param {Date} props.to - End date
 * @param {Function} props.onChange - Callback when dates change ({ from, to })
 * @param {string} props.className - Additional CSS classes
 */
export default function DateRangePicker({ from, to, onChange, className = '' }) {
  const [isOpen, setIsOpen] = useState(false)
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)
  const dropdownRef = useRef(null)

  // Sync local state with props
  useEffect(() => {
    setLocalFrom(from)
    setLocalTo(to)
  }, [from, to])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleApply = () => {
    onChange({ from: localFrom, to: localTo })
    setIsOpen(false)
  }

  const handleClear = () => {
    setLocalFrom(null)
    setLocalTo(null)
    onChange({ from: null, to: null })
    setIsOpen(false)
  }

  const handlePreset = (preset) => {
    const { from: presetFrom, to: presetTo } = preset.getValue()
    setLocalFrom(presetFrom)
    setLocalTo(presetTo)
    onChange({ from: presetFrom, to: presetTo })
    setIsOpen(false)
  }

  // Display text
  const displayText = from && to
    ? `${formatDate(from)} - ${formatDate(to)}`
    : from
      ? `From ${formatDate(from)}`
      : to
        ? `To ${formatDate(to)}`
        : 'All time'

  const hasSelection = from || to

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input flex items-center justify-between gap-2 min-w-[180px] cursor-pointer"
      >
        <div className="flex items-center gap-2 truncate">
          <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="truncate text-sm">{displayText}</span>
        </div>
        {hasSelection && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleClear()
            }}
            className="text-surface-400 hover:text-surface-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-80 bg-surface-800 border border-surface-700 rounded-lg shadow-xl">
          <div className="flex">
            {/* Presets */}
            <div className="w-32 border-r border-surface-700 p-2">
              <p className="text-xs text-surface-500 uppercase tracking-wide px-2 mb-2">Quick select</p>
              <div className="space-y-0.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handlePreset(preset)}
                    className="w-full text-left px-2 py-1.5 text-sm text-surface-300 hover:bg-surface-700 hover:text-surface-100 rounded"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom date inputs */}
            <div className="flex-1 p-3 space-y-3">
              <div>
                <label className="block text-xs text-surface-500 mb-1">From</label>
                <input
                  type="date"
                  value={toInputDate(localFrom)}
                  onChange={(e) => setLocalFrom(e.target.value ? new Date(e.target.value) : null)}
                  className="input text-sm py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs text-surface-500 mb-1">To</label>
                <input
                  type="date"
                  value={toInputDate(localTo)}
                  onChange={(e) => setLocalTo(e.target.value ? endOfDay(new Date(e.target.value)) : null)}
                  className="input text-sm py-1.5"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleClear}
                  className="btn-ghost text-sm flex-1"
                >
                  Clear
                </button>
                <button
                  onClick={handleApply}
                  className="btn-primary text-sm flex-1"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

