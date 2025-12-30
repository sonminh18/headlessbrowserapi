import { useState, useCallback } from 'react'
import StatsCard from '../components/StatsCard'
import ConfirmDialog from '../components/ConfirmDialog'
import { getDashboard, clearCache } from '../lib/api'
import usePolling from '../hooks/usePolling'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clearing, setClearing] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const result = await getDashboard()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  usePolling(fetchData, 10000)

  const handleClearCache = async () => {
    setClearing(true)
    try {
      await clearCache()
      fetchData()
    } catch (err) {
      setError(err.message)
    } finally {
      setClearing(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-surface-400">Loading dashboard...</div>
      </div>
    )
  }

  const { urls, videos, cache, browsers } = data || {}

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-100">Dashboard</h1>
          <p className="text-surface-400 mt-1 text-sm sm:text-base">Overview of your headless browser API</p>
        </div>
        <button
          onClick={() => setShowClearConfirm(true)}
          disabled={clearing}
          className="btn-secondary flex items-center justify-center gap-2 w-full sm:w-auto"
        >
          {clearing ? (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
          Clear Cache
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 sm:p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <StatsCard
          title="URLs Processed"
          value={urls?.total || 0}
          subtitle={`${urls?.byStatus?.done || 0} completed`}
          color="primary"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          }
        />
        
        <StatsCard
          title="Active Browsers"
          value={browsers?.activeBrowsers || 0}
          subtitle={`${browsers?.activePages || 0} active pages`}
          color="emerald"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
          }
        />
        
        <StatsCard
          title="Videos Synced"
          value={videos?.byStatus?.synced || 0}
          subtitle={`${videos?.total || 0} total videos`}
          color="blue"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          }
        />
        
        <StatsCard
          title="Cache Entries"
          value={cache?.memoryCache?.keys || 0}
          subtitle={`${cache?.memoryCache?.hits || 0} hits`}
          color="amber"
          icon={
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          }
        />
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* URL Status */}
        <div className="glass-card p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-surface-100 mb-3 sm:mb-4">URL Status</h3>
          <div className="space-y-2 sm:space-y-3">
            {Object.entries(urls?.byStatus || {}).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="text-surface-400 capitalize text-sm sm:text-base">{status}</span>
                <span className="font-mono text-surface-200 text-sm sm:text-base">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Video Status */}
        <div className="glass-card p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-surface-100 mb-3 sm:mb-4">Video Status</h3>
          <div className="space-y-2 sm:space-y-3">
            {Object.entries(videos?.byStatus || {}).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="text-surface-400 capitalize text-sm sm:text-base">{status}</span>
                <span className="font-mono text-surface-200 text-sm sm:text-base">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Browser Stats */}
      <div className="glass-card p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-surface-100 mb-3 sm:mb-4">Browser Statistics</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="text-center">
            <p className="text-xl sm:text-2xl font-bold text-surface-100 font-mono">{browsers?.browsersLaunched || 0}</p>
            <p className="text-xs sm:text-sm text-surface-400">Launched</p>
          </div>
          <div className="text-center">
            <p className="text-xl sm:text-2xl font-bold text-surface-100 font-mono">{browsers?.browsersClosed || 0}</p>
            <p className="text-xs sm:text-sm text-surface-400">Closed</p>
          </div>
          <div className="text-center">
            <p className="text-xl sm:text-2xl font-bold text-surface-100 font-mono">{browsers?.pagesCreated || 0}</p>
            <p className="text-xs sm:text-sm text-surface-400">Pages Created</p>
          </div>
          <div className="text-center">
            <p className="text-xl sm:text-2xl font-bold text-surface-100 font-mono">{browsers?.browserRotations || 0}</p>
            <p className="text-xs sm:text-sm text-surface-400">Rotations</p>
          </div>
        </div>
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearCache}
        title="Clear Cache"
        message="Are you sure you want to clear all cached data? This action cannot be undone."
        confirmText="Clear Cache"
        variant="danger"
      />
    </div>
  )
}
