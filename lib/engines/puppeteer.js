const puppeteer = require("puppeteer");
const util = require("hive-js-util");
const conf = require("../util/config").conf;
const BrowserPool = require("../util/browser-pool");

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
            const browser = await puppeteer.launch({
                headless: conf.BROWSER.headless === false ? false : "new",
                args: conf.BROWSER.args || [
                    "--no-sandbox", 
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage", // Improve stability in containerized environments
                    "--disable-gpu", // Reduce resource usage
                    "--disable-features=site-per-process" // Disable site isolation for memory savings
                ],
                executablePath: conf.BROWSER.executablePath,
                ignoreHTTPSErrors: true,
                dumpio: conf.BROWSER.dumpio || false
            });
            
            // Listen for browser disconnection
            browser.on('disconnected', () => {
                util.Logging.warn("Puppeteer browser disconnected");
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
        
        // Set request interception to block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            // Block unnecessary resources to improve performance
            if (['image', 'font', 'media'].includes(resourceType)) {
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
        const { url, customUserAgent, customCookies, userPass, timeout, proxyUrl, proxyAuth } = options;
        let page = null;

        try {
            // Initialize response locals if needed
            if (!res.locals) {
                res.locals = {};
            }

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

            // Set cookies if provided
            if (customCookies) {
                const cookies = Object.entries(customCookies).map(([name, value]) => ({
                    name,
                    value: String(value),
                    domain: new URL(url).hostname
                }));
                await page.setCookie(...cookies);
            }

            // Handle basic authentication
            if (userPass) {
                const [username, password] = userPass.split(':');
                await page.authenticate({ username, password });
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

            // Get the content from the page
            const content = await page.content();

            // Set response content and status
            res.locals.content = content;
            res.status(response.status());

            // Release the page back to the pool
            await this.browserPool.releasePage(page);
            page = null;

        } catch (error) {
            // Handle any errors
            if (page) {
                await this.browserPool.destroyPage(page);
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
            timeout: req.query.timeout ? parseInt(req.query.timeout) : undefined,
            proxyUrl: req.query.proxy_url,
            proxyAuth: req.query.proxy_auth
        };
        
        await this.renderWithOptions(req, res, next, options);
    }

    /**
     * Close all browser instances
     * @returns {Promise<void>}
     */
    async close() {
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
    version: async () => {
        return puppeteer.version();
    }
};
