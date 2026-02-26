const puppeteer = require("puppeteer-extra");
const stealthPlugin = require("puppeteer-extra-plugin-stealth");
const util = require("hive-js-util");
const path = require("path");
const fs = require("fs").promises;
const { v4: uuidv4 } = require("uuid");
const config = require("../util/config");
const conf = config.conf;
const DEFAULT_BROWSER_TIMEOUT = config.DEFAULT_BROWSER_TIMEOUT;
const BrowserPool = require("../util/browser-pool");

// Snapshots directory for error screenshots
const SNAPSHOTS_DIR = path.join(__dirname, "../../public/snapshots");

/**
 * Helper function to cause a delay
 * @param {number} time - Time to delay in milliseconds
 * @returns {Promise<void>}
 */
const puppeteerDelay = (time) => {
    return new Promise(function (resolve) {
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
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".jpe", ".webp"];
    const lowercaseUrl = url.toLowerCase().split("?")[0].split("#")[0];
    return imageExtensions.some((extension) => lowercaseUrl.endsWith(extension));
};

/**
 * Helper function to check if a URL is a video
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL points to a video
 */
const isVideoUrl = (url) => {
    if (!url || typeof url !== "string") return false;

    // Extract file extension from URL, handling query parameters and fragments
    const lowercaseUrl = url.toLowerCase().split("?")[0].split("#")[0];
    const videoExtensions = [".mp4", ".webm", ".ogg", ".mov", ".avi", ".wmv", ".flv", ".mkv", ".m4v", ".mpeg", ".mpg"];

    // Check if URL ends with a video extension
    const hasVideoExtension = videoExtensions.some(extension => lowercaseUrl.endsWith(extension));

    // If not a direct video file extension, check if it's clearly a streaming URL
    const isStreamingUrl = lowercaseUrl.endsWith(".m3u8") || lowercaseUrl.endsWith(".mpd");

    // For image URLs, explicitly return false to prevent false positives
    if (isImageUrl(url)) {
        return false;
    }

    return hasVideoExtension || isStreamingUrl;
};

/**
 * Helper function to check if a URL is a stream segment (HLS/DASH)
 * Stream segments are small fragments of a video stream and cannot be
 * downloaded individually as complete videos.
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL is a stream segment
 */
const isStreamSegment = (url) => {
    if (!url || typeof url !== "string") return false;
    const urlPath = url.toLowerCase().split("?")[0].split("#")[0];

    // HLS transport stream segments (.ts)
    if (urlPath.endsWith(".ts")) return true;

    // DASH/CMAF segments (.m4s, .m4f)
    if (urlPath.endsWith(".m4s") || urlPath.endsWith(".m4f")) return true;

    // Numbered segment patterns in URL path
    if (/\/seg[-_]?\d+/i.test(urlPath)) return true;
    if (/\/segment[-_]?\d+/i.test(urlPath)) return true;
    if (/\/chunk[-_]?\d+/i.test(urlPath)) return true;
    if (/\/frag(ment)?[-_]?\d+/i.test(urlPath)) return true;

    return false;
};

/**
 * Helper function to get the actual file extension from a URL
 * Handles complex URLs where .mp4 might appear mid-path
 * @param {string} url - The URL to check
 * @returns {string} The file extension (e.g., ".mp4", ".ts") or empty string
 */
const getUrlExtension = (url) => {
    if (!url || typeof url !== "string") return "";
    const urlPath = url.toLowerCase().split("?")[0].split("#")[0];
    const lastSegment = urlPath.split("/").pop() || "";
    const lastDot = lastSegment.lastIndexOf(".");
    if (lastDot === -1) return "";
    return lastSegment.substring(lastDot);
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
         * Helper function to convert relative URLs to absolute URLs
         * @param {string} url - The URL to convert
         * @returns {string} Absolute URL
         */
        const toAbsoluteUrl = (url) => {
            if (!url || typeof url !== "string") return url;

            const trimmedUrl = url.trim();

            // Already absolute URL with protocol
            if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
                return trimmedUrl;
            }

            // Blob URLs - keep as is but mark for special handling
            if (trimmedUrl.startsWith("blob:")) {
                return trimmedUrl;
            }

            // Data URLs - keep as is
            if (trimmedUrl.startsWith("data:")) {
                return trimmedUrl;
            }

            // Protocol-relative URL (//example.com/path)
            if (trimmedUrl.startsWith("//")) {
                return window.location.protocol + trimmedUrl;
            }

            // Absolute path (/path/to/video.mp4)
            if (trimmedUrl.startsWith("/")) {
                return window.location.origin + trimmedUrl;
            }

            // Relative path (path/to/video.mp4 or ./path/to/video.mp4)
            // Use URL constructor for proper resolution
            try {
                return new URL(trimmedUrl, window.location.href).href;
            } catch (e) {
                // Fallback: prepend origin
                return window.location.origin + "/" + trimmedUrl.replace(/^\.\//, "");
            }
        };

        /**
         * Helper function to add a URL to the results if it's not a duplicate
         * @param {string} url - The URL to add
         * @param {string} mimeType - The MIME type of the URL
         * @param {number} size - The size of the resource
         */
        const addUrl = (url, mimeType = "", size = 0) => {
            // Skip invalid or already added URLs
            if (!url || typeof url !== "string" || url.trim() === "" || addedUrls.has(url)) {
                return;
            }

            // Convert relative URL to absolute URL
            const absoluteUrl = toAbsoluteUrl(url);

            // Skip if already added (after conversion)
            if (addedUrls.has(absoluteUrl)) {
                return;
            }

            // Normalize URL
            const normalizedUrl = absoluteUrl;
            const lowercaseUrl = normalizedUrl.toLowerCase();

            // Skip image URLs explicitly - prevent false positives
            if (lowercaseUrl.match(/\.(jpe?g|png|gif|bmp|webp)(\?.*)?$/i)) {
                return;
            }

            // Only accept URLs with valid video extensions or streaming formats
            const isMP4 = lowercaseUrl.endsWith(".mp4");
            const isWebM = lowercaseUrl.endsWith(".webm");
            const isOgg = lowercaseUrl.endsWith(".ogg");
            const isM3U8 = lowercaseUrl.endsWith(".m3u8");
            const isMPD = lowercaseUrl.endsWith(".mpd");
            const isOtherVideo = lowercaseUrl.match(/\.(mov|avi|wmv|flv|mkv|m4v|mpeg|mpg)(\?.*)?$/i);

            const isKnownVideoFormat = isMP4 || isWebM || isOgg || isM3U8 || isMPD || isOtherVideo;

            // If not a known video format, validate by MIME type if provided
            const isVideoMimeType = mimeType &&
                (mimeType.startsWith("video/") ||
                    mimeType === "application/x-mpegURL" ||
                    mimeType === "application/vnd.apple.mpegURL" ||
                    mimeType === "application/dash+xml");

            // Only add if it's a verified video URL
            if (isKnownVideoFormat || isVideoMimeType) {
                // Determine proper mime type if not provided
                if (!mimeType) {
                    if (isMP4) mimeType = "video/mp4";
                    else if (isWebM) mimeType = "video/webm";
                    else if (isOgg) mimeType = "video/ogg";
                    else if (isM3U8) mimeType = "application/x-mpegURL";
                    else if (isMPD) mimeType = "application/dash+xml";
                    else if (lowercaseUrl.endsWith(".mov")) mimeType = "video/quicktime";
                    else mimeType = "video/mp4"; // Default
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
        const videoElements = document.querySelectorAll("video");
        videoElements.forEach(video => {
            if (video.src) {
                addUrl(video.src);
            }

            // Get all source elements which often contain different formats
            const sources = video.querySelectorAll("source");
            sources.forEach(source => {
                if (source.src) {
                    addUrl(source.src, source.type);
                }
            });
        });

        // Check for video elements with data attributes (HTML5 custom data)
        document.querySelectorAll("[data-video-url], [data-src], [data-video], [data-stream]").forEach(el => {
            const dataUrl = el.getAttribute("data-video-url") ||
                el.getAttribute("data-src") ||
                el.getAttribute("data-video") ||
                el.getAttribute("data-stream");
            if (dataUrl) {
                addUrl(dataUrl);
            }
        });

        // Look for common streaming manifests in the page source
        const pageSource = document.documentElement.outerHTML;

        // ==================== Absolute URL patterns ====================
        const manifestRegexes = [
            { regex: /["'](?:https?:)?\/\/[^"']+\.m3u8(?:\?[^"']*)?["']/gi, type: "application/x-mpegURL" },
            { regex: /["'](?:https?:)?\/\/[^"']+\.mpd(?:\?[^"']*)?["']/gi, type: "application/dash+xml" }
        ];

        manifestRegexes.forEach(({ regex, type }) => {
            let match;
            while ((match = regex.exec(pageSource)) !== null) {
                let manifestUrl = match[0].replace(/["']/g, "");
                // Add protocol if missing
                if (manifestUrl.startsWith("//")) {
                    manifestUrl = window.location.protocol + manifestUrl;
                }
                addUrl(manifestUrl, type);
            }
        });

        // Look for direct mp4 links in the page source (absolute URLs)
        const mp4Regex = /["'](?:https?:)?\/\/[^"']+\.mp4(?:\?[^"']*)?["']/gi;
        let match;
        while ((match = mp4Regex.exec(pageSource)) !== null) {
            let videoUrl = match[0].replace(/["']/g, "");
            if (videoUrl.startsWith("//")) {
                videoUrl = window.location.protocol + videoUrl;
            }
            addUrl(videoUrl, "video/mp4");
        }

        // ==================== Relative URL patterns ====================
        // Look for relative m3u8/mpd/mp4 URLs (e.g., /storage/m3u8/index.m3u8)
        const relativeVideoPatterns = [
            // Relative paths starting with /
            { regex: /["']\/[^"']*\.m3u8(?:\?[^"']*)?["']/gi, type: "application/x-mpegURL" },
            { regex: /["']\/[^"']*\.mpd(?:\?[^"']*)?["']/gi, type: "application/dash+xml" },
            { regex: /["']\/[^"']*\.mp4(?:\?[^"']*)?["']/gi, type: "video/mp4" },
            { regex: /["']\/[^"']*\.webm(?:\?[^"']*)?["']/gi, type: "video/webm" },
            // Relative paths without leading slash (./path or path)
            { regex: /["'](?:\.\/)?[a-zA-Z0-9_-]+\/[^"']*\.m3u8(?:\?[^"']*)?["']/gi, type: "application/x-mpegURL" },
            { regex: /["'](?:\.\/)?[a-zA-Z0-9_-]+\/[^"']*\.mp4(?:\?[^"']*)?["']/gi, type: "video/mp4" }
        ];

        relativeVideoPatterns.forEach(({ regex, type }) => {
            let relMatch;
            while ((relMatch = regex.exec(pageSource)) !== null) {
                const relativeUrl = relMatch[0].replace(/["']/g, "");
                // toAbsoluteUrl will handle the conversion
                addUrl(relativeUrl, type);
            }
        });

        // ==================== JavaScript variable patterns ====================
        // Look for video URLs in JavaScript variables/objects
        // Common patterns: source: "/path/video.mp4", file: "/path/video.m3u8", src: "/path/video.mp4"
        const jsVariablePatterns = [
            /(?:source|src|file|url|video|stream|manifest|playlist)\s*[:=]\s*["']([^"']+\.(?:mp4|m3u8|mpd|webm))["']/gi,
            /["'](?:source|src|file|url|video|stream)["']\s*:\s*["']([^"']+\.(?:mp4|m3u8|mpd|webm))["']/gi
        ];

        jsVariablePatterns.forEach(regex => {
            let jsMatch;
            while ((jsMatch = regex.exec(pageSource)) !== null) {
                const extractedUrl = jsMatch[1];
                if (extractedUrl) {
                    const ext = extractedUrl.toLowerCase().split("?")[0];
                    let mimeType = "video/mp4";
                    if (ext.endsWith(".m3u8")) mimeType = "application/x-mpegURL";
                    else if (ext.endsWith(".mpd")) mimeType = "application/dash+xml";
                    else if (ext.endsWith(".webm")) mimeType = "video/webm";
                    addUrl(extractedUrl, mimeType);
                }
            }
        });

        // Look for video player data in common variables
        // JW Player
        if (window.jwplayer && typeof window.jwplayer === "function") {
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
                                    const qualityA = parseInt((a.label || "").replace(/[^\d]/g, "")) || 0;
                                    const qualityB = parseInt((b.label || "").replace(/[^\d]/g, "")) || 0;
                                    return qualityB - qualityA;
                                });

                                sortedSources.forEach(source => {
                                    if (source.file) {
                                        addUrl(source.file, source.type || "");
                                    }
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.error("Error extracting from jwplayer:", e);
            }
        }

        // video.js player
        if (window.videojs) {
            try {
                const players = document.querySelectorAll(".video-js");
                players.forEach(player => {
                    const id = player.id;
                    if (id && window.videojs.getPlayers && window.videojs.getPlayers()[id]) {
                        const vjsPlayer = window.videojs.getPlayers()[id];
                        if (vjsPlayer.src()) {
                            // Get current source
                            const currentSrc = typeof vjsPlayer.src() === "string" ?
                                vjsPlayer.src()
                                : vjsPlayer.src().src;
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
                console.error("Error extracting from video.js:", e);
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
    const lowercaseUrl = url.toLowerCase().split("?")[0].split("#")[0];
    if (lowercaseUrl.endsWith(".mp4")) return "video/mp4";
    if (lowercaseUrl.endsWith(".webm")) return "video/webm";
    if (lowercaseUrl.endsWith(".ogg")) return "video/ogg";
    if (lowercaseUrl.endsWith(".mov")) return "video/quicktime";
    if (lowercaseUrl.endsWith(".avi")) return "video/x-msvideo";
    if (lowercaseUrl.endsWith(".wmv")) return "video/x-ms-wmv";
    if (lowercaseUrl.endsWith(".flv")) return "video/x-flv";
    if (lowercaseUrl.endsWith(".mkv")) return "video/x-matroska";
    if (lowercaseUrl.endsWith(".m4v")) return "video/x-m4v";
    if (lowercaseUrl.endsWith(".mpeg") || lowercaseUrl.endsWith(".mpg")) return "video/mpeg";
    return "video/mp4"; // Default type
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
            "video",
            'iframe[src*="embed"]', 
            'iframe[src*="/embed/"]',
            'iframe[src*="youtube"]',
            'iframe[src*="vimeo"]',
            'iframe[src*="dailymotion"]',
            'iframe[src*="jwplayer"]',
            'iframe[src*="player"]',
            'iframe[src*="video"]',
            ".video-player",
            ".player",
            ".video-js",
            ".jwplayer",
            ".html5-video-player",
            // Play buttons
            ".play-button",
            ".vjs-big-play-button",
            ".ytp-play-button",
            '[aria-label="Play"]',
            'button[title="Play"]',
            '[role="button"]',
            // Server/Source buttons (indicates video page)
            "#video-actions",
            ".video-server",
            ".server-list",
            ".list-server",
            '[id^="server"]',
            ".source-selector",
            "[data-source]"
        ];

        // Check if any of these selectors exist
        for (const selector of videoPlayerSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                console.log(`[VideoSource] Found detection selector: ${selector}`);
                return { found: true, reason: `Found selector: ${selector}` };
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
                        if (rule.cssText && rule.cssText.includes("video-player")) {
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
            "video-player",
            "videoplayer",
            "video_player",
            "video-js",
            "video_embed",
            "video-embed",
            "player.js",
            "jwplayer",
            "flowplayer",
            "mediaplayer",
            "media-player",
            "/embed/",
            "iframe src"
        ];

        return videoKeywords.some(keyword => pageSource.includes(keyword));
    });
};

/**
 * Smart detection and clicking of video source/quality selector buttons
 * Uses multiple heuristics to find buttons that switch video sources
 * PRIORITY: Click buttons with "MP4" in text first (direct download preferred)
 * SKIP: Buttons that are already active (to avoid switching away from MP4)
 * @param {Page} page - Puppeteer page
 * @returns {Promise<{clicked: number, selectors: string[], clickedMp4: boolean}>} Click results
 */
/**
 * Helper function to safely evaluate with context destroyed handling
 * @param {Page} page - Puppeteer page
 * @param {Function} evalFn - Function to evaluate
 * @param {any} defaultValue - Default value if context destroyed
 * @returns {Promise<any>} Evaluation result or default value
 */
const safeEvaluate = async (page, evalFn, defaultValue = null) => {
    try {
        return await page.evaluate(evalFn);
    } catch (err) {
        if (err.message && (
            err.message.includes("context was destroyed") ||
            err.message.includes("navigation") ||
            err.message.includes("Target closed") ||
            err.message.includes("Session closed")
        )) {
            util.Logging.warn("Context destroyed during evaluation, using default value");
            return defaultValue;
        }
        throw err;
    }
};

/**
 * Global Navigation Lock helper
 * Adds/Removes listeners to prevent page navigation
 * @param {Page} page - Puppeteer page
 * @param {boolean} enable - Enable or disable the lock
 * @param {Function} [existingHandler] - Existing dialog handler to remove
 * @returns {Promise<Function|null>} The dialog handler (if enabled) or null
 */
const toggleNavigationLock = async (page, enable = true, existingHandler = null) => {
    if (enable) {
        // Handler for dialogs (alerts, confirms, beforeunload)
        const onDialog = async (dialog) => {
            const type = dialog.type();
            const message = dialog.message();
            util.Logging.info(`[NavigationLock] Dismissing dialog: ${type} - "${message}"`);
            try { await dialog.dismiss(); } catch (e) { }
        };
        page.on('dialog', onDialog);

        // Inject beforeunload listener
        await safeEvaluate(page, () => {
            if (!window.__crawlerBlocker) {
                window.__crawlerBlocker = (e) => {
                    e.preventDefault();
                    e.returnValue = 'Blocked by Crawler';
                    return 'Blocked by Crawler';
                };
                window.addEventListener('beforeunload', window.__crawlerBlocker);
                console.log("[NavigationLock] Enabled beforeunload listener");
            }
        });
        util.Logging.info("[NavigationLock] Enabled Global Navigation Lock");
        return onDialog;
    } else {
        // Disable
        if (existingHandler) {
            page.off('dialog', existingHandler);
        }
        await safeEvaluate(page, () => {
            if (window.__crawlerBlocker) {
                window.removeEventListener('beforeunload', window.__crawlerBlocker);
                delete window.__crawlerBlocker;
                console.log("[NavigationLock] Disabled beforeunload listener");
            }
        });
        util.Logging.info("[NavigationLock] Disabled Global Navigation Lock");
        return null;
    }
};

const clickVideoSourceButtons = async (page) => {
    return page.evaluate(() => {
        const clickedSelectors = [];
        let clickCount = 0;
        let clickedMp4 = false;

        // Helper: Check if element is active (already selected)
        const isActiveElement = (el) => {
            const classList = (el.className || "").toLowerCase();
            const ariaSelected = el.getAttribute("aria-selected");
            const ariaCurrent = el.getAttribute("aria-current");
            return classList.includes("active") ||
                classList.includes("selected") ||
                classList.includes("current") ||
                ariaSelected === "true" ||
                ariaCurrent === "true";
        };

        // Helper: Check if element text contains MP4-related keywords
        const isMp4Element = (el) => {
            const text = (el.textContent || "").toLowerCase();
            const title = (el.getAttribute("title") || "").toLowerCase();
            const dataValue = (el.getAttribute("data-value") || "").toLowerCase();
            const allText = `${text} ${title} ${dataValue}`;
            return allText.includes("mp4") ||
                allText.includes("direct") ||
                allText.includes("download");
        };

        // Helper: Check if element is a stream/non-MP4 source
        const isStreamElement = (el) => {
            const text = (el.textContent || "").toLowerCase();
            const title = (el.getAttribute("title") || "").toLowerCase();
            const allText = `${text} ${title}`;
            // Stream indicators that are NOT direct MP4
            return (allText.includes("lc") ||
                allText.includes("hls") ||
                allText.includes("m3u8") ||
                allText.includes("stream")) &&
                !allText.includes("mp4");
        };

        const tryClick = (element, selector, isMp4 = false) => {
            try {
                const tagName = (element.tagName || "").toUpperCase();
                const text = (element.textContent || "").trim().substring(0, 50);
                const className = (element.className || "").substring(0, 50);
                const href = element.getAttribute ? element.getAttribute("href") : null;

                // Logging for debugging
                console.log(`[VideoSource] Checking potential button: Tag=${tagName}, Text="${text}", Class="${className}", Selector="${selector}"`);

                // Check if element is visible
                const rect = element.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) {
                    console.log("[VideoSource] Skipping invisible element");
                    return false;
                }

                const anchor = element.closest('a');

                // Extra safety: Check for common redirect attributes
                if (element.getAttribute("target") === "_blank" ||
                    (anchor && anchor.getAttribute("target") === "_blank")) {
                    console.log("[VideoSource] SKIPPING new tab link");
                    return false;
                }

                // Skip if already active
                if (isActiveElement(element)) {
                    console.log("[VideoSource] Skipping already active element");
                    // If MP4 button is already active, mark it but don't click
                    if (isMp4) {
                        clickedMp4 = true;
                    }
                    return false;
                }

                console.log(`[VideoSource] CLICKING element: ${selector}`);
                element.click();
                clickCount++;
                if (isMp4) clickedMp4 = true;
                if (!clickedSelectors.includes(selector)) {
                    clickedSelectors.push(selector);
                }
                return true;
            } catch (e) {
                console.error(`[VideoSource] Error clicking element: ${e.message}`);
                return false;
            }
        };

        // ==================== PRIORITY 1: Find and click MP4 buttons FIRST ====================
        // Look for server/source buttons with MP4 in text
        const serverButtonSelectors = [
            "#video-actions button",
            ".video-server",
            'button[id^="server"]',
            'button[id^="sv"]',
            ".bt_normal",
            ".server-list button",
            ".server-list a",
            ".list-server button",
            ".list-server a",
            "#list-server button",
            "#list-server a",
            ".server button",
            ".servers button",
            ".source-selector button",
            "[data-source]",
            "[data-server]"
        ];

        // First pass: Find and click MP4 buttons
        let foundMp4Button = false;
        serverButtonSelectors.forEach(selector => {
            if (foundMp4Button) return; // Stop if already found MP4
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (foundMp4Button) return;
                    if (isMp4Element(el)) {
                        const clicked = tryClick(el, `mp4:${selector}`, true);
                        if (clicked || isActiveElement(el)) {
                            foundMp4Button = true;
                        }
                    }
                });
            } catch (e) { }
        });

        // If we found and clicked MP4, or MP4 is already active, return early
        // This prevents clicking other buttons that might switch away from MP4
        if (clickedMp4) {
            return { clicked: clickCount, selectors: clickedSelectors, clickedMp4: true };
        }

        // ==================== PRIORITY 2: Click non-stream server buttons ====================
        // Only if we didn't find MP4, try other server buttons (excluding active ones)
        serverButtonSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // Skip stream sources, prefer unknown sources over known streams
                    if (!isStreamElement(el) && !isActiveElement(el)) {
                        tryClick(el, selector);
                    }
                });
            } catch (e) { }
        });

        // ==================== PRIORITY 3: Quality selectors ====================
        const qualitySelectors = [
            ".quality-selector button",
            ".quality-selector li",
            ".vjs-quality-selector button",
            ".vjs-menu-content .vjs-menu-item",
            ".jw-quality button",
            ".jw-settings-quality .jw-option",
            "[data-quality]",
            ".quality-menu li",
            ".quality-option",
            ".resolution-selector button",
            ".resolution-option"
        ];

        qualitySelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (!isActiveElement(el)) {
                        tryClick(el, selector);
                    }
                });
            } catch (e) { }
        });

        // ==================== PRIORITY 4: Text-based detection ====================
        const videoSourceKeywords = [
            // Quality keywords (prioritize high quality)
            "1080p", "720p", "480p", "360p", "4k", "hd", "sd", "full hd",
            "high", "medium", "low", "auto",
            // Source keywords
            "server", "source", "mirror", "link",
            "direct", "download",
            // VIP/Premium server keywords
            "vip", "vip 1", "vip 2", "vip1", "vip2",
            "sv 1", "sv 2", "sv1", "sv2",
            "server 1", "server 2", "server1", "server2",
            // Video hosting short names
            "fb", "gg", "ok", "pm", "hx", "fe",
            "dood", "mixdrop", "streamtape", "vidoza", "hydrax", "fembed",
            "googledrive", "google drive", "gdrive",
            // Language: Vietnamese
            "chất lượng", "nguồn", "máy chủ", "tải xuống",
            "xem phim", "phát", "chọn server", "đổi server"
        ];

        // Find all clickable elements
        const clickableElements = document.querySelectorAll(
            'button, a, [role="button"], [onclick], .btn, li[data-value], span[onclick]'
        );

        clickableElements.forEach(el => {
            // Skip if already active
            if (isActiveElement(el)) return;

            const text = (el.textContent || "").toLowerCase().trim();
            const title = (el.getAttribute("title") || "").toLowerCase();
            const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
            const dataValue = (el.getAttribute("data-value") || "").toLowerCase();
            const classList = (el.className || "").toLowerCase();

            const allText = `${text} ${title} ${ariaLabel} ${dataValue} ${classList}`;

            // Check if this element matches any video source keyword
            const matchesKeyword = videoSourceKeywords.some(keyword =>
                allText.includes(keyword)
            );

            if (matchesKeyword) {
                // Check if it's MP4-related
                const isMp4 = allText.includes("mp4") || allText.includes("direct");
                tryClick(el, `text:${text.substring(0, 20)}`, isMp4);
            }
        });

        // ==================== PRIORITY 5: Tab/Panel detection ====================
        const tabSelectors = [
            ".tabs:not(.active) button",
            ".tab-nav a:not(.active)",
            ".nav-tabs li:not(.active) a",
            ".tab-pane-selector button",
            '[role="tab"]:not([aria-selected="true"])',
            ".panel-selector button"
        ];

        tabSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (isActiveElement(el)) return;

                    const text = (el.textContent || "").toLowerCase();
                    const isVideoRelated = videoSourceKeywords.some(k => text.includes(k)) ||
                        text.includes("video") ||
                        text.includes("player");
                    if (isVideoRelated) {
                        const isMp4 = text.includes("mp4");
                        tryClick(el, selector, isMp4);
                    }
                });
            } catch (e) { }
        });

        // ==================== PRIORITY 6: Settings/Menu buttons ====================
        const settingsSelectors = [
            ".vjs-settings-button",
            ".jw-settings-button",
            ".ytp-settings-button",
            ".settings-button",
            '[aria-label*="settings"]',
            '[aria-label*="Settings"]',
            ".plyr__control--settings",
            ".video-settings"
        ];

        settingsSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (!isActiveElement(el)) {
                        tryClick(el, selector);
                    }
                });
            } catch (e) { }
        });

        // ==================== PRIORITY 7: Download buttons (NOT links that cause navigation) ====================
        // NOTE: Removed 'a[href*=".mp4"]' and 'a[download]' because clicking them causes navigation
        // which destroys the execution context
        const downloadSelectors = [
            ".download-btn:not(a)", // Only buttons, not links
            ".download-link:not(a)", // Only non-anchor elements
            "button[data-download]" // Only button elements with data-download
        ];

        downloadSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // Double-check it's not an anchor element
                    if (el.tagName !== "A") {
                        tryClick(el, selector, true);
                    }
                });
            } catch (e) { }
        });

        // Instead of clicking download links, extract their URLs for later use
        const downloadLinks = document.querySelectorAll('a[href*=".mp4"], a[download]');
        window.__extractedDownloadUrls = window.__extractedDownloadUrls || [];
        downloadLinks.forEach(link => {
            const href = link.getAttribute("href");
            if (href && !window.__extractedDownloadUrls.includes(href)) {
                window.__extractedDownloadUrls.push(href);
            }
        });

        return { clicked: clickCount, selectors: clickedSelectors, clickedMp4 };
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
                    const event = new MouseEvent("click", {
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
        const videoElements = document.querySelectorAll("video");
        videoElements.forEach(video => {
            try {
                // Try to directly play the video
                video.play().catch(() => { });
                clickCount++;

                // Also click the video element itself (some players use this)
                tryClick(video);
            } catch (e) {
                // Ignore errors
            }
        });

        // 2. Common play button selectors - try in priority order
        const playButtonSelectors = [
            ".play-button",
            ".vjs-big-play-button",
            ".ytp-large-play-button",
            ".ytp-play-button",
            '[aria-label="Play"]',
            '[title="Play"]',
            ".plyr__control--play",
            ".video-play",
            ".btn-play",
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
            const text = button.textContent?.toLowerCase() || "";
            const classes = button.className?.toLowerCase() || "";
            const ariaLabel = (button.getAttribute("aria-label") || "").toLowerCase();
            const title = (button.getAttribute("title") || "").toLowerCase();

            if (
                text.includes("play") ||
                classes.includes("play") ||
                ariaLabel.includes("play") ||
                title.includes("play") ||
                button.querySelector('i.fa-play, span.play-icon, svg[class*="play"]')
            ) {
                tryClick(button);
            }
        });

        // 4. Try iframes (if not blocked by same-origin policy)
        try {
            const iframes = document.querySelectorAll("iframe");
            iframes.forEach(iframe => {
                try {
                    if (iframe.contentDocument) {
                        // If we can access the iframe content, try to find play buttons there
                        const iframePlayButtons = iframe.contentDocument.querySelectorAll(
                            playButtonSelectors.join(", ")
                        );
                        iframePlayButtons.forEach(btn => tryClick(btn));

                        // Try to play videos directly
                        const videos = iframe.contentDocument.querySelectorAll("video");
                        videos.forEach(video => {
                            try { video.play().catch(() => { }); } catch (e) { }
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

            const browser = await puppeteer.use(stealthPlugin()).launch({
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
                await client.send("Runtime.enable");
                await client.send("Runtime.collectGarbage");
                await client.send("HeapProfiler.enable");
                await client.send("HeapProfiler.collectGarbage");
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
        const videoUrls = [];

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
                if (typeof customCookies === "string") {
                    // Handle cookie string format: name=value;name2=value2
                    const cookiePairs = customCookies.split(";");
                    for (const pair of cookiePairs) {
                        const [name, value] = pair.split("=");
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
                    const auth = Buffer.from(`${username}:${password}`).toString("base64");
                    await page.setExtraHTTPHeaders({
                        Authorization: `Basic ${auth}`
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
                        const value = item[1] || "";

                        if (key) {
                            window.localStorage.setItem(key, value);
                        }
                    }
                }, localStorage);
            }

            // Configure proxy and enable request interception to capture video URLs
            // Enable request interception via CDP
            const client = await page.target().createCDPSession();
            await client.send("Network.enable");

            // Set up a more thorough monitoring of requests for possible video content
            // Monitor all XHR requests for video content or playlist files
            await page.setRequestInterception(true);
            page.on("request", request => {
                // Allow the request to continue
                request.continue();

                const reqUrl = request.url();

                // Skip image URLs
                if (isImageUrl(reqUrl)) {
                    return;
                }

                // Skip stream segments (HLS .ts, DASH .m4s) - not downloadable individually
                if (isStreamSegment(reqUrl)) {
                    return;
                }

                // Enhanced video URL detection
                // Look for video file extensions in any request
                if (isVideoUrl(reqUrl) || reqUrl.includes("mime=video") || reqUrl.startsWith("blob:")) {
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
                if (reqUrl.includes(".m3u8") || reqUrl.includes(".mpd")) {
                    const playlistInfo = {
                        url: reqUrl,
                        mimeType: reqUrl.includes(".m3u8") ? "application/x-mpegURL" : "application/dash+xml",
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
            client.on("Network.responseReceived", async (event) => {
                try {
                    const { response } = event;
                    const responseUrl = response.url;

                    // Check if URL is an image - explicitly skip these
                    if (isImageUrl(responseUrl)) {
                        return;
                    }

                    // Skip stream segments (HLS .ts, DASH .m4s) - not downloadable individually
                    if (isStreamSegment(responseUrl)) {
                        return;
                    }

                    // Check content type and URL for video
                    const contentType = response.headers["content-type"] || "";
                    // Exclude video/MP2T (HLS transport stream segments)
                    const isVideoContentType = (contentType.includes("video/") && !contentType.includes("video/mp2t")) ||
                        contentType.includes("application/octet-stream");
                    const isManifestType = contentType.includes("application/x-mpegURL") ||
                        contentType.includes("application/vnd.apple.mpegURL") ||
                        contentType.includes("application/dash+xml");

                    // Strict check for video URLs
                    const isVideoExt = isVideoUrl(responseUrl);

                    // Enhanced detection for video responses
                    const isGoogleVideo = responseUrl.includes("googlevideo.com");

                    // Only add video files with correct content type or extension
                    if ((isVideoExt && !isImageUrl(responseUrl)) ||
                        isVideoContentType ||
                        isManifestType ||
                        isGoogleVideo) {
                        // Only collect the URL, not the content
                        const videoInfo = {
                            url: responseUrl,
                            mimeType: contentType || getVideoMimeType(responseUrl),
                            size: response.headers["content-length"] || 0
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
                await client.send("Network.setExtraHTTPHeaders", {
                    headers: {
                        "Proxy-Authorization": proxyAuth ?
                            `Basic ${Buffer.from(proxyAuth).toString("base64")}`
                            : ""
                    }
                });

                // Configure proxy server
                await client.send("Network.setUserAgent", {
                    userAgent: customUserAgent || await page.browser().userAgent()
                });
            }

            // Navigate to URL with appropriate waitUntil strategy
            const waitUntilStrategy = conf.BROWSER.waitUntil || "networkidle2";
            const response = await page.goto(url, {
                waitUntil: waitUntilStrategy,
                timeout: pageTimeout
            });

            // [Global Navigation Lock] Enable immediately after load
            let navigationLockHandler = null;
            try {
                util.Logging.info(`Page loaded. Request URL: ${url}, Actual URL: ${page.url()}`);
                navigationLockHandler = await toggleNavigationLock(page, true);
            } catch (e) {
                util.Logging.warn(`Failed to enable navigation lock: ${e.message}`);
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
                const videoDetectionResult = await hasVideoPlayerElements(page);
                const hasVideoPlayer = videoDetectionResult.found;
                let iframeInjectedHtml = "";
                if (hasVideoPlayer) {
                    util.Logging.info(`Detected potential video player on page. Current URL: ${page.url()}`);
                    util.Logging.info(`Video detection reason: ${videoDetectionResult.reason}`);
                    util.Logging.info("Applying special handling for video player");

                    // Add a longer delay for video content to load
                    await puppeteerDelay(3000);

                    // Try to click play buttons to trigger video loading
                    const clickedPlay = await clickVideoPlayButtons(page);

                    if (clickedPlay) {
                        util.Logging.info("Successfully interacted with video player, waiting for network requests");
                        // Wait longer for video content to load after clicking play
                        await puppeteerDelay(5000);
                    }

                    // ==================== Multi-pass video source detection ====================
                    // Try to find and click source/quality selector buttons multiple times
                    // PRIORITY: MP4 sources are preferred for direct download
                    // CONDITION: Only click if NO MP4 found in default source AND multiple sources available

                    // Helper function to safely evaluate with context destroyed handling
                    const safeEvaluate = async (evalFn, defaultValue = null) => {
                        try {
                            return await page.evaluate(evalFn);
                        } catch (err) {
                            if (err.message && (
                                err.message.includes("context was destroyed") ||
                                err.message.includes("navigation") ||
                                err.message.includes("Target closed") ||
                                err.message.includes("Session closed")
                            )) {
                                util.Logging.warn("Context destroyed during evaluation, using default value");
                                return defaultValue;
                            }
                            throw err;
                        }
                    };

                    // First, check if we already have MP4 in current video URLs (from network monitoring)
                    const hasMp4FromNetwork = videoUrls.some(v => (v.url || "").toLowerCase().includes(".mp4"));

                    // Check current video element source
                    const currentVideoSrc = await safeEvaluate(() => {
                        const video = document.querySelector("video");
                        return video ? video.src : "";
                    }, "");
                    const hasMp4InPlayer = currentVideoSrc && currentVideoSrc.toLowerCase().includes(".mp4");

                    // Check if there are multiple source buttons available
                    const sourceButtonCount = await safeEvaluate(() => {
                        const selectors = [
                            "#video-actions button",
                            ".video-server",
                            'button[id^="server"]',
                            'button[id^="sv"]',
                            ".server-list button, .server-list a",
                            ".list-server button, .list-server a",
                            "[data-source]",
                            "[data-server]"
                        ];
                        let count = 0;
                        selectors.forEach(sel => {
                            try {
                                count += document.querySelectorAll(sel).length;
                            } catch (e) { }
                        });
                        return count;
                    }, 0);

                    const shouldClickSourceButtons = !hasMp4FromNetwork && !hasMp4InPlayer && sourceButtonCount > 1;

                    util.Logging.info(`Source detection check: hasMp4FromNetwork=${hasMp4FromNetwork}, hasMp4InPlayer=${hasMp4InPlayer}, sourceButtonCount=${sourceButtonCount}, shouldClick=${shouldClickSourceButtons}`);

                    if (shouldClickSourceButtons) {
                        // [Global Lock Active] Logic proceeds safely

                        const maxSourcePasses = 3;
                        const delayBetweenPasses = 2000;
                        let previousVideoCount = videoUrls.length;
                        let mp4SourceActivated = false;
                        let contextDestroyed = false;

                        for (let pass = 0; pass < maxSourcePasses && !contextDestroyed; pass++) {
                            util.Logging.info(`Video source detection pass ${pass + 1}/${maxSourcePasses}`);

                            // Click source/quality buttons (prioritizes MP4)
                            let sourceClickResult;
                            try {
                                sourceClickResult = await clickVideoSourceButtons(page);

                                // Retrieve any download URLs extracted (from links we didn't click to avoid navigation)
                                const extractedDownloadUrls = await safeEvaluate(() => {
                                    const urls = window.__extractedDownloadUrls || [];
                                    window.__extractedDownloadUrls = []; // Clear after retrieval
                                    return urls;
                                }, []);

                                if (extractedDownloadUrls && extractedDownloadUrls.length > 0) {
                                    extractedDownloadUrls.forEach(downloadUrl => {
                                        if (downloadUrl && !videoUrls.some(v => v.url === downloadUrl)) {
                                            videoUrls.push({
                                                url: downloadUrl,
                                                mimeType: getVideoMimeType(downloadUrl),
                                                size: 0,
                                                source: "download_link"
                                            });
                                            util.Logging.info(`Found download link URL: ${downloadUrl.substring(0, 80)}...`);
                                        }
                                    });
                                }
                            } catch (err) {
                                if (err.message && (err.message.includes("context was destroyed") || err.message.includes("navigation"))) {
                                    util.Logging.warn("Navigation detected during button click, stopping source detection");
                                    contextDestroyed = true;
                                    break;
                                }
                                throw err;
                            }

                            if (sourceClickResult.clickedMp4) {
                                mp4SourceActivated = true;
                                util.Logging.info("MP4 source button clicked/active!");
                            }

                            if (sourceClickResult.clicked > 0) {
                                util.Logging.info(`Clicked ${sourceClickResult.clicked} source buttons: ${sourceClickResult.selectors.slice(0, 5).join(", ")}`);

                                // Log current video src BEFORE waiting
                                const videoSrcBefore = await safeEvaluate(() => {
                                    const video = document.querySelector("video");
                                    return video ? video.src : "no video element";
                                }, "no video element");

                                if (videoSrcBefore === null) {
                                    util.Logging.warn("Context destroyed, stopping source detection");
                                    contextDestroyed = true;
                                    break;
                                }
                                util.Logging.info(`[DEBUG] Video src BEFORE wait: ${(videoSrcBefore || "").substring(0, 100)}...`);

                                // Wait for video src to change (up to 5 seconds)
                                const waitForVideoChange = async () => {
                                    const startTime = Date.now();
                                    const maxWait = 5000;
                                    let lastSrc = videoSrcBefore;

                                    while (Date.now() - startTime < maxWait) {
                                        await puppeteerDelay(500);
                                        const currentSrc = await safeEvaluate(() => {
                                            const video = document.querySelector("video");
                                            return video ? video.src : "";
                                        }, null);

                                        // Context destroyed, stop waiting
                                        if (currentSrc === null) {
                                            return { src: null, contextDestroyed: true };
                                        }

                                        if (currentSrc && currentSrc !== lastSrc && currentSrc !== videoSrcBefore) {
                                            util.Logging.info(`[DEBUG] Video src CHANGED to: ${currentSrc.substring(0, 100)}...`);
                                            return { src: currentSrc, contextDestroyed: false };
                                        }
                                        lastSrc = currentSrc;
                                    }
                                    return { src: null, contextDestroyed: false };
                                };

                                const videoChangeResult = await waitForVideoChange();
                                if (videoChangeResult.contextDestroyed) {
                                    util.Logging.warn("Context destroyed while waiting for video change, stopping");
                                    contextDestroyed = true;
                                    break;
                                }

                                if (!videoChangeResult.src) {
                                    util.Logging.info(`[DEBUG] Video src did NOT change after ${delayBetweenPasses}ms`);
                                }

                                // Log current video src AFTER waiting
                                const videoSrcAfter = await safeEvaluate(() => {
                                    const video = document.querySelector("video");
                                    return video ? video.src : "no video element";
                                }, null);

                                if (videoSrcAfter === null) {
                                    util.Logging.warn("Context destroyed after waiting, stopping");
                                    contextDestroyed = true;
                                    break;
                                }
                                util.Logging.info(`[DEBUG] Video src AFTER wait: ${(videoSrcAfter || "").substring(0, 100)}...`);

                                // PRIORITY: Extract video from PRIMARY player element FIRST
                                const primaryVideoUrl = await safeEvaluate(() => {
                                    const playerSelectors = [
                                        ".video-player video",
                                        ".responsive-player video",
                                        ".dplayer video",
                                        "#player video",
                                        ".jwplayer video",
                                        ".vjs-tech",
                                        "video.jw-video",
                                        "video[playsinline]",
                                        "#videos video",
                                        ".player video",
                                        "video"
                                    ];

                                    for (const selector of playerSelectors) {
                                        const video = document.querySelector(selector);
                                        if (video && video.src && !video.src.startsWith("blob:")) {
                                            return video.src;
                                        }
                                    }
                                    return null;
                                }, null);

                                // If we found a primary video URL, add it with high priority flag
                                if (primaryVideoUrl) {
                                    const urlPreview = (primaryVideoUrl || "").substring(0, 80);
                                    const isMp4 = urlPreview.toLowerCase().includes(".mp4");

                                    const existingIndex = videoUrls.findIndex(v => v.url === primaryVideoUrl);
                                    if (existingIndex === -1) {
                                        videoUrls.push({
                                            url: primaryVideoUrl,
                                            mimeType: getVideoMimeType(primaryVideoUrl),
                                            size: 0,
                                            isPrimaryPlayer: true
                                        });
                                        util.Logging.info(`Pass ${pass + 1}: Found PRIMARY PLAYER ${isMp4 ? "MP4" : "video"}: ${urlPreview}...`);
                                    } else {
                                        videoUrls[existingIndex].isPrimaryPlayer = true;
                                        util.Logging.info(`Pass ${pass + 1}: Marked as PRIMARY PLAYER: ${urlPreview}...`);
                                    }
                                }

                                // Extract other DOM video URLs after each pass
                                const passVideoUrls = await extractVideoUrlsFromDOM(page);
                                if (passVideoUrls && passVideoUrls.length > 0) {
                                    passVideoUrls.forEach(videoInfo => {
                                        videoInfo.mimeType = videoInfo.mimeType || getVideoMimeType(videoInfo.url);
                                        videoInfo.size = videoInfo.size || 0;

                                        if (!videoUrls.some(v => v.url === videoInfo.url)) {
                                            videoUrls.push(videoInfo);
                                            const urlPreview = (videoInfo.url || "").substring(0, 80);
                                            const isMp4 = urlPreview.toLowerCase().includes(".mp4");
                                            util.Logging.info(`Pass ${pass + 1}: Found new ${isMp4 ? "MP4" : "video"} URL: ${urlPreview}...`);
                                        }
                                    });
                                }

                                // Stop if we have MP4 video
                                const hasMp4Video = videoUrls.some(v => (v.url || "").toLowerCase().includes(".mp4"));
                                if (hasMp4Video) {
                                    util.Logging.info("MP4 video found in DOM, stopping");
                                    break;
                                }

                                break;
                            }
                        }
                        // End of source click logic

                    } else {
                        util.Logging.info("Skipping source button clicks: MP4 already found or no alternative sources available");
                    }

                    // ==================== Iframe video detection ====================
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
                                        try { button.click(); } catch (e) { }
                                    });

                                    // Try to play videos directly
                                    const videos = iframe.contentDocument.querySelectorAll("video");
                                    videos.forEach(video => {
                                        try { video.play().catch(() => { }); } catch (e) { }
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
                        const iframeSources = await page.evaluate(() => window.__videoIframeSources || []);

                        iframeSources.forEach(source => {
                            util.Logging.info(`Video iframe source: ${source}`);
                            if (isVideoUrl(source)) {
                                const videoInfo = {
                                    url: source,
                                    mimeType: getVideoMimeType(source),
                                    size: 0,
                                    source: "iframe_src"
                                };
                                if (!videoUrls.some(v => v.url === source)) {
                                    videoUrls.push(videoInfo);
                                }
                            }
                        });

                        await puppeteerDelay(3000);

                        try {
                            const frames = page.frames();
                            for (const frame of frames) {
                                try {
                                    await frame.evaluate(() => {
                                        document.querySelectorAll('iframe').forEach(ifr => {
                                            ifr.removeAttribute('loading');
                                            ifr.setAttribute('loading', 'eager');
                                        });
                                        window.scrollTo(0, document.body.scrollHeight);
                                    });
                                } catch (e) { }
                            }

                            await puppeteerDelay(3000); 

                            const allFrames = page.frames();
                            for (let i = 1; i < allFrames.length; i++) {
                                const frame = allFrames[i];
                                const frameUrl = frame.url();
                                
                                if (frameUrl && (frameUrl.includes('embed') || frameUrl.includes('player') || frameUrl.includes('video') || frameUrl.includes('cdndlap'))) {
                                    try {
                                        await frame.waitForSelector('body', { timeout: 3000 }).catch(() => {});
                                        const frameHtml = await frame.content();
                                        
                                        if (frameHtml && frameHtml.length > 100) {
                                            iframeInjectedHtml += `\n<!-- PUPPETEER EXTRACTED IFRAME: ${frameUrl} -->\n<div class="iframe-extracted-data" data-url="${frameUrl}" style="display:none;">\n${frameHtml}\n</div>\n`;
                                        }
                                    } catch (err) {
                                        util.Logging.error(`Error extracting iframe ${frameUrl}: ${err.message}`);
                                    }
                                }
                            }
                        } catch (e) {
                            util.Logging.error(`Error processing nested frames: ${e.message}`);
                        }

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
                    const videos = document.querySelectorAll("video");
                    videos.forEach(video => {
                        try {
                            video.play().catch(() => { });
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

                // PRIORITY: Extract video from PRIMARY player element FIRST
                // This is the most reliable source - the actual video playing in the main player
                const initialPrimaryVideoUrl = await page.evaluate(() => {
                    // Look for video element in the main player container
                    const playerSelectors = [
                        ".video-player video",
                        ".responsive-player video",
                        ".dplayer video",
                        "#player video",
                        ".jwplayer video",
                        ".vjs-tech",
                        "video.jw-video",
                        "video[playsinline]",
                        "#videos video",
                        ".player video",
                        "video" // Fallback to any video
                    ];

                    for (const selector of playerSelectors) {
                        const video = document.querySelector(selector);
                        if (video && video.src && !video.src.startsWith("blob:")) {
                            return video.src;
                        }
                    }
                    return null;
                });

                // If we found a primary video URL, add it with high priority flag
                if (initialPrimaryVideoUrl) {
                    const urlPreview = (initialPrimaryVideoUrl || "").substring(0, 80);
                    const isMp4 = urlPreview.toLowerCase().includes(".mp4");

                    // Check if this URL already exists
                    const existingIndex = videoUrls.findIndex(v => v.url === initialPrimaryVideoUrl);
                    if (existingIndex === -1) {
                        // Add new entry with primary flag
                        videoUrls.push({
                            url: initialPrimaryVideoUrl,
                            mimeType: getVideoMimeType(initialPrimaryVideoUrl),
                            size: 0,
                            isPrimaryPlayer: true
                        });
                        util.Logging.info(`Initial: Found PRIMARY PLAYER ${isMp4 ? "MP4" : "video"}: ${urlPreview}...`);
                    } else {
                        // Mark existing entry as primary
                        videoUrls[existingIndex].isPrimaryPlayer = true;
                        util.Logging.info(`Initial: Marked as PRIMARY PLAYER: ${urlPreview}...`);
                    }
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

                // Log final page state before scraping
                const finalTitle = await page.title();
                util.Logging.info(`Final Page State - URL: ${page.url()}, Title: "${finalTitle}"`);

                // Get the content from the page
                const content = await page.content();

                // Set response content without using cleanHtmlContent
                if (iframeInjectedHtml && iframeInjectedHtml.length > 0) {
                    const bodyCloseTag = '</body>';
                    const idx = content.toLowerCase().lastIndexOf(bodyCloseTag);
                    if (idx !== -1) {
                        res.locals.content =
                            content.slice(0, idx) +
                            iframeInjectedHtml +
                            content.slice(idx);
                    } else {
                        res.locals.content = content + iframeInjectedHtml;
                    }
                } else {
                    res.locals.content = content;
                }
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
                const base64Data = imageData.split(",")[1];
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
            // Capture error snapshot if page is still available
            let snapshotUrl = null;
            if (page) {
                try {
                    // Ensure snapshots directory exists
                    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });

                    // Generate unique filename
                    const timestamp = Date.now();
                    const snapshotId = uuidv4().substring(0, 8);
                    const filename = `error_${timestamp}_${snapshotId}.jpg`;
                    const filepath = path.join(SNAPSHOTS_DIR, filename);

                    // Capture screenshot
                    await page.screenshot({
                        path: filepath,
                        type: "jpeg",
                        quality: 60,
                        fullPage: false
                    });

                    // Set snapshot URL for admin portal access
                    snapshotUrl = `/admin/snapshots/${filename}`;
                    util.Logging.info(`Error snapshot captured: ${snapshotUrl}`);
                } catch (snapshotErr) {
                    util.Logging.warn(`Failed to capture error snapshot: ${snapshotErr.message}`);
                }

                // Clean up page
                if (!proxyUrl) {
                    await this.browserPool.destroyPage(page);
                } else {
                    // If we created a special browser for proxy, close it completely
                    const browser = page.browser();
                    await page.close();
                    await browser.close();
                }
            }

            // Attach snapshot URL to error for URL tracker
            error.snapshotUrl = snapshotUrl;
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
            cleanup: req.query.cleanup !== "false",
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
    isStreamSegment,
    getUrlExtension,
    getVideoMimeType,
    extractVideoUrlsFromDOM
};
