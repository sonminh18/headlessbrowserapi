import { useState } from 'react'
import Modal from './Modal'

// Error categories and their retry suggestions
const ERROR_CATEGORIES = {
  network: {
    patterns: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'network', 'fetch failed', 'connection'],
    icon: '🌐',
    title: 'Network Error',
    suggestions: [
      'Check your internet connection',
      'Verify the server is accessible',
      'Try again in a few minutes',
      'Check if a VPN/proxy is blocking the connection'
    ],
    retryable: true
  },
  auth: {
    patterns: ['403', 'forbidden', 'unauthorized', '401', 'access denied', 'permission'],
    icon: '🔐',
    title: 'Access Denied',
    suggestions: [
      'The video may be geo-restricted',
      'Check if login/authentication is required',
      'The content might be private or protected',
      'Try using a different IP or VPN'
    ],
    retryable: false
  },
  notFound: {
    patterns: ['404', 'not found', 'does not exist', 'deleted', 'removed'],
    icon: '🔍',
    title: 'Content Not Found',
    suggestions: [
      'The video may have been deleted',
      'Check if the URL is correct',
      'The content might have moved to a new URL'
    ],
    retryable: false
  },
  timeout: {
    patterns: ['timeout', 'timed out', 'deadline exceeded'],
    icon: '⏱️',
    title: 'Timeout Error',
    suggestions: [
      'The server took too long to respond',
      'Try again during off-peak hours',
      'The video file might be too large',
      'Increase timeout settings if possible'
    ],
    retryable: true
  },
  storage: {
    patterns: ['s3', 'upload failed', 'storage', 'bucket', 'aws', 'putobject'],
    icon: '📦',
    title: 'Storage Error',
    suggestions: [
      'Check S3 bucket configuration',
      'Verify AWS credentials are valid',
      'Ensure sufficient storage quota',
      'Check S3 bucket permissions'
    ],
    retryable: true
  },
  download: {
    patterns: ['download failed', 'yt-dlp', 'ffmpeg', 'format', 'codec'],
    icon: '⬇️',
    title: 'Download Error',
    suggestions: [
      'The video format may not be supported',
      'Try downloading with a different quality',
      'Check if yt-dlp is up to date',
      'The video might be DRM protected'
    ],
    retryable: true
  }
}

function categorizeError(errorMessage) {
  const msg = (errorMessage || '').toLowerCase()
  
  for (const [category, config] of Object.entries(ERROR_CATEGORIES)) {
    if (config.patterns.some(pattern => msg.includes(pattern.toLowerCase()))) {
      return { category, ...config }
    }
  }
  
  // Default category
  return {
    category: 'unknown',
    icon: '❓',
    title: 'Unknown Error',
    suggestions: [
      'Check the full error message for details',
      'Try the operation again',
      'Contact support if the issue persists'
    ],
    retryable: true
  }
}

export default function ErrorDetailModal({ 
  isOpen, 
  onClose, 
  video, 
  onRetry,
  onDelete 
}) {
  const [showStackTrace, setShowStackTrace] = useState(false)
  const [copied, setCopied] = useState(false)
  
  if (!video) return null
  
  const errorInfo = categorizeError(video.error)
  
  // Parse stack trace if present
  const hasStackTrace = video.error && (
    video.error.includes('\n') || 
    video.error.includes('at ') ||
    video.error.length > 200
  )
  
  const errorLines = (video.error || '').split('\n')
  const mainError = errorLines[0] || 'Unknown error'
  const stackTrace = errorLines.slice(1).join('\n')
  
  const handleCopyError = async () => {
    const fullError = `Video ID: ${video.id}
Video URL: ${video.videoUrl}
Source URL: ${video.sourceUrl || 'N/A'}
Status: ${video.status}
Error Time: ${video.updatedAt || video.createdAt}

Error:
${video.error || 'No error message'}

Video Record:
${JSON.stringify(video, null, 2)}`
    
    try {
      await navigator.clipboard.writeText(fullError)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  
  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      title="Error Details"
      size="lg"
    >
      <div className="space-y-4">
        {/* Error Category Header */}
        <div className={`flex items-start gap-4 p-4 rounded-lg border ${
          errorInfo.retryable 
            ? 'bg-amber-500/10 border-amber-500/20' 
            : 'bg-red-500/10 border-red-500/20'
        }`}>
          <span className="text-3xl">{errorInfo.icon}</span>
          <div className="flex-1">
            <h3 className={`text-lg font-medium ${
              errorInfo.retryable ? 'text-amber-400' : 'text-red-400'
            }`}>
              {errorInfo.title}
            </h3>
            <p className="text-sm text-surface-400 mt-1">
              {errorInfo.retryable ? 'This error may be resolved by retrying' : 'This error cannot be resolved by retrying'}
            </p>
          </div>
        </div>
        
        {/* Video Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wider">Video URL</label>
            <p className="text-surface-300 truncate" title={video.videoUrl}>
              <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300">
                {video.videoUrl}
              </a>
            </p>
          </div>
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wider">Source Page</label>
            <p className="text-surface-300 truncate" title={video.sourceUrl}>
              {video.sourceUrl || 'N/A'}
            </p>
          </div>
        </div>
        
        {/* Error Message */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-surface-500 uppercase tracking-wider">Error Message</label>
            <button
              onClick={handleCopyError}
              className={`text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                copied 
                  ? 'bg-emerald-500/20 text-emerald-400' 
                  : 'bg-surface-700 text-surface-400 hover:text-surface-200'
              }`}
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Full Error
                </>
              )}
            </button>
          </div>
          <div className="bg-surface-900 rounded-lg p-3 font-mono text-sm">
            <p className="text-red-400 break-words">{mainError}</p>
            
            {hasStackTrace && stackTrace && (
              <div className="mt-2">
                <button
                  onClick={() => setShowStackTrace(!showStackTrace)}
                  className="text-xs text-surface-500 hover:text-surface-300 flex items-center gap-1"
                >
                  <svg className={`w-3 h-3 transition-transform ${showStackTrace ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {showStackTrace ? 'Hide' : 'Show'} Stack Trace ({errorLines.length - 1} lines)
                </button>
                
                {showStackTrace && (
                  <pre className="mt-2 text-xs text-surface-500 overflow-x-auto max-h-48 whitespace-pre-wrap">
                    {stackTrace}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Suggestions */}
        <div>
          <label className="text-xs text-surface-500 uppercase tracking-wider mb-2 block">Suggestions</label>
          <ul className="space-y-2">
            {errorInfo.suggestions.map((suggestion, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-surface-300">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-1.5 shrink-0"></span>
                {suggestion}
              </li>
            ))}
          </ul>
        </div>
        
        {/* Error Timeline */}
        <div className="flex items-center gap-4 text-xs text-surface-500">
          <span>Created: {new Date(video.createdAt).toLocaleString()}</span>
          {video.updatedAt && video.updatedAt !== video.createdAt && (
            <span>Last Updated: {new Date(video.updatedAt).toLocaleString()}</span>
          )}
          {video.retryCount > 0 && (
            <span className="text-amber-400">Retried {video.retryCount} times</span>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-surface-700">
          <button
            onClick={() => {
              onDelete?.(video)
              onClose()
            }}
            className="btn-ghost text-red-400 hover:text-red-300 text-sm"
          >
            Delete Video
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="btn-secondary"
            >
              Close
            </button>
            {errorInfo.retryable && (
              <button
                onClick={() => {
                  onRetry?.(video.id)
                  onClose()
                }}
                className="btn-primary"
              >
                Retry Now
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

