import { useState, useEffect, useCallback, useMemo } from 'react'
import ProgressBar from './ProgressBar'
import {
  getUploadQueueStatus,
  pauseUpload,
  resumeUpload,
  cancelUpload,
  setUploadPriority,
  pauseAllUploads,
  resumeAllUploads,
  clearUploadHistory,
  resetAllUploads
} from '../lib/api'

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

/**
 * Format timestamp to relative time
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(timestamp).toLocaleDateString()
}

/**
 * Format duration
 */
function formatDuration(seconds) {
  if (!seconds) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Get filename from URL
 */
function getFilename(url, fallbackId) {
  if (!url) return fallbackId?.slice(0, 12) + '...'
  try {
    const parsed = new URL(url)
    const filename = parsed.pathname.split('/').pop()
    if (filename && filename.length > 0) {
      return filename.length > 40 ? filename.slice(0, 37) + '...' : filename
    }
  } catch {
    // ignore
  }
  return url.length > 40 ? url.slice(0, 37) + '...' : url
}

/**
 * Get hostname from URL
 */
function getHostname(url) {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Pagination component
 */
function Pagination({ page, totalPages, total, onPageChange, label = 'items' }) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-surface-800/30 border-t border-surface-700/50">
      <span className="text-xs text-surface-500">
        {total} {label} total
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm text-surface-300">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="p-1.5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * Upload Queue Tab - Full tab view for managing upload queue
 */
export default function UploadQueueTab({ videoProgress = {}, onRefresh, uploadingVideos = [] }) {
  const [queueStatus, setQueueStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])

  // Pagination state
  const [pendingPage, setPendingPage] = useState(1)
  const [completedPage, setCompletedPage] = useState(1)
  const ITEMS_PER_PAGE = 10

  // Fetch queue status with pagination
  const fetchStatus = useCallback(async () => {
    try {
      const status = await getUploadQueueStatus({
        pendingPage,
        pendingLimit: ITEMS_PER_PAGE,
        completedPage,
        completedLimit: ITEMS_PER_PAGE
      })
      setQueueStatus(status)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [pendingPage, completedPage])

  // Initial fetch and polling
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Handlers
  const handlePause = async (videoId) => {
    setLoading(true)
    try {
      await pauseUpload(videoId)
      await fetchStatus()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResume = async (videoId) => {
    setLoading(true)
    try {
      await resumeUpload(videoId)
      await fetchStatus()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async (videoId) => {
    setLoading(true)
    try {
      await cancelUpload(videoId)
      await fetchStatus()
      onRefresh?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePriorityUp = async (videoId, currentPriority) => {
    try {
      await setUploadPriority(videoId, (currentPriority || 0) + 1)
      await fetchStatus()
    } catch (err) {
      setError(err.message)
    }
  }

  const handlePriorityDown = async (videoId, currentPriority) => {
    try {
      await setUploadPriority(videoId, Math.max(0, (currentPriority || 0) - 1))
      await fetchStatus()
    } catch (err) {
      setError(err.message)
    }
  }

  const handlePauseAll = async () => {
    setLoading(true)
    try {
      await pauseAllUploads()
      await fetchStatus()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResumeAll = async () => {
    setLoading(true)
    try {
      await resumeAllUploads()
      await fetchStatus()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClearHistory = async () => {
    try {
      await clearUploadHistory()
      await fetchStatus()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleResetAll = async () => {
    if (!confirm('This will cancel all queued uploads and reset uploading videos to pending. Continue?')) {
      return
    }
    setLoading(true)
    try {
      await resetAllUploads()
      await fetchStatus()
      onRefresh?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelSelected = async () => {
    if (selectedItems.length === 0) return
    setLoading(true)
    try {
      for (const videoId of selectedItems) {
        await cancelUpload(videoId)
      }
      setSelectedItems([])
      await fetchStatus()
      onRefresh?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Compute stats
  const stats = useMemo(() => {
    const activeFromQueue = queueStatus?.activeCount || 0
    const activeFromVideos = uploadingVideos?.length || 0
    const pending = queueStatus?.pendingCount || 0
    const completed = queueStatus?.completed?.filter(c => c.state === 'completed').length || 0
    const failed = queueStatus?.completed?.filter(c => c.state === 'failed').length || 0

    return {
      active: activeFromQueue + activeFromVideos,
      pending,
      completed,
      failed,
      total: activeFromQueue + activeFromVideos + pending
    }
  }, [queueStatus, uploadingVideos])

  // All items for display
  const allActiveItems = useMemo(() => {
    const fromVideos = (uploadingVideos || []).map(v => ({
      videoId: v.id,
      videoUrl: v.videoUrl,
      sourceUrl: v.sourceUrl,
      downloadSize: v.downloadSize,
      state: 'uploading',
      progress: videoProgress[v.id] || {},
      source: 'tracker'
    }))

    const fromQueue = (queueStatus?.active || []).map(item => ({
      ...item,
      progress: videoProgress[item.videoId] || item,
      source: 'queue'
    }))

    return [...fromVideos, ...fromQueue]
  }, [uploadingVideos, queueStatus, videoProgress])

  const toggleSelectItem = (videoId) => {
    setSelectedItems(prev =>
      prev.includes(videoId)
        ? prev.filter(id => id !== videoId)
        : [...prev, videoId]
    )
  }

  const selectAllPending = () => {
    const pendingIds = (queueStatus?.pending || []).map(i => i.videoId)
    setSelectedItems(pendingIds)
  }

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary-500/20">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary-400">{stats.active}</div>
              <div className="text-xs text-surface-500 uppercase tracking-wide">Uploading</div>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-400">{stats.pending}</div>
              <div className="text-xs text-surface-500 uppercase tracking-wide">In Queue</div>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/20">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{stats.completed}</div>
              <div className="text-xs text-surface-500 uppercase tracking-wide">Completed</div>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/20">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-400">{stats.failed}</div>
              <div className="text-xs text-surface-500 uppercase tracking-wide">Failed</div>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/20">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">
                {(queueStatus?.downloadQueue?.waiting || 0) + (queueStatus?.downloadQueue?.active || 0)}
              </div>
              <div className="text-xs text-surface-500 uppercase tracking-wide">Downloads</div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">×</button>
        </div>
      )}

      {/* Actions Bar */}
      {(stats.active > 0 || stats.pending > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-surface-800/50 rounded-xl">
          <div className="flex items-center gap-2 text-sm text-surface-400">
            <span className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
            Queue is {queueStatus?.isPaused ? 'paused' : 'processing'}
            {queueStatus?.maxConcurrent && (
              <span className="text-surface-500">• Max {queueStatus.maxConcurrent} concurrent</span>
            )}
          </div>
          <div className="flex gap-2">
            {queueStatus?.isPaused ? (
              <button
                onClick={handleResumeAll}
                disabled={loading}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
                Resume All
              </button>
            ) : (
              <button
                onClick={handlePauseAll}
                disabled={loading}
                className="btn-ghost text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                </svg>
                Pause All
              </button>
            )}
            <button
              onClick={handleResetAll}
              disabled={loading}
              className="text-sm px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Clear Queue
            </button>
          </div>
        </div>
      )}

      {/* Currently Uploading */}
      {allActiveItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
            <h3 className="text-sm font-semibold text-surface-200 uppercase tracking-wide">
              Uploading Now ({allActiveItems.length})
            </h3>
          </div>

          <div className="grid gap-3">
            {allActiveItems.map(item => (
              <div key={item.videoId} className="glass-card p-4 hover:border-primary-500/30 transition-colors">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base font-medium text-surface-100 truncate" title={item.videoUrl || item.videoId}>
                        {getFilename(item.videoUrl, item.videoId)}
                      </span>
                      {item.state === 'paused' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Paused</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-surface-500">
                      {getHostname(item.sourceUrl) && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          {getHostname(item.sourceUrl)}
                        </span>
                      )}
                      {item.downloadSize && (
                        <span>{formatBytes(item.downloadSize)}</span>
                      )}
                      {item.progress?.speed && (
                        <span className="text-primary-400">{item.progress.speed}</span>
                      )}
                      {item.progress?.eta && (
                        <span>ETA {formatDuration(item.progress.eta)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-primary-400">
                      {Math.round(item.progress?.percent || 0)}%
                    </span>
                    {item.state === 'paused' ? (
                      <button
                        onClick={() => handleResume(item.videoId)}
                        disabled={loading}
                        className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        title="Resume"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePause(item.videoId)}
                        disabled={loading}
                        className="p-2 rounded-lg text-amber-400 hover:bg-amber-500/20 transition-colors"
                        title="Pause"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => handleCancel(item.videoId)}
                      disabled={loading}
                      className="p-2 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Cancel"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <ProgressBar
                  percent={item.progress?.percent || 0}
                  status={item.state === 'paused' ? 'paused' : 'uploading'}
                  size="sm"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Queue */}
      {queueStatus?.pendingCount > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-200 uppercase tracking-wide">
              Pending Queue ({queueStatus.pendingCount})
            </h3>
            <div className="flex gap-2">
              {selectedItems.length > 0 && (
                <button
                  onClick={handleCancelSelected}
                  disabled={loading}
                  className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
                >
                  Cancel Selected ({selectedItems.length})
                </button>
              )}
              <button
                onClick={selectAllPending}
                className="text-xs text-surface-400 hover:text-surface-200"
              >
                Select All
              </button>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-800/50">
                  <th className="w-10 px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedItems.length === queueStatus.pending.length && selectedItems.length > 0}
                      onChange={(e) => e.target.checked ? selectAllPending() : setSelectedItems([])}
                      className="rounded border-surface-600"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Video</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Size</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Priority</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-surface-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/50">
                {queueStatus.pending.map((item, index) => (
                  <tr key={item.videoId} className="hover:bg-surface-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedItems.includes(item.videoId)}
                        onChange={() => toggleSelectItem(item.videoId)}
                        className="rounded border-surface-600"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-surface-500">#{(pendingPage - 1) * ITEMS_PER_PAGE + index + 1}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-surface-200 truncate block max-w-[200px]" title={item.videoUrl || item.videoId}>
                        {getFilename(item.videoUrl, item.videoId)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-surface-400 truncate block max-w-[150px]" title={item.sourceUrl}>
                        {getHostname(item.sourceUrl) || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-surface-400">
                      {formatBytes(item.downloadSize)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {item.priority > 0 ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                            P{item.priority}
                          </span>
                        ) : (
                          <span className="text-xs text-surface-500">Normal</span>
                        )}
                        <button
                          onClick={() => handlePriorityUp(item.videoId, item.priority)}
                          className="p-1 text-surface-500 hover:text-surface-300"
                          title="Increase priority"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handlePriorityDown(item.videoId, item.priority)}
                          className="p-1 text-surface-500 hover:text-surface-300"
                          title="Decrease priority"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleCancel(item.videoId)}
                        disabled={loading}
                        className="p-1.5 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Remove from queue"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={queueStatus.pendingPagination?.page || 1}
              totalPages={queueStatus.pendingPagination?.totalPages || 1}
              total={queueStatus.pendingCount}
              onPageChange={setPendingPage}
              label="pending"
            />
          </div>
        </div>
      )}

      {/* Completed History */}
      {queueStatus?.completedCount > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-200 uppercase tracking-wide">
              Recent Activity ({queueStatus.completedCount})
            </h3>
            <button
              onClick={handleClearHistory}
              className="text-xs text-surface-500 hover:text-surface-300"
            >
              Clear History
            </button>
          </div>

          <div className="glass-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-800/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Video</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Completed</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wide">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/50">
                {queueStatus.completed.map(item => (
                  <tr key={`${item.videoId}-${item.completedAt}`} className="hover:bg-surface-800/30 transition-colors">
                    <td className="px-4 py-3">
                      {item.state === 'completed' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Done
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-surface-200 truncate block max-w-[200px]" title={item.videoUrl || item.videoId}>
                        {getFilename(item.videoUrl, item.videoId)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-surface-400 truncate block max-w-[150px]" title={item.sourceUrl}>
                        {getHostname(item.sourceUrl) || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-surface-500">
                      {formatTimeAgo(item.completedAt)}
                    </td>
                    <td className="px-4 py-3">
                      {item.error && (
                        <span className="text-xs text-red-400 truncate block max-w-[200px]" title={item.error}>
                          {item.error.slice(0, 50)}...
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={queueStatus.completedPagination?.page || 1}
              totalPages={queueStatus.completedPagination?.totalPages || 1}
              total={queueStatus.completedCount}
              onPageChange={setCompletedPage}
              label="completed"
            />
          </div>
        </div>
      )}

      {/* Empty State */}
      {stats.total === 0 && (queueStatus?.completedCount || 0) === 0 && (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-700/50 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-surface-300 mb-2">Upload Queue is Empty</h3>
          <p className="text-sm text-surface-500 max-w-md mx-auto">
            When you sync or re-upload videos, they will appear here. You can manage priorities, pause, resume, or cancel uploads.
          </p>
        </div>
      )}

      {/* Empty but has history */}
      {stats.total === 0 && (queueStatus?.completedCount || 0) > 0 && !queueStatus?.pending?.length && (
        <div className="glass-card p-8 text-center border-emerald-500/30 bg-emerald-500/5">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-emerald-400 font-medium">All uploads completed!</p>
          <p className="text-surface-400 text-sm mt-1">{stats.completed} successful, {stats.failed} failed</p>
        </div>
      )}
    </div>
  )
}

