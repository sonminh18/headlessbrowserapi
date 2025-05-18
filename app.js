// requires the multiple libraries
const express = require("express");
const process = require("process");
const util = require("hive-js-util");
const info = require("./package");
const lib = require("./lib");
const CacheManager = require("./lib/util/cache");
const { verifyKey } = require("./lib");
const { DEFAULT_BROWSER_TIMEOUT } = require("./lib/util/config");

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
app.use(express.raw({ limit: "1GB", type: "*/*" }));

// Initialize cache with TTL of 1 hour (3600 seconds)
const cache = new CacheManager(3600);

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
            // Validate URL is a video by extension and not an image
            const url = video.url || '';
            const lowercaseUrl = url.toLowerCase();
            
            // Skip URLs with image extensions
            if (lowercaseUrl.match(/\.(jpe?g|png|gif|bmp|webp)(\?.*)?$/i)) {
                return false;
            }
            
            // Accept only video and streaming URLs
            const hasVideoExtension = lowercaseUrl.match(/\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv|m4v|mpeg|mpg|m3u8|mpd)(\?.*)?$/i);
            const hasVideoMimeType = (video.mimeType || '').startsWith('video/') || 
                                   (video.mimeType || '').includes('mpegURL') ||
                                   (video.mimeType || '').includes('dash+xml');
                                     
            return hasVideoExtension || hasVideoMimeType;
        })
        .map(video => {
            // Only return url and isHLS properties
            const videoInfo = {
                url: video.url
            };
            
            // Add isHLS flag for HLS videos
            if (video.url.toLowerCase().includes('.m3u8') || 
                (video.mimeType && (video.mimeType.includes('mpegURL') || video.mimeType.includes('x-mpegURL')))) {
                videoInfo.isHLS = true;
            }
            
            return videoInfo;
        });
};

// API endpoint for scraping
app.get("/apis/scrape/v1/:engine", validateScrapeRequest, async (req, res, next) => {
    try {
        const { url } = req.query;
        const engineModule = req.engineModule;
        
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
            res.setHeader("X-Cache", "HIT");
            
            // Format response - always use raw HTML content from cache
            const response = {
                html: cachedResult.html,
                apicalls: lib.conf.API_CALLS_LIMIT,
                url: url
            };
            
            // Include video URLs if found in cache
            if (cachedResult.videoUrls && cachedResult.videoUrls.length > 0) {
                // Process the video URLs using the helper function
                const filteredVideoUrls = formatVideoUrls(cachedResult.videoUrls);
                
                if (filteredVideoUrls.length > 0) {
                    response.videoUrls = filteredVideoUrls;
                }
            }
            
            return res.json(response);
        }

        // Process the request
        util.Logging.info(`Processing request for ${url} using ${req.params.engine} engine`);
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
                // Create cache object including videos if present
                const cacheObject = {
                    html: res.locals.content
                };
                
                if (res.locals.videoUrls && res.locals.videoUrls.length > 0) {
                    // Clean and optimize video URLs before storing
                    const cleanedVideoUrls = res.locals.videoUrls
                        .filter(video => {
                            // Validate URL is a video by extension and not an image
                            const url = video.url || '';
                            const lowercaseUrl = url.toLowerCase();
                            
                            // Skip URLs with image extensions
                            if (lowercaseUrl.match(/\.(jpe?g|png|gif|bmp|webp)(\?.*)?$/i)) {
                                return false;
                            }
                            
                            // Accept only video and streaming URLs
                            const hasVideoExtension = lowercaseUrl.match(/\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv|m4v|mpeg|mpg|m3u8|mpd)(\?.*)?$/i);
                            const hasVideoMimeType = (video.mimeType || '').startsWith('video/') || 
                                                     (video.mimeType || '').includes('mpegURL') ||
                                                     (video.mimeType || '').includes('dash+xml');
                                             
                            return hasVideoExtension || hasVideoMimeType;
                        })
                        .map(video => {
                            // Only store url and mimeType for detection in cache
                            const videoInfo = {
                                url: video.url,
                                mimeType: video.mimeType || '' // Keep mimeType for isHLS detection
                            };
                            return videoInfo;
                        });
                    
                    if (cleanedVideoUrls.length > 0) {
                        cacheObject.videoUrls = cleanedVideoUrls;
                    }
                }
                
                await cache.set(cacheKey, cacheObject);
                res.setHeader("X-Cache", "MISS");
                
                // Format response - always return raw HTML content
                const response = {
                    html: res.locals.content,
                    apicalls: lib.conf.API_CALLS_LIMIT,
                    url: url
                };
                
                // Include video URLs if found
                if (res.locals.videoUrls && res.locals.videoUrls.length > 0) {
                    // Process the video URLs using the helper function
                    const filteredVideoUrls = formatVideoUrls(res.locals.videoUrls);
                    
                    if (filteredVideoUrls.length > 0) {
                        response.videoUrls = filteredVideoUrls;
                    }
                }
                
                res.json(response);
                // Done Process the request
                util.Logging.info(`Response sent for ${url} using ${req.params.engine} engine`);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    } catch (error) {
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
