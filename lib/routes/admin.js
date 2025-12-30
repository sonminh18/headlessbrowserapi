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
const { conf } = require('../util/config');
const { cache } = require('../util/cache');

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
     * List all tracked URLs
     */
    router.get('/api/urls', async (req, res) => {
        try {
            const { status, limit, offset } = req.query;
            
            const urls = await urlTracker.getAll({
                status,
                limit: limit ? parseInt(limit) : undefined,
                offset: offset ? parseInt(offset) : undefined
            });

            const stats = await urlTracker.getStats();

            res.json({ urls, stats });
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
     * Delete a URL record
     */
    router.delete('/api/urls/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const success = await urlTracker.delete(id);

            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'URL not found' });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== Video Management ====================
    
    /**
     * GET /admin/api/videos
     * List all videos
     */
    router.get('/api/videos', async (req, res) => {
        try {
            const { status, limit, offset } = req.query;
            
            const videos = await videoTracker.getAll({
                status,
                limit: limit ? parseInt(limit) : undefined,
                offset: offset ? parseInt(offset) : undefined
            });

            const stats = await videoTracker.getStats();

            res.json({ videos, stats });
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
     * POST /admin/api/videos/:id/sync
     * Sync a video to S3
     */
    router.post('/api/videos/:id/sync', async (req, res) => {
        try {
            const { id } = req.params;

            if (!s3Storage.isConfigured()) {
                return res.status(400).json({ error: 'S3 is not configured' });
            }

            const record = await videoTracker.syncVideo(id);

            if (!record) {
                return res.status(404).json({ error: 'Video not found' });
            }

            res.json(record);
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

