import { useState, useCallback, useEffect } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import SearchInput from '../components/SearchInput'
import {
  getVideos,
  addVideo,
  updateVideo,
  deleteVideo,
  bulkDeleteVideos,
  syncVideo,
  syncAllVideos,
  downloadVideo as downloadVideoApi,
  reuploadVideo,
  bulkReuploadVideos,
  resetStuckUploads,
  getStorageStatus,
  testStorageConnection,
  reconcileStorage,
  importOrphan,
  deleteOrphan,
  bulkImportOrphans,
  bulkDeleteOrphans
} from '../lib/api'
import usePolling from '../hooks/usePolling'

export default function VideosManager() {
  const [data, setData] = useState(null)
  const [storage, setStorage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [pagination, setPagination] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editVideo, setEditVideo] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [actionLoading, setActionLoading] = useState(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [resettingStuck, setResettingStuck] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [downloadResult, setDownloadResult] = useState(null)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [showErrorDetail, setShowErrorDetail] = useState(null)
  
  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState([])
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkReuploading, setBulkReuploading] = useState(false)
  
  // Storage sync state
  const [activeTab, setActiveTab] = useState('videos') // 'videos' or 'storage-sync'
  const [syncData, setSyncData] = useState(null)
  const [syncLoading, setSyncLoading] = useState(false)
  const [selectedOrphans, setSelectedOrphans] = useState([])
  const [orphanActionLoading, setOrphanActionLoading] = useState(null)
  
  const [formData, setFormData] = useState({
    videoUrl: '',
    sourceUrl: '',
    mimeType: 'video/mp4',
    isHLS: false
  })

  const fetchData = useCallback(async () => {
    try {
      const params = { page, limit, sortBy, sortOrder }
      if (filter) params.status = filter
      if (search) params.search = search
      
      const [videosResult, storageResult] = await Promise.all([
        getVideos(params),
        getStorageStatus()
      ])
      setData(videosResult)
      setPagination(videosResult.pagination)
      setStorage(storageResult)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filter, search, sortBy, sortOrder, page, limit])

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

  const handleReupload = async (id) => {
    setActionLoading(`reupload-${id}`)
    try {
      await reuploadVideo(id)
      refresh()
    } catch (err) {
      setError(err.message)
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

  const handleResetStuck = async () => {
    setResettingStuck(true)
    try {
      const result = await resetStuckUploads(10)
      setError(null)
      if (result.reset > 0) {
        alert(`Reset ${result.reset} stuck uploads to pending.`)
      } else {
        alert('No stuck uploads found (videos must be uploading for >10 minutes).')
      }
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setResettingStuck(false)
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

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    
    setBulkDeleting(true)
    try {
      const result = await bulkDeleteVideos(selectedIds)
      setSelectedIds([])
      setShowBulkDeleteConfirm(false)
      refresh()
      if (result.errors && result.errors.length > 0) {
        setError(`Deleted ${result.deleted} videos (${result.deletedFromStorage} from storage), but ${result.errors.length} failed`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleBulkReupload = async () => {
    if (selectedIds.length === 0) return
    
    setBulkReuploading(true)
    try {
      const result = await bulkReuploadVideos(selectedIds)
      setSelectedIds([])
      refresh()
      if (result.failed > 0) {
        setError(`Re-uploaded ${result.success}/${result.total} videos. ${result.failed} failed.`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkReuploading(false)
    }
  }

  // Storage Sync handlers
  const handleReconcile = async () => {
    setSyncLoading(true)
    setError(null)
    try {
      const result = await reconcileStorage()
      setSyncData(result)
      setSelectedOrphans([])
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncLoading(false)
    }
  }

  const handleImportOrphan = async (key) => {
    setOrphanActionLoading(key)
    try {
      await importOrphan(key)
      // Refresh reconciliation data
      await handleReconcile()
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setOrphanActionLoading(null)
    }
  }

  const handleDeleteOrphan = async (key) => {
    setOrphanActionLoading(key)
    try {
      await deleteOrphan(key)
      // Refresh reconciliation data
      await handleReconcile()
    } catch (err) {
      setError(err.message)
    } finally {
      setOrphanActionLoading(null)
    }
  }

  const handleBulkImportOrphans = async () => {
    if (selectedOrphans.length === 0) return
    setOrphanActionLoading('bulk-import')
    try {
      const result = await bulkImportOrphans(selectedOrphans)
      if (result.failed > 0) {
        setError(`Imported ${result.imported} orphans, ${result.failed} failed`)
      }
      setSelectedOrphans([])
      await handleReconcile()
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setOrphanActionLoading(null)
    }
  }

  const handleBulkDeleteOrphans = async () => {
    if (selectedOrphans.length === 0) return
    setOrphanActionLoading('bulk-delete')
    try {
      const result = await bulkDeleteOrphans(selectedOrphans)
      if (result.failed > 0) {
        setError(`Deleted ${result.deleted} orphans, ${result.failed} failed`)
      }
      setSelectedOrphans([])
      await handleReconcile()
    } catch (err) {
      setError(err.message)
    } finally {
      setOrphanActionLoading(null)
    }
  }

  const toggleOrphanSelection = (key) => {
    setSelectedOrphans(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key)
        : [...prev, key]
    )
  }

  const toggleAllOrphans = () => {
    if (syncData?.orphanFiles?.length === selectedOrphans.length) {
      setSelectedOrphans([])
    } else {
      setSelectedOrphans(syncData?.orphanFiles?.map(o => o.key) || [])
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
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={row.status} />
            {row.autoImported && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">Auto</span>
            )}
            {row.skippedUpload && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">Dedup</span>
            )}
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
      header: (
        <button 
          onClick={() => {
            if (sortBy === 'createdAt') {
              setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')
            } else {
              setSortBy('createdAt')
              setSortOrder('desc')
            }
            setPage(1)
          }} 
          className="flex items-center gap-1 hover:text-surface-200 transition-colors"
        >
          Created
          {sortBy === 'createdAt' ? (
            sortOrder === 'desc' ? (
              <svg className="w-3 h-3 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )
          ) : (
            <svg className="w-3 h-3 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          )}
        </button>
      ),
      accessor: 'createdAt',
      render: (row) => (
        <span className="whitespace-nowrap text-xs sm:text-sm">
          {new Date(row.createdAt).toLocaleString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })}
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
          {(row.status === 'synced' || row.status === 'error' || row.status === 'uploading') && storage?.configured && (
            <button
              onClick={() => handleReupload(row.id)}
              disabled={actionLoading === `reupload-${row.id}`}
              className={`text-xs py-1 px-2 ${row.status === 'uploading' ? 'btn-ghost text-amber-400 hover:text-amber-300' : 'btn-secondary'}`}
              title={row.status === 'uploading' ? 'Reset stuck upload and retry' : 'Re-upload video'}
            >
              {actionLoading === `reupload-${row.id}` ? '...' : (row.status === 'uploading' ? 'Reset' : 'Re-upload')}
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
          {activeTab === 'videos' && storage?.configured && data?.stats?.byStatus?.uploading > 0 && (
            <button
              onClick={handleResetStuck}
              disabled={resettingStuck}
              className="btn-ghost flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300"
              title="Reset videos stuck in uploading status (>10 min) back to pending"
            >
              {resettingStuck ? 'Resetting...' : `Reset Stuck (${data.stats.byStatus.uploading})`}
            </button>
          )}
          {activeTab === 'videos' && storage?.configured && data?.stats?.byStatus?.pending > 0 && (
            <button
              onClick={handleSyncAll}
              disabled={syncingAll}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              {syncingAll ? 'Syncing...' : `Sync All (${data.stats.byStatus.pending})`}
            </button>
          )}
          {activeTab === 'videos' && (
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
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-800/50 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('videos')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'videos'
              ? 'bg-primary-600 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Videos
        </button>
        <button
          onClick={() => {
            setActiveTab('storage-sync')
            if (!syncData && storage?.configured) {
              handleReconcile()
            }
          }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'storage-sync'
              ? 'bg-primary-600 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Storage Sync
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 sm:p-4 text-red-400 text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">×</button>
        </div>
      )}

      {/* Storage Sync Tab */}
      {activeTab === 'storage-sync' && (
        <div className="space-y-4">
          {/* Auto-sync Info Banner */}
          <div className="glass-card p-4 border-cyan-500/30 bg-cyan-500/5">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-cyan-400 font-medium">Auto-sync enabled</p>
                <p className="text-surface-400 text-sm mt-1">
                  Videos are automatically checked against S3 storage when detected. If a video already exists in S3, 
                  it will be auto-imported as "synced" (marked with <span className="text-cyan-400">Auto</span> badge).
                  This prevents duplicate uploads and saves storage space.
                </p>
              </div>
            </div>
          </div>

          {/* Storage Sync Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-surface-100">Storage Diagnostics</h2>
              <p className="text-surface-400 text-sm mt-1">
                Scan and reconcile for edge cases - orphan files or missing records
              </p>
            </div>
            <button
              onClick={handleReconcile}
              disabled={syncLoading || !storage?.configured}
              className="btn-secondary flex items-center gap-2"
            >
              {syncLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  Run Diagnostics
                </>
              )}
            </button>
          </div>

          {!storage?.configured && (
            <div className="glass-card p-6 text-center">
              <svg className="w-12 h-12 mx-auto text-amber-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-surface-300">S3 storage is not configured. Configure it to use storage sync features.</p>
            </div>
          )}

          {storage?.configured && syncData && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-surface-100 font-mono">{syncData.summary?.totalInS3 || 0}</p>
                  <p className="text-xs text-surface-400">In S3</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-surface-100 font-mono">{syncData.summary?.syncedCount || 0}</p>
                  <p className="text-xs text-emerald-400">Synced</p>
                </div>
                <div className="glass-card p-4 text-center border-amber-500/30">
                  <p className="text-2xl font-bold text-amber-400 font-mono">{syncData.summary?.orphanCount || 0}</p>
                  <p className="text-xs text-surface-400">Orphans</p>
                </div>
                <div className="glass-card p-4 text-center border-red-500/30">
                  <p className="text-2xl font-bold text-red-400 font-mono">{syncData.summary?.missingCount || 0}</p>
                  <p className="text-xs text-surface-400">Missing in S3</p>
                </div>
              </div>

              {/* Orphan Files Section */}
              {syncData.orphanFiles?.length > 0 && (
                <div className="glass-card p-4 border-amber-500/30">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-amber-400">Orphan Files Found</h3>
                      <p className="text-sm text-surface-400">
                        Files in S3 not tracked locally. These may be from manual uploads or before auto-sync was enabled.
                        Import to track them, or delete to free storage space.
                      </p>
                    </div>
                    {selectedOrphans.length > 0 && (
                      <div className="flex gap-2">
                        <button
                          onClick={handleBulkImportOrphans}
                          disabled={orphanActionLoading === 'bulk-import'}
                          className="btn-primary text-xs"
                        >
                          {orphanActionLoading === 'bulk-import' ? 'Importing...' : `Import (${selectedOrphans.length})`}
                        </button>
                        <button
                          onClick={handleBulkDeleteOrphans}
                          disabled={orphanActionLoading === 'bulk-delete'}
                          className="btn-ghost text-xs text-red-400 hover:text-red-300"
                        >
                          {orphanActionLoading === 'bulk-delete' ? 'Deleting...' : `Delete (${selectedOrphans.length})`}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-surface-700">
                          <th className="text-left py-2 px-3">
                            <input
                              type="checkbox"
                              checked={selectedOrphans.length === syncData.orphanFiles.length}
                              onChange={toggleAllOrphans}
                              className="rounded border-surface-600"
                            />
                          </th>
                          <th className="text-left py-2 px-3 text-surface-400 font-medium">S3 Key</th>
                          <th className="text-left py-2 px-3 text-surface-400 font-medium">Size</th>
                          <th className="text-left py-2 px-3 text-surface-400 font-medium">Video URL</th>
                          <th className="text-right py-2 px-3 text-surface-400 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncData.orphanFiles.map((orphan) => (
                          <tr key={orphan.key} className="border-b border-surface-800 hover:bg-surface-800/50">
                            <td className="py-2 px-3">
                              <input
                                type="checkbox"
                                checked={selectedOrphans.includes(orphan.key)}
                                onChange={() => toggleOrphanSelection(orphan.key)}
                                className="rounded border-surface-600"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <a
                                href={orphan.s3Url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-400 hover:text-primary-300 truncate block max-w-[200px]"
                                title={orphan.key}
                              >
                                {orphan.key}
                              </a>
                            </td>
                            <td className="py-2 px-3 text-surface-400 whitespace-nowrap">
                              {orphan.size ? `${(orphan.size / 1024 / 1024).toFixed(2)} MB` : '-'}
                            </td>
                            <td className="py-2 px-3">
                              <span className="text-surface-500 truncate block max-w-[150px]" title={orphan.videoUrl}>
                                {orphan.videoUrl || 'No metadata'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => handleImportOrphan(orphan.key)}
                                  disabled={orphanActionLoading === orphan.key}
                                  className="btn-secondary text-xs py-1 px-2"
                                >
                                  {orphanActionLoading === orphan.key ? '...' : 'Import'}
                                </button>
                                <button
                                  onClick={() => handleDeleteOrphan(orphan.key)}
                                  disabled={orphanActionLoading === orphan.key}
                                  className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Missing in S3 Section */}
              {syncData.missingInS3?.length > 0 && (
                <div className="glass-card p-4 border-red-500/30">
                  <h3 className="text-lg font-medium text-surface-100 mb-2">Missing in S3</h3>
                  <p className="text-sm text-surface-400 mb-4">
                    Videos marked as synced but no longer exist in S3. You may want to re-sync them.
                  </p>
                  <div className="space-y-2">
                    {syncData.missingInS3.map((video) => (
                      <div key={video.id} className="flex items-center justify-between bg-surface-800/50 rounded p-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-surface-200 truncate">{video.videoUrl}</p>
                          <p className="text-xs text-surface-500">ID: {video.id}</p>
                        </div>
                        <StatusBadge status="error" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Synced Message */}
              {syncData.summary?.orphanCount === 0 && syncData.summary?.missingCount === 0 && (
                <div className="glass-card p-6 text-center border-emerald-500/30">
                  <svg className="w-12 h-12 mx-auto text-emerald-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-emerald-400 font-medium">Storage is in sync!</p>
                  <p className="text-surface-400 text-sm mt-1">No orphan files or missing records found.</p>
                </div>
              )}
            </>
          )}

          {storage?.configured && !syncData && !syncLoading && (
            <div className="glass-card p-6 text-center">
              <svg className="w-12 h-12 mx-auto text-surface-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-surface-300">Click "Scan & Reconcile" to compare local tracker with S3 storage.</p>
            </div>
          )}
        </div>
      )}

      {/* Videos Tab Content */}
      {activeTab === 'videos' && (
        <>
      {/* Bulk Action Toolbar */}
      {selectedIds.length > 0 && (
        <div className="glass-card p-3 flex items-center justify-between">
          <span className="text-surface-300 text-sm">
            {selectedIds.length} video{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds([])}
              className="btn-ghost text-xs"
            >
              Clear Selection
            </button>
            {storage?.configured && (
              <button
                onClick={handleBulkReupload}
                disabled={bulkReuploading}
                className="btn-secondary text-xs"
              >
                {bulkReuploading ? 'Re-uploading...' : 'Re-upload Selected'}
              </button>
            )}
            <button
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="btn-ghost text-xs text-red-400 hover:text-red-300"
            >
              Delete Selected
            </button>
          </div>
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
                {storage?.configured && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">Auto-dedup</span>
                )}
              </div>
              {storage?.configured && (
                <p className="text-xs sm:text-sm text-surface-400 mt-1 truncate">
                  {storage.endpoint} / {storage.bucket} / {storage.keyPrefix}
                </p>
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
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value)
            setPage(1) // Reset to first page on search
          }}
          placeholder="Search videos..."
          className="w-full sm:w-64"
        />
        
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setPage(1) // Reset to first page on filter change
          }}
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
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {Object.entries(data.stats.byStatus).map(([status, count]) => (
              <div key={status} className="glass-card p-3 sm:p-4 text-center">
                <p className="text-lg sm:text-xl font-bold text-surface-100 font-mono">{count}</p>
                <p className="text-xs sm:text-sm text-surface-400 capitalize">{status}</p>
              </div>
            ))}
          </div>
          {(data.stats.autoImported > 0 || data.stats.skippedUpload > 0) && (
            <div className="flex flex-wrap gap-3 text-xs">
              {data.stats.autoImported > 0 && (
                <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400">
                  {data.stats.autoImported} auto-imported from S3
                </span>
              )}
              {data.stats.skippedUpload > 0 && (
                <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400">
                  {data.stats.skippedUpload} uploads skipped (dedup)
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={data?.videos || []}
        loading={loading}
        emptyMessage="No videos tracked yet"
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        pagination={pagination}
        onPageChange={setPage}
      />
        </>
      )}

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

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected Videos"
        message={`Are you sure you want to delete ${selectedIds.length} video${selectedIds.length > 1 ? 's' : ''}? This will also delete them from S3 storage if synced.`}
        confirmText={bulkDeleting ? 'Deleting...' : 'Delete'}
        confirmDisabled={bulkDeleting}
        variant="danger"
      />
    </div>
  )
}
