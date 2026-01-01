import { useState, useRef, useEffect } from 'react'

/**
 * Quick actions dropdown menu
 * @param {object} props
 * @param {Array} props.actions - Array of action objects { label, icon?, onClick, disabled?, variant? }
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.disabled - Disable the entire menu
 * @param {string} props.size - Size variant: 'sm', 'md'
 */
export default function QuickActionsMenu({ actions = [], className = '', disabled = false, size = 'sm' }) {
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

  const handleActionClick = (action) => {
    if (action.disabled) return
    action.onClick()
    setIsOpen(false)
  }

  const sizeClasses = size === 'sm' 
    ? 'px-2 py-1 text-xs' 
    : 'px-3 py-1.5 text-sm'

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'

  return (
    <div className={`relative inline-block ${className}`} ref={dropdownRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`btn-secondary ${sizeClasses} flex items-center gap-1 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span>Actions</span>
        <svg 
          className={`${iconSize} transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 w-40 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 overflow-hidden">
          {actions.map((action, index) => {
            // Check if this is a divider
            if (action.divider) {
              return <div key={index} className="border-t border-surface-700 my-1" />
            }

            const variantClasses = action.variant === 'danger'
              ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
              : action.variant === 'success'
                ? 'text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                : action.variant === 'warning'
                  ? 'text-amber-400 hover:bg-amber-500/10 hover:text-amber-300'
                  : 'text-surface-300 hover:bg-surface-700 hover:text-surface-100'

            return (
              <button
                key={index}
                onClick={() => handleActionClick(action)}
                disabled={action.disabled}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${variantClasses} ${action.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {action.icon && (
                  <span className={iconSize}>{action.icon}</span>
                )}
                <span>{action.label}</span>
                {action.loading && (
                  <svg className="animate-spin h-3 w-3 ml-auto" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Action Icons
export const ActionIcons = {
  preview: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  download: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  sync: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  reupload: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
  copy: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  edit: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  delete: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  reset: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

