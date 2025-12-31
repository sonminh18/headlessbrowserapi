import { useState, useEffect, useRef } from 'react'

export default function Logs() {
  const [logs, setLogs] = useState([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('all') // all, info, error, warn
  const logsEndRef = useRef(null)
  const eventSourceRef = useRef(null)

  useEffect(() => {
    const es = new EventSource('/admin/api/logs/stream')
    eventSourceRef.current = es
    
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (event) => {
      if (paused) return
      const log = JSON.parse(event.data)
      if (log.type !== 'connected') {
        setLogs(prev => [...prev.slice(-499), log]) // Keep last 500
      }
    }
    
    return () => es.close()
  }, [paused])

  useEffect(() => {
    if (!paused) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, paused])

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(l => l.level === filter)

  const levelColors = {
    info: 'text-blue-400',
    warn: 'text-yellow-400',
    error: 'text-red-400',
    debug: 'text-gray-400'
  }

  const levelBgColors = {
    info: 'bg-blue-500/10',
    warn: 'bg-yellow-500/10',
    error: 'bg-red-500/10',
    debug: 'bg-gray-500/10'
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-100">Live Logs</h1>
          <p className="text-surface-400 mt-1 text-sm sm:text-base">Real-time server activity stream</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm text-surface-400">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        <select 
          value={filter} 
          onChange={e => setFilter(e.target.value)} 
          className="input w-full sm:w-auto"
        >
          <option value="all">All Levels</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
        <button 
          onClick={() => setPaused(!paused)} 
          className={`btn-secondary ${paused ? 'bg-amber-500/20 text-amber-400' : ''}`}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button 
          onClick={() => setLogs([])} 
          className="btn-ghost"
        >
          Clear
        </button>
        <div className="flex-1 text-right text-sm text-surface-500 self-center">
          {filteredLogs.length} log{filteredLogs.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Log viewer */}
      <div className="glass-card bg-surface-950/80 p-4 h-[600px] overflow-y-auto font-mono text-sm">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-surface-500">
            {connected ? 'Waiting for logs...' : 'Connecting to log stream...'}
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div 
              key={i} 
              className={`py-2 px-3 mb-1 rounded ${levelBgColors[log.level] || 'bg-surface-800/30'} 
                         border-l-2 ${log.level === 'error' ? 'border-red-500' : log.level === 'warn' ? 'border-yellow-500' : 'border-transparent'}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-surface-500 text-xs whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className={`text-xs font-semibold uppercase ${levelColors[log.level] || 'text-surface-300'}`}>
                  [{log.level}]
                </span>
                <span className="text-surface-200 flex-1">{log.message}</span>
              </div>
              {log.data && Object.keys(log.data).length > 0 && (
                <div className="mt-1 ml-20 text-xs text-surface-500 break-all">
                  {Object.entries(log.data).map(([key, value]) => (
                    <span key={key} className="mr-4">
                      <span className="text-surface-400">{key}:</span>{' '}
                      <span className="text-surface-300">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card p-3 text-center">
          <p className="text-lg font-bold text-surface-100 font-mono">
            {logs.filter(l => l.level === 'info').length}
          </p>
          <p className="text-xs text-blue-400">Info</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-lg font-bold text-surface-100 font-mono">
            {logs.filter(l => l.level === 'warn').length}
          </p>
          <p className="text-xs text-yellow-400">Warnings</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-lg font-bold text-surface-100 font-mono">
            {logs.filter(l => l.level === 'error').length}
          </p>
          <p className="text-xs text-red-400">Errors</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-lg font-bold text-surface-100 font-mono">
            {logs.filter(l => l.level === 'debug').length}
          </p>
          <p className="text-xs text-surface-400">Debug</p>
        </div>
      </div>
    </div>
  )
}

