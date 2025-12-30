const statusConfig = {
  // URL statuses
  waiting: { label: 'Waiting', className: 'badge-warning' },
  processing: { label: 'Processing', className: 'badge-info' },
  done: { label: 'Done', className: 'badge-success' },
  cancelled: { label: 'Cancelled', className: 'badge-neutral' },
  error: { label: 'Error', className: 'badge-error' },
  
  // Video statuses
  pending: { label: 'Pending', className: 'badge-warning' },
  uploading: { label: 'Uploading', className: 'badge-info' },
  synced: { label: 'Synced', className: 'badge-success' },
  
  // Browser statuses
  running: { label: 'Running', className: 'badge-success' },
  idle: { label: 'Idle', className: 'badge-neutral' },
  unknown: { label: 'Unknown', className: 'badge-neutral' },
  
  // Generic
  active: { label: 'Active', className: 'badge-success' },
  inactive: { label: 'Inactive', className: 'badge-neutral' },
  connected: { label: 'Connected', className: 'badge-success' },
  disconnected: { label: 'Disconnected', className: 'badge-error' },
}

export default function StatusBadge({ status }) {
  const config = statusConfig[status?.toLowerCase()] || { 
    label: status || 'Unknown', 
    className: 'badge-neutral' 
  }

  return (
    <span className={config.className}>
      {config.label}
    </span>
  )
}

