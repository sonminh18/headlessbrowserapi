import { useEffect, useRef, useState, useCallback } from "react";

// Video operation event types (match backend VIDEO_EVENTS)
export const VIDEO_EVENTS = {
    // Download events
    DOWNLOAD_START: "download:start",
    DOWNLOAD_PROGRESS: "download:progress",
    DOWNLOAD_COMPLETE: "download:complete",
    DOWNLOAD_ERROR: "download:error",

    // Upload events
    UPLOAD_QUEUED: "upload:queued",
    UPLOAD_START: "upload:start",
    UPLOAD_PROGRESS: "upload:progress",
    UPLOAD_COMPLETE: "upload:complete",
    UPLOAD_ERROR: "upload:error",
    UPLOAD_PAUSED: "upload:paused",
    UPLOAD_RESUMED: "upload:resumed",
    UPLOAD_CANCELLED: "upload:cancelled",

    // Queue events
    QUEUE_UPDATED: "queue:updated",
    QUEUE_PAUSED: "queue:paused",
    QUEUE_RESUMED: "queue:resumed"
};

/**
 * Custom hook for subscribing to Server-Sent Events
 * @param {string} url - SSE endpoint URL
 * @param {object} options - Hook options
 * @param {boolean} options.enabled - Whether SSE is enabled (default: true)
 * @param {number} options.reconnectDelay - Delay before reconnecting on error (default: 3000ms)
 * @param {number} options.maxRetries - Max reconnection attempts (default: 5)
 * @returns {object} { isConnected, error, lastEvent, subscribe, unsubscribe }
 */
export function useSSE(url = "/admin/api/logs/stream", options = {}) {
    const {
        enabled = true,
        reconnectDelay = 3000,
        maxRetries = 5
    } = options;

    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);
    const [lastEvent, setLastEvent] = useState(null);

    const eventSourceRef = useRef(null);
    const listenersRef = useRef(new Map());
    const retriesRef = useRef(0);
    const reconnectTimeoutRef = useRef(null);

    // Subscribe to specific event type
    const subscribe = useCallback((eventType, callback) => {
        if (!listenersRef.current.has(eventType)) {
            listenersRef.current.set(eventType, new Set());
        }
        listenersRef.current.get(eventType).add(callback);

        // Return unsubscribe function
        return () => {
            const listeners = listenersRef.current.get(eventType);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }, []);

    // Unsubscribe from specific event type (all callbacks)
    const unsubscribe = useCallback((eventType) => {
        listenersRef.current.delete(eventType);
    }, []);

    // Dispatch event to listeners
    const dispatchEvent = useCallback((event) => {
        setLastEvent(event);

        const eventType = event.type;
        const listeners = listenersRef.current.get(eventType);

        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(event);
                } catch (err) {
                    console.error(`SSE listener error for ${eventType}:`, err);
                }
            });
        }

        // Also dispatch to wildcard listeners
        const wildcardListeners = listenersRef.current.get("*");
        if (wildcardListeners) {
            wildcardListeners.forEach(callback => {
                try {
                    callback(event);
                } catch (err) {
                    console.error("SSE wildcard listener error:", err);
                }
            });
        }
    }, []);

    // Connect to SSE
    const connect = useCallback(() => {
        if (!enabled || eventSourceRef.current) return;

        try {
            const eventSource = new EventSource(url);
            eventSourceRef.current = eventSource;

            eventSource.onopen = () => {
                setIsConnected(true);
                setError(null);
                retriesRef.current = 0;
            };

            eventSource.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    dispatchEvent(data);
                } catch (err) {
                    console.error("SSE parse error:", err);
                }
            };

            eventSource.onerror = (e) => {
                setIsConnected(false);
                eventSource.close();
                eventSourceRef.current = null;

                // Attempt to reconnect
                if (retriesRef.current < maxRetries) {
                    retriesRef.current++;
                    setError(`Connection lost. Retrying (${retriesRef.current}/${maxRetries})...`);

                    reconnectTimeoutRef.current = setTimeout(() => {
                        connect();
                    }, reconnectDelay);
                } else {
                    setError("Max reconnection attempts reached. Please refresh the page.");
                }
            };
        } catch (err) {
            setError(err.message);
        }
    }, [enabled, url, maxRetries, reconnectDelay, dispatchEvent]);

    // Disconnect from SSE
    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            setIsConnected(false);
        }
    }, []);

    // Effect to manage connection
    useEffect(() => {
        if (enabled) {
            connect();
        } else {
            disconnect();
        }

        return () => {
            disconnect();
        };
    }, [enabled, connect, disconnect]);

    return {
        isConnected,
        error,
        lastEvent,
        subscribe,
        unsubscribe,
        reconnect: connect,
        disconnect
    };
}

/**
 * Custom hook for tracking video operation progress
 * Subscribes to SSE events and maintains progress state for all videos
 * @param {object} sseHook - Return value from useSSE hook
 * @returns {object} { progress, getProgress, clearProgress }
 */
export function useVideoProgress(sseHook) {
    const { subscribe } = sseHook || {};
    const [progress, setProgress] = useState({}); // Map of videoId -> progress info

    // Get progress for a specific video
    const getProgress = useCallback((videoId) => {
        return progress[videoId] || null;
    }, [progress]);

    // Clear progress for a specific video
    const clearProgress = useCallback((videoId) => {
        setProgress(prev => {
            const next = { ...prev };
            delete next[videoId];
            return next;
        });
    }, []);

    // Clear all progress
    const clearAllProgress = useCallback(() => {
        setProgress({});
    }, []);

    // Subscribe to video events
    useEffect(() => {
        if (!subscribe) return;

        const unsubscribers = [];

        // Download events
        unsubscribers.push(subscribe(VIDEO_EVENTS.DOWNLOAD_START, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    type: "download",
                    status: "downloading",
                    percent: 0,
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.DOWNLOAD_PROGRESS, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    type: "download",
                    status: "downloading",
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.DOWNLOAD_COMPLETE, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    type: "download",
                    status: "complete",
                    percent: 100,
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.DOWNLOAD_ERROR, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    type: "download",
                    status: "error",
                    ...event.data
                }
            }));
        }));

        // Upload events
        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_QUEUED, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    type: "upload",
                    status: "queued",
                    percent: 0,
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_START, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    type: "upload",
                    status: "uploading",
                    percent: 0,
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_PROGRESS, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    type: "upload",
                    status: "uploading",
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_COMPLETE, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    type: "upload",
                    status: "complete",
                    percent: 100,
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_ERROR, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    type: "upload",
                    status: "error",
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_PAUSED, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    status: "paused",
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_RESUMED, (event) => {
            setProgress(prev => ({
                ...prev,
                [event.data.videoId]: {
                    ...prev[event.data.videoId],
                    status: "uploading",
                    ...event.data
                }
            }));
        }));

        unsubscribers.push(subscribe(VIDEO_EVENTS.UPLOAD_CANCELLED, (event) => {
            clearProgress(event.data.videoId);
        }));

        // Cleanup
        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    }, [subscribe, clearProgress]);

    return {
        progress,
        getProgress,
        clearProgress,
        clearAllProgress
    };
}

export default useSSE;
