const util = require("hive-js-util");
const { v4: uuidv4 } = require("uuid");

/**
 * @class BrowserPool
 * @classdesc Manages a pool of browser instances for better resource utilization
 */
class BrowserPool {
    /**
     * Creates a new browser pool
     * @param {Object} options - Pool configuration options
     * @param {number} options.maxConcurrency - Maximum number of concurrent browsers
     * @param {Function} options.launchBrowser - Function to launch a new browser instance
     * @param {Function} options.getPage - Function to get a page from a browser
     * @param {Function} options.closePage - Function to close a page
     */
    constructor(options = {}) {
        this.maxConcurrency = options.maxConcurrency || 5;
        this.launchBrowser = options.launchBrowser;
        this.getPage = options.getPage;
        this.closePage = options.closePage;
        
        this.browsers = new Map(); // browser id -> {browser, createdAt, pageCount}
        this.pagesBrowser = new Map(); // page -> browser id
        this.activePages = 0;
        this.isClosing = false;
        
        // Browser rotation settings
        this.browserMaxPages = process.env.BROWSER_MAX_PAGES_PER_BROWSER ? 
            parseInt(process.env.BROWSER_MAX_PAGES_PER_BROWSER) : 30;
        this.browserTTL = process.env.BROWSER_TTL ? 
            parseInt(process.env.BROWSER_TTL) : 1800000; // 30 minutes default
        
        // Statistics
        this.stats = {
            pagesCreated: 0,
            pagesDestroyed: 0,
            browsersLaunched: 0,
            browsersClosed: 0,
            browserRotations: 0
        };
        
        // Log stats every 5 minutes
        this.statsInterval = setInterval(() => {
            util.Logging.debug(`Browser pool stats: ${JSON.stringify(this.stats)}`);
            this._rotateBrowsers();
        }, 300000);
    }
    
    /**
     * Rotates browsers based on age and total pages served
     * @private
     */
    async _rotateBrowsers() {
        const now = Date.now();
        const toClose = [];
        
        for (const [id, data] of this.browsers.entries()) {
            const age = now - data.createdAt;
            
            // Check if browser is too old or has served too many pages
            if (age > this.browserTTL || data.pageCount > this.browserMaxPages) {
                util.Logging.info(`Rotating browser due to ${age > this.browserTTL ? 'age' : 'page count'}`);
                toClose.push(id);
            }
        }
        
        // Close browser instances that need rotation
        for (const id of toClose) {
            try {
                const browserData = this.browsers.get(id);
                if (browserData) {
                    await browserData.browser.close();
                    this.browsers.delete(id);
                    this.stats.browsersClosed++;
                    this.stats.browserRotations++;
                }
            } catch (error) {
                util.Logging.warn(`Error closing browser during rotation: ${error.message}`);
            }
        }
    }
    
    /**
     * Acquires a page from the pool
     * @returns {Promise<Page>} A Puppeteer page
     */
    async acquirePage() {
        if (this.isClosing) {
            throw new Error("Browser pool is closing");
        }
        
        // Find a browser with available capacity or launch a new one
        let browser;
        let browserId;
        
        // If we have capacity for a new browser
        if (this.browsers.size < this.maxConcurrency) {
            browser = await this.launchBrowser();
            browserId = uuidv4();
            this.browsers.set(browserId, {
                browser,
                createdAt: Date.now(),
                pageCount: 0
            });
            this.stats.browsersLaunched++;
        } else {
            // Otherwise, find the browser with the fewest active pages
            let minPages = Infinity;
            
            for (const [id, data] of this.browsers.entries()) {
                const pages = Array.from(this.pagesBrowser.entries())
                    .filter(([_, bId]) => bId === id)
                    .length;
                
                if (pages < minPages) {
                    minPages = pages;
                    browserId = id;
                }
            }
            
            const browserData = this.browsers.get(browserId);
            browser = browserData.browser;
            
            // Check if browser needs rotation
            const now = Date.now();
            const age = now - browserData.createdAt;
            
            if (age > this.browserTTL || browserData.pageCount > this.browserMaxPages) {
                util.Logging.info(`Rotating browser on page request due to ${age > this.browserTTL ? 'age' : 'page count'}`);
                
                try {
                    // Close the old browser
                    await browser.close();
                    this.stats.browsersClosed++;
                    this.stats.browserRotations++;
                    
                    // Launch a new browser
                    browser = await this.launchBrowser();
                    this.stats.browsersLaunched++;
                    
                    // Update browser data
                    this.browsers.set(browserId, {
                        browser,
                        createdAt: now,
                        pageCount: 0
                    });
                } catch (error) {
                    util.Logging.error(`Error rotating browser: ${error.message}`);
                    // If we can't rotate, use the existing browser
                }
            }
        }
        
        // Get a page from the browser
        const page = await this.getPage(browser);
        this.pagesBrowser.set(page, browserId);
        this.activePages++;
        this.stats.pagesCreated++;
        
        // Update page count for this browser
        const browserData = this.browsers.get(browserId);
        browserData.pageCount++;
        
        return page;
    }
    
    /**
     * Releases a page back to the pool
     * @param {Page} page - The page to release
     */
    async releasePage(page) {
        if (!page || !this.pagesBrowser.has(page)) {
            return;
        }
        
        try {
            // Reset page state and clear memory
            await page.goto("about:blank");
            
            // Additional cleanup to help with memory
            const client = await page.target().createCDPSession();
            await client.send('Runtime.enable');
            await client.send('Runtime.collectGarbage');
            await client.detach();
            
            this.activePages--;
        } catch (error) {
            // If resetting fails, destroy the page
            await this.destroyPage(page);
        }
    }
    
    /**
     * Destroys a page
     * @param {Page} page - The page to destroy
     */
    async destroyPage(page) {
        if (!page || !this.pagesBrowser.has(page)) {
            return;
        }
        
        this.pagesBrowser.delete(page);
        this.activePages--;
        this.stats.pagesDestroyed++;
        
        try {
            await this.closePage(page);
        } catch (error) {
            util.Logging.warn(`Error closing page: ${error.message}`);
        }
    }
    
    /**
     * Removes a browser from the pool
     * @param {Browser} browser - The browser to remove
     */
    async removeBrowser(browser) {
        for (const [id, data] of this.browsers.entries()) {
            if (data.browser === browser) {
                this.browsers.delete(id);
                this.stats.browsersClosed++;
                
                // Close all associated pages
                for (const [page, browserId] of this.pagesBrowser.entries()) {
                    if (browserId === id) {
                        this.pagesBrowser.delete(page);
                        this.activePages--;
                    }
                }
                
                break;
            }
        }
    }
    
    /**
     * Get process information for all browsers
     * @returns {Promise<object[]>} Array of browser process info
     */
    async getProcessInfo() {
        const info = [];
        const now = Date.now();
        
        for (const [id, data] of this.browsers.entries()) {
            const browserProcess = data.browser.process();
            const pid = browserProcess ? browserProcess.pid : null;
            
            // Count active pages for this browser
            const activePagesCount = Array.from(this.pagesBrowser.entries())
                .filter(([_, browserId]) => browserId === id)
                .length;
            
            const browserInfo = {
                id,
                pid,
                status: browserProcess ? 'running' : 'unknown',
                createdAt: new Date(data.createdAt).toISOString(),
                age: now - data.createdAt,
                pageCount: data.pageCount,
                activePages: activePagesCount,
                memory: null,
                cpu: null
            };
            
            // Try to get memory usage from browser
            if (browserProcess && pid) {
                try {
                    // Get memory info from process
                    const memoryUsage = browserProcess.memoryUsage ? 
                        browserProcess.memoryUsage() : null;
                    
                    if (memoryUsage) {
                        browserInfo.memory = {
                            rss: memoryUsage.rss,
                            heapTotal: memoryUsage.heapTotal,
                            heapUsed: memoryUsage.heapUsed
                        };
                    }
                } catch (err) {
                    // Memory info not available
                }
            }
            
            info.push(browserInfo);
        }
        
        return info;
    }
    
    /**
     * Terminate a specific browser process
     * @param {string} browserId - The browser ID to terminate
     * @returns {Promise<boolean>} Success status
     */
    async terminateProcess(browserId) {
        const browserData = this.browsers.get(browserId);
        
        if (!browserData) {
            util.Logging.warn(`Browser ${browserId} not found`);
            return false;
        }
        
        try {
            const browserProcess = browserData.browser.process();
            
            // Close all pages associated with this browser
            for (const [page, bId] of this.pagesBrowser.entries()) {
                if (bId === browserId) {
                    try {
                        await page.close();
                    } catch (err) {
                        // Ignore page close errors
                    }
                    this.pagesBrowser.delete(page);
                    this.activePages--;
                }
            }
            
            // Try graceful close first
            try {
                await browserData.browser.close();
            } catch (err) {
                // If graceful close fails, force kill the process
                if (browserProcess && browserProcess.pid) {
                    util.Logging.info(`Force killing browser process ${browserProcess.pid}`);
                    process.kill(browserProcess.pid, 'SIGKILL');
                }
            }
            
            this.browsers.delete(browserId);
            this.stats.browsersClosed++;
            
            util.Logging.info(`Browser ${browserId} terminated`);
            return true;
        } catch (error) {
            util.Logging.error(`Error terminating browser ${browserId}: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Get pool statistics
     * @returns {object} Pool statistics
     */
    getStats() {
        return {
            ...this.stats,
            activeBrowsers: this.browsers.size,
            activePages: this.activePages,
            maxConcurrency: this.maxConcurrency
        };
    }
    
    /**
     * Closes all browsers in the pool
     */
    async closeAll() {
        this.isClosing = true;
        clearInterval(this.statsInterval);
        
        // Close all browsers
        for (const [id, data] of this.browsers.entries()) {
            try {
                await data.browser.close();
                this.stats.browsersClosed++;
            } catch (error) {
                util.Logging.warn(`Error closing browser: ${error.message}`);
            }
        }
        
        this.browsers.clear();
        this.pagesBrowser.clear();
        this.activePages = 0;
    }
}

module.exports = BrowserPool; 