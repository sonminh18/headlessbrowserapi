import { useState, useEffect } from 'react'
import Pagination from './Pagination'

export default function DataTable({ 
  columns, 
  data, 
  loading, 
  emptyMessage = 'No data available',
  selectable = false,
  selectedIds = [],
  onSelectionChange = () => {},
  // Pagination props
  pagination = null,
  onPageChange = () => {}
}) {
  const [localSelected, setLocalSelected] = useState(new Set(selectedIds))

  // Sync with external selectedIds prop
  useEffect(() => {
    setLocalSelected(new Set(selectedIds))
  }, [selectedIds])

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allIds = data.map(row => row.id)
      setLocalSelected(new Set(allIds))
      onSelectionChange(allIds)
    } else {
      setLocalSelected(new Set())
      onSelectionChange([])
    }
  }

  const handleSelectRow = (id) => {
    const newSelected = new Set(localSelected)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setLocalSelected(newSelected)
    onSelectionChange(Array.from(newSelected))
  }

  const isAllSelected = data && data.length > 0 && localSelected.size === data.length
  const isIndeterminate = localSelected.size > 0 && localSelected.size < (data?.length || 0)

  if (loading) {
    return (
      <div className="glass-card overflow-hidden">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-surface-400">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading...
          </div>
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="glass-card overflow-hidden">
        <div className="p-8 text-center text-surface-400">
          {emptyMessage}
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-800">
              {selectable && (
                <th className="px-4 py-4 w-12">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={el => {
                      if (el) el.indeterminate = isIndeterminate
                    }}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 
                               focus:ring-primary-500 focus:ring-offset-0 focus:ring-2 cursor-pointer"
                  />
                </th>
              )}
              {columns.map((column, index) => (
                <th
                  key={index}
                  className="px-6 py-4 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider"
                  style={{ width: column.width }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800/50">
            {data.map((row, rowIndex) => (
              <tr
                key={row.id || rowIndex}
                className={`hover:bg-surface-800/30 transition-colors ${
                  selectable && localSelected.has(row.id) ? 'bg-primary-500/10' : ''
                }`}
              >
                {selectable && (
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={localSelected.has(row.id)}
                      onChange={() => handleSelectRow(row.id)}
                      className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 
                                 focus:ring-primary-500 focus:ring-offset-0 focus:ring-2 cursor-pointer"
                    />
                  </td>
                )}
                {columns.map((column, colIndex) => (
                  <td
                    key={colIndex}
                    className="px-6 py-4 text-sm text-surface-300 font-mono"
                  >
                    {column.render ? column.render(row) : row[column.accessor]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="border-t border-surface-800">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            itemsPerPage={pagination.limit}
            onPageChange={onPageChange}
          />
        </div>
      )}
    </div>
  )
}
