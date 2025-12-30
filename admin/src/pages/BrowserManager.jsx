import { useState, useCallback } from 'react'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import { getBrowsers, terminateBrowser } from '../lib/api'
import usePolling from '../hooks/usePolling'

export default function BrowserManager() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [terminatingId, setTerminatingId] = useState(null)
  const [confirmTerminate, setConfirmTerminate] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const result = await getBrowsers()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 5 seconds
  const { refresh } = usePolling(fetchData, 5000)

  const handleTerminate = async (id) => {
    setTerminatingId(id)
    try {
      await terminateBrowser(id)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setTerminatingId(null)
    }
  }

  const formatBytes = (bytes) => {
    if (!bytes) return 'N/A'
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  const formatDuration = (ms) => {
    if (!ms) return 'N/A'
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  const columns = [
    {
      header: 'Browser ID',
      accessor: 'id',
      render: (row) => (
        <span className="text-xs truncate max-w-[120px] block" title={row.id}>
          {row.id.slice(0, 8)}...
        </span>
      )
    },
    {
      header: 'PID',
      accessor: 'pid',
      render: (row) => row.pid || 'N/A'
    },
    {
      header: 'Status',
      accessor: 'status',
      render: (row) => <StatusBadge status={row.status} />
    },
    {
      header: 'Memory',
      accessor: 'memory',
      render: (row) => formatBytes(row.memory?.rss)
    },
    {
      header: 'Pages',
      accessor: 'activePages',
      render: (row) => (
        <span>
          {row.activePages} / {row.pageCount}
        </span>
      )
    },
    {
      header: 'Age',
      accessor: 'age',
      render: (row) => formatDuration(row.age)
    },
    {
      header: 'Created',
      accessor: 'createdAt',
      render: (row) => new Date(row.createdAt).toLocaleString()
    },
    {
      header: 'Actions',
      render: (row) => (
        <button
          onClick={() => setConfirmTerminate(row.id)}
          disabled={terminatingId === row.id}
          className="btn-danger text-xs py-1 px-2"
        >
          {terminatingId === row.id ? 'Terminating...' : 'Terminate'}
        </button>
      )
    }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-surface-100">Browser Manager</h1>
          <p className="text-surface-400 mt-1">Manage active browser processes</p>
        </div>
        <button onClick={refresh} className="btn-secondary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Stats */}
      {data?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-surface-100 font-mono">{data.stats.activeBrowsers}</p>
            <p className="text-sm text-surface-400">Active Browsers</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-surface-100 font-mono">{data.stats.activePages}</p>
            <p className="text-sm text-surface-400">Active Pages</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-surface-100 font-mono">{data.stats.browsersLaunched}</p>
            <p className="text-sm text-surface-400">Total Launched</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-surface-100 font-mono">{data.stats.maxConcurrency}</p>
            <p className="text-sm text-surface-400">Max Concurrency</p>
          </div>
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={data?.browsers || []}
        loading={loading}
        emptyMessage="No active browsers"
      />

      {/* Auto-refresh indicator */}
      <div className="text-center text-sm text-surface-500">
        Auto-refreshing every 5 seconds
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!confirmTerminate}
        onClose={() => setConfirmTerminate(null)}
        onConfirm={() => handleTerminate(confirmTerminate)}
        title="Terminate Browser"
        message="Are you sure you want to terminate this browser process? All active pages will be closed."
        confirmText="Terminate"
        variant="danger"
      />
    </div>
  )
}

