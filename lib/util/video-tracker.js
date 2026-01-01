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
 * Priority order (highest to lowest):
 * 1. Direct MP4 files (easiest to download, no conversion needed)
 * 2. Other direct video formats (webm, mov, etc.)
 * 3. HLS streams (.m3u8) - requires ffmpeg conversion
 * 4. DASH streams (.mpd) - requires ffmpeg conversion
 * 
 * Additional criteria:
 * - Filter out ad/tracking URLs
 * - Prefer higher quality indicators in URL (1080p, 720p, etc.)
 * - Prefer longer filenames (more descriptive = main content)
 * - Avoid blob URLs
 * 
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
    
    // ==================== PRIMARY PLAYER PRIORITY ====================
    // If any video is marked as from the primary player element,
    // give it HIGHEST priority - this is the video actually playing in the main player
    const primaryPlayerVideos = unique.filter(v => v.isPrimaryPlayer === true);
    if (primaryPlayerVideos.length > 0) {
        // Find the best primary player video (prefer MP4 if multiple)
        const primaryMp4 = primaryPlayerVideos.find(v => 
            (v.url || v.videoUrl || '').toLowerCase().includes('.mp4')
        );
        if (primaryMp4) {
            util.Logging.info(`VideoTracker: Selected PRIMARY PLAYER MP4 video`);
            util.Logging.info(`  → URL: ${(primaryMp4.url || primaryMp4.videoUrl || '').substring(0, 100)}...`);
            return primaryMp4;
        }
        // Return any primary player video if no MP4
        util.Logging.info(`VideoTracker: Selected PRIMARY PLAYER video`);
        util.Logging.info(`  → URL: ${(primaryPlayerVideos[0].url || primaryPlayerVideos[0].videoUrl || '').substring(0, 100)}...`);
        return primaryPlayerVideos[0];
    }
    
    // Quality indicators and their scores (higher = better)
    const qualityScores = {
        '4k': 100, '2160p': 100, 'uhd': 100,
        '1080p': 90, 'fullhd': 90, 'full_hd': 90, 'fhd': 90,
        '720p': 80, 'hd': 80,
        '480p': 60, 'sd': 60,
        '360p': 40,
        '240p': 20,
        '144p': 10
    };
    
    // Score each video
    const scored = unique.map(video => {
        const url = (video.url || video.videoUrl || '').toLowerCase();
        let score = 0;
        let reason = [];
        
        // ==================== FIRST: Detect and penalize placeholder/junk files ====================
        // Common placeholder/blank video patterns used by themes/players
        const junkPatterns = [
            /blank\.mp4/i,
            /1s_blank/i,
            /placeholder/i,
            /dummy/i,
            /empty\.mp4/i,
            /test\.mp4/i,
            /sample\.mp4/i,
            /loading\.mp4/i,
            /pixel\.mp4/i,
            /spacer/i,
        ];
        
        const isJunkFile = junkPatterns.some(pattern => pattern.test(url));
        if (isJunkFile) {
            score -= 100; // Heavy penalty for junk files
            reason.push('Junk/placeholder file (-100)');
        }
        
        // Penalize files in theme/player/asset directories (usually not real content)
        const themeAssetPatterns = [
            /\/themes?\//i,
            /\/player\//i,
            /\/assets?\//i,
            /\/plugins?\//i,
            /\/vendor\//i,
            /\/lib\//i,
            /\/js\//i,
            /\/css\//i,
            /\/dist\//i,
            /\/static\/(?!videos?|media|uploads?)/i,
        ];
        
        const isThemeAsset = themeAssetPatterns.some(pattern => pattern.test(url));
        if (isThemeAsset) {
            score -= 50; // Penalty for theme/asset files
            reason.push('Theme/asset path (-50)');
        }
        
        // ==================== Format Priority (HIGHEST WEIGHT) ====================
        // MP4 gets highest priority - direct download, no conversion needed
        // But only if it's not a junk file
        if (url.includes('.mp4') && !isJunkFile && !isThemeAsset) {
            score += 50;
            reason.push('MP4 direct (+50)');
        } else if (url.includes('.mp4')) {
            // Reduced score for MP4 that might be junk
            score += 10;
            reason.push('MP4 (reduced, suspicious) (+10)');
        }
        // Other direct video formats
        else if (url.match(/\.(webm|mov|avi|mkv|m4v)(\?|$)/)) {
            score += 40;
            reason.push('Direct video (+40)');
        }
        // HLS streams - need conversion but widely supported
        // Bonus: HLS in /storage/ or /uploads/ is usually real content
        else if (video.isHLS || url.includes('.m3u8')) {
            score += 20;
            reason.push('HLS stream (+20)');
        }
        // DASH streams - need conversion
        else if (url.includes('.mpd')) {
            score += 15;
            reason.push('DASH stream (+15)');
        }
        
        // ==================== Content Path Bonus ====================
        // Bonus for URLs in content directories (usually real videos)
        const contentPathPatterns = [
            /\/storage\//i,
            /\/uploads?\//i,
            /\/videos?\//i,
            /\/media\//i,
            /\/content\//i,
            /\/files?\//i,
            /\/stream\//i,
            /\/hls\//i,
            /\/vod\//i,
        ];
        
        const isContentPath = contentPathPatterns.some(pattern => pattern.test(url));
        if (isContentPath) {
            score += 15;
            reason.push('Content path (+15)');
        }
        
        // ==================== Quality Detection ====================
        // Check for quality indicators in URL
        for (const [quality, qScore] of Object.entries(qualityScores)) {
            if (url.includes(quality)) {
                score += qScore / 5; // Scale down quality score (max +20)
                reason.push(`Quality ${quality} (+${qScore / 5})`);
                break; // Only count highest quality match
            }
        }
        
        // ==================== URL Quality Indicators ====================
        // Prefer longer filenames (more descriptive = main content) +5 max
        const filename = url.split('/').pop()?.split('?')[0] || '';
        const filenameScore = Math.min(filename.length / 20, 5);
        score += filenameScore;
        
        // Bonus for meaningful path slugs (contains words, not just IDs)
        // e.g., /storage/m3u8/tong-hop-ban-tinh-day-am-dao/index.m3u8 is more likely real content
        const pathParts = url.split('/').filter(p => p && !p.includes('.'));
        const hasMeaningfulSlug = pathParts.some(part => 
            part.length > 10 && // Long enough
            /[a-z].*-.*[a-z]/i.test(part) && // Contains hyphenated words
            !/^[a-f0-9-]+$/i.test(part) // Not just UUID
        );
        if (hasMeaningfulSlug) {
            score += 10;
            reason.push('Meaningful slug (+10)');
        }
        
        // Penalize very short/generic filenames
        const genericFilenames = ['index', 'video', 'stream', 'play', 'main', 'default'];
        const baseFilename = filename.replace(/\.(mp4|m3u8|mpd|webm)$/i, '').toLowerCase();
        if (genericFilenames.includes(baseFilename) || baseFilename.length < 5) {
            // Only penalize if NOT in a content directory with meaningful path
            if (!hasMeaningfulSlug && !isContentPath) {
                score -= 5;
                reason.push('Generic filename (-5)');
            }
        }
        
        // Prefer non-blob URLs +10 points (blob URLs are temporary and can't be downloaded)
        if (!url.startsWith('blob:')) {
            score += 10;
            reason.push('Non-blob (+10)');
        } else {
            // Heavily penalize blob URLs - they can't be downloaded directly
            score -= 30;
            reason.push('Blob URL (-30)');
        }
        
        // Penalize very short URLs (likely tracking) -10 points
        if (url.length < 50) {
            score -= 10;
            reason.push('Short URL (-10)');
        }
        
        // Prefer videos with size info +3 points
        if (video.size && video.size > 0) {
            score += 3;
            reason.push('Has size (+3)');
        }
        
        // ==================== Domain Trust ====================
        // Bonus for known CDN/video hosting domains
        const trustedDomains = [
            'cloudfront.net', 'akamaihd.net', 'fbcdn.net',
            'googlevideo.com', 'youtube.com', 'vimeo.com',
            'cdn.', 'media.', 'video.', 'stream.',
            'mp4upload.com', 'vidoza.net', 'mixdrop.co',
        ];
        if (trustedDomains.some(domain => url.includes(domain))) {
            score += 5;
            reason.push('Trusted domain (+5)');
        }
        
        // Penalize common ad/tracking patterns that might slip through
        const suspiciousPatterns = [
            'pixel', 'beacon', 'track', 'analytics',
            'impression', 'click', 'advert'
        ];
        if (suspiciousPatterns.some(pattern => url.includes(pattern))) {
            score -= 20;
            reason.push('Suspicious pattern (-20)');
        }
        
        return { video, score, reason };
    });
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    const best = scored[0];
    util.Logging.info(`VideoTracker: Selected best video from ${videos.length} candidates`);
    util.Logging.info(`  → Score: ${best.score}, URL: ${(best.video.url || best.video.videoUrl || '').substring(0, 100)}...`);
    util.Logging.info(`  → Reasons: ${best.reason.join(', ')}`);
    
    // Log runner-ups for debugging
    if (scored.length > 1) {
        util.Logging.debug(`  → Runner-up scores: ${scored.slice(1, 4).map(s => s.score).join(', ')}`);
    }
    
    return best.video;
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
     * Get video record by video URL (for deduplication)
     * @param {string} videoUrl - Video URL to search for
     * @returns {Promise<object|null>} Video record or null
     */
    async getByVideoUrl(videoUrl) {
        if (!videoUrl) return null;
        
        const allVideos = await this.getAll();
        // Normalize URL by removing query params for comparison
        const normalizedUrl = videoUrl.split('?')[0];
        return allVideos.find(v => {
            const existingNormalizedUrl = (v.videoUrl || '').split('?')[0];
            return existingNormalizedUrl === normalizedUrl;
        }) || null;
    }
    
    /**
     * Add a new video record with automatic S3 deduplication
     * If the video already exists in S3 storage, auto-import as "synced"
     * @param {object} videoInfo - Video information
     * @param {string} videoInfo.sourceUrl - Page URL where video was found
     * @param {string} videoInfo.videoUrl - Original video URL
     * @param {string} videoInfo.mimeType - Video MIME type
     * @param {boolean} videoInfo.isHLS - Whether video is HLS stream
     * @returns {Promise<object>} Created or existing video record
     */
    async addVideo(videoInfo) {
        // Check if video with same URL already exists in local tracker
        const existing = await this.getByVideoUrl(videoInfo.videoUrl);
        if (existing) {
            util.Logging.info(`VideoTracker: Video already exists with URL ${videoInfo.videoUrl}, returning existing record ${existing.id}`);
            return existing;
        }
        
        // Prepare base record
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
        
        // Auto-check S3 for existing file (deduplication)
        if (s3Storage.isConfigured()) {
            try {
                const actualExtension = videoInfo.isHLS ? "mp4" : "mp4";
                const s3Key = s3Storage.generateKey(videoInfo.videoUrl, actualExtension);
                
                util.Logging.debug(`VideoTracker: Checking S3 for existing file: ${s3Key}`);
                const existsResult = await s3Storage.checkObjectExists(s3Key);
                
                if (existsResult.exists) {
                    // File already exists in S3 - auto-import as synced
                    const s3Url = s3Storage.getPublicUrl(s3Key);
                    record.s3Url = s3Url;
                    record.status = VIDEO_STATUS.SYNCED;
                    record.syncedAt = new Date().toISOString();
                    record.downloadSize = existsResult.size;
                    record.autoImported = true; // Flag to indicate auto-import from S3
                    
                    util.Logging.info(`VideoTracker: Video already exists in S3, auto-imported as synced: ${s3Url}`);
                }
            } catch (err) {
                // If S3 check fails, continue with pending status
                util.Logging.warn(`VideoTracker: S3 check failed, adding as pending: ${err.message}`);
            }
        }
        
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
     * @param {string} options.search - Search query for video URL or source URL
     * @param {string} options.sortBy - Field to sort by (createdAt)
     * @param {string} options.sortOrder - Sort order (asc, desc)
     * @param {number} options.limit - Limit results
     * @param {number} options.offset - Offset for pagination
     * @param {boolean} options.countOnly - Return only total count
     * @returns {Promise<object[]|object>} Array of video records or { records, total }
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
        
        // Filter by status
        if (options.status) {
            records = records.filter(r => r.status === options.status);
        }
        
        // Search filter - search in videoUrl and sourceUrl
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            records = records.filter(r => 
                (r.videoUrl && r.videoUrl.toLowerCase().includes(searchLower)) ||
                (r.sourceUrl && r.sourceUrl.toLowerCase().includes(searchLower))
            );
        }
        
        // Sorting
        const sortBy = options.sortBy || 'createdAt';
        const sortOrder = options.sortOrder || 'desc';
        const sortMultiplier = sortOrder === 'asc' ? 1 : -1;
        
        records.sort((a, b) => {
            let aVal, bVal;
            
            if (sortBy === 'createdAt') {
                aVal = new Date(a.createdAt || 0);
                bVal = new Date(b.createdAt || 0);
            } else {
                aVal = a[sortBy];
                bVal = b[sortBy];
            }
            
            if (aVal < bVal) return -1 * sortMultiplier;
            if (aVal > bVal) return 1 * sortMultiplier;
            return 0;
        });
        
        // Get total count before pagination
        const total = records.length;
        
        // Return only count if requested
        if (options.countOnly) {
            return { total };
        }
        
        // Pagination
        const offset = options.offset || 0;
        const limit = options.limit || records.length;
        const paginatedRecords = records.slice(offset, offset + limit);
        
        // Return with total if pagination is used
        if (options.limit !== undefined || options.offset !== undefined) {
            return { records: paginatedRecords, total };
        }
        
        return paginatedRecords;
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
     * Bulk re-upload multiple videos
     * @param {string[]} ids - Array of video record IDs to re-upload
     * @returns {Promise<object>} Results with success/failed counts and errors
     */
    async reuploadMany(ids) {
        const results = {
            total: ids.length,
            success: 0,
            failed: 0,
            deletedFromStorage: 0,
            errors: []
        };
        
        for (const id of ids) {
            try {
                const result = await this.reuploadVideo(id);
                if (result.success) {
                    results.success++;
                    if (result.deletedFromStorage) {
                        results.deletedFromStorage++;
                    }
                } else {
                    results.failed++;
                    results.errors.push({ id, error: result.error || 'Re-upload failed' });
                }
            } catch (err) {
                results.failed++;
                results.errors.push({ id, error: err.message });
            }
        }
        
        util.Logging.info(`VideoTracker: Bulk re-upload completed - ${results.success}/${results.total} succeeded`);
        return results;
    }
    
    /**
     * Delete multiple video records by IDs
     * @param {string[]} ids - Array of video record IDs to delete
     * @param {boolean} deleteFromStorage - Whether to also delete from S3 (default: true)
     * @returns {Promise<object>} Results with deleted count and errors
     */
    async deleteMany(ids, deleteFromStorage = true) {
        const results = { 
            deleted: 0, 
            deletedFromStorage: 0, 
            errors: [] 
        };
        
        for (const id of ids) {
            try {
                const result = await this.deleteVideo(id, deleteFromStorage);
                if (result.success) {
                    results.deleted++;
                    if (result.deletedFromStorage) {
                        results.deletedFromStorage++;
                    }
                } else {
                    results.errors.push({ id, error: result.error || 'Delete failed' });
                }
            } catch (err) {
                results.errors.push({ id, error: err.message });
            }
        }
        
        util.Logging.info(`VideoTracker: Bulk deleted ${results.deleted}/${ids.length} videos (${results.deletedFromStorage} from storage)`);
        return results;
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
     * Uses deterministic S3 key to check if file already exists (deduplication)
     * If exists, skips upload and uses existing S3 URL
     * Otherwise downloads and uploads the video
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
        
        // Generate deterministic S3 key first (same URL = same key)
        const actualExtension = record.isHLS ? "mp4" : "mp4";
        const s3Key = s3Storage.generateKey(record.videoUrl, actualExtension);
        
        try {
            util.Logging.info(`VideoTracker: Starting sync for video ${id}: ${record.videoUrl}`);
            util.Logging.info(`VideoTracker: Checking if file exists at S3 key: ${s3Key}`);
            
            // Check if file already exists in S3 (deduplication)
            const existsResult = await s3Storage.checkObjectExists(s3Key);
            
            if (existsResult.exists) {
                // File already exists - skip download and upload
                const s3Url = s3Storage.getPublicUrl(s3Key);
                util.Logging.info(`VideoTracker: File already exists in S3, skipping upload: ${s3Url}`);
                
                record.s3Url = s3Url;
                record.status = VIDEO_STATUS.SYNCED;
                record.syncedAt = new Date().toISOString();
                record.error = null;
                record.skippedUpload = true; // Flag to indicate deduplication
                
                await this._save(record);
                return record;
            }
            
            util.Logging.info(`VideoTracker: File not in S3, proceeding with download and upload`);
        } catch (err) {
            // If check fails, proceed with normal upload (safe fallback)
            util.Logging.warn(`VideoTracker: Failed to check S3 existence, proceeding with upload: ${err.message}`);
        }
        
        // Update status to uploading
        record.status = VIDEO_STATUS.UPLOADING;
        await this._save(record);
        
        const tempFilesToCleanup = [];
        let filePath, contentType;
        
        try {
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
            
            // Upload to S3 with metadata for future reconciliation
            const s3Url = await s3Storage.uploadFromFile(filePath, s3Key, contentType, {
                videoUrl: record.videoUrl,
                sourceUrl: record.sourceUrl
            });
            
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
     * Re-upload a video (delete from S3 if synced, then re-sync)
     * For synced: Delete S3 file -> Reset record -> Download -> Upload
     * For error: Reset record -> Download -> Upload
     * @param {string} id - Video record ID
     * @returns {Promise<object>} Result with success status and updated record
     */
    async reuploadVideo(id) {
        const record = await this.getById(id);
        
        if (!record) {
            return { success: false, error: 'Video not found' };
        }
        
        // Only allow re-upload for synced or error status
        if (record.status !== VIDEO_STATUS.SYNCED && record.status !== VIDEO_STATUS.ERROR) {
            return { 
                success: false, 
                error: `Cannot re-upload video with status "${record.status}". Only synced or error videos can be re-uploaded.`
            };
        }
        
        if (!s3Storage.isConfigured()) {
            return { success: false, error: 'S3 is not configured' };
        }
        
        const result = {
            success: true,
            deletedFromStorage: false,
            previousStatus: record.status
        };
        
        try {
            // If synced, delete existing S3 file first
            if (record.status === VIDEO_STATUS.SYNCED && record.s3Url) {
                util.Logging.info(`VideoTracker: Re-upload - deleting existing S3 file for video ${id}`);
                
                try {
                    const s3Key = s3Storage.extractKeyFromUrl(record.s3Url);
                    if (s3Key) {
                        await s3Storage.deleteObject(s3Key);
                        result.deletedFromStorage = true;
                        util.Logging.info(`VideoTracker: Deleted S3 file: ${s3Key}`);
                    }
                } catch (err) {
                    util.Logging.warn(`VideoTracker: Failed to delete S3 file, continuing with re-upload: ${err.message}`);
                }
            }
            
            // Reset record to pending state
            record.status = VIDEO_STATUS.PENDING;
            record.s3Url = null;
            record.syncedAt = null;
            record.error = null;
            record.isProtected = false;
            record.skippedUpload = false;
            record.autoImported = false;
            // Clear download info to force fresh download
            record.downloadPath = null;
            record.downloadSize = null;
            record.downloadContentType = null;
            record.downloadedAt = null;
            
            await this._save(record);
            util.Logging.info(`VideoTracker: Reset video ${id} to pending for re-upload`);
            
            // Now sync the video (download + upload)
            const syncedRecord = await this.syncVideo(id);
            
            result.record = syncedRecord;
            result.success = syncedRecord.status === VIDEO_STATUS.SYNCED;
            
            if (!result.success) {
                result.error = syncedRecord.error || 'Sync failed';
            }
            
            return result;
        } catch (err) {
            util.Logging.error(`VideoTracker: Re-upload failed for video ${id}: ${err.message}`);
            return {
                success: false,
                error: err.message,
                deletedFromStorage: result.deletedFromStorage
            };
        }
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
            },
            autoImported: 0,
            skippedUpload: 0
        };
        
        for (const record of records) {
            if (stats.byStatus[record.status] !== undefined) {
                stats.byStatus[record.status]++;
            }
            if (record.autoImported) {
                stats.autoImported++;
            }
            if (record.skippedUpload) {
                stats.skippedUpload++;
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

