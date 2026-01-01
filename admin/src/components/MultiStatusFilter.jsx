import { useState, useRef, useEffect } from 'react'

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending', color: 'bg-amber-500/20 text-amber-400' },
  { value: 'uploading', label: 'Uploading', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'synced', label: 'Synced', color: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'error', label: 'Error', color: 'bg-red-500/20 text-red-400' }
]

/**
 * Multi-select status filter component
 * @param {object} props
 * @param {Array<string>} props.selected - Currently selected statuses
 * @param {Function} props.onChange - Callback when selection changes
 * @param {string} props.className - Additional CSS classes
 */
export default function MultiStatusFilter({ selected = [], onChange, className = '' }) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

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

  const toggleStatus = (status) => {
    if (selected.includes(status)) {
      onChange(selected.filter(s => s !== status))
    } else {
      onChange([...selected, status])
    }
  }

  const clearAll = () => {
    onChange([])
    setIsOpen(false)
  }

  const selectAll = () => {
    onChange(STATUS_OPTIONS.map(s => s.value))
  }

  const selectedCount = selected.length
  const displayText = selectedCount === 0 
    ? 'All Status' 
    : selectedCount === STATUS_OPTIONS.length 
      ? 'All Status' 
      : `${selectedCount} selected`

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input flex items-center justify-between gap-2 min-w-[140px] cursor-pointer"
      >
        <span className="truncate">{displayText}</span>
        <svg 
          className={`w-4 h-4 text-surface-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-56 bg-surface-800 border border-surface-700 rounded-lg shadow-xl">
          {/* Quick actions */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
            <button
              onClick={clearAll}
              className="text-xs text-surface-400 hover:text-surface-200"
            >
              Clear all
            </button>
            <button
              onClick={selectAll}
              className="text-xs text-primary-400 hover:text-primary-300"
            >
              Select all
            </button>
          </div>

          {/* Status options */}
          <div className="p-2 space-y-1">
            {STATUS_OPTIONS.map((status) => (
              <label
                key={status.value}
                className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-surface-700/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(status.value)}
                  onChange={() => toggleStatus(status.value)}
                  className="w-4 h-4 rounded border-surface-600 text-primary-600 focus:ring-primary-500 bg-surface-700"
                />
                <span className={`text-sm px-2 py-0.5 rounded ${status.color}`}>
                  {status.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Selected badges (shown when dropdown is closed) */}
      {!isOpen && selectedCount > 0 && selectedCount < STATUS_OPTIONS.length && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map(statusValue => {
            const status = STATUS_OPTIONS.find(s => s.value === statusValue)
            return (
              <span
                key={statusValue}
                className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${status?.color}`}
              >
                {status?.label}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleStatus(statusValue)
                  }}
                  className="hover:opacity-75"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

