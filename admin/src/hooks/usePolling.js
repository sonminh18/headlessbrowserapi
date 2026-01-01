import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * Custom hook for smart polling with visibility API and exponential backoff
 * @param {Function} fetchFunction - Function to fetch data
 * @param {number} baseInterval - Base polling interval in milliseconds
 * @param {object} options - Polling options
 * @param {boolean} options.enabled - Whether polling is enabled
 * @param {boolean} options.pauseOnHidden - Pause when tab is hidden (default: true)
 * @param {boolean} options.useBackoff - Use exponential backoff when idle (default: true)
 * @param {number} options.maxInterval - Max interval with backoff (default: 60000)
 * @param {number} options.backoffFactor - Backoff multiplier (default: 1.5)
 * @returns {object} { refresh, pause, resume, isPaused, isVisible }
 */
export function usePolling(fetchFunction, baseInterval = 5000, options = {}) {
  const {
    enabled = true,
    pauseOnHidden = true,
    useBackoff = true,
    maxInterval = 60000,
    backoffFactor = 1.5
  } = options

  const intervalRef = useRef(null)
  const timeoutRef = useRef(null)
  const fetchRef = useRef(fetchFunction)
  const currentIntervalRef = useRef(baseInterval)
  const lastActivityRef = useRef(Date.now())
  const isPendingRef = useRef(false)

  const [isPaused, setIsPaused] = useState(false)
  const [isVisible, setIsVisible] = useState(
    typeof document !== 'undefined' ? !document.hidden : true
  )

  // Keep fetch function reference up to date
  useEffect(() => {
    fetchRef.current = fetchFunction
  }, [fetchFunction])

  // Reset backoff on user activity
  const resetBackoff = useCallback(() => {
    lastActivityRef.current = Date.now()
    currentIntervalRef.current = baseInterval
  }, [baseInterval])

  // Manual refresh function - also resets backoff
  const refresh = useCallback(() => {
    if (isPendingRef.current) return // Skip if action is pending
    resetBackoff()
    fetchRef.current()
  }, [resetBackoff])

  // Pause polling
  const pause = useCallback(() => {
    setIsPaused(true)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Resume polling
  const resume = useCallback(() => {
    setIsPaused(false)
    resetBackoff()
  }, [resetBackoff])

  // Set pending state (to skip polls during actions)
  const setPending = useCallback((pending) => {
    isPendingRef.current = pending
    if (!pending) {
      resetBackoff()
    }
  }, [resetBackoff])

  // Handle visibility change
  useEffect(() => {
    if (!pauseOnHidden || typeof document === 'undefined') return

    const handleVisibilityChange = () => {
      const visible = !document.hidden
      setIsVisible(visible)
      
      if (visible) {
        // Tab became visible - reset backoff and refresh
        resetBackoff()
        if (enabled && !isPaused) {
          fetchRef.current()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pauseOnHidden, enabled, isPaused, resetBackoff])

  // Handle user activity to reset backoff
  useEffect(() => {
    if (!useBackoff || typeof window === 'undefined') return

    const handleActivity = () => {
      lastActivityRef.current = Date.now()
      // Reset interval if it was backed off
      if (currentIntervalRef.current > baseInterval) {
        currentIntervalRef.current = baseInterval
      }
    }

    // Listen for user interactions
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true })
    })

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity)
      })
    }
  }, [useBackoff, baseInterval])

  // Main polling logic with smart scheduling
  useEffect(() => {
    if (!enabled || isPaused) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    // Don't poll if tab is hidden and pauseOnHidden is enabled
    if (pauseOnHidden && !isVisible) {
      return
    }

    // Initial fetch
    fetchRef.current()

    const scheduleNextPoll = () => {
      // Calculate next interval with backoff if enabled
      let nextInterval = currentIntervalRef.current

      if (useBackoff) {
        const idleTime = Date.now() - lastActivityRef.current
        // Start backing off after 30 seconds of inactivity
        if (idleTime > 30000) {
          nextInterval = Math.min(
            currentIntervalRef.current * backoffFactor,
            maxInterval
          )
          currentIntervalRef.current = nextInterval
        }
      }

      timeoutRef.current = setTimeout(() => {
        if (!isPendingRef.current && isVisible) {
          fetchRef.current()
        }
        scheduleNextPoll()
      }, nextInterval)
    }

    scheduleNextPoll()

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [enabled, isPaused, isVisible, pauseOnHidden, useBackoff, backoffFactor, maxInterval])

  return { 
    refresh, 
    pause, 
    resume, 
    setPending,
    isPaused, 
    isVisible,
    resetBackoff
  }
}

export default usePolling

