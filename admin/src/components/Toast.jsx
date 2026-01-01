import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// Toast types and their styles
const TOAST_TYPES = {
  success: {
    bg: 'bg-emerald-500/20 border-emerald-500/30',
    text: 'text-emerald-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    )
  },
  error: {
    bg: 'bg-red-500/20 border-red-500/30',
    text: 'text-red-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  },
  warning: {
    bg: 'bg-amber-500/20 border-amber-500/30',
    text: 'text-amber-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  },
  info: {
    bg: 'bg-primary-500/20 border-primary-500/30',
    text: 'text-primary-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
}

// Individual Toast component
function ToastItem({ id, type = 'info', title, message, duration = 5000, onClose }) {
  const [isVisible, setIsVisible] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  
  const styles = TOAST_TYPES[type] || TOAST_TYPES.info

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => {
      setIsVisible(true)
    })

    // Auto dismiss
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose()
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration])

  const handleClose = useCallback(() => {
    setIsLeaving(true)
    setTimeout(() => {
      onClose(id)
    }, 300)
  }, [id, onClose])

  return (
    <div
      className={`
        ${styles.bg} border rounded-lg shadow-xl backdrop-blur-sm
        transform transition-all duration-300 ease-out
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        max-w-sm w-full pointer-events-auto
      `}
    >
      <div className="p-4 flex items-start gap-3">
        <div className={`${styles.text} shrink-0`}>
          {styles.icon}
        </div>
        <div className="flex-1 min-w-0">
          {title && (
            <p className={`font-medium ${styles.text}`}>{title}</p>
          )}
          {message && (
            <p className="text-sm text-surface-300 mt-0.5">{message}</p>
          )}
        </div>
        <button
          onClick={handleClose}
          className="text-surface-500 hover:text-surface-300 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// Toast Container
function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          {...toast}
          onClose={removeToast}
        />
      ))}
    </div>
  )
}

// Toast Context
const ToastContext = createContext(null)

// Toast Provider
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { ...toast, id }])
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Convenience methods
  const toast = useCallback((message, options = {}) => {
    return addToast({ message, ...options })
  }, [addToast])

  toast.success = useCallback((message, title) => {
    return addToast({ type: 'success', message, title })
  }, [addToast])

  toast.error = useCallback((message, title) => {
    return addToast({ type: 'error', message, title, duration: 8000 })
  }, [addToast])

  toast.warning = useCallback((message, title) => {
    return addToast({ type: 'warning', message, title })
  }, [addToast])

  toast.info = useCallback((message, title) => {
    return addToast({ type: 'info', message, title })
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toast, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context.toast
}

export default ToastProvider

