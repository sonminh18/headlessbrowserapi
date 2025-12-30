import { useEffect, useRef, useCallback } from 'react'

/**
 * Custom hook for polling data at regular intervals
 * @param {Function} fetchFunction - Function to fetch data
 * @param {number} interval - Polling interval in milliseconds
 * @param {boolean} enabled - Whether polling is enabled
 * @returns {object} { refresh }
 */
export function usePolling(fetchFunction, interval = 5000, enabled = true) {
  const intervalRef = useRef(null)
  const fetchRef = useRef(fetchFunction)

  // Keep fetch function reference up to date
  useEffect(() => {
    fetchRef.current = fetchFunction
  }, [fetchFunction])

  // Manual refresh function
  const refresh = useCallback(() => {
    fetchRef.current()
  }, [])

  // Set up polling
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Initial fetch
    fetchRef.current()

    // Set up interval
    intervalRef.current = setInterval(() => {
      fetchRef.current()
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [interval, enabled])

  return { refresh }
}

export default usePolling

