import { useState, useCallback } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { getUrls, getUrlDetails, addUrl, rescrapeUrl, cancelUrl, deleteUrl, bulkDeleteUrls, getUrlCachedResponse } from '../lib/api'
import usePolling from '../hooks/usePolling'

export default function URLs() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewData, setViewData] = useState(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  
  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState([])
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  
  // Cached response tab state
  const [activeTab, setActiveTab] = useState('overview')
  const [cachedResponse, setCachedResponse] = useState(null)
  const [cachedLoading, setCachedLoading] = useState(false)
  
  // Snapshot modal state
  const [showSnapshotModal, setShowSnapshotModal] = useState(false)
  const [snapshotUrl, setSnapshotUrl] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const params = filter ? { status: filter } : {}
      const result = await getUrls(params)
      setData(result)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filter])

  const { refresh } = usePolling(fetchData, 10000)

  const handleAddUrl = async () => {
    if (!newUrl.trim()) return
    
    setAdding(true)
    try {
      await addUrl(newUrl)
      setNewUrl('')
      setShowAddModal(false)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const handleViewDetails = async (id) => {
    setViewLoading(true)
    setShowViewModal(true)
    setActiveTab('overview')
    setCachedResponse(null)
    try {
      const details = await getUrlDetails(id)
      setViewData(details)
    } catch (err) {
      setError(err.message)
      setShowViewModal(false)
    } finally {
      setViewLoading(false)
    }
  }
  
  const loadCachedResponse = async (id) => {
    setCachedLoading(true)
    try {
      const data = await getUrlCachedResponse(id)
      setCachedResponse(data)
    } catch (err) {
      setCachedResponse({ error: err.message })
    } finally {
      setCachedLoading(false)
    }
  }

  const handleCloseViewModal = () => {
    setShowViewModal(false)
    setViewData(null)
    setActiveTab('overview')
    setCachedResponse(null)
  }

  const handleCancel = async (id) => {
    setActionLoading(id)
    try {
      await cancelUrl(id)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (id) => {
    setActionLoading(id)
    try {
      await deleteUrl(id)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleRescrape = async (id) => {
    setActionLoading(id)
    try {
      await rescrapeUrl(id)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }
  
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    
    setBulkDeleting(true)
    try {
      const result = await bulkDeleteUrls(selectedIds)
      setSelectedIds([])
      setShowBulkDeleteConfirm(false)
      refresh()
      if (result.failed && result.failed.length > 0) {
        setError(`Deleted ${result.deleted} URLs, but ${result.failed.length} failed`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkDeleting(false)
    }
  }
  
  const handleViewSnapshot = (url) => {
    setSnapshotUrl(url)
    setShowSnapshotModal(true)
  }

  const formatDuration = (record) => {
    if (!record.startedAt) return '-'
    const start = new Date(record.startedAt)
    const end = record.completedAt ? new Date(record.completedAt) : new Date()
    const ms = end - start
    
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  }

  const columns = [
    {
      header: 'URL',
      accessor: 'url',
      render: (row) => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-400 hover:text-primary-300 truncate block max-w-[150px] sm:max-w-[300px]"
          title={row.url}
        >
          {row.url}
        </a>
      )
    },
    {
      header: 'Status',
      accessor: 'status',
      render: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={row.status} />
          {row.status === 'error' && row.error && (
            <span 
              className="text-xs text-red-400 truncate max-w-[150px] cursor-help"
              title={row.error}
            >
              {row.error.length > 30 ? row.error.substring(0, 30) + '...' : row.error}
            </span>
          )}
        </div>
      )
    },
    {
      header: 'Result',
      render: (row) => (
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          {row.result ? (
            <>
              <span className="text-surface-400">{(row.result.htmlLength / 1024).toFixed(1)}KB</span>
              {row.result.videoUrls?.length > 0 && (
                <span className="badge-info">
                  {row.result.videoUrls.length} video{row.result.videoUrls.length > 1 ? 's' : ''}
                </span>
              )}
              {row.result.cached && (
                <span className="badge-neutral text-xs">cached</span>
              )}
            </>
          ) : (
            <span className="text-surface-500">-</span>
          )}
        </div>
      )
    },
    {
      header: 'Duration',
      render: (row) => (
        <span className="whitespace-nowrap text-xs sm:text-sm">
          {formatDuration(row)}
        </span>
      )
    },
    {
      header: 'Actions',
      render: (row) => (
        <div className="flex flex-wrap gap-1 sm:gap-2">
          {row.status === 'done' && row.result && (
            <button
              onClick={() => handleViewDetails(row.id)}
              className="btn-primary text-xs py-1 px-2"
            >
              View
            </button>
          )}
          {row.snapshotUrl && (
            <button
              onClick={() => handleViewSnapshot(row.snapshotUrl)}
              className="btn-secondary text-xs py-1 px-2"
              title="View error snapshot"
            >
              📷
            </button>
          )}
          {(row.status === 'done' || row.status === 'error') && (
            <button
              onClick={() => handleRescrape(row.id)}
              disabled={actionLoading === row.id}
              className="btn-info text-xs py-1 px-2"
            >
              {actionLoading === row.id ? 'Scraping...' : 'Re-scrape'}
            </button>
          )}
          {(row.status === 'waiting' || row.status === 'processing') && (
            <button
              onClick={() => handleCancel(row.id)}
              disabled={actionLoading === row.id}
              className="btn-secondary text-xs py-1 px-2"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => handleDelete(row.id)}
            disabled={actionLoading === row.id}
            className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      )
    }
  ]

  const statusOptions = ['', 'waiting', 'processing', 'done', 'cancelled', 'error']

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-100">URL Tracker</h1>
          <p className="text-surface-400 mt-1 text-sm sm:text-base">Track and manage processed URLs</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)} 
          className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add URL
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 sm:p-4 text-red-400 text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">×</button>
        </div>
      )}

      {/* Bulk Action Toolbar */}
      {selectedIds.length > 0 && (
        <div className="glass-card p-3 flex items-center justify-between">
          <span className="text-surface-300 text-sm">
            {selectedIds.length} URL{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds([])}
              className="btn-ghost text-xs"
            >
              Clear Selection
            </button>
            <button
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="btn-ghost text-xs text-red-400 hover:text-red-300"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
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
        data={data?.urls || []}
        loading={loading}
        emptyMessage="No URLs tracked yet"
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      {/* Add URL Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add URL"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              URL to scrape
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com"
              className="input"
              autoFocus
            />
            <p className="text-xs text-surface-500 mt-2">
              This will scrape the URL using the Puppeteer engine
            </p>
          </div>
          
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
            <button onClick={() => setShowAddModal(false)} className="btn-secondary w-full sm:w-auto">
              Cancel
            </button>
            <button
              onClick={handleAddUrl}
              disabled={adding || !newUrl.trim()}
              className="btn-primary w-full sm:w-auto"
            >
              {adding ? 'Scraping...' : 'Add URL'}
            </button>
          </div>
        </div>
      </Modal>

      {/* View Details Modal */}
      <Modal
        isOpen={showViewModal}
        onClose={handleCloseViewModal}
        title="Scrape Result"
        size="lg"
      >
        {viewLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-surface-400">Loading...</div>
          </div>
        ) : viewData ? (
          <div className="space-y-4">
            {/* Tab Navigation */}
            <div className="flex border-b border-surface-700">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 text-sm font-medium ${activeTab === 'overview' 
                  ? 'border-b-2 border-primary-500 text-primary-400' 
                  : 'text-surface-400 hover:text-surface-300'}`}
              >
                Overview
              </button>
              <button
                onClick={() => {
                  setActiveTab('cached')
                  if (!cachedResponse && viewData?.id) {
                    loadCachedResponse(viewData.id)
                  }
                }}
                className={`px-4 py-2 text-sm font-medium ${activeTab === 'cached' 
                  ? 'border-b-2 border-primary-500 text-primary-400' 
                  : 'text-surface-400 hover:text-surface-300'}`}
              >
                Cached Response
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'overview' ? (
              <>
                {/* URL Info */}
                <div className="glass-card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-surface-400">URL</span>
                    <a
                      href={viewData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-400 hover:text-primary-300 text-sm truncate max-w-[300px]"
                    >
                      {viewData.url}
                    </a>
                  </div>
                  {viewData.result?.title && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-surface-400">Title</span>
                      <span className="text-surface-200 text-sm truncate max-w-[300px]">
                        {viewData.result.title}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-surface-400">Status</span>
                    <StatusBadge status={viewData.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-surface-400">HTML Size</span>
                    <span className="text-surface-200 font-mono text-sm">
                      {viewData.result?.htmlLength 
                        ? `${(viewData.result.htmlLength / 1024).toFixed(2)} KB` 
                        : '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-surface-400">Cached</span>
                    <span className="text-surface-200 text-sm">
                      {viewData.result?.cached ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>

                {/* Videos */}
                {viewData.result?.videoUrls?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-surface-300 mb-2">
                      Videos Found ({viewData.result.videoUrls.length})
                    </h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {viewData.result.videoUrls.map((video, index) => (
                        <div key={index} className="glass-card p-3 text-sm">
                          <a
                            href={video.url || video}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-400 hover:text-primary-300 break-all"
                          >
                            {video.url || video}
                          </a>
                          {video.mimeType && (
                            <span className="ml-2 badge-neutral text-xs">{video.mimeType}</span>
                          )}
                          {video.isHLS && (
                            <span className="ml-2 badge-warning text-xs">HLS</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* HTML Preview */}
                {viewData.result?.htmlPreview && (
                  <div>
                    <h4 className="text-sm font-medium text-surface-300 mb-2">HTML Preview</h4>
                    <pre className="glass-card p-3 text-xs font-mono text-surface-400 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                      {viewData.result.htmlPreview}...
                    </pre>
                  </div>
                )}

                {/* Error */}
                {viewData.error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    <strong>Error:</strong> {viewData.error}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                {cachedLoading ? (
                  <div className="text-center py-8 text-surface-400">Loading cached response...</div>
                ) : cachedResponse?.error ? (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
                    {cachedResponse.error}
                    {cachedResponse.hint && (
                      <p className="text-xs mt-1 text-surface-500">{cachedResponse.hint}</p>
                    )}
                  </div>
                ) : cachedResponse ? (
                  <>
                    {/* Cache Info */}
                    <div className="glass-card p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-surface-400 text-sm">Cache Key</span>
                        <code className="text-xs text-surface-300 max-w-[300px] truncate" title={cachedResponse.cacheKey}>
                          {cachedResponse.cacheKey}
                        </code>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-surface-400 text-sm">HTML Size</span>
                        <span className="text-surface-200">
                          {(cachedResponse.data?.htmlLength / 1024).toFixed(2)} KB
                        </span>
                      </div>
                    </div>
                    
                    {/* HTML Content */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-medium text-surface-300">HTML Content</h4>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(cachedResponse.data?.html || '')
                          }}
                          className="btn-ghost text-xs"
                        >
                          Copy HTML
                        </button>
                      </div>
                      <pre className="glass-card bg-black/60 p-4 text-xs font-mono text-surface-400 
                                      overflow-auto max-h-[400px] whitespace-pre-wrap break-all">
                        {cachedResponse.data?.html || 'No HTML content'}
                      </pre>
                    </div>
                    
                    {/* Video URLs if any */}
                    {cachedResponse.data?.videoUrls?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-surface-300 mb-2">
                          Cached Video URLs ({cachedResponse.data.videoUrls.length})
                        </h4>
                        <div className="space-y-1">
                          {cachedResponse.data.videoUrls.map((v, i) => (
                            <div key={i} className="glass-card p-2 text-xs">
                              <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-primary-400 break-all">
                                {v.url}
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Snapshot Modal */}
      <Modal
        isOpen={showSnapshotModal}
        onClose={() => {
          setShowSnapshotModal(false)
          setSnapshotUrl(null)
        }}
        title="Error Snapshot"
        size="lg"
      >
        {snapshotUrl && (
          <div className="text-center">
            <img 
              src={snapshotUrl} 
              alt="Error snapshot" 
              className="max-w-full rounded-lg border border-surface-700"
            />
          </div>
        )}
      </Modal>

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected URLs"
        message={`Are you sure you want to delete ${selectedIds.length} URL${selectedIds.length > 1 ? 's' : ''}? This action cannot be undone.`}
        confirmText={bulkDeleting ? 'Deleting...' : 'Delete'}
        confirmDisabled={bulkDeleting}
        variant="danger"
      />
    </div>
  )
}
