/**
 * Upload Queue Manager
 * Manages video uploads with concurrency control, priority, and pause/resume
 */
const EventEmitter = require('events');
const { logEmitter } = require('./log-emitter');

// Queue item states
const QUEUE_STATES = {
    PENDING: 'pending',
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

/**
 * Upload Queue Manager
 * @extends EventEmitter
 */
class UploadQueue extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.maxConcurrent = options.maxConcurrent || 2;
        this.queue = [];              // Pending items (sorted by priority)
        this.active = new Map();      // Currently processing (videoId -> item)
        this.completed = [];          // History (last N items)
        this.paused = new Set();      // Paused video IDs
        this.failed = new Map();      // Failed items for retry tracking
        
        this.maxHistory = options.maxHistory || 50;
        this.isPaused = false;        // Global pause state
        
        // Callbacks
        this._processCallback = options.processCallback || null;
    }

    /**
     * Set the process callback
     * @param {Function} callback - Async function to process a video (videoId) => Promise
     */
    setProcessCallback(callback) {
        this._processCallback = callback;
    }

    /**
     * Add a video to the upload queue
     * @param {string} videoId - Video ID to upload
     * @param {object} options - Queue options
     * @param {number} options.priority - Priority (higher = processed first, default: 0)
     * @param {string} options.videoUrl - Video URL for display
     * @param {string} options.sourceUrl - Source page URL for display
     * @param {number} options.downloadSize - File size in bytes
     * @param {object} options.metadata - Additional metadata
     * @returns {object} Queue item
     */
    add(videoId, options = {}) {
        const { priority = 0, videoUrl = null, sourceUrl = null, downloadSize = null, metadata = {} } = options;
        
        // Check if already in queue or active
        if (this.active.has(videoId)) {
            return { success: false, error: 'Video is already being processed' };
        }
        
        const existingIndex = this.queue.findIndex(item => item.videoId === videoId);
        if (existingIndex >= 0) {
            // Update priority if higher
            if (priority > this.queue[existingIndex].priority) {
                this.queue[existingIndex].priority = priority;
                this._sortQueue();
            }
            // Update video info if provided
            if (videoUrl) this.queue[existingIndex].videoUrl = videoUrl;
            if (sourceUrl) this.queue[existingIndex].sourceUrl = sourceUrl;
            if (downloadSize) this.queue[existingIndex].downloadSize = downloadSize;
            return { success: true, position: existingIndex + 1, updated: true };
        }
        
        const item = {
            videoId,
            videoUrl,
            sourceUrl,
            downloadSize,
            priority,
            metadata,
            state: QUEUE_STATES.PENDING,
            addedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            error: null,
            progress: 0
        };
        
        this.queue.push(item);
        this._sortQueue();
        
        const position = this.queue.findIndex(i => i.videoId === videoId) + 1;
        
        // Emit event
        logEmitter.uploadQueued(videoId, position);
        this._emitQueueUpdated();
        
        // Try to process next
        this._processNext();
        
        return { success: true, position, item };
    }

    /**
     * Add multiple videos to the queue
     * @param {string[]} videoIds - Array of video IDs
     * @param {number} priority - Priority for all items
     * @returns {object} Results
     */
    addMany(videoIds, priority = 0) {
        const results = {
            total: videoIds.length,
            added: 0,
            skipped: 0,
            positions: []
        };
        
        for (const videoId of videoIds) {
            const result = this.add(videoId, { priority });
            if (result.success) {
                results.added++;
                results.positions.push({ videoId, position: result.position });
            } else {
                results.skipped++;
            }
        }
        
        return results;
    }

    /**
     * Pause a specific video's upload
     * @param {string} videoId - Video ID
     * @returns {boolean} Success
     */
    pause(videoId) {
        if (this.active.has(videoId)) {
            this.paused.add(videoId);
            const item = this.active.get(videoId);
            item.state = QUEUE_STATES.PAUSED;
            logEmitter.uploadPaused(videoId, item.progress || 0);
            return true;
        }
        
        const queueItem = this.queue.find(i => i.videoId === videoId);
        if (queueItem) {
            this.paused.add(videoId);
            queueItem.state = QUEUE_STATES.PAUSED;
            return true;
        }
        
        return false;
    }

    /**
     * Resume a paused video's upload
     * @param {string} videoId - Video ID
     * @returns {boolean} Success
     */
    resume(videoId) {
        if (!this.paused.has(videoId)) {
            return false;
        }
        
        this.paused.delete(videoId);
        
        const activeItem = this.active.get(videoId);
        if (activeItem) {
            activeItem.state = QUEUE_STATES.ACTIVE;
            logEmitter.uploadResumed(videoId);
            return true;
        }
        
        const queueItem = this.queue.find(i => i.videoId === videoId);
        if (queueItem) {
            queueItem.state = QUEUE_STATES.PENDING;
            this._processNext();
            return true;
        }
        
        return false;
    }

    /**
     * Cancel a video's upload
     * @param {string} videoId - Video ID
     * @returns {boolean} Success
     */
    cancel(videoId) {
        // Remove from queue
        const queueIndex = this.queue.findIndex(i => i.videoId === videoId);
        if (queueIndex >= 0) {
            this.queue.splice(queueIndex, 1);
            this.paused.delete(videoId);
            logEmitter.uploadCancelled(videoId);
            this._emitQueueUpdated();
            return true;
        }
        
        // Mark active as cancelled
        if (this.active.has(videoId)) {
            const item = this.active.get(videoId);
            item.state = QUEUE_STATES.CANCELLED;
            // The process loop should check this and stop
            logEmitter.uploadCancelled(videoId);
            return true;
        }
        
        return false;
    }

    /**
     * Update priority for a video
     * @param {string} videoId - Video ID
     * @param {number} priority - New priority
     * @returns {boolean} Success
     */
    setPriority(videoId, priority) {
        const item = this.queue.find(i => i.videoId === videoId);
        if (item) {
            item.priority = priority;
            this._sortQueue();
            this._emitQueueUpdated();
            return true;
        }
        return false;
    }

    /**
     * Pause all uploads
     */
    pauseAll() {
        this.isPaused = true;
        logEmitter.queuePaused();
    }

    /**
     * Resume all uploads
     */
    resumeAll() {
        this.isPaused = false;
        logEmitter.queueResumed();
        this._processNext();
    }

    /**
     * Get queue status with pagination
     * @param {object} options - Pagination options
     * @param {number} options.pendingPage - Page number for pending items (1-based)
     * @param {number} options.pendingLimit - Items per page for pending
     * @param {number} options.completedPage - Page number for completed items (1-based)
     * @param {number} options.completedLimit - Items per page for completed
     * @returns {object} Queue status
     */
    getStatus(options = {}) {
        const {
            pendingPage = 1,
            pendingLimit = 20,
            completedPage = 1,
            completedLimit = 20
        } = options;
        
        // Paginate pending (already sorted by priority)
        const pendingStart = (pendingPage - 1) * pendingLimit;
        const paginatedPending = this.queue.slice(pendingStart, pendingStart + pendingLimit);
        
        // Paginate completed (reverse order - newest first)
        const reversedCompleted = [...this.completed].reverse();
        const completedStart = (completedPage - 1) * completedLimit;
        const paginatedCompleted = reversedCompleted.slice(completedStart, completedStart + completedLimit);
        
        return {
            isPaused: this.isPaused,
            maxConcurrent: this.maxConcurrent,
            activeCount: this.active.size,
            pendingCount: this.queue.length,
            pausedCount: this.paused.size,
            completedCount: this.completed.length,
            active: Array.from(this.active.values()),
            pending: paginatedPending,
            pendingPagination: {
                page: pendingPage,
                limit: pendingLimit,
                total: this.queue.length,
                totalPages: Math.ceil(this.queue.length / pendingLimit)
            },
            completed: paginatedCompleted,
            completedPagination: {
                page: completedPage,
                limit: completedLimit,
                total: this.completed.length,
                totalPages: Math.ceil(this.completed.length / completedLimit)
            },
            paused: Array.from(this.paused)
        };
    }

    /**
     * Get progress for a specific video
     * @param {string} videoId - Video ID
     * @returns {object|null} Progress info or null
     */
    getProgress(videoId) {
        if (this.active.has(videoId)) {
            return this.active.get(videoId);
        }
        
        const queueItem = this.queue.find(i => i.videoId === videoId);
        if (queueItem) {
            const position = this.queue.indexOf(queueItem) + 1;
            return { ...queueItem, position };
        }
        
        return null;
    }

    /**
     * Update progress for an active upload
     * @param {string} videoId - Video ID
     * @param {number} percent - Progress percentage
     * @param {number} speed - Speed in bytes/second
     * @param {number} eta - ETA in seconds
     */
    updateProgress(videoId, percent, speed, eta) {
        if (this.active.has(videoId)) {
            const item = this.active.get(videoId);
            item.progress = percent;
            item.speed = speed;
            item.eta = eta;
        }
    }

    /**
     * Sort queue by priority (higher first)
     * @private
     */
    _sortQueue() {
        this.queue.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Process next items in queue
     * @private
     */
    async _processNext() {
        if (this.isPaused) return;
        if (!this._processCallback) return;
        
        while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
            // Find next non-paused item
            const index = this.queue.findIndex(item => 
                !this.paused.has(item.videoId) && item.state === QUEUE_STATES.PENDING
            );
            
            if (index < 0) break;
            
            const item = this.queue.splice(index, 1)[0];
            item.state = QUEUE_STATES.ACTIVE;
            item.startedAt = new Date().toISOString();
            
            this.active.set(item.videoId, item);
            this._emitQueueUpdated();
            
            // Process asynchronously
            this._processItem(item);
        }
    }

    /**
     * Process a single queue item
     * @private
     * @param {object} item - Queue item
     */
    async _processItem(item) {
        try {
            await this._processCallback(item.videoId, item);
            
            // Check if cancelled during processing
            if (item.state === QUEUE_STATES.CANCELLED) {
                this.active.delete(item.videoId);
                return;
            }
            
            item.state = QUEUE_STATES.COMPLETED;
            item.completedAt = new Date().toISOString();
            item.progress = 100;
        } catch (err) {
            item.state = QUEUE_STATES.FAILED;
            item.error = err.message;
            item.completedAt = new Date().toISOString();
            
            // Track failed items
            this.failed.set(item.videoId, item);
        } finally {
            this.active.delete(item.videoId);
            this.paused.delete(item.videoId);
            
            // Add to history
            this.completed.push(item);
            if (this.completed.length > this.maxHistory) {
                this.completed.shift();
            }
            
            this._emitQueueUpdated();
            this._processNext();
        }
    }

    /**
     * Emit queue updated event
     * @private
     */
    _emitQueueUpdated() {
        const status = this.getStatus();
        logEmitter.queueUpdated(status.pending);
        this.emit('queueUpdated', status);
    }

    /**
     * Clear completed history
     */
    clearHistory() {
        this.completed = [];
        this._emitQueueUpdated();
    }

    /**
     * Clear all - reset the queue
     */
    clearAll() {
        this.queue = [];
        this.active.clear();
        this.completed = [];
        this.paused.clear();
        this.failed.clear();
        this.isPaused = false;
        this._emitQueueUpdated();
    }
}

// Singleton instance
const uploadQueue = new UploadQueue({ maxConcurrent: 2 });

module.exports = {
    UploadQueue,
    uploadQueue,
    QUEUE_STATES
};

