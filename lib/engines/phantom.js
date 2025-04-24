const util = require("hive-js-util");
const phantom = require("phantom");
const config = require("../util/config");

/**
 * @class PhantomSingleton
 * @classdesc Manages PhantomJS browser instances
 */
class PhantomSingleton {
    constructor() {
        this.instance = null;
        this.instancePromise = null;
    }

    /**
     * Initialize the PhantomJS instance
     */
    async init() {
        if (this.instance) {
            return;
        }

        try {
            this.instance = await phantom.create();
        } catch (error) {
            util.Logging.error(`Error initializing PhantomJS: ${error.message}`);
            throw error;
        }
    }

    /**
     * Destroy the PhantomJS instance
     */
    async destroy() {
        if (!this.instance) {
            return;
        }

        try {
            await this.instance.exit();
            this.instance = null;
        } catch (error) {
            util.Logging.error(`Error destroying PhantomJS: ${error.message}`);
        }
    }

    /**
     * Get the PhantomJS version
     * @returns {Promise<string>} Version information
     */
    async version() {
        return "PhantomJS 2.1";
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

        // Validate URL format
        try {
            const urlObject = new URL(url);
            // Use urlObject to avoid the side effect of just creating it
            if (!urlObject.protocol) {
                throw new Error("Invalid URL protocol");
            }
        } catch (error) {
            const urlError = new Error(`Invalid URL format: ${url}`);
            urlError.code = 400;
            throw urlError;
        }

        if (!this.instance) {
            await this.init();
        }

        let page = null;
        try {
            // Create a new page
            page = await this.instance.createPage();

            // Initialize response locals if needed
            if (!res.locals) {
                res.locals = {};
            }

            // Set custom user agent if provided
            if (customUserAgent) {
                await page.property("settings", { userAgent: customUserAgent });
            }

            // Set cookies if provided
            if (customCookies) {
                const cookies = Object.entries(customCookies).map(([name, value]) => ({
                    name: name,
                    value: String(value),
                    domain: new URL(url).hostname
                }));
                await page.property("cookies", cookies);
            }

            // Set proxy if provided
            if (proxyUrl) {
                await page.property("settings", {
                    proxy: proxyUrl,
                    proxyAuth: proxyAuth || undefined
                });
            }

            // Set basic auth if provided
            if (userPass) {
                const [username, password] = userPass.split(":");
                await page.property("settings", { auth: { username: username, password: password } });
            }

            // Set timeout - use config value as fallback if available
            const pageTimeout = timeout || (config.conf && config.conf.BROWSER && config.conf.BROWSER.timeout) || 30000;
            await page.property("settings", { resourceTimeout: pageTimeout });

            // Open the URL
            const status = await page.open(url);

            if (status !== "success") {
                const openError = new Error(`Failed to open URL: ${url}`);
                openError.code = 500; // This is a server-side error
                throw openError;
            }

            // Get the content
            const content = await page.property("content");

            // Set response content
            res.locals.content = content;

            // Close the page
            await page.close();

            return content;
        } catch (error) {
            // Handle any errors
            if (page) {
                try {
                    await page.close();
                } catch (e) {
                    // Ignore errors during close
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
            proxyAuth: req.query.proxy_auth
        };

        return this.renderWithOptions(req, res, next, options);
    }
}

// Singleton instance
let instance = null;

module.exports = {
    singleton() {
        if (instance === null) {
            instance = new PhantomSingleton();
        }
        return instance;
    },
    version() {
        return "PhantomJS 2.1";
    }
};
