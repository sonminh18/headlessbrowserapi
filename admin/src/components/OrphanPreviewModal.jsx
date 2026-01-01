import { useState, useEffect } from 'react'
import Modal from './Modal'

// Format file size
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

// Get file extension
const getFileExtension = (key) => {
  const parts = key.split('.')
  return parts.length > 1 ? parts.pop().toUpperCase() : 'Unknown'
}

// Check if file is video
const isVideoFile = (key) => {
  const videoExtensions = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'ts', 'm3u8']
  const ext = key.split('.').pop()?.toLowerCase()
  return videoExtensions.includes(ext)
}

export default function OrphanPreviewModal({ 
  isOpen, 
  onClose, 
  orphan,
  onImport,
  onDelete,
  loading = false
}) {
  const [previewError, setPreviewError] = useState(false)
  const [selectedAction, setSelectedAction] = useState(null)
  
  useEffect(() => {
    if (isOpen) {
      setPreviewError(false)
      setSelectedAction(null)
    }
  }, [isOpen])
  
  if (!orphan) return null
  
  const fileExtension = getFileExtension(orphan.key)
  const isVideo = isVideoFile(orphan.key)
  const previewUrl = orphan.url || orphan.s3Url
  
  const handleImport = () => {
    setSelectedAction('import')
    onImport?.(orphan.key)
  }
  
  const handleDelete = () => {
    setSelectedAction('delete')
    onDelete?.(orphan.key)
  }
  
  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      title="Orphan File Preview"
      size="lg"
    >
      <div className="space-y-4">
        {/* File Info Header */}
        <div className="flex items-start gap-4 p-4 bg-surface-800/50 rounded-lg">
          <div className="w-12 h-12 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
            {isVideo ? (
              <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-surface-200 font-medium truncate" title={orphan.key}>
              {orphan.key.split('/').pop()}
            </p>
            <p className="text-surface-500 text-sm truncate mt-0.5" title={orphan.key}>
              {orphan.key}
            </p>
            <div className="flex items-center gap-4 mt-2 text-xs text-surface-400">
              <span className="px-2 py-0.5 rounded bg-surface-700">{fileExtension}</span>
              <span>{formatFileSize(orphan.size)}</span>
              {orphan.lastModified && (
                <span>Modified: {new Date(orphan.lastModified).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>
        
        {/* Video Preview */}
        {isVideo && previewUrl && !previewError && (
          <div className="aspect-video bg-surface-900 rounded-lg overflow-hidden">
            <video 
              src={previewUrl}
              controls
              className="w-full h-full"
              onError={() => setPreviewError(true)}
              preload="metadata"
            >
              Your browser does not support video playback.
            </video>
          </div>
        )}
        
        {/* Preview Error or Non-video */}
        {(previewError || !isVideo) && (
          <div className="aspect-video bg-surface-900 rounded-lg flex items-center justify-center">
            <div className="text-center">
              {previewError ? (
                <>
                  <svg className="w-16 h-16 text-surface-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-surface-500 mt-2">Preview unavailable</p>
                  <p className="text-surface-600 text-sm">Cannot load video from S3</p>
                </>
              ) : (
                <>
                  <svg className="w-16 h-16 text-surface-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-surface-500 mt-2">No preview available</p>
                  <p className="text-surface-600 text-sm">This file type cannot be previewed</p>
                </>
              )}
            </div>
          </div>
        )}
        
        {/* Direct Link */}
        {previewUrl && (
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wider mb-1 block">S3 URL</label>
            <a 
              href={previewUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary-400 hover:text-primary-300 text-sm break-all"
            >
              {previewUrl}
            </a>
          </div>
        )}
        
        {/* What happens explanation */}
        <div className="p-3 bg-surface-800/50 rounded-lg">
          <h4 className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
            Actions Explained
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <span className="text-emerald-400">Import:</span>
              <span className="text-surface-400">Creates a video record in the database linked to this S3 file. The video will appear in your videos list with "synced" status.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-red-400">Delete:</span>
              <span className="text-surface-400">Permanently removes this file from S3 storage. This cannot be undone.</span>
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-surface-700">
          <button
            onClick={onClose}
            className="btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={loading}
              className={`btn-ghost text-red-400 hover:text-red-300 ${
                selectedAction === 'delete' ? 'opacity-50' : ''
              }`}
            >
              {loading && selectedAction === 'delete' ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Deleting...
                </span>
              ) : (
                'Delete from S3'
              )}
            </button>
            <button
              onClick={handleImport}
              disabled={loading}
              className={`btn-primary ${
                selectedAction === 'import' ? 'opacity-50' : ''
              }`}
            >
              {loading && selectedAction === 'import' ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Importing...
                </span>
              ) : (
                'Import to Database'
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

