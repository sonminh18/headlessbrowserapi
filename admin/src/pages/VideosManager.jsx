import { useState, useCallback, useEffect } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  getVideos,
  addVideo,
  updateVideo,
  deleteVideo,
  syncVideo,
  syncAllVideos,
  downloadVideo as downloadVideoApi,
  getStorageStatus,
  testStorageConnection
} from '../lib/api'
import usePolling from '../hooks/usePolling'

export default function VideosManager() {
  const [data, setData] = useState(null)
  const [storage, setStorage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editVideo, setEditVideo] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [actionLoading, setActionLoading] = useState(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [downloadResult, setDownloadResult] = useState(null)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [showErrorDetail, setShowErrorDetail] = useState(null)
  
  const [formData, setFormData] = useState({
    videoUrl: '',
    sourceUrl: '',
    mimeType: 'video/mp4',
    isHLS: false
  })

  const fetchData = useCallback(async () => {
    try {
      const params = filter ? { status: filter } : {}
      const [videosResult, storageResult] = await Promise.all([
        getVideos(params),
        getStorageStatus()
      ])
      setData(videosResult)
      setStorage(storageResult)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filter])

  const { refresh } = usePolling(fetchData, 10000)

  useEffect(() => {
    if (editVideo) {
      setFormData({
        videoUrl: editVideo.videoUrl || '',
        sourceUrl: editVideo.sourceUrl || '',
        mimeType: editVideo.mimeType || 'video/mp4',
        isHLS: editVideo.isHLS || false
      })
    } else {
      setFormData({
        videoUrl: '',
        sourceUrl: '',
        mimeType: 'video/mp4',
        isHLS: false
      })
    }
  }, [editVideo])

  const handleSave = async () => {
    setActionLoading('save')
    try {
      if (editVideo) {
        await updateVideo(editVideo.id, formData)
      } else {
        await addVideo(formData)
      }
      setShowAddModal(false)
      setEditVideo(null)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (video) => {
    setActionLoading(video.id)
    try {
      const result = await deleteVideo(video.id)
      if (result.deletedFromStorage) {
        // Show success message for storage deletion
      }
      if (result.storageError) {
        setError(`Record deleted but S3 deletion failed: ${result.storageError}`)
      }
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
      setConfirmDelete(null)
    }
  }

  const handleSync = async (id) => {
    setActionLoading(id)
    try {
      await syncVideo(id)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDownload = async (id) => {
    setActionLoading(`download-${id}`)
    setShowDownloadModal(true)
    setDownloadResult(null)
    try {
      const result = await downloadVideoApi(id)
      setDownloadResult(result)
      refresh() // Refresh to show updated download status
    } catch (err) {
      setDownloadResult({ success: false, error: err.message })
    } finally {
      setActionLoading(null)
    }
  }

  const handleSyncAll = async () => {
    setSyncingAll(true)
    try {
      const result = await syncAllVideos()
      setError(null)
      alert(`Synced ${result.synced} videos. ${result.failed} failed.`)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncingAll(false)
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    try {
      await testStorageConnection()
      alert('S3 connection successful!')
    } catch (err) {
      setError(err.message)
    } finally {
      setTestingConnection(false)
    }
  }

  const columns = [
    {
      header: 'Video URL',
      accessor: 'videoUrl',
      render: (row) => (
        <a
          href={row.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-400 hover:text-primary-300 truncate block max-w-[120px] sm:max-w-[200px]"
          title={row.videoUrl}
        >
          {row.videoUrl}
        </a>
      )
    },
    {
      header: 'Source Page',
      accessor: 'sourceUrl',
      render: (row) => (
        <span className="truncate block max-w-[100px] sm:max-w-[150px] text-surface-400" title={row.sourceUrl}>
          {row.sourceUrl || '-'}
        </span>
      )
    },
    {
      header: 'Status',
      accessor: 'status',
      render: (row) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={row.status} />
            {row.isProtected && (
              <span className="badge-warning text-xs">Protected</span>
            )}
          </div>
          {row.status === 'error' && row.error && (
            <button
              onClick={() => setShowErrorDetail(row)}
              className="text-xs text-red-400 hover:text-red-300 underline text-left truncate max-w-[150px]"
              title={row.error}
            >
              {row.error.length > 30 ? row.error.substring(0, 30) + '...' : row.error}
            </button>
          )}
        </div>
      )
    },
    {
      header: 'S3 URL',
      accessor: 's3Url',
      render: (row) => row.s3Url ? (
        <a
          href={row.s3Url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-400 hover:text-emerald-300 truncate block max-w-[100px] sm:max-w-[150px]"
          title={row.s3Url}
        >
          {row.s3Url}
        </a>
      ) : '-'
    },
    {
      header: 'Created',
      accessor: 'createdAt',
      render: (row) => (
        <span className="whitespace-nowrap text-xs sm:text-sm">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      )
    },
    {
      header: 'Actions',
      render: (row) => (
        <div className="flex flex-wrap gap-1 sm:gap-2">
          {row.status === 'pending' && !row.downloadedAt && (
            <button
              onClick={() => handleDownload(row.id)}
              disabled={actionLoading === `download-${row.id}`}
              className="btn-secondary text-xs py-1 px-2"
            >
              {actionLoading === `download-${row.id}` ? '...' : 'Download'}
            </button>
          )}
          {row.status === 'pending' && row.downloadedAt && (
            <span className="badge-success text-xs">Downloaded</span>
          )}
          {row.status === 'pending' && storage?.configured && (
            <button
              onClick={() => handleSync(row.id)}
              disabled={actionLoading === row.id}
              className="btn-primary text-xs py-1 px-2"
            >
              Sync
            </button>
          )}
          <button
            onClick={() => {
              setEditVideo(row)
              setShowAddModal(true)
            }}
            className="btn-secondary text-xs py-1 px-2"
          >
            Edit
          </button>
          <button
            onClick={() => setConfirmDelete(row)}
            disabled={actionLoading === row.id}
            className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      )
    }
  ]

  const statusOptions = ['', 'pending', 'uploading', 'synced', 'error']

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-100">Videos Manager</h1>
          <p className="text-surface-400 mt-1 text-sm sm:text-base">Manage extracted videos and S3 sync</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {storage?.configured && data?.stats?.byStatus?.pending > 0 && (
            <button
              onClick={handleSyncAll}
              disabled={syncingAll}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              {syncingAll ? 'Syncing...' : `Sync All (${data.stats.byStatus.pending})`}
            </button>
          )}
          <button
            onClick={() => {
              setEditVideo(null)
              setShowAddModal(true)
            }}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Video
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 sm:p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Storage Status Banner */}
      <div className={`glass-card p-3 sm:p-4 ${storage?.configured ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3 sm:gap-4">
            <div className={`p-2 rounded-lg shrink-0 ${storage?.configured ? 'bg-emerald-500/20' : 'bg-amber-500/20'}`}>
              <svg className={`w-5 h-5 ${storage?.configured ? 'text-emerald-400' : 'text-amber-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-surface-100">S3 Storage</span>
                <StatusBadge status={storage?.configured ? 'connected' : 'disconnected'} />
              </div>
              {storage?.configured && (
                <p className="text-xs sm:text-sm text-surface-400 mt-1 truncate">
                  {storage.endpoint} / {storage.bucket} / {storage.keyPrefix}
                </p>
              )}
              {storage?.autoSync && (
                <span className="badge-info text-xs mt-1">Auto-sync enabled</span>
              )}
            </div>
          </div>
          {storage?.configured && (
            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="btn-secondary text-sm shrink-0"
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 sm:gap-4">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input w-full sm:w-auto sm:max-w-xs"
        >
          <option value="">All Status</option>
          {statusOptions.slice(1).map((status) => (
            <option key={status} value={status}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>
        
        <button onClick={refresh} className="btn-secondary">
          Refresh
        </button>
      </div>

      {/* Stats */}
      {data?.stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {Object.entries(data.stats.byStatus).map(([status, count]) => (
            <div key={status} className="glass-card p-3 sm:p-4 text-center">
              <p className="text-lg sm:text-xl font-bold text-surface-100 font-mono">{count}</p>
              <p className="text-xs sm:text-sm text-surface-400 capitalize">{status}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={data?.videos || []}
        loading={loading}
        emptyMessage="No videos tracked yet"
      />

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          setEditVideo(null)
        }}
        title={editVideo ? 'Edit Video' : 'Add Video'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              Video URL *
            </label>
            <input
              type="url"
              value={formData.videoUrl}
              onChange={(e) => setFormData({ ...formData, videoUrl: e.target.value })}
              placeholder="https://example.com/video.mp4"
              className="input"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              Source Page URL
            </label>
            <input
              type="url"
              value={formData.sourceUrl}
              onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
              placeholder="https://example.com/page"
              className="input"
            />
          </div>
          
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isHLS"
              checked={formData.isHLS}
              onChange={(e) => setFormData({ ...formData, isHLS: e.target.checked })}
              className="w-4 h-4 rounded border-surface-600 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="isHLS" className="text-sm text-surface-300">
              HLS Stream (will be converted to MP4)
            </label>
          </div>
          
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
            <button
              onClick={() => {
                setShowAddModal(false)
                setEditVideo(null)
              }}
              className="btn-secondary w-full sm:w-auto"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={actionLoading === 'save' || !formData.videoUrl.trim()}
              className="btn-primary w-full sm:w-auto"
            >
              {actionLoading === 'save' ? 'Saving...' : editVideo ? 'Update' : 'Add Video'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDelete(confirmDelete)}
        title="Delete Video"
        message={
          confirmDelete?.s3Url 
            ? "This video has been synced to S3. Deleting will remove both the record and the file from storage. Are you sure?"
            : "Are you sure you want to delete this video record?"
        }
        confirmText={confirmDelete?.s3Url ? "Delete from Storage" : "Delete"}
        variant="danger"
      />

      {/* Download Result Modal */}
      <Modal
        isOpen={showDownloadModal}
        onClose={() => {
          setShowDownloadModal(false)
          setDownloadResult(null)
        }}
        title="Download Video"
      >
        {!downloadResult ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-3 text-surface-400">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Downloading video...
            </div>
          </div>
        ) : downloadResult.success ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-emerald-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-lg font-medium">Download Complete!</span>
            </div>
            
            <div className="glass-card p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-surface-400">File Size</span>
                <span className="text-surface-100 font-mono">{downloadResult.download.sizeMB} MB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Content Type</span>
                <span className="text-surface-100">{downloadResult.download.contentType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Download Time</span>
                <span className="text-surface-100 font-mono">{downloadResult.download.durationSeconds}s</span>
              </div>
            </div>

            <p className="text-sm text-surface-400">
              Video downloaded and ready for sync. Click "Sync" to upload to S3 storage.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-lg font-medium">Download Failed</span>
            </div>
            
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
              {downloadResult.error}
            </div>

            <p className="text-sm text-surface-400">
              The video cannot be downloaded. Check the URL and try again.
            </p>
          </div>
        )}
      </Modal>

      {/* Error Detail Modal */}
      <Modal
        isOpen={!!showErrorDetail}
        onClose={() => setShowErrorDetail(null)}
        title="Error Details"
      >
        {showErrorDetail && (
          <div className="space-y-4">
            {/* Error Type Badge */}
            <div className="flex items-center gap-3">
              {showErrorDetail.isProtected ? (
                <div className="flex items-center gap-2 text-amber-400">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-lg font-medium">Protected Content</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-400">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-lg font-medium">Sync/Download Error</span>
                </div>
              )}
            </div>

            {/* Video Info */}
            <div className="glass-card p-4 space-y-3">
              <div>
                <span className="text-xs text-surface-500 uppercase tracking-wide">Video URL</span>
                <p className="text-surface-200 break-all text-sm mt-1">{showErrorDetail.videoUrl}</p>
              </div>
              {showErrorDetail.sourceUrl && (
                <div>
                  <span className="text-xs text-surface-500 uppercase tracking-wide">Source Page</span>
                  <p className="text-surface-200 break-all text-sm mt-1">{showErrorDetail.sourceUrl}</p>
                </div>
              )}
              <div className="flex gap-4">
                <div>
                  <span className="text-xs text-surface-500 uppercase tracking-wide">Type</span>
                  <p className="text-surface-200 text-sm mt-1">{showErrorDetail.isHLS ? 'HLS Stream' : 'Direct Video'}</p>
                </div>
                <div>
                  <span className="text-xs text-surface-500 uppercase tracking-wide">Created</span>
                  <p className="text-surface-200 text-sm mt-1">{new Date(showErrorDetail.createdAt).toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Error Message */}
            <div>
              <span className="text-xs text-surface-500 uppercase tracking-wide">Error Message</span>
              <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
                {showErrorDetail.error}
              </div>
            </div>

            {/* Explanation for protected content */}
            {showErrorDetail.isProtected && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <p className="text-amber-400 text-sm">
                  <strong>Why this happens:</strong> This video uses DRM (Digital Rights Management) or 
                  obfuscation techniques that prevent direct download. The video segments are encrypted 
                  or disguised as image files, making them impossible to download without the browser's 
                  decryption layer.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowErrorDetail(null)}
                className="btn-secondary"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setConfirmDelete(showErrorDetail)
                  setShowErrorDetail(null)
                }}
                className="btn-ghost text-red-400 hover:text-red-300"
              >
                Delete Record
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
