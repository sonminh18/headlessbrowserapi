const puppeteer = require("puppeteer");
const util = require("hive-js-util");
const config = require("../util/config");
const conf = config.conf;
const DEFAULT_BROWSER_TIMEOUT = config.DEFAULT_BROWSER_TIMEOUT;
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
 * Helper function to check if a URL is an image
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL points to an image
 */
const isImageUrl = (url) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.jpe', '.webp'];
    const lowercaseUrl = url.toLowerCase().split('?')[0].split('#')[0];
    return imageExtensions.some((extension) => lowercaseUrl.endsWith(extension));
};

/**
 * Helper function to check if a URL is a video
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL points to a video
 */
const isVideoUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    
    // Extract file extension from URL, handling query parameters and fragments
    const lowercaseUrl = url.toLowerCase().split('?')[0].split('#')[0];
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.flv', '.mkv', '.m4v', '.mpeg', '.mpg'];
    
    // Check if URL ends with a video extension
    const hasVideoExtension = videoExtensions.some(extension => lowercaseUrl.endsWith(extension));
    
    // If not a direct video file extension, check if it's clearly a streaming URL
    const isStreamingUrl = lowercaseUrl.endsWith('.m3u8') || lowercaseUrl.endsWith('.mpd');
    
    // For image URLs, explicitly return false to prevent false positives
    if (isImageUrl(url)) {
        return false;
    }
    
    return hasVideoExtension || isStreamingUrl;
};

/**
 * Helper function to extract video URLs from DOM
 * @param {Page} page - Puppeteer page
 * @returns {Promise<Array>} Array of video URLs
 */
const extractVideoUrlsFromDOM = async (page) => {
    return page.evaluate(() => {
        const urls = [];
        const addedUrls = new Set(); // Track added URLs to avoid duplicates
        
        /**
         * Helper function to add a URL to the results if it's not a duplicate
         * @param {string} url - The URL to add
         * @param {string} mimeType - The MIME type of the URL
         * @param {number} size - The size of the resource
         */
        const addUrl = (url, mimeType = '', size = 0) => {
            // Skip invalid or already added URLs
            if (!url || typeof url !== 'string' || url.trim() === '' || addedUrls.has(url)) {
                return;
            }
            
            // Normalize URL
            const normalizedUrl = url.trim();
            const lowercaseUrl = normalizedUrl.toLowerCase();
            
            // Skip image URLs explicitly - prevent false positives
            if (lowercaseUrl.match(/\.(jpe?g|png|gif|bmp|webp)(\?.*)?$/i)) {
                return;
            }
            
            // Only accept URLs with valid video extensions or streaming formats
            const isMP4 = lowercaseUrl.endsWith('.mp4');
            const isWebM = lowercaseUrl.endsWith('.webm');
            const isOgg = lowercaseUrl.endsWith('.ogg');
            const isM3U8 = lowercaseUrl.endsWith('.m3u8');
            const isMPD = lowercaseUrl.endsWith('.mpd');
            const isOtherVideo = lowercaseUrl.match(/\.(mov|avi|wmv|flv|mkv|m4v|mpeg|mpg)(\?.*)?$/i);
            
            const isKnownVideoFormat = isMP4 || isWebM || isOgg || isM3U8 || isMPD || isOtherVideo;
            
            // If not a known video format, validate by MIME type if provided
            const isVideoMimeType = mimeType && 
                (mimeType.startsWith('video/') || 
                 mimeType === 'application/x-mpegURL' || 
                 mimeType === 'application/vnd.apple.mpegURL' ||
                 mimeType === 'application/dash+xml');
                 
            // Only add if it's a verified video URL
            if (isKnownVideoFormat || isVideoMimeType) {
                // Determine proper mime type if not provided
                if (!mimeType) {
                    if (isMP4) mimeType = 'video/mp4';
                    else if (isWebM) mimeType = 'video/webm';
                    else if (isOgg) mimeType = 'video/ogg';
                    else if (isM3U8) mimeType = 'application/x-mpegURL';
                    else if (isMPD) mimeType = 'application/dash+xml';
                    else if (lowercaseUrl.endsWith('.mov')) mimeType = 'video/quicktime';
                    else mimeType = 'video/mp4'; // Default
                }
                
                // Add to tracking set
                addedUrls.add(normalizedUrl);
                
                urls.push({
                    url: normalizedUrl,
                    mimeType,
                    size
                });
            }
        };
        
        // Extract from video elements - highest quality source
        const videoElements = document.querySelectorAll('video');
        videoElements.forEach(video => {
            if (video.src) {
                addUrl(video.src);
            }
            
            // Get all source elements which often contain different formats
            const sources = video.querySelectorAll('source');
            sources.forEach(source => {
                if (source.src) {
                    addUrl(source.src, source.type);
                }
            });
        });
        
        // Check for video elements with data attributes (HTML5 custom data)
        document.querySelectorAll('[data-video-url], [data-src], [data-video], [data-stream]').forEach(el => {
            const dataUrl = el.getAttribute('data-video-url') || 
                           el.getAttribute('data-src') || 
                           el.getAttribute('data-video') ||
                           el.getAttribute('data-stream');
            if (dataUrl) {
                addUrl(dataUrl);
            }
        });
        
        // Look for common streaming manifests in the page source
        const pageSource = document.documentElement.outerHTML;
        const manifestRegexes = [
            { regex: /["'](?:https?:)?\/\/[^"']+\.m3u8(?:\?[^"']*)?["']/gi, type: 'application/x-mpegURL' },
            { regex: /["'](?:https?:)?\/\/[^"']+\.mpd(?:\?[^"']*)?["']/gi, type: 'application/dash+xml' }
        ];
        
        manifestRegexes.forEach(({regex, type}) => {
            let match;
            while ((match = regex.exec(pageSource)) !== null) {
                let manifestUrl = match[0].replace(/["']/g, '');
                // Add protocol if missing
                if (manifestUrl.startsWith('//')) {
                    manifestUrl = window.location.protocol + manifestUrl;
                }
                addUrl(manifestUrl, type);
            }
        });
        
        // Look for direct mp4 links in the page source
        const mp4Regex = /["'](?:https?:)?\/\/[^"']+\.mp4(?:\?[^"']*)?["']/gi;
        let match;
        while ((match = mp4Regex.exec(pageSource)) !== null) {
            let videoUrl = match[0].replace(/["']/g, '');
            if (videoUrl.startsWith('//')) {
                videoUrl = window.location.protocol + videoUrl;
            }
            addUrl(videoUrl, 'video/mp4');
        }
        
        // Look for video player data in common variables
        // JW Player
        if (window.jwplayer && typeof window.jwplayer === 'function') {
            try {
                const players = window.jwplayer();
                if (players && players.getPlaylist) {
                    const playlist = players.getPlaylist();
                    if (playlist && playlist.length > 0) {
                        playlist.forEach(item => {
                            if (item.file) addUrl(item.file);
                            if (item.sources && Array.isArray(item.sources)) {
                                // Sort sources by quality if available (high to low)
                                const sortedSources = [...item.sources].sort((a, b) => {
                                    const qualityA = parseInt((a.label || '').replace(/[^\d]/g, '')) || 0;
                                    const qualityB = parseInt((b.label || '').replace(/[^\d]/g, '')) || 0;
                                    return qualityB - qualityA;
                                });
                                
                                sortedSources.forEach(source => {
                                    if (source.file) {
                                        addUrl(source.file, source.type || '');
                                    }
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.error('Error extracting from jwplayer:', e);
            }
        }
        
        // video.js player
        if (window.videojs) {
            try {
                const players = document.querySelectorAll('.video-js');
                players.forEach(player => {
                    const id = player.id;
                    if (id && window.videojs.getPlayers && window.videojs.getPlayers()[id]) {
                        const vjsPlayer = window.videojs.getPlayers()[id];
                        if (vjsPlayer.src()) {
                            // Get current source
                            const currentSrc = typeof vjsPlayer.src() === 'string' ? 
                                vjsPlayer.src() : vjsPlayer.src().src;
                            if (currentSrc) {
                                addUrl(currentSrc);
                            }
                            
                            // Get all sources
                            if (vjsPlayer.currentSources && Array.isArray(vjsPlayer.currentSources())) {
                                vjsPlayer.currentSources().forEach(source => {
                                    if (source.src) {
                                        addUrl(source.src, source.type);
                                    }
                                });
                            }
                        }
                    }
                });
            } catch (e) {
                console.error('Error extracting from video.js:', e);
            }
        }
        
        return urls;
    });
};

/**
 * Helper function to extract video mime type
 * @param {string} url - The URL to check
 * @returns {string} MIME type for the video
 */
const getVideoMimeType = (url) => {
    const lowercaseUrl = url.toLowerCase().split('?')[0].split('#')[0];
    if (lowercaseUrl.endsWith('.mp4')) return 'video/mp4';
    if (lowercaseUrl.endsWith('.webm')) return 'video/webm';
    if (lowercaseUrl.endsWith('.ogg')) return 'video/ogg';
    if (lowercaseUrl.endsWith('.mov')) return 'video/quicktime';
    if (lowercaseUrl.endsWith('.avi')) return 'video/x-msvideo';
    if (lowercaseUrl.endsWith('.wmv')) return 'video/x-ms-wmv';
    if (lowercaseUrl.endsWith('.flv')) return 'video/x-flv';
    if (lowercaseUrl.endsWith('.mkv')) return 'video/x-matroska';
    if (lowercaseUrl.endsWith('.m4v')) return 'video/x-m4v';
    if (lowercaseUrl.endsWith('.mpeg') || lowercaseUrl.endsWith('.mpg')) return 'video/mpeg';
    return 'video/mp4'; // Default type
};

/**
 * Helper function to check if a URL contains video player elements
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<boolean>} True if page likely contains a video player
 */
const hasVideoPlayerElements = async (page) => {
    return page.evaluate(() => {
        // Check for common video player classes and elements
        const videoPlayerSelectors = [
            // Common video player elements
            'video',
            'iframe[src*="youtube"]',
            'iframe[src*="vimeo"]',
            'iframe[src*="dailymotion"]',
            'iframe[src*="jwplayer"]',
            'iframe[src*="player"]',
            'iframe[src*="video"]',
            '.video-player',
            '.player',
            '.video-js',
            '.jwplayer',
            '.html5-video-player',
            // Play buttons
            '.play-button',
            '.vjs-big-play-button',
            '.ytp-play-button',
            '[aria-label="Play"]',
            'button[title="Play"]',
            '[role="button"]'
        ];
        
        // Check if any of these selectors exist
        for (const selector of videoPlayerSelectors) {
            if (document.querySelector(selector)) {
                return true;
            }
        }
        
        // Check for video-player keyword in stylesheets
        try {
            const stylesheets = Array.from(document.styleSheets);
            for (const sheet of stylesheets) {
                try {
                    // Handle cross-origin stylesheet errors
                    const rules = Array.from(sheet.cssRules || []);
                    for (const rule of rules) {
                        if (rule.cssText && rule.cssText.includes('video-player')) {
                            return true;
                        }
                    }
                } catch (e) {
                    // Cross-origin stylesheet access error, ignore
                }
            }
        } catch (e) {
            // Ignore stylesheet errors
        }
        
        // Check for video keywords in page source
        const pageSource = document.documentElement.outerHTML.toLowerCase();
        const videoKeywords = [
            'video-player',
            'videoplayer',
            'video_player',
            'video-js',
            'video_embed',
            'video-embed',
            'player.js',
            'jwplayer',
            'flowplayer',
            'mediaplayer',
            'media-player'
        ];
        
        return videoKeywords.some(keyword => pageSource.includes(keyword));
    });
};

/**
 * Attempts to find and click play buttons in video players
 * @param {Page} page - Puppeteer page
 * @returns {Promise<boolean>} True if any play button was found and clicked
 */
const clickVideoPlayButtons = async (page) => {
    return page.evaluate(() => {
        let clickCount = 0;
        
        // Function to try clicking an element
        const tryClick = (element) => {
            try {
                // Try normal click first
                element.click();
                clickCount++;
                return true;
            } catch (e) {
                try {
                    // Fallback: dispatch click event
                    const event = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    element.dispatchEvent(event);
                    clickCount++;
                    return true;
                } catch (e2) {
                    return false;
                }
            }
        };
        
        // Try to interact with common video player controls
        
        // 1. Direct video elements
        const videoElements = document.querySelectorAll('video');
        videoElements.forEach(video => {
            try {
                // Try to directly play the video
                video.play().catch(() => {});
                clickCount++;
                
                // Also click the video element itself (some players use this)
                tryClick(video);
            } catch (e) {
                // Ignore errors
            }
        });
        
        // 2. Common play button selectors - try in priority order
        const playButtonSelectors = [
            '.play-button', 
            '.vjs-big-play-button',
            '.ytp-large-play-button',
            '.ytp-play-button',
            '[aria-label="Play"]',
            '[title="Play"]',
            '.plyr__control--play',
            '.video-play',
            '.btn-play',
            // Generic buttons that might control playback
            '[role="button"]'
        ];
        
        // Try each selector
        for (const selector of playButtonSelectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(tryClick);
        }
        
        // 3. Try to find play buttons by common attributes and text
        const allButtons = document.querySelectorAll('button, a, div[role="button"], span[role="button"]');
        allButtons.forEach(button => {
            // Check if it looks like a play button
            const text = button.textContent?.toLowerCase() || '';
            const classes = button.className?.toLowerCase() || '';
            const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
            const title = (button.getAttribute('title') || '').toLowerCase();
            
            if (
                text.includes('play') || 
                classes.includes('play') || 
                ariaLabel.includes('play') || 
                title.includes('play') ||
                button.querySelector('i.fa-play, span.play-icon, svg[class*="play"]')
            ) {
                tryClick(button);
            }
        });
        
        // 4. Try iframes (if not blocked by same-origin policy)
        try {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                try {
                    if (iframe.contentDocument) {
                        // If we can access the iframe content, try to find play buttons there
                        const iframePlayButtons = iframe.contentDocument.querySelectorAll(
                            playButtonSelectors.join(', ')
                        );
                        iframePlayButtons.forEach(btn => tryClick(btn));
                        
                        // Try to play videos directly
                        const videos = iframe.contentDocument.querySelectorAll('video');
                        videos.forEach(video => {
                            try { video.play().catch(() => {}); } catch (e) {}
                        });
                    }
                } catch (e) {
                    // Cross-origin iframe access error, ignore
                }
            });
        } catch (e) {
            // Ignore iframe errors
        }
        
        return clickCount > 0;
    });
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

        // No longer intercepting requests
        
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
            basicAuth,
        } = options;
        
        let page = null;
        let videoUrls = [];
        
        try {
            // Initialize response locals if needed
            if (!res.locals) {
                res.locals = {};
            }

            // Check if URL is an image
            const isImage = isImageUrl(url);

            // Get page from pool
            page = await this.browserPool.acquirePage();

            // Set timeout with clear precedence:
            // 1. Request query timeout (if provided)
            // 2. Configuration timeout from config file
            // 3. Default timeout constant (30000ms)
            const pageTimeout = timeout || conf.BROWSER.timeout || DEFAULT_BROWSER_TIMEOUT;
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

            // Configure proxy and enable request interception to capture video URLs
            // Enable request interception via CDP
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');
            
            // Set up a more thorough monitoring of requests for possible video content
            // Monitor all XHR requests for video content or playlist files
            await page.setRequestInterception(true);
            page.on('request', request => {
                // Allow the request to continue
                request.continue();
                
                const reqUrl = request.url();
                
                // Skip image URLs
                if (isImageUrl(reqUrl)) {
                    return;
                }
                
                // Enhanced video URL detection
                // Look for video file extensions in any request
                if (isVideoUrl(reqUrl) || reqUrl.includes('mime=video') || reqUrl.startsWith('blob:')) {
                    // Only collect the URL, not the content
                    const videoInfo = {
                        url: reqUrl,
                        mimeType: getVideoMimeType(reqUrl),
                        size: 0
                    };
                    
                    // Avoid duplicates
                    if (!videoUrls.some(v => v.url === reqUrl)) {
                        videoUrls.push(videoInfo);
                        util.Logging.info(`Detected video URL from request: ${reqUrl}`);
                    }
                }
                
                
                // Look for video playlist files (m3u8, mpd)
                if (reqUrl.includes('.m3u8') || reqUrl.includes('.mpd')) {
                    const playlistInfo = {
                        url: reqUrl,
                        mimeType: reqUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'application/dash+xml',
                        size: 0,
                        isPlaylist: true
                    };
                    
                    // Avoid duplicates
                    if (!videoUrls.some(v => v.url === reqUrl)) {
                        videoUrls.push(playlistInfo);
                        util.Logging.info(`Detected video playlist URL: ${reqUrl}`);
                    }
                }
                
            });
            
            // Enhance response monitoring to detect media content types
            client.on('Network.responseReceived', async (event) => {
                try {
                    const { response } = event;
                    const responseUrl = response.url;
                    
                    // Check if URL is an image - explicitly skip these
                    if (isImageUrl(responseUrl)) {
                        return;
                    }
                    
                    // Check content type and URL for video
                    const contentType = response.headers['content-type'] || '';
                    const isVideoContentType = contentType.includes('video/') ||
                                            contentType.includes('application/octet-stream');
                    const isManifestType = contentType.includes('application/x-mpegURL') || 
                                       contentType.includes('application/vnd.apple.mpegURL') ||
                                       contentType.includes('application/dash+xml');
                    
                    // Strict check for video URLs
                    const isVideoExt = isVideoUrl(responseUrl);
                    
                    // Enhanced detection for video responses
                    const isGoogleVideo = responseUrl.includes('googlevideo.com');
                    
                    // Only add video files with correct content type or extension
                    if ((isVideoExt && !isImageUrl(responseUrl)) || 
                        isVideoContentType || 
                        isManifestType || 
                        isGoogleVideo) {
                        
                        // Only collect the URL, not the content
                        const videoInfo = {
                            url: responseUrl,
                            mimeType: contentType || getVideoMimeType(responseUrl),
                            size: response.headers['content-length'] || 0
                        };
                        
                        // Avoid duplicates
                        if (!videoUrls.some(v => v.url === responseUrl)) {
                            videoUrls.push(videoInfo);
                            util.Logging.info(`Detected video URL from response: ${responseUrl}`);
                        }
                    }
                    
                } catch (err) {
                    util.Logging.warn(`Error detecting video URL: ${err.message}`);
                }
            });
            
            // Set proxy if provided
            if (proxyUrl) {
                if (proxyAuth) {
                    const [proxyUsername, proxyPassword] = proxyAuth.split(":");
                    await page.authenticate({
                        username: proxyUsername,
                        password: proxyPassword
                    });
                }
                
                // Apply proxy server settings
                await client.send('Network.setExtraHTTPHeaders', {
                    headers: {
                        'Proxy-Authorization': proxyAuth ? 
                            `Basic ${Buffer.from(proxyAuth).toString('base64')}` : ''
                    }
                });
                
                // Configure proxy server
                await client.send('Network.setUserAgent', {
                    userAgent: customUserAgent || await page.browser().userAgent()
                });
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
                
                // Check if page contains video player elements
                const hasVideoPlayer = await hasVideoPlayerElements(page);
                
                if (hasVideoPlayer) {
                    util.Logging.info("Detected potential video player on page, applying special handling");
                    
                    // Add a longer delay for video content to load
                    await puppeteerDelay(3000);
                    
                    // Try to click play buttons to trigger video loading
                    const clickedPlay = await clickVideoPlayButtons(page);
                    
                    if (clickedPlay) {
                        util.Logging.info("Successfully interacted with video player, waiting for network requests");
                        // Wait longer for video content to load after clicking play
                        await puppeteerDelay(5000);
                    }
                    
                    // Additional attempt with custom interaction for iframe-based players
                    const iframeVideoDetected = await page.evaluate(() => {
                        let detected = false;
                        
                        // Check for video player iframes
                        const videoIframes = document.querySelectorAll('iframe[src*="player"], iframe[src*="video"], iframe[src*="embed"]');
                        videoIframes.forEach(iframe => {
                            // Flag that we've found a potential video iframe
                            detected = true;
                            
                            // Store the iframe source URL for later analysis
                            window.__videoIframeSources = window.__videoIframeSources || [];
                            if (iframe.src) {
                                window.__videoIframeSources.push(iframe.src);
                            }
                            
                            // Try to access and interact with iframe content if possible
                            try {
                                if (iframe.contentWindow && iframe.contentDocument) {
                                    // Try to find and click play buttons
                                    const playButtons = iframe.contentDocument.querySelectorAll('.play-button, [aria-label="Play"], button');
                                    playButtons.forEach(button => {
                                        try { button.click(); } catch (e) {}
                                    });
                                    
                                    // Try to play videos directly
                                    const videos = iframe.contentDocument.querySelectorAll('video');
                                    videos.forEach(video => {
                                        try { video.play().catch(() => {}); } catch (e) {}
                                    });
                                }
                            } catch (e) {
                                // Cross-origin iframe access error, ignore
                            }
                        });
                        
                        return detected;
                    });
                    
                    if (iframeVideoDetected) {
                        util.Logging.info("Detected video iframes, waiting for content to load");
                        // Get iframe sources for analysis
                        const iframeSources = await page.evaluate(() => window.__videoIframeSources || []);
                        
                        // Log the iframe sources
                        iframeSources.forEach(source => {
                            util.Logging.info(`Video iframe source: ${source}`);
                            
                            // Add any iframe sources that look like direct video URLs
                            if (isVideoUrl(source)) {
                                const videoInfo = {
                                    url: source,
                                    mimeType: getVideoMimeType(source),
                                    size: 0,
                                    source: 'iframe_src'
                                };
                                
                                // Avoid duplicates
                                if (!videoUrls.some(v => v.url === source)) {
                                    videoUrls.push(videoInfo);
                                }
                            }
                        });
                        
                        // Wait longer for network requests from iframe interactions
                        await puppeteerDelay(3000);
                    }
                }
                
                // Add delay for video detection (use the specified delay or default)
                const videoDetectionDelay = delayTime || 3000;
                if (videoDetectionDelay > 0) {
                    await puppeteerDelay(videoDetectionDelay);
                }
                
                // Try to interact with common video player elements to trigger video loading
                await page.evaluate(() => {
                    // Try to click on play buttons
                    const playButtons = document.querySelectorAll('.play-button, .vjs-big-play-button, .play-btn, [aria-label="Play"]');
                    playButtons.forEach(button => {
                        try {
                            button.click();
                        } catch (e) {
                            // Ignore errors
                        }
                    });
                    
                    // Try to play all video elements
                    const videos = document.querySelectorAll('video');
                    videos.forEach(video => {
                        try {
                            video.play().catch(() => {});
                        } catch (e) {
                            // Ignore errors
                        }
                    });
                });
                
                // Additional delay after interaction
                await puppeteerDelay(1000);
                
                // Run custom JavaScript evaluation if provided
                if (customEval) {
                    await page.evaluate((evalCode) => {
                        // eslint-disable-next-line no-eval
                        eval(evalCode);
                    }, customEval);
                }
                
                // Extract video URLs from DOM elements after JavaScript execution
                const domVideoUrls = await extractVideoUrlsFromDOM(page);
                if (domVideoUrls && domVideoUrls.length > 0) {
                    domVideoUrls.forEach(videoInfo => {
                        // Add mimeType and size based on URL
                        videoInfo.mimeType = videoInfo.mimeType || getVideoMimeType(videoInfo.url);
                        videoInfo.size = videoInfo.size || 0;
                        
                        // Avoid duplicates
                        if (!videoUrls.some(v => v.url === videoInfo.url)) {
                            videoUrls.push(videoInfo);
                            util.Logging.info(`Detected video URL from DOM: ${videoInfo.url}`);
                        }
                    });
                }
                
                // Get the content from the page
                const content = await page.content();
                
                // Set response content without using cleanHtmlContent
                res.locals.content = content;
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

            // Add video URLs to response if any were found
            if (videoUrls.length > 0) {
                res.locals.videoUrls = videoUrls;
            }
            
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
            basicAuth: req.query.basic_auth,
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
let _instance = null;
module.exports = {
    singleton: () => {
        if (!_instance) {
            _instance = new PuppeteerSingleton();
        }
        return _instance;
    },
    version: async () => puppeteer.version(),
    puppeteerDelay,
    isImageUrl,
    isVideoUrl,
    getVideoMimeType,
    extractVideoUrlsFromDOM
};
