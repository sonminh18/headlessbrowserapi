const puppeteer = require('puppeteer');
const config = require('./config');
const util = require("hive-js-util");
const { v4: uuidv4 } = require('uuid');

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
        
        this.browsers = new Map(); // browser id -> browser instance
        this.pagesBrowser = new Map(); // page -> browser id
        this.activePages = 0;
        this.isClosing = false;
        
        // Statistics
        this.stats = {
            pagesCreated: 0,
            pagesDestroyed: 0,
            browsersLaunched: 0,
            browsersClosed: 0
        };
        
        // Log stats every 5 minutes
        this.statsInterval = setInterval(() => {
            util.Logging.debug(`Browser pool stats: ${JSON.stringify(this.stats)}`);
        }, 300000);
    }
    
    /**
     * Acquires a page from the pool
     * @returns {Promise<Page>} A Puppeteer page
     */
    async acquirePage() {
        if (this.isClosing) {
            throw new Error('Browser pool is closing');
        }
        
        // Find a browser with available capacity or launch a new one
        let browser;
        let browserId;
        
        // If we have capacity for a new browser
        if (this.browsers.size < this.maxConcurrency) {
            browser = await this.launchBrowser();
            browserId = uuidv4();
            this.browsers.set(browserId, browser);
            this.stats.browsersLaunched++;
        } else {
            // Otherwise, find the browser with the fewest active pages
            let minPages = Infinity;
            
            for (const [id, _] of this.browsers) {
                const pages = Array.from(this.pagesBrowser.entries())
                    .filter(([_, bId]) => bId === id)
                    .length;
                
                if (pages < minPages) {
                    minPages = pages;
                    browserId = id;
                }
            }
            
            browser = this.browsers.get(browserId);
        }
        
        // Get a page from the browser
        const page = await this.getPage(browser);
        this.pagesBrowser.set(page, browserId);
        this.activePages++;
        this.stats.pagesCreated++;
        
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
            // Reset page state
            await page.goto('about:blank');
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
        
        const browserId = this.pagesBrowser.get(page);
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
        for (const [id, b] of this.browsers.entries()) {
            if (b === browser) {
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
     * Closes all browsers in the pool
     */
    async closeAll() {
        this.isClosing = true;
        clearInterval(this.statsInterval);
        
        // Close all browsers
        for (const browser of this.browsers.values()) {
            try {
                await browser.close();
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