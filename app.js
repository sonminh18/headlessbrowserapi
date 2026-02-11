// requires the multiple libraries
const express = require("express");
const path = require("path");
const process = require("process");
const util = require("hive-js-util");
const info = require("./package");
const lib = require("./lib");
const CacheManager = require("./lib/util/cache");
const { verifyKey } = require("./lib");
const { DEFAULT_BROWSER_TIMEOUT } = require("./lib/util/config");
const { s3Storage } = require("./lib/util/s3-storage");
const { downloadVideo, cleanupTempFiles } = require("./lib/util/video-downloader");
const { createAdminRouter } = require("./lib/routes/admin");
const { videoTracker, selectBestVideo, AD_URL_PATTERNS } = require("./lib/util/video-tracker");
const { urlTracker, URL_STATUS } = require("./lib/util/url-tracker");
const { logEmitter } = require("./lib/util/log-emitter");
const { videoDownloadQueue } = require("./lib/util/video-download-queue");

// Set up chrome-headless-shell executable path if not already set
try {
    if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
        // Try to find the chrome-headless-shell path using @puppeteer/browsers
        const browsers = require("@puppeteer/browsers");
        const executablePath = browsers.computeExecutablePath({
            browser: "chrome-headless-shell",
            buildId: "stable"
        });
        process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
        console.log(`Using chrome-headless-shell at: ${executablePath}`);
    }
} catch (err) {
    console.log("Could not determine chrome-headless-shell path automatically:", err.message);
}

// builds the initial application object to be used
// by the application for serving
const app = express();

// Parse JSON for admin routes first
app.use('/admin', express.json());

// Raw body parser for other routes (scraping)
app.use(express.raw({ limit: "1GB", type: "*/*" }));

// Initialize cache with TTL of 30 days (2592000 seconds)
const cache = new CacheManager(parseInt(process.env.CACHE_TTL) || 2592000);

// Helper function to get browser pool from engine
const getBrowserPool = async () => {
    try {
        const engineInstance = lib.ENGINES.puppeteer.singleton();
        return engineInstance.browserPool;
    } catch (err) {
        return null;
    }
};

// Graceful shutdown handlers
const handleShutdown = async () => {
    util.Logging.info("Exiting gracefully");
    await lib.destroy();
    process.exit(0);
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
process.on("exit", () => {
    util.Logging.info("Exiting on user's request");
});

// Request validation middleware
const validateScrapeRequest = (req, res, next) => {
    try {
        // Extract and validate required parameters
        const { apikey, url } = req.query;

        // Validate required parameters
        if (!apikey) {
            return res.status(400).json({
                html: "API key is required",
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: "API key is required"
            });
        }
        if (!url) {
            return res.status(400).json({
                html: "URL is required",
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: "URL is required"
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (error) {
            return res.status(400).json({
                html: "Invalid URL format",
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: "Invalid URL format"
            });
        }

        // Set the API key in the request for verification
        req.query.key = apikey;

        try {
            verifyKey(req);
        } catch (error) {
            return res.status(400).json({
                html: error.message,
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: error.message
            });
        }

        // Validate timeout (must be a number)
        if (req.query.timeout && req.query.timeout !== 'default') {
            const timeout = parseInt(req.query.timeout, 10);
            if (isNaN(timeout) || timeout <= 0) {
                return res.status(400).json({
                    html: "Timeout must be a positive number",
                    apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                    url: req.originalUrl || req.url,
                    error: "Timeout must be a positive number"
                });
            }

            // Log the custom timeout being used
            util.Logging.info(`Using custom timeout from request: ${timeout}ms`);
        }

        // Validate custom cookies format if provided
        if (req.query.custom_cookies && req.query.custom_cookies !== 'default') {
            try {
                // Try to parse as JSON
                JSON.parse(decodeURIComponent(req.query.custom_cookies));
            } catch (error) {
                // If it's not valid JSON, assume it's a cookie string format
                // Cookie strings should be in format: name=value;name2=value2
                if (!req.query.custom_cookies.includes('=')) {
                    const errorMsg = "Invalid custom_cookies format. Must be URL-encoded JSON or a string in format 'name=value;name2=value2'";
                    return res.status(400).json({
                        html: errorMsg,
                        apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                        url: req.originalUrl || req.url,
                        error: errorMsg
                    });
                }
            }
        }

        // Validate proxy_url if provided
        if (req.query.proxy_url && req.query.proxy_url !== 'default') {
            try {
                new URL(req.query.proxy_url);
            } catch (error) {
                return res.status(400).json({
                    html: "Invalid proxy_url format",
                    apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                    url: req.originalUrl || req.url,
                    error: "Invalid proxy_url format"
                });
            }
        }

        // Validate user_pass format if provided (should be username:password)
        if (req.query.user_pass && req.query.user_pass !== 'default' && !req.query.user_pass.includes(':')) {
            return res.status(400).json({
                html: "Invalid user_pass format. Must be 'username:password'",
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: "Invalid user_pass format. Must be 'username:password'"
            });
        }

        // Validate proxy_auth format if provided (should be username:password)
        if (req.query.proxy_auth && req.query.proxy_auth !== 'default' && !req.query.proxy_auth.includes(':')) {
            return res.status(400).json({
                html: "Invalid proxy_auth format. Must be 'username:password'",
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: "Invalid proxy_auth format. Must be 'username:password'"
            });
        }

        // Validate cleanup parameter if provided
        if (req.query.cleanup && req.query.cleanup !== 'true' && req.query.cleanup !== 'false') {
            return res.status(400).json({
                html: "Invalid cleanup value. Must be 'true' or 'false'",
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: "Invalid cleanup value. Must be 'true' or 'false'"
            });
        }

        // Validate upload parameter if provided
        if (req.query.upload && req.query.upload !== 'true' && req.query.upload !== 'false') {
            return res.status(400).json({
                html: "Invalid upload value. Must be 'true' or 'false'",
                apicalls: lib.conf.API_CALLS_LIMIT,
                url: req.originalUrl || req.url,
                error: "Invalid upload value. Must be 'true' or 'false'"
            });
        }

        // Check S3 configuration if upload=true
        if (req.query.upload === 'true' && !s3Storage.isConfigured()) {
            return res.status(400).json({
                html: "S3 storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY environment variables.",
                apicalls: lib.conf.API_CALLS_LIMIT,
                url: req.originalUrl || req.url,
                error: "S3 storage is not configured"
            });
        }

        // Validate delay parameter (must be a number)
        if (req.query.delay && req.query.delay !== 'default') {
            const delay = parseInt(req.query.delay, 10);
            if (isNaN(delay) || delay < 0) {
                return res.status(400).json({
                    html: "Delay must be a non-negative number",
                    apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                    url: req.originalUrl || req.url,
                    error: "Delay must be a non-negative number"
                });
            }
        }

        // Validate basic_auth format if provided (should be username:password)
        if (req.query.basic_auth && req.query.basic_auth !== 'default' && !req.query.basic_auth.includes(':')) {
            return res.status(400).json({
                html: "Invalid basic_auth format. Must be 'username:password'",
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: "Invalid basic_auth format. Must be 'username:password'"
            });
        }

        // Validate eval parameter if provided (must be URL-encoded)
        if (req.query.eval && req.query.eval !== 'default') {
            try {
                decodeURIComponent(req.query.eval);
            } catch (error) {
                return res.status(400).json({
                    html: "Invalid eval parameter. Must be URL-encoded JavaScript",
                    apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                    url: req.originalUrl || req.url,
                    error: "Invalid eval parameter. Must be URL-encoded JavaScript"
                });
            }
        }

        // Get the appropriate engine
        const { engine } = req.params;

        // Only support puppeteer engine now
        if (engine !== 'puppeteer') {
            const errorMsg = `Unsupported engine: ${engine}. Only puppeteer engine is supported`;
            return res.status(400).json({
                html: errorMsg,
                apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
                url: req.originalUrl || req.url,
                error: errorMsg
            });
        }

        const engineModule = lib.ENGINES.puppeteer;
        req.engineModule = engineModule;

        next();
    } catch (error) {
        next(error);
    }
};

// Helper function to format video URLs consistently
const formatVideoUrls = (videoUrls) => {
    return videoUrls
        .filter(video => {
            const url = video.url || '';
            const lowercaseUrl = url.toLowerCase();
            const urlPath = lowercaseUrl.split("?")[0].split("#")[0];

            // Skip URLs with image extensions
            if (lowercaseUrl.match(/\.(jpe?g|png|gif|bmp|webp)(\?.*)?$/i)) {
                return false;
            }

            // Skip stream segments (HLS .ts, DASH .m4s) - not downloadable individually
            if (urlPath.endsWith('.ts') || urlPath.endsWith('.m4s') || urlPath.endsWith('.m4f')) {
                return false;
            }
            // Skip numbered segment patterns
            if (/\/seg[-_]?\d+/i.test(urlPath) || /\/chunk[-_]?\d+/i.test(urlPath)) {
                return false;
            }

            // Skip blob URLs (not downloadable outside browser context)
            if (lowercaseUrl.startsWith('blob:')) {
                return false;
            }

            // Skip data URIs
            if (lowercaseUrl.startsWith('data:')) {
                return false;
            }

            // Skip known ad/tracker video CDNs (uses shared AD_URL_PATTERNS + env extras)
            if (AD_URL_PATTERNS.some(pattern => pattern.test(lowercaseUrl))) {
                return false;
            }

            // Accept only video and streaming URLs
            const hasVideoExtension = lowercaseUrl.match(/\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv|m4v|mpeg|mpg|m3u8|mpd)(\?.*)?$/i);
            const hasVideoMimeType = (video.mimeType || '').startsWith('video/') ||
                (video.mimeType || '').includes('mpegURL') ||
                (video.mimeType || '').includes('dash+xml');

            // Exclude video/MP2T (HLS segment MIME type)
            if ((video.mimeType || '').toLowerCase().includes('mp2t')) {
                return false;
            }

            return hasVideoExtension || hasVideoMimeType;
        })
        .map(video => {
            const videoInfo = {
                url: video.url,
                originalUrl: video.url,
                mimeType: video.mimeType || '',
                isPrimaryPlayer: video.isPrimaryPlayer || false
            };

            // Add isHLS flag for HLS videos
            if (video.url.toLowerCase().includes('.m3u8') ||
                (video.mimeType && (video.mimeType.includes('mpegURL') || video.mimeType.includes('x-mpegURL')))) {
                videoInfo.isHLS = true;
            }

            return videoInfo;
        });
};

// Helper function to check AUTO_SYNC_VIDEOS env var (case-insensitive, trims whitespace)
const isAutoSyncVideosEnabled = () => {
    const value = (process.env.AUTO_SYNC_VIDEOS || '').toString().trim().toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
};

// Helper function to generate video URLs HTML block
// Output: <div id="hbapi-videos"><a href="..."></a></div>
// XPath: //div[@id='hbapi-videos']/a/@href
// CSS: #hbapi-videos a
const generateVideoUrlsHtml = (videoUrls) => {
    if (!videoUrls || videoUrls.length === 0) return '';
    const links = videoUrls.map(v => `<a href="${v.url || v}"></a>`).join('\n');
    return `\n<!-- HBAPI-VIDEO-URLS-START -->\n<div id="hbapi-videos" style="display:none">\n${links}\n</div>\n<!-- HBAPI-VIDEO-URLS-END -->\n`;
};

// Helper function to insert video URLs HTML INSIDE the body tag (before </body>)
// This ensures crawlers like Crawlomatic can properly parse the content
const insertVideoUrlsIntoHtml = (html, videoUrls) => {
    if (!videoUrls || videoUrls.length === 0) return html;

    const videoBlock = generateVideoUrlsHtml(videoUrls);
    if (!videoBlock) return html;

    // Try to insert before </body> (case-insensitive)
    const bodyCloseRegex = /<\/body>/i;
    if (bodyCloseRegex.test(html)) {
        return html.replace(bodyCloseRegex, `${videoBlock}</body>`);
    }

    // Try to insert before </html> if no </body> found
    const htmlCloseRegex = /<\/html>/i;
    if (htmlCloseRegex.test(html)) {
        return html.replace(htmlCloseRegex, `${videoBlock}</html>`);
    }

    // Fallback: append at the end if no closing tags found
    return html + videoBlock;
};

/**
 * Prioritize video sources for the download queue.
 * Sorts by: downloadability (format + URL pattern) × quality (resolution).
 * Returns sorted array with the best downloadable source first,
 * providing a natural fallback chain for the download queue.
 *
 * Scoring criteria:
 * - Downloadability: Direct download URLs > Direct MP4 > WebM > HLS > DASH
 * - Quality: 4K > 1080p > 720p > 480p > 360p > 240p
 * - Penalties: Blob URLs, segments, junk files, theme/asset paths
 *
 * @param {Array} videos - Array of video objects from formatVideoUrls
 * @returns {Array} Sorted array with score metadata
 */
const prioritizeVideoSources = (videos) => {
    if (!videos || videos.length === 0) return [];

    const scored = videos.map(v => {
        const url = (v.originalUrl || v.url || '').toLowerCase();
        const urlPath = url.split("?")[0].split("#")[0];
        // Get actual file extension from the last path segment
        const lastSegment = urlPath.split("/").pop() || "";
        const lastDot = lastSegment.lastIndexOf(".");
        const ext = lastDot !== -1 ? lastSegment.substring(lastDot) : "";

        let downloadScore = 0;
        let qualityScore = 0;

        // ==================== DOWNLOADABILITY SCORING ====================

        // Direct download path indicators (very high confidence of downloadability)
        if (/\/(dload|download|dl|get|fetch)\//i.test(url)) {
            downloadScore += 50;
        }

        // Primary player bonus (moderate, NOT absolute - high-quality dload links should win)
        if (v.isPrimaryPlayer) {
            downloadScore += 20;
        }

        // Format scoring based on ACTUAL file extension (not mid-path matches)
        if (ext === '.mp4') {
            downloadScore += 80;
        } else if (ext === '.webm') {
            downloadScore += 70;
        } else if (ext === '.mov' || ext === '.avi' || ext === '.mkv' || ext === '.m4v') {
            downloadScore += 60;
        } else if (ext === '.m3u8' || v.isHLS) {
            downloadScore += 40; // Needs yt-dlp but reliable
        } else if (ext === '.mpd') {
            downloadScore += 30; // Needs yt-dlp
        }

        // Penalize non-downloadable formats (safety net - should be filtered earlier)
        if (ext === '.ts' || ext === '.m4s' || ext === '.m4f') {
            downloadScore -= 200;
        }
        if (url.startsWith('blob:')) {
            downloadScore -= 200;
        }

        // CDN/content path bonus (URLs in content directories are usually real videos)
        if (/\/(storage|uploads?|videos?|media|content|files?|stream|vod)\//i.test(url)) {
            downloadScore += 10;
        }

        // Known CDN domain bonus
        if (/cloudfront|akamai|cdn\.|gvideo|googlevideo|fbcdn/i.test(url)) {
            downloadScore += 5;
        }

        // Same-site domain bonus - video URL from same domain as the page is more likely to be content
        // (External domains are often ads or shared resources)
        try {
            const videoHost = new URL(v.originalUrl || v.url).hostname;
            // URLs that contain the site's own domain patterns get a bonus
            if (/\/(dload|download)\//i.test(url)) {
                downloadScore += 15; // Download links from the site itself
            }
        } catch { /* ignore parse errors */ }

        // Penalize junk/placeholder files
        if (/blank|placeholder|dummy|empty|loading|pixel|spacer/i.test(url)) {
            downloadScore -= 100;
        }

        // Penalize theme/asset paths (usually player UI assets, not content)
        if (/\/(themes?|player|assets?|plugins?|vendor|lib|js|css|dist)\//i.test(url)) {
            downloadScore -= 50;
        }

        // Penalize known ad/tracker networks and shared video CDNs
        // Uses centralized AD_URL_PATTERNS (built-in + env extras)
        if (AD_URL_PATTERNS.some(pattern => pattern.test(url))) {
            downloadScore -= 150;
        }

        // Penalize suspicious ad/tracking patterns in path
        if (/beacon|track|analytics|impression|advert|pixel|pstool=|psid=|brokercpp/i.test(url)) {
            downloadScore -= 80;
        }

        // Penalize videos from /library/ paths (often ad creative assets)
        if (/\/library\/\d+\//i.test(url)) {
            downloadScore -= 40;
        }

        // ==================== QUALITY SCORING ====================

        // Extract resolution from URL patterns
        // Supports: 1080p, -1080p.mp4, /1080/, _1080_, etc.
        if (/2160p|[-_/]2160[-_/.]|4k|uhd/i.test(url)) qualityScore += 100;
        else if (/1440p|[-_/]1440[-_/.]|2k/i.test(url)) qualityScore += 95;
        else if (/1080p|[-_/]1080[-_/.]|fullhd|fhd/i.test(url)) qualityScore += 90;
        else if (/720p|[-_/]720[-_/.](?!\d)/i.test(url)) qualityScore += 80;
        else if (/480p|[-_/]480[-_/.]|[-/]sd[-/\.]/i.test(url)) qualityScore += 60;
        else if (/360p|[-_/]360[-_/.]/i.test(url)) qualityScore += 40;
        else if (/240p|[-_/]240[-_/.]/i.test(url)) qualityScore += 20;
        else if (/144p|[-_/]144[-_/.]/i.test(url)) qualityScore += 10;

        // Also check for resolution in path segments (e.g., /2160/, /1080/)
        if (!qualityScore) {
            const resMatch = url.match(/\/(\d{3,4})\//);
            if (resMatch) {
                const res = parseInt(resMatch[1]);
                if (res >= 2160) qualityScore += 100;
                else if (res >= 1440) qualityScore += 95;
                else if (res >= 1080) qualityScore += 90;
                else if (res >= 720) qualityScore += 80;
                else if (res >= 480) qualityScore += 60;
                else if (res >= 360) qualityScore += 40;
                else if (res >= 240) qualityScore += 20;
            }
        }

        // Non-blob URL bonus
        if (!url.startsWith('blob:')) {
            downloadScore += 10;
        }

        // Total score: downloadability weighted 2x over quality
        const totalScore = (downloadScore * 2) + qualityScore;

        return {
            url: v.originalUrl || v.url,
            mimeType: v.mimeType || 'video/mp4',
            isHLS: v.isHLS || false,
            isPrimaryPlayer: v.isPrimaryPlayer || false,
            score: totalScore,
            downloadScore,
            qualityScore
        };
    })
    // Remove obviously non-downloadable sources (segments, blobs that slipped through)
    .filter(v => v.downloadScore > -100)
    .sort((a, b) => {
        // Sort by total score descending (isPrimaryPlayer is already factored into score)
        return b.score - a.score;
    });

    // Log the ranking for debugging
    if (scored.length > 0) {
        util.Logging.info(`Video source ranking (${scored.length} sources):`);
        scored.slice(0, 5).forEach((s, i) => {
            const urlPreview = (s.url || '').substring(0, 80);
            util.Logging.info(`  #${i + 1}: [D:${s.downloadScore} Q:${s.qualityScore} T:${s.score}] ${urlPreview}...`);
        });
    }

    return scored;
};

// API endpoint for scraping
app.get("/apis/scrape/v1/:engine", validateScrapeRequest, async (req, res, next) => {
    let urlRecord = null;

    try {
        const { url } = req.query;
        const engineModule = req.engineModule;

        // Track URL processing
        urlRecord = await urlTracker.addUrl(url);
        await urlTracker.updateStatus(urlRecord.id, URL_STATUS.PROCESSING);

        // Create a clean options object from query parameters
        const options = {
            url,
            customUserAgent: req.query.custom_user_agent !== 'default' ? req.query.custom_user_agent : undefined,
            customCookies: req.query.custom_cookies && req.query.custom_cookies !== 'default'
                ? (() => {
                    try {
                        // Try to parse as JSON first
                        return JSON.parse(decodeURIComponent(req.query.custom_cookies));
                    } catch (error) {
                        // If it's not valid JSON, treat it as a cookie string
                        return req.query.custom_cookies;
                    }
                })()
                : undefined,
            userPass: req.query.user_pass !== 'default' ? req.query.user_pass : undefined,
            timeout: req.query.timeout && req.query.timeout !== 'default'
                ? parseInt(req.query.timeout, 10)
                : undefined,
            proxyUrl: req.query.proxy_url !== 'default' ? req.query.proxy_url : undefined,
            proxyAuth: req.query.proxy_auth !== 'default' ? req.query.proxy_auth : undefined,
            cleanup: req.query.cleanup === 'false' ? false : true,
            delayTime: req.query.delay && req.query.delay !== 'default'
                ? parseInt(req.query.delay, 10)
                : undefined,
            localStorage: req.query.localstorage !== 'default' ? req.query.localstorage : undefined,
            customEval: req.query.eval && req.query.eval !== 'default'
                ? decodeURIComponent(req.query.eval)
                : undefined,
            basicAuth: req.query.basic_auth !== 'default' ? req.query.basic_auth : undefined
        };

        // Create a unique cache key based on URL and relevant options
        const cacheKey = `${url}-${JSON.stringify(options)}`;

        // Check cache first
        const cachedResult = await cache.get(cacheKey);
        if (cachedResult) {
            util.Logging.info(`Cache hit for ${url}`);
            logEmitter.broadcast('info', 'Cache hit', { url });
            res.setHeader("X-Cache", "HIT");

            // Format response - always use raw HTML content from cache
            const response = {
                html: cachedResult.html,
                apicalls: lib.conf.API_CALLS_LIMIT,
                url: url,
                cached: true
            };

            // Include video URLs if found in cache
            if (cachedResult.videoUrls && cachedResult.videoUrls.length > 0) {
                // Process the video URLs using the helper function
                const filteredVideoUrls = formatVideoUrls(cachedResult.videoUrls);

                if (filteredVideoUrls.length > 0) {
                    // Check if any videos have been synced to CDN and replace URLs for response
                    // But always keep originalUrl for tracking
                    const allVideos = await videoTracker.getAll();
                    const enhancedVideoUrls = filteredVideoUrls.map(video => {
                        const originalUrl = video.originalUrl || video.url;
                        // Find synced video record matching this URL
                        const syncedRecord = allVideos.find(v =>
                            v.videoUrl === originalUrl && v.status === 'synced' && v.s3Url
                        );
                        if (syncedRecord) {
                            return {
                                ...video,
                                url: syncedRecord.s3Url, // CDN URL for client response
                                originalUrl: originalUrl, // Always keep original URL
                                synced: true
                            };
                        }
                        return {
                            ...video,
                            originalUrl: originalUrl // Ensure originalUrl is always present
                        };
                    });
                    response.videoUrls = enhancedVideoUrls;
                }
            }

            // Update URL status to done with cached result
            // URL Tracker stores ORIGINAL URLs (for Admin UI "Videos Found" display)
            if (urlRecord) {
                // Map to original URLs for tracking - Admin UI should show original URLs, not CDN URLs
                const originalVideoUrls = (response.videoUrls || []).map(video => ({
                    url: video.originalUrl || video.url, // Always use original URL for tracking
                    mimeType: video.mimeType || '',
                    isHLS: video.isHLS || false
                }));

                const cachedResponse = {
                    htmlLength: cachedResult.html?.length || 0,
                    htmlPreview: cachedResult.html?.substring(0, 500) || '',
                    videoUrls: originalVideoUrls, // Store ORIGINAL URLs, not CDN URLs
                    cached: true,
                    title: cachedResult.title || null
                };
                await urlTracker.updateStatus(urlRecord.id, URL_STATUS.DONE, null, cachedResponse, cacheKey);
            }

            // Track ONLY the best video to avoid storage bloat (no need to append - already in cached HTML)
            if (response.videoUrls && response.videoUrls.length > 0) {
                const autoSyncEnabled = isAutoSyncVideosEnabled();
                const autoSync = autoSyncEnabled && s3Storage.isConfigured();

                // NOTE: Video URLs are already appended to cached HTML, no need to append again
                // The cached HTML contains original URLs; response.videoUrls may have CDN URLs if synced

                // Create prioritized list of sources
                const prioritizedSources = prioritizeVideoSources(response.videoUrls);

                if (prioritizedSources.length > 0) {
                    const bestVideo = prioritizedSources[0];

                    // Skip tracking if video is already synced (has CDN URL)
                    if (bestVideo && !bestVideo.synced) {
                        const originalVideoUrl = bestVideo.url; // prioritizeVideoSources normalizes to .url

                        const videoRecord = await videoTracker.addVideo({
                            primaryVideoUrl: originalVideoUrl,
                            videoUrl: originalVideoUrl,
                            videoSources: prioritizedSources,
                            sourceUrl: url,
                            mimeType: bestVideo.mimeType || 'video/mp4',
                            isHLS: bestVideo.isHLS || false
                        });

                        // Auto-sync to S3 (don't block response)
                        if (autoSync) {
                            // Fire-and-forget queue job (don't await)
                            videoDownloadQueue.add({
                                videoId: videoRecord.id,
                                sourceIndex: 0,
                                attempt: 1
                            }).then(() => {
                                util.Logging.info(`Enqueued download from cache for video ${videoRecord.id} with ${prioritizedSources.length} sources`);
                            }).catch(err => {
                                util.Logging.error(`Failed to enqueue download from cache for video ${videoRecord.id}: ${err.message}`);
                            });
                        }
                    }
                }

                return res.json(response);
            }
        }

        // Process the request
        util.Logging.info(`Processing request for ${url} using ${req.params.engine} engine`);
        logEmitter.broadcast('info', 'Scrape started', { url, engine: req.params.engine });
        const engineInstance = engineModule.singleton();

        // Initialize res.locals
        res.locals = {};

        // Set a request timeout based on the provided timeout or a default
        const requestTimeout = options.timeout || lib.conf.BROWSER.timeout || DEFAULT_BROWSER_TIMEOUT;
        const timeoutId = setTimeout(() => {
            const error = new Error(`Request timed out after ${requestTimeout}ms`);
            error.code = 504;
            next(error);
        }, requestTimeout + 5000); // Add 5 seconds buffer

        try {
            await engineInstance.renderWithOptions(req, res, next, options);

            // Clear the timeout
            clearTimeout(timeoutId);

            // Cache the result if not already sent
            if (!res.headersSent && res.locals.content) {
                res.setHeader("X-Cache", "MISS");

                // Start building response
                let finalHtml = res.locals.content;
                let processedVideoUrls = [];

                // Process video URLs if found
                if (res.locals.videoUrls && res.locals.videoUrls.length > 0) {
                    processedVideoUrls = formatVideoUrls(res.locals.videoUrls);
                }

                // Upload video to S3 if requested (before appending to HTML)
                if (req.query.upload === 'true' && processedVideoUrls.length > 0) {
                    const video = processedVideoUrls[0];
                    const tempFiles = [];

                    try {
                        util.Logging.info(`Starting video download: ${video.url}`);

                        // Download video (handles both direct and HLS)
                        const downloadResult = await downloadVideo(video, {
                            maxSizeMB: lib.conf.UPLOAD?.maxSizeMB,
                            timeout: lib.conf.UPLOAD?.timeout
                        });

                        tempFiles.push(...downloadResult.tempFiles);

                        // Generate S3 key and upload
                        const s3Key = s3Storage.generateKey(video.url);
                        util.Logging.info(`Uploading video to S3: ${s3Key}`);

                        const s3Url = await s3Storage.uploadFromFile(
                            downloadResult.filePath,
                            s3Key,
                            downloadResult.contentType
                        );

                        // Replace URL in processedVideoUrls
                        video.url = s3Url;
                        delete video.isHLS; // No longer HLS after conversion

                        util.Logging.info(`Video uploaded to S3: ${s3Url}`);
                    } catch (err) {
                        util.Logging.error(`Video upload failed: ${err.message}`);
                    } finally {
                        // Always cleanup temp files
                        await cleanupTempFiles(tempFiles);
                    }
                }

                // ==================== Pre-generate CDN URL for BEST video only ====================
                // HTML will contain OUR CDN URL (for crawlers)
                // Response.videoUrls will contain ORIGINAL URLs found on page (for display)
                const autoSyncEnabled = isAutoSyncVideosEnabled();
                const autoSync = autoSyncEnabled && s3Storage.isConfigured();
                let bestVideo = null;
                let videoRecord = null;
                let cdnUrl = null;

                // Track and pre-generate CDN URL for best video only
                if (processedVideoUrls.length > 0) {
                    // Prioritize sources
                    const prioritizedSources = prioritizeVideoSources(processedVideoUrls);

                    if (prioritizedSources.length > 0) {
                        bestVideo = prioritizedSources[0];

                        if (bestVideo && !bestVideo.synced) {
                            const originalVideoUrl = bestVideo.url;

                            // Add video to tracker with ALL sources
                            videoRecord = await videoTracker.addVideo({
                                primaryVideoUrl: originalVideoUrl,
                                videoUrl: originalVideoUrl,
                                videoSources: prioritizedSources,
                                sourceUrl: url,
                                mimeType: bestVideo.mimeType,
                                isHLS: bestVideo.isHLS
                            });

                            // Pre-generate CDN URL based on primary URL
                            if (autoSync) {
                                const extension = bestVideo.isHLS ? 'mp4' : 'mp4';
                                const s3Key = s3Storage.generateKey(originalVideoUrl, extension);
                                cdnUrl = s3Storage.getPublicUrl(s3Key);
                                util.Logging.info(`Pre-generated CDN URL for best video: ${cdnUrl}`);
                            }
                        }
                    }
                }

                // Insert ONLY our CDN URL into HTML (for crawlers to consume)
                if (autoSyncEnabled && cdnUrl) {
                    const cdnVideoForHtml = [{ url: cdnUrl }];
                    finalHtml = insertVideoUrlsIntoHtml(finalHtml, cdnVideoForHtml);
                    util.Logging.info(`Inserted OUR CDN URL into HTML: ${cdnUrl}`);
                }

                // Create cache object with FINAL HTML
                const cacheObject = {
                    html: finalHtml
                };

                // Store ORIGINAL video URLs in cache
                if (processedVideoUrls.length > 0) {
                    cacheObject.videoUrls = processedVideoUrls.map(video => ({
                        url: video.originalUrl || video.url,
                        mimeType: video.mimeType || ''
                    }));
                    if (cdnUrl) {
                        cacheObject.cdnUrl = cdnUrl;
                    }
                }

                // Save to cache
                await cache.set(cacheKey, cacheObject);

                // Build response object
                const response = {
                    html: finalHtml,
                    apicalls: lib.conf.API_CALLS_LIMIT,
                    url: url
                };

                // response.videoUrls = ORIGINAL URLs
                if (processedVideoUrls.length > 0) {
                    response.videoUrls = processedVideoUrls.map(video => ({
                        url: video.originalUrl || video.url,
                        mimeType: video.mimeType || '',
                        isHLS: video.isHLS || false
                    }));
                }

                // Trigger async upload AFTER response is built (don't block response)
                if (videoRecord && autoSync) {
                    // Enqueue download job (fire-and-forget - don't await)
                    videoDownloadQueue.add({
                        videoId: videoRecord.id,
                        sourceIndex: 0,
                        attempt: 1
                    }).then(() => {
                        util.Logging.info(`Enqueued download job for video ${videoRecord.id} with ${videoRecord.videoSources?.length || 1} sources`);
                    }).catch(err => {
                        util.Logging.error(`Failed to enqueue download job for video ${videoRecord.id}: ${err.message}`);
                    });
                }

                // Update URL status to done with scrape result
                if (urlRecord) {
                    await urlTracker.updateStatus(urlRecord.id, URL_STATUS.DONE, null, response, cacheKey);
                }

                res.json(response);
                // Done Process the request
                util.Logging.info(`Response sent for ${url} using ${req.params.engine} engine`);
                logEmitter.broadcast('info', 'Scrape completed', {
                    url,
                    htmlLength: response.html?.length || 0,
                    videoCount: response.videoUrls?.length || 0,
                    cached: false
                });
            }
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    } catch (error) {
        // Update URL status to error with snapshot URL if available
        if (urlRecord) {
            await urlTracker.updateStatus(urlRecord.id, URL_STATUS.ERROR, error.message, null, null, error.snapshotUrl);
        }
        logEmitter.broadcast('error', 'Scrape failed', {
            url: req.query.url,
            error: error.message,
            snapshotUrl: error.snapshotUrl
        });
        next(error);
    }
});

// Info endpoint
app.get("/info", async (req, res, next) => {
    try {
        const version = await lib.ENGINES.puppeteer.singleton().version();

        res.json({
            name: info.name,
            version: info.version,
            node: process.version,
            engines: {
                puppeteer: {
                    version: version,
                    status: "available"
                }
            }
        });
    } catch (error) {
        res.json({
            name: info.name,
            version: info.version,
            node: process.version,
            engines: {
                puppeteer: {
                    version: "unknown",
                    status: "error",
                    error: error.message
                }
            }
        });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// API endpoint for clearing cache - simplified without key verification
app.get("/apis/cache/clear", async (req, res, next) => {
    try {
        const { pattern } = req.query;

        // Log the cache clear request
        util.Logging.info(`Cache clear request received ${pattern ? `with pattern: ${pattern}` : '(all cache)'}`);

        // Clear cache with optional pattern
        await cache.clear(pattern || '*');

        // Get cache statistics after clearing
        const stats = await cache.getStats();

        res.json({
            success: true,
            message: `Cache ${pattern ? `matching pattern '${pattern}'` : 'completely'} cleared`,
            stats
        });
    } catch (error) {
        next(error);
    }
});

// API endpoint for getting cache stats - simplified without key verification
app.get("/apis/cache/stats", async (req, res, next) => {
    try {
        // Get cache statistics
        const stats = await cache.getStats();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        next(error);
    }
});

// ==================== Admin Portal ====================

// Serve admin static files
app.use('/admin', express.static(path.join(__dirname, 'admin/dist')));

// Mount admin API routes
const adminRouter = createAdminRouter({
    cache,
    getBrowserPool
});
app.use('/admin', adminRouter);

// 404 handler
app.all("*", (req, res) => {
    res.status(404);
    res.json({
        html: "Not found",
        apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
        url: req.originalUrl,
        error: "Route not found"
    });
});

// Error handler
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    // Use default error code of 500 if not specified
    const code = err.code || 500;

    // Get the target URL from query parameters if available
    const targetUrl = req.query && req.query.url ? req.query.url : req.originalUrl || req.url;

    // Format response according to the example
    const result = {
        html: err.message,
        apicalls: lib.conf.API_CALLS_LIMIT, // Use configured limit
        url: targetUrl,
        error: err.message
    };

    // Log error details
    util.Logging.error(`Error processing request: ${err.message}`);

    // Include stack trace in non-production environments
    if (process.env.NODE_ENV !== "production") {
        result.stack = err.stack ? err.stack.split("\n") : [];
    }

    res.status(code);
    res.json(result);
});

// Only start the server if we're not in test mode
if (process.env.NODE_ENV !== "test") {
    (async () => {
        try {
            // Load configurations and initialize
            await lib.start();

            // Start listening
            app.listen(lib.conf.PORT, lib.conf.HOST, () => {
                util.Logging.info(`Listening on ${lib.conf.HOST}:${lib.conf.PORT}`);
                util.Logging.info(`AUTO_SYNC_VIDEOS=${process.env.AUTO_SYNC_VIDEOS} (enabled=${isAutoSyncVideosEnabled()})`);
                lib.init();
            });
        } catch (err) {
            util.Logging.error(`Failed to start server: ${err.message}`);
            await lib.stop();
            process.exit(1);
        }
    })();
}

module.exports = app;

// Export utility functions for testing
const { isImageUrl, isVideoUrl } = require('./lib/engines/puppeteer');
module.exports.isImageUrl = isImageUrl;
module.exports.isVideoUrl = isVideoUrl;
