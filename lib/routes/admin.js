/**
 * Admin API Routes
 * Provides endpoints for managing browsers, URLs, videos, and cache
 */
const express = require('express');
const path = require('path');
const http = require('http');
const { urlTracker, URL_STATUS } = require('../util/url-tracker');
const { videoTracker, VIDEO_STATUS } = require('../util/video-tracker');
const { s3Storage } = require('../util/s3-storage');
const { storageSync } = require('../util/storage-sync');
const { conf } = require('../util/config');
const { cache } = require('../util/cache');
const { logEmitter } = require('../util/log-emitter');
const { uploadQueue } = require('../util/upload-queue');

/**
 * Internal function to call scrape API
 * @param {string} url - URL to scrape
 * @returns {Promise<object>} Scrape result
 */
const callScrapeApi = (url) => {
    return new Promise((resolve, reject) => {
        const apiKey = conf.API_KEY || process.env.API_KEY || 'test-api-key';
        const port = conf.PORT || process.env.PORT || 3000;
        const host = '127.0.0.1';
        
        const requestUrl = `/apis/scrape/v1/puppeteer?apikey=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(url)}`;
        
        const options = {
            hostname: host,
            port: port,
            path: requestUrl,
            method: 'GET',
            timeout: 120000
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (res.statusCode >= 400) {
                        reject(new Error(result.error || `HTTP ${res.statusCode}`));
                    } else {
                        resolve(result);
                    }
                } catch (e) {
                    reject(new Error('Invalid response from scrape API'));
                }
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
};

/**
 * Create admin router
 * @param {object} options - Router options
 * @param {object} options.cache - CacheManager instance
 * @param {Function} options.getBrowserPool - Function to get browser pool instance
 * @returns {express.Router} Express router
 */
const createAdminRouter = (options) => {
    const router = express.Router();
    const { cache, getBrowserPool } = options;

    // Parse JSON body for admin routes
    router.use(express.json());

    // ==================== Dashboard ====================
    
    /**
     * GET /admin/api/dashboard
     * Get dashboard statistics
     */
    router.get('/api/dashboard', async (req, res) => {
        try {
            const [urlStats, videoStats, cacheStats, browserPool] = await Promise.all([
                urlTracker.getStats(),
                videoTracker.getStats(),
                cache.getStats(),
                getBrowserPool()
            ]);

            const browserStats = browserPool ? browserPool.getStats() : {
                activeBrowsers: 0,
                activePages: 0,
                browsersLaunched: 0,
                browsersClosed: 0
            };

            res.json({
                urls: urlStats,
                videos: videoStats,
                cache: cacheStats,
                browsers: browserStats
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== Browser Management ====================
    
    /**
     * GET /admin/api/browsers
     * List all browser processes
     */
    router.get('/api/browsers', async (req, res) => {
        try {
            const browserPool = await getBrowserPool();
            
            if (!browserPool) {
                return res.json({ browsers: [], stats: {} });
            }

            const processInfo = await browserPool.getProcessInfo();
            const stats = browserPool.getStats();

            res.json({
                browsers: processInfo,
                stats
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/browsers/:id/terminate
     * Terminate a specific browser process
     */
    router.post('/api/browsers/:id/terminate', async (req, res) => {
        try {
            const { id } = req.params;
            const browserPool = await getBrowserPool();

            if (!browserPool) {
                return res.status(404).json({ error: 'Browser pool not available' });
            }

            const success = await browserPool.terminateProcess(id);

            if (success) {
                res.json({ success: true, message: `Browser ${id} terminated` });
            } else {
                res.status(404).json({ error: `Browser ${id} not found` });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== URL Management ====================
    
    /**
     * GET /admin/api/urls
     * List all tracked URLs with pagination, search, sorting
     */
    router.get('/api/urls', async (req, res) => {
        try {
            const { status, search, hasVideo, sortBy, sortOrder, page, limit } = req.query;
            
            const pageNum = page ? parseInt(page) : 1;
            const limitNum = limit ? parseInt(limit) : 10;
            const offset = (pageNum - 1) * limitNum;
            
            const result = await urlTracker.getAll({
                status,
                search,
                hasVideo,
                sortBy,
                sortOrder,
                limit: limitNum,
                offset
            });

            const stats = await urlTracker.getStats();
            
            // Handle both array (backward compat) and object response
            const urls = Array.isArray(result) ? result : result.records;
            const total = Array.isArray(result) ? result.length : result.total;
            const totalPages = Math.ceil(total / limitNum);

            res.json({ 
                urls, 
                stats,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages
                }
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /admin/api/urls/:id
     * Get URL details including scrape result
     */
    router.get('/api/urls/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const record = await urlTracker.getById(id);

            if (!record) {
                return res.status(404).json({ error: 'URL not found' });
            }

            res.json(record);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/urls
     * Add a new URL and scrape it (calls the actual scrape API)
     */
    router.post('/api/urls', async (req, res) => {
        try {
            const { url } = req.body;

            if (!url) {
                return res.status(400).json({ error: 'URL is required' });
            }

            // Validate URL format
            try {
                new URL(url);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid URL format' });
            }

            // Call the actual scrape API (this will also track the URL)
            const scrapeResult = await callScrapeApi(url);
            
            // Get the URL record that was created during scraping
            const urls = await urlTracker.getAll({ limit: 1 });
            const record = urls.find(u => u.url === url) || { url, status: 'done' };
            
            res.status(201).json({
                ...record,
                scrapeResult: {
                    hasHtml: !!scrapeResult.html,
                    htmlLength: scrapeResult.html ? scrapeResult.html.length : 0,
                    videoUrls: scrapeResult.videoUrls || [],
                    cached: scrapeResult.cached || false
                }
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/urls/:id/cancel
     * Cancel a URL processing
     */
    router.post('/api/urls/:id/cancel', async (req, res) => {
        try {
            const { id } = req.params;
            const record = await urlTracker.cancelUrl(id);

            if (!record) {
                return res.status(404).json({ error: 'URL not found' });
            }

            res.json(record);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/urls/:id/rescrape
     * Re-scrape a URL (scrape fresh data)
     * Steps:
     * 1. Invalidate cache for this URL
     * 2. Delete old videos for this URL (including from S3 storage)
     * 3. Delete old URL record
     * 4. Call scrape API (which creates new record and videos)
     * 5. Return the result
     */
    router.post('/api/urls/:id/rescrape', async (req, res) => {
        try {
            const { id } = req.params;
            const existingRecord = await urlTracker.getById(id);

            if (!existingRecord) {
                return res.status(404).json({ error: 'URL not found' });
            }

            const targetUrl = existingRecord.url;

            // Invalidate cache for this URL before re-scraping
            // The cache key format is: `${url}-${JSON.stringify(options)}`
            // Default options from scrape API when called without extra params
            const defaultOptions = { url: targetUrl, cleanup: true };
            const cacheKey = `${targetUrl}-${JSON.stringify(defaultOptions)}`;
            await cache.delete(cacheKey);
            
            // Delete all existing videos for this source URL (including from S3 storage)
            const videoDeleteResult = await videoTracker.deleteBySourceUrl(targetUrl, true);
            
            // Delete old URL record - scrape API will create new one
            await urlTracker.delete(id);

            try {
                // Perform the scrape using internal API call
                // The scrape API already handles URL tracking internally
                const response = await callScrapeApi(targetUrl);

                // Check if scrape returned an error
                if (response.error) {
                    return res.json({
                        success: false,
                        error: response.error
                    });
                }

                // Get the newly created URL record from scrape API
                const allUrls = await urlTracker.getAll();
                const newRecord = allUrls.find(u => u.url === targetUrl && u.status === URL_STATUS.DONE);

                res.json({
                    success: true,
                    urlRecord: newRecord || null,
                    videosAdded: response.videoUrls?.length || 0,
                    videosDeleted: videoDeleteResult.deleted,
                    videosDeletedFromStorage: videoDeleteResult.deletedFromStorage,
                    cached: response.cached || false
                });
            } catch (scrapeErr) {
                res.status(500).json({ 
                    success: false,
                    error: scrapeErr.message
                });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * DELETE /admin/api/urls/:id
     * Delete a URL record and its associated cache
     */
    router.delete('/api/urls/:id', async (req, res) => {
        try {
            const { id } = req.params;
            
            // Get the URL record first to retrieve cacheKey
            const record = await urlTracker.getById(id);
            if (!record) {
                return res.status(404).json({ error: 'URL not found' });
            }
            
            let cacheCleared = false;
            
            // Clear associated cache if cacheKey exists
            if (record.cacheKey) {
                try {
                    await cache.delete(record.cacheKey);
                    cacheCleared = true;
                } catch (cacheErr) {
                    // Log but don't fail - cache might already be expired
                    console.warn(`Failed to clear cache for URL ${id}: ${cacheErr.message}`);
                }
            }
            
            // Delete the URL record
            const success = await urlTracker.delete(id);

            if (success) {
                res.json({ success: true, cacheCleared });
            } else {
                res.status(404).json({ error: 'Failed to delete URL record' });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/urls/bulk-delete
     * Delete multiple URL records and their associated cache
     */
    router.post('/api/urls/bulk-delete', async (req, res) => {
        try {
            const { ids } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids array is required' });
            }

            let cacheCleared = 0;
            
            // Clear cache for each URL before deleting
            for (const id of ids) {
                try {
                    const record = await urlTracker.getById(id);
                    if (record?.cacheKey) {
                        await cache.delete(record.cacheKey);
                        cacheCleared++;
                    }
                } catch (err) {
                    // Log but don't fail
                    console.warn(`Failed to clear cache for URL ${id}: ${err.message}`);
                }
            }

            const results = await urlTracker.deleteMany(ids);
            results.cacheCleared = cacheCleared;
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /admin/api/urls/:id/response
     * Get cached response for a URL
     */
    router.get('/api/urls/:id/response', async (req, res) => {
        try {
            const { id } = req.params;
            const record = await urlTracker.getById(id);

            if (!record) {
                return res.status(404).json({ error: 'URL not found' });
            }

            if (!record.cacheKey) {
                return res.status(404).json({ 
                    error: 'No cache key stored for this URL',
                    hint: 'This URL may have been tracked before cacheKey support was added'
                });
            }

            // Retrieve from cache
            const cachedData = await cache.get(record.cacheKey);
            
            if (!cachedData) {
                return res.status(404).json({ 
                    error: 'Cached response not found or expired',
                    cacheKey: record.cacheKey
                });
            }

            res.json({
                url: record.url,
                cacheKey: record.cacheKey,
                cachedAt: record.completedAt,
                data: {
                    html: cachedData.html,
                    htmlLength: cachedData.html?.length || 0,
                    videoUrls: cachedData.videoUrls || [],
                    title: record.result?.title
                }
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== Video Management ====================
    
    /**
     * GET /admin/api/videos
     * List all videos with pagination, search, sorting, and date filtering
     */
    router.get('/api/videos', async (req, res) => {
        try {
            const { status, search, sortBy, sortOrder, page, limit, dateFrom, dateTo, sourceUrl, isHLS } = req.query;
            
            const pageNum = page ? parseInt(page) : 1;
            const limitNum = limit ? parseInt(limit) : 10;
            const offset = (pageNum - 1) * limitNum;
            
            const result = await videoTracker.getAll({
                status, // Can be comma-separated for multi-status filter
                search,
                sortBy,
                sortOrder,
                limit: limitNum,
                offset,
                dateFrom: dateFrom ? new Date(dateFrom) : null,
                dateTo: dateTo ? new Date(dateTo) : null,
                sourceUrl, // Filter by source URL
                isHLS: isHLS === 'true' // Filter HLS only
            });

            const stats = await videoTracker.getStats();
            
            // Handle both array (backward compat) and object response
            const videos = Array.isArray(result) ? result : result.records;
            const total = Array.isArray(result) ? result.length : result.total;
            const totalPages = Math.ceil(total / limitNum);

            res.json({ 
                videos, 
                stats,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages
                }
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /admin/api/videos/export
     * Export videos to CSV or JSON
     */
    router.get('/api/videos/export', async (req, res) => {
        try {
            const { status, search, sortBy, sortOrder, dateFrom, dateTo, format = 'csv' } = req.query;
            
            const result = await videoTracker.getAll({
                status,
                search,
                sortBy,
                sortOrder,
                dateFrom: dateFrom ? new Date(dateFrom) : null,
                dateTo: dateTo ? new Date(dateTo) : null,
                limit: 10000 // Max export limit
            });

            const videos = Array.isArray(result) ? result : result.records;
            
            if (format === 'json') {
                res.json({ data: videos, total: videos.length });
            } else {
                // CSV format
                const headers = ['id', 'videoUrl', 'sourceUrl', 'status', 's3Url', 'createdAt', 'syncedAt', 'error'];
                const csvRows = [headers.join(',')];
                
                for (const video of videos) {
                    const row = headers.map(h => {
                        const value = video[h] || '';
                        // Escape quotes and wrap in quotes if contains comma
                        const escaped = String(value).replace(/"/g, '""');
                        return escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') 
                            ? `"${escaped}"` 
                            : escaped;
                    });
                    csvRows.push(row.join(','));
                }
                
                res.json({ csv: csvRows.join('\n'), total: videos.length });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos
     * Add a video manually
     */
    router.post('/api/videos', async (req, res) => {
        try {
            const { videoUrl, sourceUrl, mimeType, isHLS } = req.body;

            if (!videoUrl) {
                return res.status(400).json({ error: 'Video URL is required' });
            }

            const record = await videoTracker.addVideo({
                videoUrl,
                sourceUrl: sourceUrl || '',
                mimeType: mimeType || 'video/mp4',
                isHLS: isHLS || false
            });

            res.status(201).json(record);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * PUT /admin/api/videos/:id
     * Update a video record
     */
    router.put('/api/videos/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;

            const record = await videoTracker.updateVideo(id, updates);

            if (!record) {
                return res.status(404).json({ error: 'Video not found' });
            }

            res.json(record);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * DELETE /admin/api/videos/:id
     * Delete a video record and its S3 file if synced
     */
    router.delete('/api/videos/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { keepStorage } = req.query; // ?keepStorage=true to keep S3 file
            
            const result = await videoTracker.deleteVideo(id, keepStorage !== 'true');

            if (!result.success) {
                return res.status(404).json({ error: result.error || 'Video not found' });
            }

            res.json({
                success: true,
                deletedFromStorage: result.deletedFromStorage,
                storageError: result.storageError
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/bulk-delete
     * Delete multiple video records (and optionally from S3)
     */
    router.post('/api/videos/bulk-delete', async (req, res) => {
        try {
            const { ids, keepStorage } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids array is required' });
            }

            const results = await videoTracker.deleteMany(ids, keepStorage !== true);
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/bulk-reupload
     * Bulk re-upload multiple videos via upload queue
     */
    router.post('/api/videos/bulk-reupload', async (req, res) => {
        try {
            const { ids, force = false, deleteFirst = false, priority = 0 } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids array is required' });
            }

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            let queued = 0;
            let failed = 0;
            const errors = [];

            for (const id of ids) {
                try {
                    // Use centralized reset method to ensure all fields are properly cleared
                    // This fixes the stale downloadPath bug
                    const resetResult = await videoTracker.resetForReupload(id, { force, deleteFirst });
                    
                    if (!resetResult.success) {
                        errors.push({ id, error: resetResult.error });
                        failed++;
                        continue;
                    }

                    const video = resetResult.record;

                    // Add to queue with video info for display
                    const queueResult = uploadQueue.add(id, { 
                        priority,
                        videoUrl: video.videoUrl,
                        sourceUrl: video.sourceUrl,
                        downloadSize: video.downloadSize
                    });
                    if (queueResult.success) {
                        queued++;
                    }
                } catch (err) {
                    errors.push({ id, error: err.message });
                    failed++;
                }
            }

            res.json({
                total: ids.length,
                queued,
                failed,
                errors: errors.length > 0 ? errors : undefined
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/bulk-sync
     * Bulk sync multiple pending videos via upload queue
     */
    router.post('/api/videos/bulk-sync', async (req, res) => {
        try {
            const { ids, priority = 0 } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids array is required' });
            }

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            // Add all to queue with video info
            const results = { total: ids.length, queued: 0, skipped: 0, positions: [] };
            
            for (const id of ids) {
                try {
                    const video = await videoTracker.getById(id);
                    const queueResult = uploadQueue.add(id, { 
                        priority,
                        videoUrl: video?.videoUrl,
                        sourceUrl: video?.sourceUrl,
                        downloadSize: video?.downloadSize
                    });
                    
                    if (queueResult.success) {
                        results.queued++;
                        results.positions.push({ videoId: id, position: queueResult.position });
                    } else {
                        results.skipped++;
                    }
                } catch (err) {
                    results.skipped++;
                }
            }

            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/retry-failed
     * Retry all failed videos (re-queue them for sync)
     */
    router.post('/api/videos/retry-failed', async (req, res) => {
        try {
            const { maxRetries = 3, skipProtected = true } = req.body;

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const results = await videoTracker.retryAllFailed({ maxRetries, skipProtected });
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/:id/sync
     * Sync a video to S3 via upload queue
     */
    router.post('/api/videos/:id/sync', async (req, res) => {
        try {
            const { id } = req.params;
            const { priority = 0, immediate = false } = req.body;

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            // Check if video exists
            const video = await videoTracker.getById(id);
            if (!video) {
                return res.status(404).json({ error: 'Video not found' });
            }

            // Add to upload queue with video info
            const queueResult = uploadQueue.add(id, { 
                priority,
                videoUrl: video.videoUrl,
                sourceUrl: video.sourceUrl,
                downloadSize: video.downloadSize
            });
            
            if (!queueResult.success) {
                // Already in queue or processing
                return res.json({
                    queued: false,
                    message: queueResult.error || 'Already in queue',
                    status: video.status
                });
            }

            res.json({
                queued: true,
                position: queueResult.position,
                videoId: id,
                priority,
                message: `Added to upload queue at position ${queueResult.position}`
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/reset-stuck
     * Reset videos stuck in uploading status back to pending
     */
    router.post('/api/videos/reset-stuck', async (req, res) => {
        try {
            const { timeoutMinutes } = req.body;
            const results = await videoTracker.resetStuckUploads(timeoutMinutes || 10);
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/sync-all
     * Sync all pending videos to S3
     */
    router.post('/api/videos/sync-all', async (req, res) => {
        try {
            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const results = await videoTracker.syncAllPending();
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/:id/reupload
     * Re-upload a video via upload queue
     * For synced videos: Delete S3 file -> Reset status -> Add to queue
     * For error videos: Reset status -> Add to queue
     * Options:
     *   - force: boolean - Skip S3 existence check
     *   - deleteFirst: boolean - Delete S3 file before upload
     *   - priority: number - Queue priority (higher = processed first)
     */
    router.post('/api/videos/:id/reupload', async (req, res) => {
        try {
            const { id } = req.params;
            const { force = false, deleteFirst = false, priority = 0 } = req.body || {};

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            // Use centralized reset method to ensure all fields are properly cleared
            // This fixes the stale downloadPath bug
            const resetResult = await videoTracker.resetForReupload(id, { force, deleteFirst });
            
            if (!resetResult.success) {
                return res.status(404).json({ error: resetResult.error });
            }

            const video = resetResult.record;

            // Add to upload queue with priority and video info
            const queueResult = uploadQueue.add(id, { 
                priority,
                videoUrl: video.videoUrl,
                sourceUrl: video.sourceUrl,
                downloadSize: video.downloadSize
            });

            res.json({
                queued: queueResult.success,
                position: queueResult.position,
                videoId: id,
                deletedFromStorage: resetResult.deletedFromStorage,
                previousStatus: resetResult.previousStatus,
                force,
                priority,
                message: queueResult.success 
                    ? `Added to upload queue at position ${queueResult.position}`
                    : queueResult.error || 'Already in queue'
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/videos/:id/download
     * Download a video and store for later sync
     */
    router.post('/api/videos/:id/download', async (req, res) => {
        try {
            const { id } = req.params;
            const startTime = Date.now();
            
            const record = await videoTracker.downloadVideoById(id);

            if (!record) {
                return res.status(404).json({ error: 'Video not found' });
            }

            const duration = Date.now() - startTime;

            if (record.downloadedAt && !record.error) {
                res.json({
                    success: true,
                    videoId: id,
                    videoUrl: record.videoUrl,
                    download: {
                        size: record.downloadSize,
                        sizeMB: parseFloat((record.downloadSize / 1024 / 1024).toFixed(2)),
                        contentType: record.downloadContentType,
                        downloadedAt: record.downloadedAt,
                        duration: duration,
                        durationSeconds: (duration / 1000).toFixed(1)
                    }
                });
            } else {
                res.json({
                    success: false,
                    videoId: id,
                    videoUrl: record.videoUrl,
                    error: record.error || 'Download failed',
                    duration: duration
                });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== Upload Queue ====================

    // Initialize upload queue with video tracker sync callback
    uploadQueue.setProcessCallback(async (videoId, item) => {
        const record = await videoTracker.syncVideo(videoId);
        if (record && record.status === VIDEO_STATUS.SYNCED) {
            return record;
        }
        throw new Error(record?.error || 'Sync failed');
    });

    /**
     * GET /admin/api/upload-queue/status
     * Get upload queue status
     */
    router.get('/api/upload-queue/status', (req, res) => {
        try {
            const { 
                pendingPage = 1, 
                pendingLimit = 20,
                completedPage = 1,
                completedLimit = 20
            } = req.query;
            
            const status = uploadQueue.getStatus({
                pendingPage: parseInt(pendingPage),
                pendingLimit: parseInt(pendingLimit),
                completedPage: parseInt(completedPage),
                completedLimit: parseInt(completedLimit)
            });
            res.json(status);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/add
     * Add videos to upload queue
     */
    router.post('/api/upload-queue/add', async (req, res) => {
        try {
            const { ids, priority = 0 } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids array is required' });
            }

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const results = uploadQueue.addMany(ids, priority);
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/:id/pause
     * Pause a specific upload
     */
    router.post('/api/upload-queue/:id/pause', (req, res) => {
        try {
            const { id } = req.params;
            const success = uploadQueue.pause(id);
            res.json({ success });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/:id/resume
     * Resume a specific upload
     */
    router.post('/api/upload-queue/:id/resume', (req, res) => {
        try {
            const { id } = req.params;
            const success = uploadQueue.resume(id);
            res.json({ success });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/:id/cancel
     * Cancel a specific upload and optionally reset video status
     */
    router.post('/api/upload-queue/:id/cancel', async (req, res) => {
        try {
            const { id } = req.params;
            const { resetStatus = true } = req.body || {};
            
            // Cancel from queue
            const cancelled = uploadQueue.cancel(id);
            
            // Also reset video status if requested
            let statusReset = false;
            if (resetStatus) {
                try {
                    const video = await videoTracker.getById(id);
                    if (video && video.status === VIDEO_STATUS.UPLOADING) {
                        await videoTracker.updateVideo(id, {
                            status: VIDEO_STATUS.PENDING,
                            error: 'Upload cancelled by user'
                        });
                        statusReset = true;
                    }
                } catch (err) {
                    // Ignore errors resetting status
                }
            }
            
            res.json({ success: cancelled || statusReset, cancelled, statusReset });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/:id/priority
     * Set priority for a specific upload
     */
    router.post('/api/upload-queue/:id/priority', (req, res) => {
        try {
            const { id } = req.params;
            const { priority } = req.body;
            
            if (priority === undefined) {
                return res.status(400).json({ error: 'priority is required' });
            }
            
            const success = uploadQueue.setPriority(id, priority);
            res.json({ success });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/pause-all
     * Pause all uploads
     */
    router.post('/api/upload-queue/pause-all', (req, res) => {
        try {
            uploadQueue.pauseAll();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/resume-all
     * Resume all uploads
     */
    router.post('/api/upload-queue/resume-all', (req, res) => {
        try {
            uploadQueue.resumeAll();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/clear
     * Clear completed history
     */
    router.post('/api/upload-queue/clear', (req, res) => {
        try {
            uploadQueue.clearHistory();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/upload-queue/reset-all
     * Cancel all queue items and reset all uploading videos to pending
     */
    router.post('/api/upload-queue/reset-all', async (req, res) => {
        try {
            // Get queue status
            const status = uploadQueue.getStatus();
            let cancelledCount = 0;
            let resetCount = 0;
            
            // Cancel all items in queue
            for (const item of [...(status.active || []), ...(status.pending || [])]) {
                if (uploadQueue.cancel(item.videoId)) {
                    cancelledCount++;
                }
            }
            
            // Reset all videos with uploading status
            const allVideos = await videoTracker.getAll({ status: VIDEO_STATUS.UPLOADING });
            const uploadingVideos = Array.isArray(allVideos) ? allVideos : (allVideos.records || []);
            
            for (const video of uploadingVideos) {
                try {
                    await videoTracker.updateVideo(video.id, {
                        status: VIDEO_STATUS.PENDING,
                        error: 'Queue reset by user'
                    });
                    resetCount++;
                } catch (err) {
                    // Ignore individual errors
                }
            }
            
            res.json({ 
                success: true, 
                cancelled: cancelledCount, 
                reset: resetCount,
                message: `Cancelled ${cancelledCount} queue items, reset ${resetCount} uploading videos`
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== Storage ====================
    
    /**
     * GET /admin/api/storage/status
     * Get S3 storage configuration status
     */
    router.get('/api/storage/status', (req, res) => {
        const isConfigured = s3Storage.isConfigured();
        
        res.json({
            configured: isConfigured,
            endpoint: process.env.S3_ENDPOINT ? process.env.S3_ENDPOINT.replace(/\/\/.+@/, '//***@') : null,
            bucket: process.env.S3_BUCKET || null,
            region: process.env.S3_REGION || 'us-east-1',
            keyPrefix: process.env.S3_KEY_PREFIX || 'videos/',
            cdnUrl: process.env.S3_CDN_URL || null,
            autoSync: process.env.AUTO_SYNC_VIDEOS === 'true'
        });
    });

    /**
     * POST /admin/api/storage/test
     * Test S3 connection
     */
    router.post('/api/storage/test', async (req, res) => {
        try {
            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'S3 is not configured' 
                });
            }

            await s3Storage.validateConnection();
            res.json({ success: true, message: 'S3 connection successful' });
        } catch (err) {
            res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
    });

    // ==================== Storage Sync ====================

    /**
     * GET /admin/api/storage/sync/status
     * Get storage sync status and cache info
     */
    router.get('/api/storage/sync/status', async (req, res) => {
        try {
            const status = await storageSync.getStatus();
            res.json(status);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/storage/scan
     * Scan S3 storage and build inventory
     */
    router.post('/api/storage/scan', async (req, res) => {
        try {
            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const inventory = await storageSync.scanStorage(true);
            
            // Convert Map to array for JSON response
            const objects = Array.from(inventory.values());
            
            res.json({
                success: true,
                count: objects.length,
                objects: objects
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /admin/api/storage/reconcile
     * Reconcile local tracker with S3 storage
     * Query params:
     *   - forceRefresh: boolean - Force refresh even if cache exists
     */
    router.get('/api/storage/reconcile', async (req, res) => {
        try {
            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const forceRefresh = req.query.forceRefresh === 'true';
            const result = await storageSync.reconcile({ forceRefresh });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    
    /**
     * GET /admin/api/storage/status
     * Get storage sync status overview
     */
    router.get('/api/storage/status', async (req, res) => {
        try {
            const status = await storageSync.getStatus();
            res.json(status);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /admin/api/storage/orphans
     * List orphan files (in S3 but not tracked)
     */
    router.get('/api/storage/orphans', async (req, res) => {
        try {
            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const result = await storageSync.reconcile();
            res.json({
                orphans: result.orphanFiles,
                count: result.orphanFiles.length
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/storage/orphans/import
     * Import an orphan file into the tracker
     * Body: { key: "s3-key-to-import" }
     */
    router.post('/api/storage/orphans/import', async (req, res) => {
        try {
            const { key } = req.body;

            if (!key) {
                return res.status(400).json({ error: 'S3 key is required' });
            }

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const record = await storageSync.importOrphan(key);
            res.json({
                success: true,
                video: record
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * DELETE /admin/api/storage/orphans
     * Delete an orphan file from S3
     * Body: { key: "s3-key-to-delete" }
     */
    router.delete('/api/storage/orphans', async (req, res) => {
        try {
            const { key } = req.body;

            if (!key) {
                return res.status(400).json({ error: 'S3 key is required' });
            }

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            await storageSync.deleteOrphan(key);
            res.json({
                success: true,
                message: `Deleted ${key} from S3`
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/storage/orphans/bulk-import
     * Bulk import multiple orphan files
     * Body: { keys: ["key1", "key2", ...] }
     */
    router.post('/api/storage/orphans/bulk-import', async (req, res) => {
        try {
            const { keys } = req.body;

            if (!keys || !Array.isArray(keys) || keys.length === 0) {
                return res.status(400).json({ error: 'keys array is required' });
            }

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const result = await storageSync.bulkImportOrphans(keys);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/storage/orphans/bulk-delete
     * Bulk delete multiple orphan files from S3
     * Body: { keys: ["key1", "key2", ...] }
     */
    router.post('/api/storage/orphans/bulk-delete', async (req, res) => {
        try {
            const { keys } = req.body;

            if (!keys || !Array.isArray(keys) || keys.length === 0) {
                return res.status(400).json({ error: 'keys array is required' });
            }

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const result = await storageSync.bulkDeleteOrphans(keys);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/storage/fix-missing
     * Fix videos marked as synced but missing from S3
     * Resets their status to pending
     * Body: { ids: ["video-id-1", "video-id-2", ...] }
     */
    router.post('/api/storage/fix-missing', async (req, res) => {
        try {
            const { ids } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids array is required' });
            }

            const result = await storageSync.fixMissingInS3(ids);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /admin/api/storage/clear-cache
     * Clear the S3 inventory cache
     */
    router.post('/api/storage/clear-cache', (req, res) => {
        storageSync.clearCache();
        res.json({ success: true, message: 'Inventory cache cleared' });
    });

    // ==================== Live Logs ====================
    
    /**
     * GET /admin/api/logs/stream - SSE endpoint for live logs
     */
    router.get('/api/logs/stream', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        res.flushHeaders();
        
        // Send initial connection message
        res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
        
        // Add this client to emitter
        logEmitter.addClient(res);
        
        // Heartbeat every 30s to keep connection alive
        const heartbeat = setInterval(() => {
            res.write(`: heartbeat\n\n`);
        }, 30000);
        
        req.on('close', () => {
            clearInterval(heartbeat);
            logEmitter.removeClient(res);
        });
    });

    /**
     * GET /admin/api/logs/stats - Get log stats
     */
    router.get('/api/logs/stats', (req, res) => {
        res.json({
            activeClients: logEmitter.getClientCount()
        });
    });

    // ==================== Cache ====================
    
    /**
     * POST /admin/api/cache/clear
     * Clear all cache
     */
    router.post('/api/cache/clear', async (req, res) => {
        try {
            const { pattern } = req.body;
            await cache.clear(pattern || '*');
            
            const stats = await cache.getStats();
            res.json({ 
                success: true, 
                message: 'Cache cleared',
                stats 
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /admin/api/cache/stats
     * Get cache statistics
     */
    router.get('/api/cache/stats', async (req, res) => {
        try {
            const stats = await cache.getStats();
            res.json(stats);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== Serve Snapshots ====================
    
    /**
     * Serve error snapshots
     */
    router.use('/snapshots', express.static(path.join(__dirname, '../../public/snapshots')));

    // ==================== Serve Admin SPA ====================
    
    /**
     * Serve admin frontend (SPA)
     * This should be added after all API routes
     */
    router.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '../../admin/dist/index.html'));
    });

    router.get('/*', (req, res, next) => {
        // Skip API routes
        if (req.path.startsWith('/api/')) {
            return next();
        }
        res.sendFile(path.join(__dirname, '../../admin/dist/index.html'));
    });

    return router;
};

module.exports = {
    createAdminRouter,
    URL_STATUS,
    VIDEO_STATUS
};

