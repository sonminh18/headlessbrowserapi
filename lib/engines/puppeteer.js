const puppeteer = require("puppeteer");
const util = require("hive-js-util");
const conf = require("../util/config").conf;
const BrowserPool = require("../util/browser-pool");

/**
 * Helper function to cause a delay
 * @param {number} time - Time to delay in milliseconds
 * @returns {Promise<void>}
 */
const puppeteerDelay = (time) => {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time);
    });
};

/**
 * Helper function to detect chrome-headless-shell path if not provided
 * @returns {string|undefined} Path to chrome-headless-shell or undefined
 */
const detectChromeHeadlessShellPath = () => {
    try {
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            return process.env.PUPPETEER_EXECUTABLE_PATH;
        }

        const browsers = require("@puppeteer/browsers");
        return browsers.computeExecutablePath({
            browser: "chrome-headless-shell",
            buildId: "stable"
        });
    } catch (err) {
        util.Logging.warn(`Could not auto-detect chrome-headless-shell path: ${err.message}`);
        return undefined;
    }
};

/**
 * Helper function to clean HTML content by removing JavaScript and CSS
 * @param {string} html - Original HTML content
 * @returns {string} Cleaned HTML content
 */
const cleanHtmlContent = (html) => {
    try {
        // Use regex to remove inline scripts, style tags, and style attributes
        // Remove script tags
        let cleanedHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        
        // Remove style tags
        cleanedHtml = cleanedHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        
        // Remove link tags with rel="stylesheet"
        cleanedHtml = cleanedHtml.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
        
        // Remove inline style attributes
        cleanedHtml = cleanedHtml.replace(/\s+style\s*=\s*["'][^"']*["']/gi, '');
        
        return cleanedHtml;
    } catch (error) {
        util.Logging.warn(`Error cleaning HTML content: ${error.message}`);
        return html; // Return original if cleaning fails
    }
};

/**
 * Helper function to check if a URL is an image
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL points to an image
 */
const isImageUrl = (url) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.jpe', '.webp'];
    const lowercasedUrl = url.toLowerCase().split('?')[0].split('#')[0];
    return imageExtensions.some((extension) => lowercasedUrl.endsWith(extension));
};

/**
 * @class PuppeteerSingleton
 * @classdesc Manages Puppeteer browser instances using a browser pool
 */
class PuppeteerSingleton {
    constructor() {
        this.browserPool = new BrowserPool({
            maxConcurrency: conf.BROWSER.maxConcurrency || 5,
            launchBrowser: this._launchBrowser.bind(this),
            getPage: this._getPageFromBrowser,
            closePage: this._closePage
        });
    }

    /**
     * Launch a new browser instance
     * @returns {Promise<Browser>} Puppeteer browser instance
     * @private
     */
    async _launchBrowser() {
        util.Logging.info("Launching Puppeteer browser");

        try {
            // Determine executable path with priority:
            // 1. Config setting
            // 2. Auto-detected chrome-headless-shell
            // 3. Puppeteer's bundled browser
            const executablePath = conf.BROWSER.executablePath || detectChromeHeadlessShellPath();

            if (executablePath) {
                util.Logging.info(`Using browser executable: ${executablePath}`);
            }

            // Enhanced browser args based on the example script
            const defaultArgs = [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-breakpad",
                "--disable-sync",
                "--disable-translate",
                "--disable-extensions",
                "--disable-software-rasterizer",
                "--disable-infobars",
                "--disable-plugins",
                "--disable-features=site-per-process"
            ];

            const browser = await puppeteer.launch({
                headless: conf.BROWSER.headless === false ? false : "new",
                args: conf.BROWSER.args || defaultArgs,
                executablePath: executablePath,
                ignoreHTTPSErrors: true,
                dumpio: conf.BROWSER.dumpio || false
            });

            // Listen for browser disconnection
            browser.on("disconnected", () => {
                util.Logging.info("Puppeteer browser disconnected");
                this.browserPool.removeBrowser(browser);
            });

            return browser;
        } catch (error) {
            util.Logging.error(`Error launching browser: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get a page from the browser
     * @param {Browser} browser - Puppeteer browser instance
     * @returns {Promise<Page>} Puppeteer page
     * @private
     */
    async _getPageFromBrowser(browser) {
        const page = await browser.newPage();

        // Set default viewport
        await page.setViewport({
            width: conf.BROWSER.viewportWidth || 1920,
            height: conf.BROWSER.viewportHeight || 1080
        });

        // Set request interception to selectively block resources
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            const resourceType = request.resourceType();
            // Block scripts, stylesheets, and fonts for better performance
            if (resourceType === "font" || resourceType === "script" || resourceType === "stylesheet") {
                request.abort();
            } else {
                request.continue();
            }
        });

        return page;
    }

    /**
     * Close a page
     * @param {Page} page - Puppeteer page
     * @private
     */
    async _closePage(page) {
        if (!page) return;

        try {
            // Remove all listeners before closing
            page.removeAllListeners();
            
            // Force clear JS heap
            try {
                const client = await page.target().createCDPSession();
                await client.send('Runtime.enable');
                await client.send('Runtime.collectGarbage');
                await client.send('HeapProfiler.enable');
                await client.send('HeapProfiler.collectGarbage');
                await client.detach();
            } catch (err) {
                util.Logging.debug(`Error running garbage collection: ${err.message}`);
            }
            
            await page.close();
        } catch (error) {
            util.Logging.debug(`Error closing page: ${error.message}`);
            // Ignore errors during close
        }
    }

    /**
     * Get the Puppeteer version
     * @returns {Promise<string>} Version information
     */
    async version() {
        return puppeteer.version();
    }

    /**
     * Render a page with options
     * @param {Request} req - Express request
     * @param {Response} res - Express response
     * @param {Function} next - Express next function
     * @param {Object} options - Custom options
     */
    async renderWithOptions(req, res, next, options) {
        const { 
            url, 
            customUserAgent, 
            customCookies, 
            userPass, 
            timeout, 
            proxyUrl, 
            proxyAuth, 
            cleanup = true,
            delayTime,
            localStorage,
            customEval,
            basicAuth
        } = options;
        
        let page = null;

        try {
            // Initialize response locals if needed
            if (!res.locals) {
                res.locals = {};
            }

            // Check if URL is an image
            const isImage = isImageUrl(url);

            // Get page from pool
            page = await this.browserPool.acquirePage();

            // Set timeout
            const pageTimeout = timeout || conf.BROWSER.timeout || 30000;
            page.setDefaultNavigationTimeout(pageTimeout);
            page.setDefaultTimeout(pageTimeout);

            // Set custom user agent if provided
            if (customUserAgent) {
                await page.setUserAgent(customUserAgent);
            }

            // Set cookies if provided (improved cookie handling from example)
            if (customCookies) {
                if (typeof customCookies === 'string') {
                    // Handle cookie string format: name=value;name2=value2
                    const cookiePairs = customCookies.split(';');
                    for (const pair of cookiePairs) {
                        const [name, value] = pair.split('=');
                        if (name && value) {
                            try {
                                const decodedValue = decodeURIComponent(value.trim());
                                await page.setCookie({
                                    name: name.trim(),
                                    value: decodedValue,
                                    url: url
                                });
                            } catch (error) {
                                // If decoding fails, use the raw value
                                await page.setCookie({
                                    name: name.trim(),
                                    value: value.trim(),
                                    url: url
                                });
                            }
                        }
                    }
                } else {
                    // Handle object format from JSON
                    const cookies = Object.entries(customCookies).map(([name, value]) => ({
                        name: name,
                        value: String(value),
                        domain: new URL(url).hostname
                    }));
                    await page.setCookie(...cookies);
                }
            }

            // Handle basic authentication via username:password
            if (userPass) {
                const [username, password] = userPass.split(":");
                await page.authenticate({ username, password });
            }
            
            // Handle basic authentication via Authorization header
            if (basicAuth) {
                const [username, password] = basicAuth.split(":");
                if (username && password) {
                    const auth = Buffer.from(`${username}:${password}`).toString('base64');
                    await page.setExtraHTTPHeaders({
                        'Authorization': `Basic ${auth}`                    
                    });
                }
            }
            
            // Set up localStorage if provided
            if (localStorage) {
                await page.evaluateOnNewDocument((localStorage) => {
                    localStorage = localStorage.split(";");
                    for (let i = 0; i < localStorage.length; i++) {
                        const item = localStorage[i].split("=");
                        const key = item[0];
                        const value = item[1] || '';
                        
                        if (key) {
                            window.localStorage.setItem(key, value);
                        }
                    }
                }, localStorage);
            }

            // Configure proxy if provided
            if (proxyUrl) {
                // Proxy must be set up before the browser launches, so we need to 
                // destroy this page and create a new one with proxy settings
                await this.browserPool.destroyPage(page);
                
                const args = [...(conf.BROWSER.args || [])];
                args.push(`--proxy-server=${proxyUrl}`);
                
                const browser = await puppeteer.launch({
                    headless: conf.BROWSER.headless === false ? false : "new",
                    args: args,
                    executablePath: conf.BROWSER.executablePath || detectChromeHeadlessShellPath(),
                    ignoreHTTPSErrors: true
                });
                
                page = await browser.newPage();
                
                // Set proxy authentication if provided
                if (proxyAuth) {
                    const [proxyUsername, proxyPassword] = proxyAuth.split(":");
                    await page.authenticate({ username: proxyUsername, password: proxyPassword });
                }
            }

            // Navigate to URL with appropriate waitUntil strategy
            const waitUntilStrategy = conf.BROWSER.waitUntil || "networkidle2";
            const response = await page.goto(url, {
                waitUntil: waitUntilStrategy,
                timeout: pageTimeout
            });

            if (!response) {
                throw new Error(`Failed to load URL: ${url}`);
            }

            if (!isImage) {
                // For regular web pages
                
                // Set viewport to match body size for better rendering
                const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
                const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
                await page.setViewport({ width: bodyWidth, height: bodyHeight });
                
                // Scroll to bottom to trigger lazy loading
                await page.evaluate(() => window.scrollTo(0, Number.MAX_SAFE_INTEGER));
                
                // Add delay if specified
                if (delayTime && delayTime > 0) {
                    await puppeteerDelay(delayTime);
                }
                
                // Run custom JavaScript evaluation if provided
                if (customEval) {
                    await page.evaluate((evalCode) => {
                        // eslint-disable-next-line no-eval
                        eval(evalCode);
                    }, customEval);
                }
                
                // Get the content from the page
                const content = await page.content();
                
                // Clean the HTML content if cleanup is enabled
                const finalContent = cleanup ? cleanHtmlContent(content) : content;
                
                // Set response content and status
                res.locals.content = finalContent;
            } else {
                // For image URLs, return base64 data
                // Add delay if specified
                if (delayTime && delayTime > 0) {
                    await puppeteerDelay(delayTime);
                }
                
                const imageData = await page.evaluate(async () => {
                    const response = await fetch(window.location.href);
                    const blob = await response.blob();
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                });
                
                // Extract just the base64 data without the data URI prefix
                const base64Data = imageData.split(',')[1];
                res.locals.content = base64Data;
            }
            
            res.status(response.status());

            // Release the page back to the pool
            if (!proxyUrl) {
                await this.browserPool.releasePage(page);
            } else {
                // If we created a special browser for proxy, close it completely
                const browser = page.browser();
                await page.close();
                await browser.close();
            }
            page = null;
        } catch (error) {
            // Handle any errors
            if (page) {
                if (!proxyUrl) {
                    await this.browserPool.destroyPage(page);
                } else {
                    // If we created a special browser for proxy, close it completely
                    const browser = page.browser();
                    await page.close();
                    await browser.close();
                }
            }
            throw error;
        }
    }

    /**
     * Legacy render method
     * @param {Request} req - Express request
     * @param {Response} res - Express response
     * @param {Function} next - Express next function
     */
    async render(req, res, next) {
        const options = {
            url: req.query.url,
            customUserAgent: req.query.custom_user_agent,
            customCookies: req.query.custom_cookies ? JSON.parse(decodeURIComponent(req.query.custom_cookies)) : undefined,
            userPass: req.query.user_pass,
            timeout: req.query.timeout ? parseInt(req.query.timeout, 10) : undefined,
            proxyUrl: req.query.proxy_url,
            proxyAuth: req.query.proxy_auth,
            cleanup: req.query.cleanup === 'false' ? false : true,
            delayTime: req.query.delay ? parseInt(req.query.delay, 10) : undefined,
            localStorage: req.query.localstorage,
            customEval: req.query.custom_eval,
            basicAuth: req.query.basic_auth
        };

        await this.renderWithOptions(req, res, next, options);
    }

    /**
     * Close all browser instances
     * @returns {Promise<void>}
     */
    async close() {
        util.Logging.info("Closing Puppeteer browser");
        await this.browserPool.closeAll();
    }
}

// Create and export a singleton instance
let instance = null;
module.exports = {
    singleton: () => {
        if (!instance) {
            instance = new PuppeteerSingleton();
        }
        return instance;
    },
    version: async () => puppeteer.version()
};
