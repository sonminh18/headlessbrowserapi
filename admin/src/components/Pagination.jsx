import { useMemo } from 'react'

export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  totalItems = 0,
  onPageChange,
  itemsPerPage = 20
}) {
  // Generate page numbers to display
  const pageNumbers = useMemo(() => {
    const pages = []
    const maxVisiblePages = 5
    
    if (totalPages <= maxVisiblePages) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Show first, last, and pages around current
      const startPage = Math.max(1, currentPage - 1)
      const endPage = Math.min(totalPages, currentPage + 1)
      
      if (startPage > 1) {
        pages.push(1)
        if (startPage > 2) pages.push('...')
      }
      
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i)
      }
      
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) pages.push('...')
        pages.push(totalPages)
      }
    }
    
    return pages
  }, [currentPage, totalPages])

  if (totalPages <= 1) {
    return null
  }

  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2">
      {/* Items info */}
      <div className="text-sm text-surface-400">
        Showing <span className="font-medium text-surface-200">{startItem}</span> to{' '}
        <span className="font-medium text-surface-200">{endItem}</span> of{' '}
        <span className="font-medium text-surface-200">{totalItems}</span> results
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-1">
        {/* Previous button */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed
                     text-surface-400 hover:text-surface-200 hover:bg-surface-800
                     disabled:hover:bg-transparent disabled:hover:text-surface-400"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Page numbers */}
        <div className="flex items-center gap-1">
          {pageNumbers.map((page, index) => (
            page === '...' ? (
              <span key={`ellipsis-${index}`} className="px-2 text-surface-500">...</span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                           ${currentPage === page
                             ? 'bg-primary-600 text-white'
                             : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                           }`}
              >
                {page}
              </button>
            )
          ))}
        </div>

        {/* Next button */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed
                     text-surface-400 hover:text-surface-200 hover:bg-surface-800
                     disabled:hover:bg-transparent disabled:hover:text-surface-400"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

