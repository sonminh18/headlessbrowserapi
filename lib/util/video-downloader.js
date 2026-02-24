const https = require("https");
const http = require("http");
const { createWriteStream } = require("fs");
const { unlink, stat } = require("fs/promises");
const { tmpdir } = require("os");
const path = require("path");
const { v4: uuid } = require("uuid");
const { spawn } = require("child_process");
const { conf } = require("./config");
const { Logging } = require("hive-js-util");

// Semaphore for limiting concurrent downloads
let activeDownloads = 0;
const downloadQueue = [];

/**
 * Acquire semaphore for video download
 * Ensures we don't exceed max concurrent downloads
 * @returns {Promise<void>}
 */
async function acquireDownloadSlot() {
    const maxConcurrent = conf.UPLOAD?.maxConcurrentDownloads || 2;

    if (activeDownloads < maxConcurrent) {
        activeDownloads++;
        return;
    }

    // Wait for a slot to become available
    return new Promise((resolve) => {
        downloadQueue.push(resolve);
    });
}

/**
 * Release semaphore slot after download completes
 */
function releaseDownloadSlot() {
    activeDownloads--;
    if (downloadQueue.length > 0) {
        activeDownloads++;
        const next = downloadQueue.shift();
        next();
    }
}

/**
 * Validate video URL before downloading
 * Implements SSRF protection by blocking local/private IPs
 * @param {string} url - URL to validate
 * @returns {URL} Parsed URL object
 * @throws {Error} If URL is invalid or blocked
 */
function validateVideoUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid video URL: ${url}`);
    }

    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(`Invalid protocol: ${parsed.protocol}`);
    }

    // Block local/private IPs (SSRF protection)
    const hostname = parsed.hostname.toLowerCase();
    const blockedPatterns = [
        /^localhost$/,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^0\./,
        /^169\.254\./,
        /^\[::1\]$/,
        /^\[fe80:/i
    ];

    for (const pattern of blockedPatterns) {
        if (pattern.test(hostname)) {
            throw new Error(`Blocked hostname: ${hostname}`);
        }
    }

    return parsed;
}

/**
 * Download direct video (MP4, WebM, etc.) to file using streaming
 * @param {string} url - Video URL to download
 * @param {string} outputPath - Path to save the video
 * @param {number} maxSizeMB - Maximum allowed file size in MB
 * @returns {Promise<Object>} Download result with filePath, contentType, size
 */
async function downloadDirectVideo(url, outputPath, maxSizeMB) {
    validateVideoUrl(url);

    const maxBytes = (maxSizeMB || conf.UPLOAD?.maxSizeMB || 500) * 1024 * 1024;
    const timeout = conf.UPLOAD?.timeout || 300000;

    return new Promise((resolve, reject) => {
        const protocol = url.startsWith("https") ? https : http;

        const request = protocol.get(
            url,
            {
                timeout,
                headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; VideoDownloader/1.0)"
                }
            },
            (response) => {
                // Handle redirects
                if (
                    response.statusCode >= 300 &&
                    response.statusCode < 400 &&
                    response.headers.location
                ) {
                    downloadDirectVideo(response.headers.location, outputPath, maxSizeMB)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: Failed to download video`));
                    return;
                }

                // Check Content-Length if available
                const contentLength = parseInt(response.headers["content-length"], 10);
                if (contentLength && contentLength > maxBytes) {
                    const sizeMB = Math.round(contentLength / 1024 / 1024);
                    reject(
                        new Error(
                            `Video too large: ${sizeMB}MB exceeds ${maxSizeMB || conf.UPLOAD?.maxSizeMB}MB limit`
                        )
                    );
                    request.destroy();
                    return;
                }

                const contentType = response.headers["content-type"] || "video/mp4";
                const fileStream = createWriteStream(outputPath);
                let downloadedBytes = 0;

                response.on("data", (chunk) => {
                    downloadedBytes += chunk.length;
                    if (downloadedBytes > maxBytes) {
                        reject(
                            new Error(
                                `Video too large: exceeds ${maxSizeMB || conf.UPLOAD?.maxSizeMB}MB limit`
                            )
                        );
                        request.destroy();
                        fileStream.destroy();
                    }
                });

                response.pipe(fileStream);

                fileStream.on("finish", () => {
                    fileStream.close();
                    resolve({
                        filePath: outputPath,
                        contentType,
                        size: downloadedBytes
                    });
                });

                fileStream.on("error", reject);
            }
        );

        request.on("error", reject);
        request.on("timeout", () => {
            request.destroy();
            reject(new Error("Download timeout"));
        });
    });
}

/**
 * Extract referer from URL (use origin as referer)
 * @param {string} url - Video URL
 * @returns {string} Referer URL
 */
function getRefererFromUrl(url) {
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}/`;
    } catch {
        return "";
    }
}

/**
 * Download HLS stream using yt-dlp (preferred method)
 * yt-dlp handles complex HLS streams, encrypted content, and various edge cases better than FFmpeg
 * @param {string} m3u8Url - HLS playlist URL
 * @param {string} outputPath - Path to save the video
 * @param {number} timeoutMs - Download timeout in milliseconds
 * @param {Object} options - Additional options
 * @param {string} options.referer - Custom referer header
 * @param {string} options.userAgent - Custom user agent
 * @returns {Promise<Object>} Download result with filePath, contentType
 */
async function downloadHLSWithYtDlp(m3u8Url, outputPath, timeoutMs, options = {}) {
    validateVideoUrl(m3u8Url);

    const timeout = timeoutMs || parseInt(process.env.UPLOAD_TIMEOUT) || 300000;
    const referer = options.referer || getRefererFromUrl(m3u8Url);
    const userAgent = options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    await acquireDownloadSlot();

    return new Promise((resolve, reject) => {
        let completed = false;

        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                if (ytdlpProcess) {
                    ytdlpProcess.kill("SIGKILL");
                }
                releaseDownloadSlot();
                reject(new Error(`yt-dlp download timeout after ${timeout}ms`));
            }
        }, timeout);

        // Speed & downloader configuration from env
        const concurrentFragments = conf.YTDLP?.concurrentFragments || 4;
        const downloader = conf.YTDLP?.downloader || "aria2c";
        const aria2cConnections = conf.YTDLP?.aria2cConnections || 16;

        // yt-dlp arguments
        const args = [
            "--no-warnings",
            "--no-playlist",
            "--format", "best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "--output", outputPath,
            "--referer", referer,
            "--user-agent", userAgent,
            "--no-check-certificates",
            "--legacy-server-connect",
            "--concurrent-fragments", String(concurrentFragments),
            "--exec",
            'sh -c \'ffmpeg -y -i "$1" -c copy -movflags +faststart "${1%.mp4}.tmp.mp4" < /dev/null && mv "${1%.mp4}.tmp.mp4" "$1"\' _ {}',
        ];
          

        // External downloader selection
        if (downloader === "aria2c") {
            // aria2c: fastest option with multi-connection parallel downloads
            // -x: max connections per server, -s: split into N parts, -k: min split size
            args.push(
                "--downloader", "aria2c",
                "--downloader-args", `aria2c:-x ${aria2cConnections} -s ${aria2cConnections} -k 1M --min-split-size=1M`
            );
        } else if (downloader === "ffmpeg") {
            // ffmpeg: better reconnect for flaky CDNs, but single-threaded
            args.push("--downloader", "ffmpeg");
        }
        // else "native": use yt-dlp's built-in downloader with --concurrent-fragments

        args.push(
            // Retry options - aggressive retry for flaky CDNs
            "--retries", "10",
            "--fragment-retries", "10",
            "--file-access-retries", "5",
            "--extractor-retries", "5",
            // HTTP resilience
            "--socket-timeout", "30",
            // Continue partial downloads
            "--no-part",
            // Progress
            "--newline",
            // The URL
            m3u8Url
        );

        Logging.info(`yt-dlp starting: ${m3u8Url}`);
        const ytdlpProcess = spawn("yt-dlp", args);

        let stderr = "";

        ytdlpProcess.stdout.on("data", (data) => {
            const line = data.toString().trim();
            if (line.includes("[download]") && line.includes("%")) {
                Logging.debug(`yt-dlp: ${line}`);
            }
        });

        ytdlpProcess.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        ytdlpProcess.on("close", (code) => {
            if (!completed) {
                completed = true;
                clearTimeout(timeoutId);
                releaseDownloadSlot();

                if (code === 0) {
                    Logging.info(`yt-dlp download completed: ${outputPath}`);
                    resolve({
                        filePath: outputPath,
                        contentType: "video/mp4"
                    });
                } else {
                    reject(new Error(`yt-dlp failed with code ${code}: ${stderr.slice(-500)}`));
                }
            }
        });

        ytdlpProcess.on("error", (err) => {
            if (!completed) {
                completed = true;
                clearTimeout(timeoutId);
                releaseDownloadSlot();
                reject(new Error(`yt-dlp error: ${err.message}`));
            }
        });
    });
}

/**
 * Download HLS stream using ffmpeg with reconnect options (fallback method)
 * ffmpeg handles connection drops better than yt-dlp for some CDNs thanks to
 * built-in HTTP reconnect_streamed and reconnect_delay_max options.
 * @param {string} m3u8Url - HLS playlist URL
 * @param {string} outputPath - Path to save the video
 * @param {number} timeoutMs - Download timeout in milliseconds
 * @param {Object} options - Additional options
 * @param {string} options.referer - Custom referer header
 * @param {string} options.userAgent - Custom user agent
 * @returns {Promise<Object>} Download result with filePath, contentType
 */
async function downloadHLSWithFFmpeg(m3u8Url, outputPath, timeoutMs, options = {}) {
    validateVideoUrl(m3u8Url);

    const timeout = timeoutMs || parseInt(process.env.UPLOAD_TIMEOUT) || 300000;
    const referer = options.referer || getRefererFromUrl(m3u8Url);
    const userAgent = options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    await acquireDownloadSlot();

    return new Promise((resolve, reject) => {
        let completed = false;

        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                if (ffmpegProcess) {
                    ffmpegProcess.kill("SIGKILL");
                }
                releaseDownloadSlot();
                reject(new Error(`ffmpeg HLS download timeout after ${timeout}ms`));
            }
        }, timeout);

        // ffmpeg arguments with HTTP reconnect options for resilience
        // CRITICAL: reconnect options and format options MUST come BEFORE the -i input
        const args = [
            // HTTP reconnect options (before -i) - handles CDN connection drops
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            // HTTP headers
            "-headers", `Referer: ${referer}\r\nUser-Agent: ${userAgent}\r\n`,
            // Explicitly allow all protocols needed for HLS over HTTPS
            "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
            // Force HLS demuxer explicitly to ensure allowed_extensions is applied
            "-f", "hls",
            // Allow non-standard segment extensions (some CDNs use .jpg, .png, .gif as obfuscation)
            "-allowed_extensions", "ALL",
            // Input
            "-i", m3u8Url,
            // Copy streams without re-encoding (fast, lossless)
            "-c", "copy",
            // MP4 output
            "-f", "mp4",
            "-movflags", "+faststart",
            // Overwrite output
            "-y",
            // Log level
            "-loglevel", "warning",
            "-stats",
            // Output file
            outputPath
        ];

        Logging.info(`ffmpeg HLS starting: ${m3u8Url}`);
        const ffmpegProcess = spawn("ffmpeg", args);

        let stderr = "";
        let lastProgress = "";

        ffmpegProcess.stderr.on("data", (data) => {
            const line = data.toString().trim();
            stderr += line + "\n";
            // Capture progress lines (time=XX:XX:XX)
            if (line.includes("time=")) {
                lastProgress = line;
                Logging.debug(`ffmpeg: ${line}`);
            }
        });

        ffmpegProcess.on("close", (code) => {
            if (!completed) {
                completed = true;
                clearTimeout(timeoutId);
                releaseDownloadSlot();

                if (code === 0) {
                    Logging.info(`ffmpeg HLS download completed: ${outputPath}`);
                    resolve({
                        filePath: outputPath,
                        contentType: "video/mp4"
                    });
                } else {
                    reject(new Error(`ffmpeg failed with code ${code}: ${stderr.slice(-500)}`));
                }
            }
        });

        ffmpegProcess.on("error", (err) => {
            if (!completed) {
                completed = true;
                clearTimeout(timeoutId);
                releaseDownloadSlot();
                reject(new Error(`ffmpeg error: ${err.message}`));
            }
        });
    });
}

/**
 * Download HLS stream to MP4 with fallback chain: yt-dlp -> ffmpeg
 * yt-dlp is tried first (better format selection, subtitle support).
 * If yt-dlp fails (connection drops, CDN blocks), ffmpeg is used as fallback
 * with HTTP reconnect options that handle flaky CDNs more gracefully.
 * @param {string} m3u8Url - HLS playlist URL
 * @param {string} outputPath - Path to save the converted video
 * @param {number} timeoutMs - Conversion timeout in milliseconds
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Download result with filePath, contentType
 */
async function downloadHLSVideo(m3u8Url, outputPath, timeoutMs, options = {}) {
    // Strategy 1: Try yt-dlp first (better format selection)
    try {
        Logging.info(`[HLS] Attempt 1/2: yt-dlp for ${m3u8Url}`);
        return await downloadHLSWithYtDlp(m3u8Url, outputPath, timeoutMs, options);
    } catch (ytdlpError) {
        Logging.warn(`[HLS] yt-dlp failed: ${ytdlpError.message}`);

        // Clean up any partial file from yt-dlp before ffmpeg attempt
        try { await unlink(outputPath); } catch { /* ignore */ }

        // Strategy 2: Fallback to ffmpeg with reconnect options
        try {
            Logging.info(`[HLS] Attempt 2/2: ffmpeg (with reconnect) for ${m3u8Url}`);
            return await downloadHLSWithFFmpeg(m3u8Url, outputPath, timeoutMs, options);
        } catch (ffmpegError) {
            Logging.error(`[HLS] Both yt-dlp and ffmpeg failed for ${m3u8Url}`);
            // Throw combined error with both failure reasons
            throw new Error(
                `HLS download failed with all methods. ` +
                `yt-dlp: ${ytdlpError.message.substring(0, 200)}. ` +
                `ffmpeg: ${ffmpegError.message.substring(0, 200)}`
            );
        }
    }
}

/**
 * Validate that a file is actually a valid video file
 * Uses ffprobe to check for valid video streams with reasonable dimensions
 * @param {string} filePath - Path to the video file
 * @returns {Promise<boolean>} True if file is a valid video
 */
async function validateVideoFile(filePath) {
    return new Promise((resolve) => {
        const ffprobeProcess = spawn("ffprobe", [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,codec_name",
            "-of", "json",
            filePath
        ]);

        let stdout = "";
        let stderr = "";

        ffprobeProcess.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        ffprobeProcess.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        ffprobeProcess.on("close", (code) => {
            if (code !== 0) {
                Logging.warn(`Video validation failed: ffprobe exited with code ${code}`);
                resolve(false);
                return;
            }

            try {
                const result = JSON.parse(stdout);
                const stream = result.streams && result.streams[0];

                if (!stream) {
                    Logging.warn("Video validation failed: No video streams found");
                    resolve(false);
                    return;
                }

                // Check for valid dimensions (not 1x1 or 0x0)
                const width = stream.width || 0;
                const height = stream.height || 0;

                if (width < 10 || height < 10) {
                    Logging.warn(`Video validation failed: Invalid dimensions ${width}x${height}`);
                    resolve(false);
                    return;
                }

                // Check codec is not an image format
                const codec = stream.codec_name || "";
                const imageCodecs = ["png", "mjpeg", "jpeg", "gif", "bmp", "webp"];

                if (imageCodecs.includes(codec.toLowerCase())) {
                    Logging.warn(`Video validation failed: File contains image codec (${codec}), not video`);
                    resolve(false);
                    return;
                }

                Logging.debug(`Video validation passed: ${width}x${height}, codec: ${codec}`);
                resolve(true);
            } catch (e) {
                Logging.warn(`Video validation failed: ${e.message}`);
                resolve(false);
            }
        });

        ffprobeProcess.on("error", (err) => {
            Logging.warn(`Video validation error: ${err.message}`);
            resolve(false);
        });
    });
}

/**
 * Get file extension from URL or content type
 * @param {string} url - Video URL
 * @param {string} contentType - MIME type
 * @returns {string} File extension
 */
function getExtension(url, contentType) {
    // Try to get from URL
    const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (urlMatch) {
        const ext = urlMatch[1].toLowerCase();
        if (["mp4", "webm", "mov", "avi", "mkv", "m4v"].includes(ext)) {
            return ext;
        }
    }

    // Fall back to content type
    const mimeMap = {
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/quicktime": "mov",
        "video/x-msvideo": "avi",
        "video/x-matroska": "mkv"
    };

    return mimeMap[contentType] || "mp4";
}

/**
 * Generate temp file path
 * @param {string} extension - File extension
 * @returns {string} Temporary file path
 */
function getTempFilePath(extension = "mp4") {
    return path.join(tmpdir(), `video-${uuid()}.${extension}`);
}

/**
 * Cleanup temp files safely
 * @param {string[]} files - Array of file paths to delete
 */
async function cleanupTempFiles(files) {
    for (const file of files) {
        try {
            await unlink(file);
            Logging.debug(`Cleaned up temp file: ${file}`);
        } catch {
            // Ignore errors - file might not exist
            Logging.debug(`Failed to cleanup temp file: ${file}`);
        }
    }
}

/**
 * Apply text watermark to video using ffmpeg drawtext filter.
 * Reads watermark settings from conf.WATERMARK (env vars).
 * Skips silently if watermark is disabled or text is empty.
 * @param {string} inputPath - Path to the input video file
 * @returns {Promise<string|null>} Path to watermarked file, or null if skipped
 */
async function applyWatermark(inputPath) {
    const watermark = conf.WATERMARK;

    if (!watermark?.enabled || !watermark.text) {
        return null;
    }

    const outputPath = getTempFilePath("mp4");
    const fontsize = watermark.fontsize || 24;
    const opacity = Math.max(0, Math.min(1, watermark.opacity || 0.5));
    const position = watermark.position || "bottom-right";

    // Calculate x,y based on position (with 20px padding)
    const pad = 20;
    const positionMap = {
        "top-left":      { x: `${pad}`,          y: `${pad}` },
        "top-right":     { x: `w-tw-${pad}`,     y: `${pad}` },
        "bottom-left":   { x: `${pad}`,          y: `h-th-${pad}` },
        "bottom-right":  { x: `w-tw-${pad}`,     y: `h-th-${pad}` },
        "center":        { x: "(w-tw)/2",        y: "(h-th)/2" }
    };
    const pos = positionMap[position] || positionMap["bottom-right"];

    // Escape special characters for ffmpeg drawtext filter
    // ffmpeg drawtext requires escaping: ' \ : %
    const escapedText = watermark.text
        .replace(/\\/g, "\\\\\\\\")
        .replace(/'/g, "\u2019")       // Replace apostrophe with unicode right single quote
        .replace(/:/g, "\\:")
        .replace(/%/g, "%%");

    // drawtext filter with shadow for readability on any background
    const drawtext = [
        `text='${escapedText}'`,
        `fontfile=/usr/share/fonts/truetype/freefont/FreeSansBold.ttf`,
        `fontsize=${fontsize}`,
        `fontcolor=white@${opacity}`,
        `shadowcolor=black@${opacity}`,
        `shadowx=2`,
        `shadowy=2`,
        `x=${pos.x}`,
        `y=${pos.y}`
    ].join(":");

    const args = [
        "-i", inputPath,
        "-vf", `drawtext=${drawtext}`,
        // Re-encode video with drawtext, copy audio
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "copy",
        "-movflags", "+faststart",
        "-y",
        outputPath
    ];

    return new Promise((resolve, reject) => {
        Logging.info(`[Watermark] Applying "${watermark.text}" to video`);

        const ffmpegProcess = spawn("ffmpeg", args);
        let stderr = "";

        ffmpegProcess.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        ffmpegProcess.on("close", (code) => {
            if (code === 0) {
                Logging.info(`[Watermark] Applied successfully: ${outputPath}`);
                resolve(outputPath);
            } else {
                Logging.warn(`[Watermark] Failed (code ${code}), using original video. Error: ${stderr.slice(-300)}`);
                // Non-fatal: return null so caller uses the original video
                resolve(null);
            }
        });

        ffmpegProcess.on("error", (err) => {
            Logging.warn(`[Watermark] Process error: ${err.message}, using original video`);
            resolve(null);
        });
    });
}

/**
 * Main function to download video (handles both direct and HLS)
 * @param {Object} videoInfo - Video information object
 * @param {string} videoInfo.url - Video URL
 * @param {boolean} videoInfo.isHLS - Whether the video is HLS stream
 * @param {string} videoInfo.mimeType - MIME type of the video
 * @param {Object} options - Download options
 * @param {number} options.maxSizeMB - Maximum allowed file size
 * @param {number} options.timeout - Download timeout
 * @returns {Promise<Object>} Download result with filePath, contentType, size, tempFiles
 */
async function downloadVideo(videoInfo, options = {}) {
    const { url, isHLS } = videoInfo;
    const maxSizeMB = options.maxSizeMB || conf.UPLOAD?.maxSizeMB || 500;
    const timeout = options.timeout || conf.UPLOAD?.timeout || 300000;

    const tempFiles = [];

    try {
        let result;

        if (isHLS) {
            const outputPath = getTempFilePath("mp4");
            tempFiles.push(outputPath);
            result = await downloadHLSVideo(url, outputPath, timeout, {
                referer: options.referer,
                userAgent: options.userAgent
            });
        } else {
            const extension = getExtension(url, videoInfo.mimeType);
            const outputPath = getTempFilePath(extension);
            tempFiles.push(outputPath);
            result = await downloadDirectVideo(url, outputPath, maxSizeMB);
        }

        // Check final file size
        const fileStats = await stat(result.filePath);
        const maxBytes = maxSizeMB * 1024 * 1024;

        if (fileStats.size > maxBytes) {
            const sizeMB = Math.round(fileStats.size / 1024 / 1024);
            throw new Error(`Video too large: ${sizeMB}MB exceeds ${maxSizeMB}MB limit`);
        }

        // Validate that the file is actually a video (not a broken/fake file)
        const isValid = await validateVideoFile(result.filePath);
        if (!isValid) {
            throw new Error("Downloaded file is not a valid video (possibly obfuscated/protected content)");
        }

        // Apply watermark if enabled
        const watermarkedPath = await applyWatermark(result.filePath);
        if (watermarkedPath) {
            tempFiles.push(watermarkedPath);
            // Replace original with watermarked version
            result.filePath = watermarkedPath;
            const watermarkedStats = await stat(watermarkedPath);
            return {
                ...result,
                size: watermarkedStats.size,
                tempFiles
            };
        }

        return {
            ...result,
            size: fileStats.size,
            tempFiles // Return for cleanup by caller
        };
    } catch (error) {
        // Cleanup on error
        await cleanupTempFiles(tempFiles);
        throw error;
    }
}

module.exports = {
    downloadVideo,
    downloadDirectVideo,
    downloadHLSVideo,
    downloadHLSWithYtDlp,
    downloadHLSWithFFmpeg,
    applyWatermark,
    cleanupTempFiles,
    getTempFilePath,
    validateVideoUrl,
    getExtension
};
