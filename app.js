// Set up chrome-headless-shell executable path if not already set
try {
    if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
        // Try to find the chrome-headless-shell path using @puppeteer/browsers
        const browsers = require('@puppeteer/browsers');
        const executablePath = browsers.computeExecutablePath({
            browser: 'chrome-headless-shell',
            buildId: 'stable'
        });
        process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
        console.log(`Using chrome-headless-shell at: ${executablePath}`);
    }
} catch (err) {
    console.log('Could not determine chrome-headless-shell path automatically:', err.message);
}

// requires the multiple libraries
const express = require("express");
const process = require("process");
const util = require("hive-js-util");
const info = require("./package");
const lib = require("./lib");
const CacheManager = require("./lib/util/cache");
const { verifyKey } = require("./lib");

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
        
        if (!apikey) {
            return res.status(400).json({ error: "API key is required", code: 400 });
        }
        if (!url) {
            return res.status(400).json({ error: "URL is required", code: 400 });
        }
        
        // Set the API key in the request for verification
        req.query.key = apikey;
        
        try {
            verifyKey(req);
        } catch (error) {
            return res.status(400).json({ error: error.message, code: 400 });
        }
        
        // Get the appropriate engine
        const { engine } = req.params;
        const engineModule = lib.ENGINES[engine];
        if (!engineModule) {
            return res.status(400).json({ error: `Unsupported engine: ${engine}`, code: 400 });
        }
        
        // Store engine in request for later use
        req.engineModule = engineModule;
        
        next();
    } catch (error) {
        next(error);
    }
};

// API endpoint for scraping
app.get("/apis/scrape/v1/:engine", validateScrapeRequest, async (req, res, next) => {
    try {
        const { url } = req.query;
        const engineModule = req.engineModule;
        
        // Create a clean options object from query parameters
        const options = {
            url,
            customUserAgent: req.query.custom_user_agent,
            customCookies: req.query.custom_cookies ? JSON.parse(decodeURIComponent(req.query.custom_cookies)) : undefined,
            userPass: req.query.user_pass,
            timeout: req.query.timeout ? parseInt(req.query.timeout) : undefined,
            proxyUrl: req.query.proxy_url,
            proxyAuth: req.query.proxy_auth
        };

        // Create a unique cache key based on URL and relevant options
        const cacheKey = `${url}-${JSON.stringify(options)}`;

        // Check cache first
        const cachedResult = await cache.get(cacheKey);
        if (cachedResult) {
            util.Logging.info(`Cache hit for ${url}`);
            res.setHeader('X-Cache', 'HIT');
            return res.send(cachedResult);
        }

        // Process the request
        util.Logging.info(`Processing request for ${url} using ${req.params.engine} engine`);
        const engineInstance = engineModule.singleton();
        
        // Initialize res.locals
        res.locals = {};
        
        // Set a request timeout based on the provided timeout or a default
        const requestTimeout = options.timeout || lib.conf.BROWSER.timeout || 30000;
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
                await cache.set(cacheKey, res.locals.content);
                res.setHeader('X-Cache', 'MISS');
                res.send(res.locals.content);
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
        const engineVersionPromises = Object.entries(lib.ENGINES).map(async ([name, module]) => {
            try {
                const version = await module.singleton().version();
                return { name, version };
            } catch (err) {
                return { name, version: "unknown" };
            }
        });
        
        const engineVersions = await Promise.all(engineVersionPromises);
        
        res.json({
            name: info.name,
            version: info.version,
            node: process.version,
            engines: engineVersions.reduce((acc, { name, version }) => {
                acc[name] = version;
                return acc;
            }, {})
        });
    } catch (error) {
        next(error);
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// 404 handler
app.all("*", (req, res) => {
    res.status(404);
    res.json({ error: "Route not found", code: 404 });
});

// Error handler
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    
    // Use default error code of 500 if not specified
    const code = err.code || 500;
    const result = { error: err.message, code: code };
    
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
if (process.env.NODE_ENV !== 'test') {
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
