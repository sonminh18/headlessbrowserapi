import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Custom hook for debouncing a value
 * @param {any} value - Value to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {any} Debounced value
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}

/**
 * Custom hook for debouncing a callback function
 * @param {Function} callback - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @param {Array} deps - Dependencies array
 * @returns {Function} Debounced callback
 */
export function useDebouncedCallback(callback, delay = 300, deps = []) {
  const timeoutRef = useRef(null)
  const callbackRef = useRef(callback)

  // Keep callback reference up to date
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const debouncedCallback = useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args)
    }, delay)
  }, [delay, ...deps])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return debouncedCallback
}

/**
 * Custom hook for request deduplication with abort controller
 * @returns {object} { createRequest, cancelAll }
 */
export function useRequestDeduplication() {
  const controllersRef = useRef(new Map())

  const createRequest = useCallback((key, fetchFn) => {
    // Cancel previous request with the same key
    if (controllersRef.current.has(key)) {
      controllersRef.current.get(key).abort()
    }

    // Create new controller
    const controller = new AbortController()
    controllersRef.current.set(key, controller)

    // Return promise that handles abort
    return fetchFn(controller.signal)
      .finally(() => {
        // Clean up controller after request completes
        if (controllersRef.current.get(key) === controller) {
          controllersRef.current.delete(key)
        }
      })
  }, [])

  const cancelAll = useCallback(() => {
    controllersRef.current.forEach(controller => {
      controller.abort()
    })
    controllersRef.current.clear()
  }, [])

  const cancel = useCallback((key) => {
    if (controllersRef.current.has(key)) {
      controllersRef.current.get(key).abort()
      controllersRef.current.delete(key)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAll()
    }
  }, [cancelAll])

  return { createRequest, cancel, cancelAll }
}

export default useDebounce

