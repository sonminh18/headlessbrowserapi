import { useState, useEffect } from 'react'
import Modal from './Modal'

export default function RetryModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  failedCount = 0,
  loading = false 
}) {
  const [options, setOptions] = useState({
    maxRetries: 3,
    skipProtected: true,
    redownload: false,
    priority: 0
  })

  useEffect(() => {
    if (isOpen) {
      // Reset to defaults when modal opens
      setOptions({
        maxRetries: 3,
        skipProtected: true,
        redownload: false,
        priority: 0
      })
    }
  }, [isOpen])

  const handleConfirm = () => {
    onConfirm(options)
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      title="Retry Failed Videos"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-surface-200">Failed Videos</p>
              <p className="text-2xl font-bold text-red-400">{failedCount}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              Maximum Retry Attempts
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={options.maxRetries}
              onChange={(e) => setOptions(prev => ({ ...prev, maxRetries: parseInt(e.target.value) || 1 }))}
              className="input w-24"
            />
            <p className="mt-1 text-xs text-surface-500">
              Number of retry attempts per video (1-10)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="skipProtected"
              checked={options.skipProtected}
              onChange={(e) => setOptions(prev => ({ ...prev, skipProtected: e.target.checked }))}
              className="form-checkbox h-4 w-4 text-primary-600 rounded border-surface-600 bg-surface-900"
            />
            <label htmlFor="skipProtected" className="text-sm text-surface-300">
              Skip protected/geo-restricted videos
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="redownload"
              checked={options.redownload}
              onChange={(e) => setOptions(prev => ({ ...prev, redownload: e.target.checked }))}
              className="form-checkbox h-4 w-4 text-primary-600 rounded border-surface-600 bg-surface-900"
            />
            <label htmlFor="redownload" className="text-sm text-surface-300">
              Re-download from source (if local file missing)
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              Queue Priority
            </label>
            <select
              value={options.priority}
              onChange={(e) => setOptions(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
              className="input w-32"
            >
              <option value={0}>Normal</option>
              <option value={1}>High</option>
              <option value={2}>Urgent</option>
            </select>
            <p className="mt-1 text-xs text-surface-500">
              Higher priority videos will be processed first
            </p>
          </div>
        </div>

        <div className="p-3 bg-surface-800/50 rounded-lg">
          <h4 className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
            Retry Strategy
          </h4>
          <ul className="text-xs text-surface-400 space-y-1">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-400"></span>
              Videos will be retried with exponential backoff
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-400"></span>
              Connection errors are retried automatically
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-400"></span>
              Permanent errors (404, 403) are skipped
            </li>
          </ul>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="btn-primary"
            disabled={loading || failedCount === 0}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Retrying...
              </span>
            ) : (
              `Retry ${failedCount} Videos`
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

