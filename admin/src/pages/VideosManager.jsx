import { useState, useCallback, useEffect, useMemo } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import SearchInput from '../components/SearchInput'
import MultiStatusFilter from '../components/MultiStatusFilter'
import DateRangePicker from '../components/DateRangePicker'
import QuickActionsMenu, { ActionIcons } from '../components/QuickActionsMenu'
import {
  getVideos,
  addVideo,
  updateVideo,
  deleteVideo,
  bulkDeleteVideos,
  syncVideo,
  syncAllVideos,
  downloadVideo as downloadVideoApi,
  reuploadVideo as reuploadVideoApi,
  bulkReuploadVideos,
  bulkSyncVideos,
  retryFailedVideos,
  resetStuckUploads,
  getStorageStatus,
  testStorageConnection,
  reconcileStorage,
  importOrphan,
  deleteOrphan,
  bulkImportOrphans,
  bulkDeleteOrphans,
  exportVideos,
  fixMissingInS3
} from '../lib/api'
import usePolling from '../hooks/usePolling'
import { useDebounce } from '../hooks/useDebounce'
import { optimisticDelete, optimisticBulkDelete, optimisticStatusUpdate } from '../hooks/useOptimistic'
import { useSSE, useVideoProgress } from '../hooks/useSSE'
import { ProgressBadge } from '../components/ProgressBar'
import UploadQueueTab from '../components/UploadQueueTab'
import ReuploadModal from '../components/ReuploadModal'
import RetryModal from '../components/RetryModal'
import ErrorDetailModal from '../components/ErrorDetailModal'
import OrphanPreviewModal from '../components/OrphanPreviewModal'
import { useToast } from '../components/Toast'

export default function VideosManager() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [storage, setStorage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('') // Single status filter (legacy, kept for compatibility)
  const [statusFilter, setStatusFilter] = useState([]) // Multi-status filter
  const [dateRange, setDateRange] = useState({ from: null, to: null }) // Date range filter
  const [sourceUrlFilter, setSourceUrlFilter] = useState('') // Source URL filter
  const [hlsOnlyFilter, setHlsOnlyFilter] = useState(false) // HLS only filter
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300) // Debounce search input
  const debouncedSourceUrl = useDebounce(sourceUrlFilter, 300) // Debounce source URL filter
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
  
  // Reupload modal state
  const [showReuploadModal, setShowReuploadModal] = useState(false)
  const [reuploadingVideo, setReuploadingVideo] = useState(null) // Single video or null for bulk
  const [selectAllAcrossPages, setSelectAllAcrossPages] = useState(false) // Select all across pages
  
  // Retry modal state
  const [showRetryModal, setShowRetryModal] = useState(false)
  const [retrying, setRetrying] = useState(false)
  
  // Storage sync state
  const [activeTab, setActiveTab] = useState('videos') // 'videos' or 'storage-sync'
  const [syncData, setSyncData] = useState(null)
  const [syncLoading, setSyncLoading] = useState(false)
  const [selectedOrphans, setSelectedOrphans] = useState([])
  const [orphanActionLoading, setOrphanActionLoading] = useState(null)
  const [previewOrphan, setPreviewOrphan] = useState(null) // Orphan file being previewed
  
  const [formData, setFormData] = useState({
    videoUrl: '',
    sourceUrl: '',
    mimeType: 'video/mp4',
    isHLS: false
  })

  const fetchData = useCallback(async () => {
    try {
      const params = { page, limit, sortBy, sortOrder }
      
      // Use multi-status filter if set, otherwise use single filter
      if (statusFilter.length > 0) {
        params.status = statusFilter.join(',')
      } else if (filter) {
        params.status = filter
      }
      
      if (debouncedSearch) params.search = debouncedSearch
      
      // Date range filter
      if (dateRange.from) params.dateFrom = dateRange.from.toISOString()
      if (dateRange.to) params.dateTo = dateRange.to.toISOString()
      
      // Source URL filter
      if (debouncedSourceUrl) params.sourceUrl = debouncedSourceUrl
      
      // HLS only filter
      if (hlsOnlyFilter) params.isHLS = true
      
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
  }, [filter, statusFilter, dateRange, debouncedSearch, debouncedSourceUrl, hlsOnlyFilter, sortBy, sortOrder, page, limit])

  // Smart polling with visibility API and exponential backoff
  const { refresh, setPending, isVisible } = usePolling(fetchData, 10000, {
    enabled: true,
    pauseOnHidden: true,
    useBackoff: true,
    maxInterval: 60000,
    backoffFactor: 1.5
  })

  // Reset to page 1 when debounced search changes
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  // SSE connection for real-time progress updates
  const sse = useSSE('/admin/api/logs/stream', { enabled: true })
  const { progress: videoProgress, getProgress } = useVideoProgress(sse)

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
    setPending(true)
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
      setPending(false)
    }
  }

  const handleDelete = async (video) => {
    setActionLoading(video.id)
    setPending(true)
    setConfirmDelete(null)
    
    // Optimistic update - remove item immediately
    const previousVideos = data?.videos || []
    setData(prev => prev ? {
      ...prev,
      videos: optimisticDelete(prev.videos, video.id),
      stats: {
        ...prev.stats,
        total: (prev.stats?.total || 0) - 1,
        byStatus: {
          ...prev.stats?.byStatus,
          [video.status]: (prev.stats?.byStatus?.[video.status] || 1) - 1
        }
      }
    } : prev)
    
    try {
      const result = await deleteVideo(video.id)
      if (result.storageError) {
        toast.warning(`S3 deletion failed: ${result.storageError}`, 'Partial Delete')
      } else {
        toast.success('Video deleted successfully')
      }
      // Refresh to get accurate data from server
      refresh()
    } catch (err) {
      // Rollback on error
      setData(prev => prev ? { ...prev, videos: previousVideos } : prev)
      toast.error(err.message, 'Delete Failed')
    } finally {
      setActionLoading(null)
      setPending(false)
    }
  }

  const handleSync = async (id) => {
    setActionLoading(id)
    setPending(true)
    
    // Optimistic update - set status to uploading
    const previousStatus = data?.videos?.find(v => v.id === id)?.status
    setData(prev => prev ? {
      ...prev,
      videos: optimisticStatusUpdate(prev.videos, id, 'uploading')
    } : prev)
    
    try {
      await syncVideo(id)
      toast.success('Video synced to S3 successfully')
      refresh()
    } catch (err) {
      // Rollback status on error
      if (previousStatus) {
        setData(prev => prev ? {
          ...prev,
          videos: optimisticStatusUpdate(prev.videos, id, previousStatus)
        } : prev)
      }
      toast.error(err.message, 'Sync Failed')
    } finally {
      setActionLoading(null)
      setPending(false)
    }
  }

  const handleDownload = async (id) => {
    setActionLoading(`download-${id}`)
    setShowDownloadModal(true)
    setDownloadResult(null)
    setPending(true)
    try {
      const result = await downloadVideoApi(id)
      setDownloadResult(result)
      if (result.success) {
        toast.success('Video downloaded successfully')
      }
      refresh() // Refresh to show updated download status
    } catch (err) {
      setDownloadResult({ success: false, error: err.message })
      toast.error(err.message, 'Download Failed')
    } finally {
      setActionLoading(null)
      setPending(false)
    }
  }

  // Open reupload modal for single video
  const openReuploadModal = (video) => {
    setReuploadingVideo(video)
    setShowReuploadModal(true)
  }

  // Open reupload modal for bulk
  const openBulkReuploadModal = () => {
    setReuploadingVideo(null)
    setShowReuploadModal(true)
  }

  // Handle reupload with options from modal
  const handleReuploadWithOptions = async (options) => {
    setShowReuploadModal(false)
    
    if (reuploadingVideo) {
      // Single video reupload
      const id = reuploadingVideo.id
      setActionLoading(`reupload-${id}`)
      setPending(true)
      
      const previousStatus = reuploadingVideo.status
      setData(prev => prev ? {
        ...prev,
        videos: optimisticStatusUpdate(prev.videos, id, 'uploading')
      } : prev)
      
      try {
        await reuploadVideoApi(id, options)
        toast.success('Video re-upload started')
        refresh()
      } catch (err) {
        setData(prev => prev ? {
          ...prev,
          videos: optimisticStatusUpdate(prev.videos, id, previousStatus)
        } : prev)
        toast.error(err.message, 'Re-upload Failed')
      } finally {
        setActionLoading(null)
        setPending(false)
      }
    } else {
      // Bulk reupload
      await handleBulkReuploadWithOptions(options)
    }
    
    setReuploadingVideo(null)
  }

  // Bulk reupload with options
  const handleBulkReuploadWithOptions = async (options) => {
    if (selectedIds.length === 0) return
    
    setBulkReuploading(true)
    setPending(true)
    
    const previousVideos = data?.videos || []
    const idsToReupload = [...selectedIds]
    
    try {
      const result = await bulkReuploadVideos(idsToReupload, options)
      setSelectedIds([])
      refresh()
      if (result.failed > 0) {
        toast.warning(`Re-uploaded ${result.success}/${result.total} videos. ${result.failed} failed.`, 'Partial Success')
      } else {
        toast.success(`Re-uploaded ${result.success} videos successfully`)
      }
    } catch (err) {
      toast.error(err.message, 'Bulk Re-upload Failed')
    } finally {
      setBulkReuploading(false)
      setPending(false)
    }
  }

  // Legacy single reupload (without modal)
  const handleReupload = async (id) => {
    setActionLoading(`reupload-${id}`)
    setPending(true)
    
    // Optimistic update - set status to uploading
    const previousStatus = data?.videos?.find(v => v.id === id)?.status
    setData(prev => prev ? {
      ...prev,
      videos: optimisticStatusUpdate(prev.videos, id, 'uploading')
    } : prev)
    
    try {
      await reuploadVideoApi(id)
      toast.success('Re-upload started')
      refresh()
    } catch (err) {
      // Rollback status on error
      if (previousStatus) {
        setData(prev => prev ? {
          ...prev,
          videos: optimisticStatusUpdate(prev.videos, id, previousStatus)
        } : prev)
      }
      toast.error(err.message, 'Re-upload Failed')
    } finally {
      setActionLoading(null)
      setPending(false)
    }
  }

  const handleSyncAll = async () => {
    setSyncingAll(true)
    setPending(true)
    try {
      const result = await syncAllVideos()
      setError(null)
      if (result.failed > 0) {
        toast.warning(`Synced ${result.synced} videos. ${result.failed} failed.`, 'Partial Sync')
      } else {
        toast.success(`Synced ${result.synced} videos successfully`)
      }
      refresh()
    } catch (err) {
      toast.error(err.message, 'Sync All Failed')
    } finally {
      setSyncingAll(false)
      setPending(false)
    }
  }

  const handleResetStuck = async () => {
    setResettingStuck(true)
    setPending(true)
    try {
      const result = await resetStuckUploads(10)
      setError(null)
      if (result.reset > 0) {
        toast.info(`Reset ${result.reset} stuck uploads to pending.`)
      } else {
        toast.info('No stuck uploads found (>10 minutes)')
      }
      refresh()
    } catch (err) {
      toast.error(err.message, 'Reset Failed')
    } finally {
      setResettingStuck(false)
      setPending(false)
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    try {
      await testStorageConnection()
      toast.success('S3 connection successful!')
    } catch (err) {
      toast.error(err.message, 'Connection Failed')
    } finally {
      setTestingConnection(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    
    setBulkDeleting(true)
    setPending(true)
    setShowBulkDeleteConfirm(false)
    
    // Store previous data for rollback
    const previousVideos = data?.videos || []
    const idsToDelete = [...selectedIds]
    
    // Optimistic update - remove items immediately
    setData(prev => prev ? {
      ...prev,
      videos: optimisticBulkDelete(prev.videos, idsToDelete)
    } : prev)
    setSelectedIds([])
    
    try {
      const result = await bulkDeleteVideos(idsToDelete)
      if (result.errors && result.errors.length > 0) {
        toast.warning(`Deleted ${result.deleted} videos, but ${result.errors.length} failed`, 'Partial Delete')
      } else {
        toast.success(`Deleted ${result.deleted} videos successfully`)
      }
      // Refresh to get accurate data from server
      refresh()
    } catch (err) {
      // Rollback on error
      setData(prev => prev ? { ...prev, videos: previousVideos } : prev)
      setSelectedIds(idsToDelete)
      toast.error(err.message, 'Bulk Delete Failed')
    } finally {
      setBulkDeleting(false)
      setPending(false)
    }
  }

  const handleBulkReupload = async () => {
    if (selectedIds.length === 0) return
    
    setBulkReuploading(true)
    setPending(true)
    try {
      const result = await bulkReuploadVideos(selectedIds)
      setSelectedIds([])
      refresh()
      if (result.failed > 0) {
        toast.warning(`Re-uploaded ${result.success}/${result.total} videos. ${result.failed} failed.`, 'Partial Success')
      } else {
        toast.success(`Re-uploaded ${result.success} videos successfully`)
      }
    } catch (err) {
      toast.error(err.message, 'Bulk Re-upload Failed')
    } finally {
      setBulkReuploading(false)
      setPending(false)
    }
  }

  // Export handler
  const handleExport = async () => {
    try {
      const params = { sortBy, sortOrder }
      if (statusFilter.length > 0) params.status = statusFilter.join(',')
      else if (filter) params.status = filter
      if (debouncedSearch) params.search = debouncedSearch
      if (dateRange.from) params.dateFrom = dateRange.from.toISOString()
      if (dateRange.to) params.dateTo = dateRange.to.toISOString()
      
      const result = await exportVideos('csv', params)
      
      // Create download link
      const blob = new Blob([result.csv || JSON.stringify(result.data, null, 2)], { 
        type: 'text/csv;charset=utf-8;' 
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `videos-export-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success('Export downloaded successfully')
    } catch (err) {
      toast.error(err.message, 'Export Failed')
    }
  }

  // Bulk sync handler
  const handleBulkSync = async () => {
    if (selectedIds.length === 0) return
    
    setPending(true)
    try {
      const result = await bulkSyncVideos(selectedIds)
      setSelectedIds([])
      refresh()
      if (result.failed > 0) {
        toast.warning(`Synced ${result.synced}/${result.total} videos. ${result.failed} failed.`, 'Partial Sync')
      } else {
        toast.success(`Synced ${result.synced} videos successfully`)
      }
    } catch (err) {
      toast.error(err.message, 'Bulk Sync Failed')
    } finally {
      setPending(false)
    }
  }

  // Open retry modal
  const openRetryModal = () => {
    setShowRetryModal(true)
  }

  // Retry failed handler with options from modal
  const handleRetryFailed = async (options = {}) => {
    setRetrying(true)
    setPending(true)
    setShowRetryModal(false)
    try {
      const result = await retryFailedVideos(options)
      refresh()
      toast.info(`Retry queued for ${result.queued} failed videos`)
    } catch (err) {
      toast.error(err.message, 'Retry Failed')
    } finally {
      setRetrying(false)
      setPending(false)
    }
  }

  // Fix missing in S3 handler
  const handleFixMissing = async () => {
    if (!syncData?.missingInS3?.length) return
    
    setPending(true)
    try {
      const ids = syncData.missingInS3.map(v => v.id)
      const result = await fixMissingInS3(ids)
      await handleReconcile()
      refresh()
      if (result.failed > 0) {
        toast.warning(`Fixed ${result.fixed} missing videos. ${result.failed} failed.`, 'Partial Fix')
      } else {
        toast.success(`Fixed ${result.fixed} missing videos`)
      }
    } catch (err) {
      toast.error(err.message, 'Fix Failed')
    } finally {
      setPending(false)
    }
  }

  // Storage Sync handlers
  // Run diagnostics - always clears cache and forces fresh scan
  const handleReconcile = async () => {
    setSyncLoading(true)
    setError(null)
    setSyncData(null) // Clear current data to show loading state
    try {
      // Always force refresh when user clicks Run Diagnostics
      const result = await reconcileStorage(true)
      setSyncData(result)
      setSelectedOrphans([])
      toast.success('Storage scan complete')
    } catch (err) {
      toast.error(err.message, 'Scan Failed')
    } finally {
      setSyncLoading(false)
    }
  }
  
  // Quick refresh - uses cache if available
  const handleQuickRefresh = async () => {
    setSyncLoading(true)
    setError(null)
    try {
      const result = await reconcileStorage(false)
      setSyncData(result)
      setSelectedOrphans([])
      if (result.fromCache) {
        toast.info('Using cached data (updated ' + formatTimeAgo(result.lastUpdated) + ')')
      } else {
        toast.success('Storage scan complete')
      }
    } catch (err) {
      toast.error(err.message, 'Scan Failed')
    } finally {
      setSyncLoading(false)
    }
  }
  
  // Format timestamp to relative time
  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'never'
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return new Date(timestamp).toLocaleDateString()
  }

  const handleImportOrphan = async (key) => {
    setOrphanActionLoading(key)
    try {
      await importOrphan(key)
      toast.success('Orphan file imported')
      // Refresh reconciliation data
      await handleReconcile()
      refresh()
    } catch (err) {
      toast.error(err.message, 'Import Failed')
    } finally {
      setOrphanActionLoading(null)
    }
  }

  const handleDeleteOrphan = async (key) => {
    setOrphanActionLoading(key)
    try {
      await deleteOrphan(key)
      toast.success('Orphan file deleted')
      // Refresh reconciliation data
      await handleReconcile()
    } catch (err) {
      toast.error(err.message, 'Delete Failed')
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
        toast.warning(`Imported ${result.imported} orphans, ${result.failed} failed`, 'Partial Import')
      } else {
        toast.success(`Imported ${result.imported} orphan files`)
      }
      setSelectedOrphans([])
      await handleReconcile()
      refresh()
    } catch (err) {
      toast.error(err.message, 'Bulk Import Failed')
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
        toast.warning(`Deleted ${result.deleted} orphans, ${result.failed} failed`, 'Partial Delete')
      } else {
        toast.success(`Deleted ${result.deleted} orphan files`)
      }
      setSelectedOrphans([])
      await handleReconcile()
    } catch (err) {
      toast.error(err.message, 'Bulk Delete Failed')
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

  // Helper function to format file size
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`
  }

  // Helper function to format duration
  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '-'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
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
      render: (row) => {
        const progress = getProgress(row.id)
        
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Show progress badge if operation in progress */}
              {progress && (progress.status === 'downloading' || progress.status === 'uploading') ? (
                <ProgressBadge 
                  percent={progress.percent} 
                  status={progress.status}
                  type={progress.type}
                />
              ) : (
                <StatusBadge status={row.status} />
              )}
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
            {/* Show progress details */}
            {progress && progress.speed && (
              <span className="text-xs text-surface-500">
                {Math.round(progress.speed / 1024)}KB/s
                {progress.eta && ` • ETA: ${progress.eta}s`}
              </span>
            )}
            {row.status === 'error' && row.error && !progress && (
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
      }
    },
    {
      header: 'Size / Duration',
      accessor: 'fileSize',
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="text-surface-300" title={row.downloadSize ? `${row.downloadSize} bytes` : ''}>
            {formatFileSize(row.downloadSize || row.fileSize)}
          </span>
          {row.duration > 0 && (
            <span className="text-surface-500" title={`${row.duration} seconds`}>
              {formatDuration(row.duration)}
            </span>
          )}
          {row.isHLS && (
            <span className="text-xs px-1 py-0.5 rounded bg-violet-500/20 text-violet-400 w-fit">HLS</span>
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
      render: (row) => {
        const isLoading = actionLoading?.includes(row.id)
        
        // Build actions based on video status
        const actions = []
        
        // Preview action (if synced with S3 URL)
        if (row.s3Url) {
          actions.push({
            label: 'Preview',
            icon: ActionIcons.preview,
            onClick: () => window.open(row.s3Url, '_blank')
          })
        }
        
        // Download action (only for pending without downloaded)
        if (row.status === 'pending' && !row.downloadedAt) {
          actions.push({
            label: 'Download',
            icon: ActionIcons.download,
            onClick: () => handleDownload(row.id),
            loading: actionLoading === `download-${row.id}`
          })
        }
        
        // Sync action (only for pending with storage configured)
        if (row.status === 'pending' && storage?.configured) {
          actions.push({
            label: 'Sync to S3',
            icon: ActionIcons.sync,
            onClick: () => handleSync(row.id),
            loading: actionLoading === row.id
          })
        }
        
        // Re-upload action (for synced, error, or uploading)
        if (['synced', 'error', 'uploading'].includes(row.status) && storage?.configured) {
          actions.push({
            label: row.status === 'uploading' ? 'Reset Upload' : 'Re-upload',
            icon: ActionIcons.reupload,
            onClick: () => handleReupload(row.id),
            loading: actionLoading === `reupload-${row.id}`,
            variant: row.status === 'uploading' ? 'warning' : undefined
          })
        }
        
        // Copy URL action
        actions.push({
          label: 'Copy Video URL',
          icon: ActionIcons.copy,
          onClick: () => {
            navigator.clipboard.writeText(row.videoUrl)
            // Could add toast notification here
          }
        })
        
        if (row.s3Url) {
          actions.push({
            label: 'Copy S3 URL',
            icon: ActionIcons.copy,
            onClick: () => navigator.clipboard.writeText(row.s3Url)
          })
        }
        
        actions.push({ divider: true })
        
        // Edit action
        actions.push({
          label: 'Edit',
          icon: ActionIcons.edit,
          onClick: () => {
            setEditVideo(row)
            setShowAddModal(true)
          }
        })
        
        // Delete action
        actions.push({
          label: 'Delete',
          icon: ActionIcons.delete,
          onClick: () => setConfirmDelete(row),
          variant: 'danger'
        })
        
        return (
          <QuickActionsMenu
            actions={actions}
            disabled={isLoading}
            size="sm"
          />
        )
      }
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
          {activeTab === 'videos' && storage?.configured && data?.stats?.byStatus?.error > 0 && (
            <button
              onClick={openRetryModal}
              disabled={retrying}
              className="btn-ghost flex items-center gap-2 text-sm text-red-400 hover:text-red-300"
              title="Retry all failed videos with options"
            >
              {retrying ? 'Retrying...' : `Retry Failed (${data.stats.byStatus.error})`}
            </button>
          )}
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
          onClick={() => setActiveTab('upload-queue')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'upload-queue'
              ? 'bg-primary-600 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Upload Queue
          {data?.stats?.byStatus?.uploading > 0 && (
            <span className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
          )}
        </button>
        <button
          onClick={() => {
            setActiveTab('storage-sync')
            // Load cached data from server if we don't have data yet
            if (!syncData && storage?.configured) {
              handleQuickRefresh()
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
              {syncData?.lastUpdated && (
                <p className="text-surface-500 text-xs mt-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Last updated: {formatTimeAgo(syncData.lastUpdated)}
                  {syncData.fromCache && <span className="text-cyan-400 ml-1">(cached)</span>}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {syncData && (
                <button
                  onClick={handleQuickRefresh}
                  disabled={syncLoading || !storage?.configured}
                  className="btn-ghost flex items-center gap-2 text-sm"
                  title="Quick refresh - uses cache if available"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Quick Refresh
                </button>
              )}
              <button
                onClick={handleReconcile}
                disabled={syncLoading || !storage?.configured}
                className="btn-secondary flex items-center gap-2"
                title="Full scan - clears cache and scans S3 storage"
              >
                {syncLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Scanning S3...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    {syncData ? 'Full Scan' : 'Run Diagnostics'}
                  </>
                )}
              </button>
            </div>
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
                <div className="glass-card p-4 text-center bg-gradient-to-br from-primary-500/10 to-transparent">
                  <p className="text-2xl font-bold text-primary-400 font-mono">{syncData.summary?.totalStorageSizeFormatted || '0 B'}</p>
                  <p className="text-xs text-surface-400">Total Storage</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-surface-100 font-mono">{syncData.summary?.totalInS3 || 0}</p>
                  <p className="text-xs text-surface-400">Files in S3</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-400 font-mono">{syncData.summary?.syncedCount || 0}</p>
                  <p className="text-xs text-emerald-400">Synced</p>
                </div>
                <div className="glass-card p-4 text-center border-amber-500/30">
                  <p className="text-2xl font-bold text-amber-400 font-mono">{syncData.summary?.orphanCount || 0}</p>
                  <p className="text-xs text-surface-400">Orphans</p>
                  {syncData.summary?.orphanSizeFormatted && syncData.summary?.orphanCount > 0 && (
                    <p className="text-[10px] text-amber-400/70 mt-0.5">{syncData.summary.orphanSizeFormatted}</p>
                  )}
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
                              <button
                                onClick={() => setPreviewOrphan(orphan)}
                                className="text-primary-400 hover:text-primary-300 truncate block max-w-[200px] text-left"
                                title={`Preview: ${orphan.key}`}
                              >
                                {orphan.key}
                              </button>
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
                                  onClick={() => setPreviewOrphan(orphan)}
                                  className="btn-ghost text-xs py-1 px-2 text-violet-400 hover:text-violet-300"
                                  title="Preview file"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                </button>
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
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-red-400">Missing in S3</h3>
                      <p className="text-sm text-surface-400">
                        Videos marked as synced but no longer exist in S3. Click "Fix Missing" to re-sync them.
                      </p>
                    </div>
                    <button
                      onClick={handleFixMissing}
                      className="btn-primary text-sm shrink-0"
                    >
                      Fix Missing ({syncData.missingInS3.length})
                    </button>
                  </div>
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

      {/* Upload Queue Tab */}
      {activeTab === 'upload-queue' && (
        <UploadQueueTab 
          videoProgress={videoProgress} 
          onRefresh={refresh}
          uploadingVideos={data?.videos?.filter(v => v.status === 'uploading') || []}
        />
      )}

      {/* Videos Tab Content */}
      {activeTab === 'videos' && (
        <>
      {/* Bulk Action Toolbar */}
      {(selectedIds.length > 0 || selectAllAcrossPages) && (
        <div className="glass-card p-3 flex items-center justify-between">
          <span className="text-surface-300 text-sm">
            {selectAllAcrossPages 
              ? `All ${pagination?.total || 0} matching videos selected`
              : `${selectedIds.length} video${selectedIds.length > 1 ? 's' : ''} selected`
            }
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedIds([])
                setSelectAllAcrossPages(false)
              }}
              className="btn-ghost text-xs"
            >
              Clear Selection
            </button>
            {storage?.configured && (
              <>
                <button
                  onClick={handleBulkSync}
                  className="btn-primary text-xs"
                >
                  Sync Selected
                </button>
                <button
                  onClick={openBulkReuploadModal}
                  disabled={bulkReuploading}
                  className="btn-secondary text-xs"
                >
                  {bulkReuploading ? 'Re-uploading...' : 'Re-upload Selected'}
                </button>
              </>
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
      <div className="flex flex-wrap gap-3 sm:gap-4 items-start">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search videos..."
          className="w-full sm:w-64"
        />
        
        <MultiStatusFilter
          selected={statusFilter}
          onChange={(newFilter) => {
            setStatusFilter(newFilter)
            setFilter('') // Clear single filter when using multi-filter
            setPage(1)
          }}
          className="w-full sm:w-auto"
        />
        
        <DateRangePicker
          from={dateRange.from}
          to={dateRange.to}
          onChange={(newRange) => {
            setDateRange(newRange)
            setPage(1)
          }}
          className="w-full sm:w-auto"
        />
        
        {/* Source URL Filter */}
        <div className="relative">
          <input
            type="text"
            value={sourceUrlFilter}
            onChange={(e) => {
              setSourceUrlFilter(e.target.value)
              setPage(1)
            }}
            placeholder="Filter by source URL..."
            className="input w-full sm:w-48 text-sm"
          />
          {sourceUrlFilter && (
            <button
              onClick={() => {
                setSourceUrlFilter('')
                setPage(1)
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        
        {/* HLS Only Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hlsOnlyFilter}
            onChange={(e) => {
              setHlsOnlyFilter(e.target.checked)
              setPage(1)
            }}
            className="form-checkbox h-4 w-4 text-violet-600 rounded border-surface-600 bg-surface-900"
          />
          <span className="text-sm text-surface-300 flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 text-xs">HLS</span>
            Only
          </span>
        </label>
        
        <div className="flex gap-2">
          <button onClick={refresh} className="btn-secondary">
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="btn-ghost text-surface-400 hover:text-surface-200"
            title="Export to CSV"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>
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
        selectAllAcrossPages={selectAllAcrossPages}
        onSelectAllAcrossPages={setSelectAllAcrossPages}
        totalSelectableCount={pagination?.total || 0}
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
      <ErrorDetailModal
        isOpen={!!showErrorDetail}
        onClose={() => setShowErrorDetail(null)}
        video={showErrorDetail}
        onRetry={(id) => handleReupload(id)}
        onDelete={(video) => setConfirmDelete(video)}
      />

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

      {/* Reupload Modal */}
      <ReuploadModal
        isOpen={showReuploadModal}
        onClose={() => {
          setShowReuploadModal(false)
          setReuploadingVideo(null)
        }}
        onConfirm={handleReuploadWithOptions}
        video={reuploadingVideo}
        count={reuploadingVideo ? 1 : selectedIds.length}
        loading={bulkReuploading}
      />

      {/* Retry Failed Modal */}
      <RetryModal
        isOpen={showRetryModal}
        onClose={() => setShowRetryModal(false)}
        onConfirm={handleRetryFailed}
        failedCount={data?.stats?.byStatus?.error || 0}
        loading={retrying}
      />

      {/* Orphan File Preview Modal */}
      <OrphanPreviewModal
        isOpen={!!previewOrphan}
        onClose={() => setPreviewOrphan(null)}
        orphan={previewOrphan}
        onImport={(key) => {
          handleImportOrphan(key)
          setPreviewOrphan(null)
        }}
        onDelete={(key) => {
          handleDeleteOrphan(key)
          setPreviewOrphan(null)
        }}
        loading={orphanActionLoading === previewOrphan?.key}
      />
    </div>
  )
}
