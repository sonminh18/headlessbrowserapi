/**
 * Log Emitter - Centralized log broadcaster for SSE streaming
 * Provides real-time log streaming to Admin Portal
 */
const EventEmitter = require("events");

// Video operation event types
const VIDEO_EVENTS = {
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

class LogEmitter extends EventEmitter {
    constructor() {
        super();
        this._clients = new Set();
        this._buffer = []; // Keep last 100 logs for new clients
        this._maxBuffer = 100;
        this._videoProgress = new Map(); // Track progress per video
    }

    /**
     * Add a client response object for SSE streaming
     * @param {Response} res - Express response object
     */
    addClient(res) {
        // Send buffered logs to new client
        this._buffer.forEach(log => {
            res.write(`data: ${JSON.stringify(log)}\n\n`);
        });

        this._clients.add(res);
        res.on("close", () => this._clients.delete(res));
    }

    /**
     * Remove a client from the broadcast list
     * @param {Response} res - Express response object
     */
    removeClient(res) {
        this._clients.delete(res);
    }

    /**
     * Broadcast a log message to all connected clients
     * @param {string} level - Log level (info, warn, error, debug)
     * @param {string} message - Log message
     * @param {object} data - Additional data to include
     */
    broadcast(level, message, data = {}) {
        const log = {
            type: "log",
            level,
            message,
            data,
            timestamp: new Date().toISOString()
        };

        // Add to buffer
        this._buffer.push(log);
        if (this._buffer.length > this._maxBuffer) {
            this._buffer.shift();
        }

        // Broadcast to all clients
        this._send(log);
    }

    /**
     * Broadcast an event to all connected clients
     * @param {string} eventType - Event type from VIDEO_EVENTS
     * @param {object} data - Event data
     */
    emitEvent(eventType, data = {}) {
        const event = {
            type: eventType,
            data,
            timestamp: new Date().toISOString()
        };

        // Don't buffer progress events (too many)
        if (!eventType.includes("progress")) {
            this._buffer.push(event);
            if (this._buffer.length > this._maxBuffer) {
                this._buffer.shift();
            }
        }

        this._send(event);
    }

    /**
     * Send payload to all clients
     * @param {object} payload - Data to send
     * @private
     */
    _send(payload) {
        const data = `data: ${JSON.stringify(payload)}\n\n`;
        this._clients.forEach(res => {
            try {
                res.write(data);
            } catch (err) {
                this._clients.delete(res);
            }
        });
    }

    // ==================== Video Download Events ====================

    /**
     * Emit download start event
     * @param {string} videoId - Video ID
     * @param {string} videoUrl - Video URL
     * @param {number} totalSize - Expected total size (if known)
     */
    downloadStart(videoId, videoUrl, totalSize = null) {
        this._videoProgress.set(videoId, { type: "download", percent: 0 });
        this.emitEvent(VIDEO_EVENTS.DOWNLOAD_START, {
            videoId,
            videoUrl,
            totalSize
        });
    }

    /**
     * Emit download progress event
     * @param {string} videoId - Video ID
     * @param {number} downloadedBytes - Bytes downloaded so far
     * @param {number} totalBytes - Total bytes (if known)
     * @param {number} speed - Download speed in bytes/second
     */
    downloadProgress(videoId, downloadedBytes, totalBytes = null, speed = null) {
        const percent = totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : null;
        const eta = (speed && totalBytes) ? Math.round((totalBytes - downloadedBytes) / speed) : null;

        this._videoProgress.set(videoId, { type: "download", percent, speed, eta });
        this.emitEvent(VIDEO_EVENTS.DOWNLOAD_PROGRESS, {
            videoId,
            downloadedBytes,
            totalBytes,
            percent,
            speed,
            eta
        });
    }

    /**
     * Emit download complete event
     * @param {string} videoId - Video ID
     * @param {number} size - Final file size
     * @param {number} duration - Download duration in ms
     */
    downloadComplete(videoId, size, duration) {
        this._videoProgress.delete(videoId);
        this.emitEvent(VIDEO_EVENTS.DOWNLOAD_COMPLETE, {
            videoId,
            size,
            duration
        });
    }

    /**
     * Emit download error event
     * @param {string} videoId - Video ID
     * @param {string} error - Error message
     */
    downloadError(videoId, error) {
        this._videoProgress.delete(videoId);
        this.emitEvent(VIDEO_EVENTS.DOWNLOAD_ERROR, {
            videoId,
            error
        });
    }

    // ==================== Video Upload Events ====================

    /**
     * Emit upload queued event
     * @param {string} videoId - Video ID
     * @param {number} position - Position in queue
     */
    uploadQueued(videoId, position) {
        this.emitEvent(VIDEO_EVENTS.UPLOAD_QUEUED, {
            videoId,
            position
        });
    }

    /**
     * Emit upload start event
     * @param {string} videoId - Video ID
     * @param {string} videoUrl - Video URL
     * @param {number} totalSize - Total file size
     */
    uploadStart(videoId, videoUrl, totalSize) {
        this._videoProgress.set(videoId, { type: "upload", percent: 0 });
        this.emitEvent(VIDEO_EVENTS.UPLOAD_START, {
            videoId,
            videoUrl,
            totalSize
        });
    }

    /**
     * Emit upload progress event
     * @param {string} videoId - Video ID
     * @param {number} uploadedBytes - Bytes uploaded so far
     * @param {number} totalBytes - Total bytes
     * @param {number} speed - Upload speed in bytes/second
     */
    uploadProgress(videoId, uploadedBytes, totalBytes, speed = null) {
        const percent = totalBytes ? Math.round((uploadedBytes / totalBytes) * 100) : null;
        const eta = (speed && totalBytes) ? Math.round((totalBytes - uploadedBytes) / speed) : null;

        this._videoProgress.set(videoId, { type: "upload", percent, speed, eta });
        this.emitEvent(VIDEO_EVENTS.UPLOAD_PROGRESS, {
            videoId,
            uploadedBytes,
            totalBytes,
            percent,
            speed,
            eta
        });
    }

    /**
     * Emit upload complete event
     * @param {string} videoId - Video ID
     * @param {string} s3Url - Final S3 URL
     * @param {number} duration - Upload duration in ms
     */
    uploadComplete(videoId, s3Url, duration) {
        this._videoProgress.delete(videoId);
        this.emitEvent(VIDEO_EVENTS.UPLOAD_COMPLETE, {
            videoId,
            s3Url,
            duration
        });
    }

    /**
     * Emit upload error event
     * @param {string} videoId - Video ID
     * @param {string} error - Error message
     * @param {boolean} retryable - Whether the error is retryable
     */
    uploadError(videoId, error, retryable = true) {
        this._videoProgress.delete(videoId);
        this.emitEvent(VIDEO_EVENTS.UPLOAD_ERROR, {
            videoId,
            error,
            retryable
        });
    }

    /**
     * Emit upload paused event
     * @param {string} videoId - Video ID
     * @param {number} uploadedBytes - Bytes uploaded before pause
     */
    uploadPaused(videoId, uploadedBytes) {
        this.emitEvent(VIDEO_EVENTS.UPLOAD_PAUSED, {
            videoId,
            uploadedBytes
        });
    }

    /**
     * Emit upload resumed event
     * @param {string} videoId - Video ID
     */
    uploadResumed(videoId) {
        this.emitEvent(VIDEO_EVENTS.UPLOAD_RESUMED, {
            videoId
        });
    }

    /**
     * Emit upload cancelled event
     * @param {string} videoId - Video ID
     */
    uploadCancelled(videoId) {
        this._videoProgress.delete(videoId);
        this.emitEvent(VIDEO_EVENTS.UPLOAD_CANCELLED, {
            videoId
        });
    }

    // ==================== Queue Events ====================

    /**
     * Emit queue updated event
     * @param {Array} queue - Current queue state
     */
    queueUpdated(queue) {
        this.emitEvent(VIDEO_EVENTS.QUEUE_UPDATED, {
            queue,
            total: queue.length
        });
    }

    /**
     * Emit queue paused event
     */
    queuePaused() {
        this.emitEvent(VIDEO_EVENTS.QUEUE_PAUSED, {});
    }

    /**
     * Emit queue resumed event
     */
    queueResumed() {
        this.emitEvent(VIDEO_EVENTS.QUEUE_RESUMED, {});
    }

    // ==================== Standard Log Methods ====================

    /**
     * Log info message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    info(message, data = {}) {
        this.broadcast("info", message, data);
    }

    /**
     * Log warning message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    warn(message, data = {}) {
        this.broadcast("warn", message, data);
    }

    /**
     * Log error message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    error(message, data = {}) {
        this.broadcast("error", message, data);
    }

    /**
     * Log debug message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    debug(message, data = {}) {
        this.broadcast("debug", message, data);
    }

    // ==================== Utility Methods ====================

    /**
     * Get count of connected clients
     * @returns {number} Number of connected clients
     */
    getClientCount() {
        return this._clients.size;
    }

    /**
     * Clear the log buffer
     */
    clearBuffer() {
        this._buffer = [];
    }

    /**
     * Get progress for a specific video
     * @param {string} videoId - Video ID
     * @returns {object|null} Progress info or null
     */
    getVideoProgress(videoId) {
        return this._videoProgress.get(videoId) || null;
    }

    /**
     * Get all video progress
     * @returns {object} Map of videoId -> progress
     */
    getAllProgress() {
        return Object.fromEntries(this._videoProgress);
    }
}

// Singleton instance
const logEmitter = new LogEmitter();

module.exports = { logEmitter, LogEmitter, VIDEO_EVENTS };
