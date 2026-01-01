import { useMemo } from 'react'

/**
 * Format bytes to human readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  
  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

/**
 * Format seconds to human readable duration
 * @param {number} seconds - Number of seconds
 * @returns {string} Formatted string (e.g., "1m 30s")
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '-'
  
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  
  if (minutes < 60) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
  }
  
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

/**
 * ProgressBar component with speed and ETA
 * @param {object} props
 * @param {number} props.percent - Progress percentage (0-100)
 * @param {number} props.speed - Speed in bytes/second
 * @param {number} props.eta - Estimated time remaining in seconds
 * @param {string} props.status - Status: 'downloading', 'uploading', 'paused', 'complete', 'error'
 * @param {string} props.type - Type: 'download' or 'upload'
 * @param {boolean} props.showDetails - Whether to show speed/eta details
 * @param {string} props.size - Size variant: 'sm', 'md', 'lg'
 * @param {string} props.className - Additional CSS classes
 */
export default function ProgressBar({
  percent = 0,
  speed,
  eta,
  status = 'downloading',
  type = 'download',
  showDetails = true,
  size = 'md',
  className = ''
}) {
  // Clamp percent between 0 and 100
  const clampedPercent = Math.max(0, Math.min(100, percent || 0))
  
  // Determine colors based on status
  const colors = useMemo(() => {
    switch (status) {
      case 'complete':
        return {
          bar: 'bg-emerald-500',
          bg: 'bg-emerald-500/20',
          text: 'text-emerald-400'
        }
      case 'error':
        return {
          bar: 'bg-red-500',
          bg: 'bg-red-500/20',
          text: 'text-red-400'
        }
      case 'paused':
        return {
          bar: 'bg-amber-500',
          bg: 'bg-amber-500/20',
          text: 'text-amber-400'
        }
      case 'uploading':
        return {
          bar: 'bg-primary-500',
          bg: 'bg-primary-500/20',
          text: 'text-primary-400'
        }
      case 'downloading':
      default:
        return {
          bar: 'bg-cyan-500',
          bg: 'bg-cyan-500/20',
          text: 'text-cyan-400'
        }
    }
  }, [status])
  
  // Size classes
  const sizeClasses = useMemo(() => {
    switch (size) {
      case 'sm':
        return { bar: 'h-1', text: 'text-xs' }
      case 'lg':
        return { bar: 'h-3', text: 'text-sm' }
      case 'md':
      default:
        return { bar: 'h-2', text: 'text-xs' }
    }
  }, [size])
  
  // Animation class for active states
  const animationClass = useMemo(() => {
    if (status === 'downloading' || status === 'uploading') {
      return 'animate-pulse-subtle'
    }
    return ''
  }, [status])
  
  return (
    <div className={`${className}`}>
      {/* Progress bar */}
      <div className={`w-full ${colors.bg} rounded-full ${sizeClasses.bar} overflow-hidden`}>
        <div
          className={`${colors.bar} ${sizeClasses.bar} rounded-full transition-all duration-300 ${animationClass}`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      
      {/* Details row */}
      {showDetails && (
        <div className={`flex items-center justify-between mt-1 ${sizeClasses.text} text-surface-400`}>
          <span className={colors.text}>
            {status === 'complete' ? '✓ Complete' : 
             status === 'error' ? '✗ Failed' :
             status === 'paused' ? '⏸ Paused' :
             `${clampedPercent}%`}
          </span>
          
          <div className="flex items-center gap-2">
            {speed != null && status !== 'complete' && status !== 'error' && (
              <span>{formatBytes(speed)}/s</span>
            )}
            {eta != null && status !== 'complete' && status !== 'error' && (
              <span>ETA: {formatDuration(eta)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Compact inline progress indicator
 * Shows as a small badge with percentage
 */
export function ProgressBadge({
  percent = 0,
  status = 'downloading',
  type = 'download'
}) {
  const clampedPercent = Math.max(0, Math.min(100, percent || 0))
  
  const colors = useMemo(() => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-500/20 text-emerald-400'
      case 'error':
        return 'bg-red-500/20 text-red-400'
      case 'paused':
        return 'bg-amber-500/20 text-amber-400'
      case 'uploading':
        return 'bg-primary-500/20 text-primary-400'
      case 'downloading':
      default:
        return 'bg-cyan-500/20 text-cyan-400'
    }
  }, [status])
  
  const icon = useMemo(() => {
    switch (status) {
      case 'complete':
        return '✓'
      case 'error':
        return '✗'
      case 'paused':
        return '⏸'
      case 'uploading':
        return '↑'
      case 'downloading':
      default:
        return '↓'
    }
  }, [status])
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      <span>{icon}</span>
      <span>{status === 'complete' ? 'Done' : status === 'error' ? 'Failed' : `${clampedPercent}%`}</span>
    </span>
  )
}

/**
 * Circular progress indicator
 */
export function CircularProgress({
  percent = 0,
  size = 24,
  strokeWidth = 3,
  status = 'downloading'
}) {
  const clampedPercent = Math.max(0, Math.min(100, percent || 0))
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (clampedPercent / 100) * circumference
  
  const color = useMemo(() => {
    switch (status) {
      case 'complete':
        return 'stroke-emerald-500'
      case 'error':
        return 'stroke-red-500'
      case 'paused':
        return 'stroke-amber-500'
      case 'uploading':
        return 'stroke-primary-500'
      case 'downloading':
      default:
        return 'stroke-cyan-500'
    }
  }, [status])
  
  return (
    <svg
      width={size}
      height={size}
      className="transform -rotate-90"
    >
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
        className="stroke-surface-700"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
        className={`${color} transition-all duration-300`}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  )
}

