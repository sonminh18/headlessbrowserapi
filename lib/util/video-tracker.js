/**
 * @class VideoTracker
 * @classdesc Tracks extracted videos and their S3 sync status
 */
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const util = require('hive-js-util');
const { s3Storage } = require('./s3-storage');
const { downloadVideo, cleanupTempFiles } = require('./video-downloader');

// Video status constants
const VIDEO_STATUS = {
    PENDING: 'pending',
    UPLOADING: 'uploading',
    SYNCED: 'synced',
    ERROR: 'error'
};

// Ad/tracking URL patterns to filter out
const AD_URL_PATTERNS = [
    /doubleclick\.net/i,
    /googlesyndication\.com/i,
    /googleadservices\.com/i,
    /facebook\.com\/tr/i,
    /analytics\./i,
    /tracking\./i,
    /pixel\./i,
    /ads\./i,
    /advertisement/i,
    /prebid/i,
    /adserver/i,
    /adsystem/i
];

/**
 * Select the best video from a list of videos for syncing
 * Criteria:
 * 1. Filter out ad/tracking URLs
 * 2. Prefer HLS streams (usually main content)
 * 3. Prefer longer filenames (more descriptive = main content)
 * 4. Avoid duplicate videos by URL
 * @param {Array} videos - Array of video objects with url, mimeType, isHLS
 * @returns {Object|null} Best video object or null if none valid
 */
function selectBestVideo(videos) {
    if (!videos || videos.length === 0) return null;
    if (videos.length === 1) return videos[0];
    
    // Filter out ad URLs
    const filtered = videos.filter(video => {
        const url = video.url || video.videoUrl || '';
        return !AD_URL_PATTERNS.some(pattern => pattern.test(url));
    });
    
    if (filtered.length === 0) return null;
    if (filtered.length === 1) return filtered[0];
    
    // Deduplicate by URL (keep first occurrence)
    const seen = new Set();
    const unique = filtered.filter(video => {
        const url = video.url || video.videoUrl || '';
        // Normalize URL by removing query params for comparison
        const normalizedUrl = url.split('?')[0];
        if (seen.has(normalizedUrl)) return false;
        seen.add(normalizedUrl);
        return true;
    });
    
    if (unique.length === 1) return unique[0];
    
    // Score each video
    const scored = unique.map(video => {
        const url = video.url || video.videoUrl || '';
        let score = 0;
        
        // Prefer HLS (usually main content) +10 points
        if (video.isHLS || url.includes('.m3u8')) {
            score += 10;
        }
        
        // Prefer longer filename (more descriptive) +5 points max
        const filename = url.split('/').pop()?.split('?')[0] || '';
        score += Math.min(filename.length / 20, 5);
        
        // Prefer non-blob URLs +3 points
        if (!url.startsWith('blob:')) {
            score += 3;
        }
        
        // Penalize very short URLs (likely tracking) -5 points
        if (url.length < 50) {
            score -= 5;
        }
        
        // Prefer videos with size info +2 points
        if (video.size && video.size > 0) {
            score += 2;
        }
        
        return { video, score };
    });
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    util.Logging.info(`VideoTracker: Selected best video from ${videos.length} candidates (score: ${scored[0].score})`);
    
    return scored[0].video;
}

/**
 * Video Tracker Service for managing extracted videos
 */
class VideoTracker {
    constructor() {
        this.keyPrefix = process.env.REDIS_KEY_PREFIX || 'hbapi:';
        this.videosKey = `${this.keyPrefix}videos`;
        this.redisEnabled = process.env.REDIS_ENABLED === 'true';
        this.redisAvailable = false;
        this.redis = null;
        
        // In-memory fallback
        this.memoryStore = new Map();
        
        if (this.redisEnabled) {
            this._initRedis();
        }
    }
    
    /**
     * Initialize Redis connection
     * @private
     */
    _initRedis() {
        try {
            const redisOptions = {
                retryStrategy: (times) => {
                    const delay = Math.min(times * 100, 3000);
                    return delay;
                }
            };

            if (process.env.REDIS_PASSWORD) {
                redisOptions.password = process.env.REDIS_PASSWORD;
            }

            this.redis = new Redis(
                process.env.REDIS_URL || 'redis://localhost:6379',
                redisOptions
            );
            
            this.redis.on('connect', () => {
                this.redisAvailable = true;
                util.Logging.info('VideoTracker: Connected to Redis');
            });
            
            this.redis.on('error', (err) => {
                this.redisAvailable = false;
                util.Logging.warn(`VideoTracker Redis error: ${err.message}`);
            });
        } catch (err) {
            this.redisAvailable = false;
            util.Logging.warn(`VideoTracker: Failed to initialize Redis: ${err.message}`);
        }
    }
    
    /**
     * Add a new video record
     * @param {object} videoInfo - Video information
     * @param {string} videoInfo.sourceUrl - Page URL where video was found
     * @param {string} videoInfo.videoUrl - Original video URL
     * @param {string} videoInfo.mimeType - Video MIME type
     * @param {boolean} videoInfo.isHLS - Whether video is HLS stream
     * @returns {Promise<object>} Created video record
     */
    async addVideo(videoInfo) {
        const record = {
            id: uuidv4(),
            sourceUrl: videoInfo.sourceUrl || '',
            videoUrl: videoInfo.videoUrl,
            s3Url: null,
            mimeType: videoInfo.mimeType || 'video/mp4',
            isHLS: videoInfo.isHLS || false,
            status: VIDEO_STATUS.PENDING,
            // Download state
            downloadPath: null,
            downloadSize: null,
            downloadContentType: null,
            downloadedAt: null,
            // Sync state
            syncedAt: null,
            error: null,
            createdAt: new Date().toISOString()
        };
        
        await this._save(record);
        return record;
    }
    
    /**
     * Download a video and store the file path
     * @param {string} id - Video record ID
     * @returns {Promise<object|null>} Updated record or null
     */
    async downloadVideoById(id) {
        const record = await this.getById(id);
        
        if (!record) {
            return null;
        }
        
        // Already downloaded
        if (record.downloadPath && record.downloadedAt) {
            return record;
        }
        
        try {
            util.Logging.info(`VideoTracker: Starting download for video ${id}: ${record.videoUrl}`);
            
            const downloadResult = await downloadVideo(
                { url: record.videoUrl, isHLS: record.isHLS, mimeType: record.mimeType },
                { timeout: 300000, referer: record.sourceUrl }
            );
            
            // Store download info (keep temp file for sync later)
            record.downloadPath = downloadResult.filePath;
            record.downloadSize = downloadResult.size;
            record.downloadContentType = downloadResult.contentType;
            record.downloadedAt = new Date().toISOString();
            record.error = null;
            
            util.Logging.info(`VideoTracker: Video ${id} downloaded to ${record.downloadPath} (${record.downloadSize} bytes)`);
        } catch (err) {
            util.Logging.error(`VideoTracker: Download failed for video ${id}: ${err.message}`);
            record.error = err.message;
        }
        
        await this._save(record);
        return record;
    }
    
    /**
     * Update a video record
     * @param {string} id - Video record ID
     * @param {object} updates - Fields to update
     * @returns {Promise<object|null>} Updated record or null
     */
    async updateVideo(id, updates) {
        const record = await this.getById(id);
        
        if (!record) {
            return null;
        }
        
        // Apply updates
        Object.assign(record, updates);
        
        await this._save(record);
        return record;
    }
    
    /**
     * Delete a video record and its S3 file if synced
     * @param {string} id - Video record ID
     * @param {boolean} deleteFromStorage - Whether to also delete from S3 (default: true)
     * @returns {Promise<object>} Result with success status and details
     */
    async deleteVideo(id, deleteFromStorage = true) {
        const record = await this.getById(id);
        
        if (!record) {
            return { success: false, error: 'Video not found' };
        }

        const result = {
            success: true,
            deletedFromStorage: false,
            storageError: null
        };

        // Delete from S3 if synced and deleteFromStorage is true
        if (deleteFromStorage && record.s3Url) {
            util.Logging.info(`VideoTracker: Attempting to delete from S3. s3Url: ${record.s3Url}, isConfigured: ${s3Storage.isConfigured()}`);
            
            if (s3Storage.isConfigured()) {
                try {
                    const s3Key = s3Storage.extractKeyFromUrl(record.s3Url);
                    util.Logging.info(`VideoTracker: Extracted S3 key: ${s3Key}`);
                    
                    if (s3Key) {
                        await s3Storage.deleteObject(s3Key);
                        result.deletedFromStorage = true;
                        util.Logging.info(`VideoTracker: Deleted S3 file for video ${id}: ${s3Key}`);
                    } else {
                        util.Logging.warn(`VideoTracker: Could not extract S3 key from URL: ${record.s3Url}`);
                        result.storageError = 'Could not extract S3 key from URL';
                    }
                } catch (err) {
                    util.Logging.error(`VideoTracker: Failed to delete S3 file for video ${id}: ${err.message}`);
                    result.storageError = err.message;
                }
            } else {
                util.Logging.warn(`VideoTracker: S3 not configured, cannot delete from storage`);
                result.storageError = 'S3 not configured';
            }
        } else {
            util.Logging.debug(`VideoTracker: No S3 deletion needed. deleteFromStorage: ${deleteFromStorage}, s3Url: ${record.s3Url}`);
        }

        // Cleanup downloaded temp file if exists
        if (record.downloadPath) {
            try {
                await cleanupTempFiles([record.downloadPath]);
            } catch (err) {
                // Ignore cleanup errors
            }
        }

        // Delete from database
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.hdel(this.videosKey, id);
            } catch (err) {
                util.Logging.warn(`VideoTracker deleteVideo Redis error: ${err.message}`);
                this.memoryStore.delete(id);
            }
        } else {
            this.memoryStore.delete(id);
        }
        
        return result;
    }
    
    /**
     * Get video record by ID
     * @param {string} id - Video record ID
     * @returns {Promise<object|null>} Video record or null
     */
    async getById(id) {
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const data = await this.redis.hget(this.videosKey, id);
                return data ? JSON.parse(data) : null;
            } catch (err) {
                util.Logging.warn(`VideoTracker getById Redis error: ${err.message}`);
            }
        }
        
        return this.memoryStore.get(id) || null;
    }
    
    /**
     * Get all video records
     * @param {object} options - Filter options
     * @param {string} options.status - Filter by status
     * @param {number} options.limit - Limit results
     * @param {number} options.offset - Offset for pagination
     * @returns {Promise<object[]>} Array of video records
     */
    async getAll(options = {}) {
        let records = [];
        
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const data = await this.redis.hgetall(this.videosKey);
                records = Object.values(data).map(item => JSON.parse(item));
            } catch (err) {
                util.Logging.warn(`VideoTracker getAll Redis error: ${err.message}`);
                records = Array.from(this.memoryStore.values());
            }
        } else {
            records = Array.from(this.memoryStore.values());
        }
        
        // Sort by createdAt descending
        records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Filter by status
        if (options.status) {
            records = records.filter(r => r.status === options.status);
        }
        
        // Pagination
        const offset = options.offset || 0;
        const limit = options.limit || records.length;
        
        return records.slice(offset, offset + limit);
    }
    
    /**
     * Get videos by status
     * @param {string} status - Video status
     * @returns {Promise<object[]>} Array of video records
     */
    async getByStatus(status) {
        return this.getAll({ status });
    }
    
    /**
     * Get videos by source URL
     * @param {string} sourceUrl - Source URL where videos were found
     * @returns {Promise<object[]>} Array of video records
     */
    async getBySourceUrl(sourceUrl) {
        const allVideos = await this.getAll();
        return allVideos.filter(v => v.sourceUrl === sourceUrl);
    }
    
    /**
     * Delete all videos for a source URL (with storage cleanup)
     * @param {string} sourceUrl - Source URL to delete videos for
     * @param {boolean} deleteFromStorage - Whether to delete from S3 storage
     * @returns {Promise<object>} Deletion result
     */
    async deleteBySourceUrl(sourceUrl, deleteFromStorage = true) {
        const videos = await this.getBySourceUrl(sourceUrl);
        const result = {
            deleted: 0,
            deletedFromStorage: 0,
            errors: []
        };
        
        for (const video of videos) {
            try {
                const deleteResult = await this.deleteVideo(video.id, deleteFromStorage);
                if (deleteResult.success) {
                    result.deleted++;
                    if (deleteResult.deletedFromStorage) {
                        result.deletedFromStorage++;
                    }
                }
            } catch (err) {
                result.errors.push({ id: video.id, error: err.message });
            }
        }
        
        util.Logging.info(`VideoTracker: Deleted ${result.deleted} videos for sourceUrl: ${sourceUrl} (${result.deletedFromStorage} from storage)`);
        return result;
    }
    
    /**
     * Sync a video to S3
     * Uses already downloaded file if available, otherwise downloads first
     * @param {string} id - Video record ID
     * @returns {Promise<object|null>} Updated record or null
     */
    async syncVideo(id) {
        let record = await this.getById(id);
        
        if (!record) {
            return null;
        }
        
        if (!s3Storage.isConfigured()) {
            record.status = VIDEO_STATUS.ERROR;
            record.error = 'S3 is not configured';
            await this._save(record);
            return record;
        }
        
        // Update status to uploading
        record.status = VIDEO_STATUS.UPLOADING;
        await this._save(record);
        
        const tempFilesToCleanup = [];
        let filePath, contentType;
        
        try {
            util.Logging.info(`VideoTracker: Starting sync for video ${id}: ${record.videoUrl}`);
            
            // Check if already downloaded
            if (record.downloadPath && record.downloadedAt) {
                util.Logging.info(`VideoTracker: Using pre-downloaded file: ${record.downloadPath}`);
                filePath = record.downloadPath;
                contentType = record.downloadContentType || record.mimeType;
            } else {
                // Download video
                util.Logging.info(`VideoTracker: Downloading video...`);
                
                const downloadResult = await downloadVideo(
                    { url: record.videoUrl, isHLS: record.isHLS, mimeType: record.mimeType },
                    { timeout: 300000, referer: record.sourceUrl }
                );
                
                filePath = downloadResult.filePath;
                contentType = downloadResult.contentType;
                if (downloadResult.tempFiles) {
                    tempFilesToCleanup.push(...downloadResult.tempFiles);
                }
                
                // Save download info
                record.downloadPath = filePath;
                record.downloadSize = downloadResult.size;
                record.downloadContentType = contentType;
                record.downloadedAt = new Date().toISOString();
            }
            
            // Generate S3 key and upload
            const actualExtension = record.isHLS ? "mp4" : "mp4";
            const s3Key = s3Storage.generateKey(record.videoUrl, actualExtension);
            const s3Url = await s3Storage.uploadFromFile(filePath, s3Key, contentType);
            
            // Update record
            record.s3Url = s3Url;
            record.status = VIDEO_STATUS.SYNCED;
            record.syncedAt = new Date().toISOString();
            record.error = null;
            
            // Cleanup downloaded file after successful upload
            if (record.downloadPath) {
                tempFilesToCleanup.push(record.downloadPath);
                record.downloadPath = null;
            }
            
            util.Logging.info(`VideoTracker: Video ${id} synced to ${s3Url}`);
        } catch (err) {
            // Check if this is a protected/obfuscated video
            const isProtected = err.message.includes('not a valid video') || 
                               err.message.includes('obfuscated') ||
                               err.message.includes('protected');
            
            if (isProtected) {
                util.Logging.warn(`VideoTracker: Video ${id} appears to be protected/DRM content - cannot download`);
                record.status = VIDEO_STATUS.ERROR;
                record.error = 'Protected content - video uses DRM or obfuscation that prevents download';
                record.isProtected = true;
            } else {
                util.Logging.error(`VideoTracker: Sync failed for video ${id}: ${err.message}`);
                record.status = VIDEO_STATUS.ERROR;
                record.error = err.message;
            }
        } finally {
            await cleanupTempFiles(tempFilesToCleanup);
        }
        
        await this._save(record);
        return record;
    }
    
    /**
     * Sync all pending videos
     * @returns {Promise<object>} Sync results
     */
    async syncAllPending() {
        const pendingVideos = await this.getByStatus(VIDEO_STATUS.PENDING);
        
        const results = {
            total: pendingVideos.length,
            synced: 0,
            failed: 0,
            errors: []
        };
        
        for (const video of pendingVideos) {
            const updated = await this.syncVideo(video.id);
            
            if (updated.status === VIDEO_STATUS.SYNCED) {
                results.synced++;
            } else {
                results.failed++;
                results.errors.push({
                    id: video.id,
                    url: video.videoUrl,
                    error: updated.error
                });
            }
        }
        
        return results;
    }
    
    /**
     * Get statistics
     * @returns {Promise<object>} Statistics object
     */
    async getStats() {
        const records = await this.getAll();
        
        const stats = {
            total: records.length,
            byStatus: {
                [VIDEO_STATUS.PENDING]: 0,
                [VIDEO_STATUS.UPLOADING]: 0,
                [VIDEO_STATUS.SYNCED]: 0,
                [VIDEO_STATUS.ERROR]: 0
            }
        };
        
        for (const record of records) {
            if (stats.byStatus[record.status] !== undefined) {
                stats.byStatus[record.status]++;
            }
        }
        
        return stats;
    }
    
    /**
     * Save record to storage
     * @param {object} record - Video record
     * @private
     */
    async _save(record) {
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.hset(this.videosKey, record.id, JSON.stringify(record));
                return;
            } catch (err) {
                util.Logging.warn(`VideoTracker _save Redis error: ${err.message}`);
            }
        }
        
        this.memoryStore.set(record.id, record);
    }
    
    /**
     * Clear all video records
     * @returns {Promise<boolean>} Success status
     */
    async clearAll() {
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.del(this.videosKey);
                return true;
            } catch (err) {
                util.Logging.warn(`VideoTracker clearAll Redis error: ${err.message}`);
            }
        }
        
        this.memoryStore.clear();
        return true;
    }
}

// Singleton instance
const videoTracker = new VideoTracker();

module.exports = {
    VideoTracker,
    videoTracker,
    VIDEO_STATUS,
    selectBestVideo
};

