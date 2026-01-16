const Queue = require("bull");
const { conf } = require("./config");
const { videoTracker } = require("./video-tracker");
const { downloadVideo, cleanupTempFiles } = require("./video-downloader");
const { s3Storage } = require("./s3-storage");
const { Logging } = require("hive-js-util");

// Get TTL from CACHE_TTL env (same as cache retention)
const JOB_RETENTION_SECONDS = parseInt(process.env.CACHE_TTL) || 2592000; // 30 days

// Create queue
// Create queue
// Support both REDIS_URL (used in Docker) and component overrides
const queueOptions = {
    settings: {
        // Job completion cleanup
        removeOnComplete: {
            age: JOB_RETENTION_SECONDS, // Keep completed jobs for TTL duration
            count: 1000 // Keep max 1000 completed jobs
        },
        removeOnFail: {
            age: JOB_RETENTION_SECONDS,
            count: 1000
        }
    }
};

let videoDownloadQueue;

// Always include password in redis options if provided
const finalQueueOptions = {
    ...queueOptions,
    redis: {
        password: process.env.REDIS_PASSWORD || undefined
    }
};

if (process.env.REDIS_URL) {
    Logging.info(`Initializing Video Download Queue with Redis URL: ${process.env.REDIS_URL}`);
    videoDownloadQueue = new Queue("video-downloads", process.env.REDIS_URL, finalQueueOptions);
} else {
    Logging.info("Initializing Video Download Queue with Redis Host/Port");
    videoDownloadQueue = new Queue("video-downloads", {
        ...finalQueueOptions,
        redis: {
            ...finalQueueOptions.redis,
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT) || 6379,
            db: parseInt(process.env.REDIS_DB) || 0
        }
    });
}

// Process download jobs with retry logic
const concurrency = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 2;
videoDownloadQueue.process(concurrency, async (job) => {
    const { videoId, sourceIndex = 0, attempt = 1 } = job.data;
    const MAX_ATTEMPTS_PER_SOURCE = 3; // 1 initial + 1 retry

    // Get video record
    const record = await videoTracker.getById(videoId);
    if (!record || !record.videoSources) {
        throw new Error("Video not found or no sources");
    }

    // Check if we've exhausted all sources
    if (sourceIndex >= record.videoSources.length) {
        await videoTracker.updateVideo(videoId, {
            status: "error",
            error: "All video sources failed to download"
        });
        return { success: false, allSourcesFailed: true };
    }

    const source = record.videoSources[sourceIndex];
    Logging.info(`Download job: video ${videoId}, source ${sourceIndex + 1}/${record.videoSources.length}, attempt ${attempt}/${MAX_ATTEMPTS_PER_SOURCE}`);

    const tempFilesToCleanup = [];

    try {
        // Download video
        const downloadResult = await downloadVideo({
            url: source.url,
            isHLS: source.isHLS,
            mimeType: source.mimeType
        }, {
            timeout: 300000,
            referer: record.sourceUrl
        });

        if (downloadResult.tempFiles) {
            tempFilesToCleanup.push(...downloadResult.tempFiles);
        }

        // Upload to S3 (use primaryVideoUrl for deterministic S3 key)
        const primaryUrl = record.primaryVideoUrl || record.videoSources[0].url;
        const s3Key = s3Storage.generateKey(primaryUrl, "mp4");
        const s3Url = await s3Storage.uploadFromFile(
            downloadResult.filePath,
            s3Key,
            downloadResult.contentType,
            {
                videoUrl: source.url,
                sourceUrl: record.sourceUrl,
                sourceIndex
            }
        );

        Logging.info(`Video ${videoId} uploaded to S3: ${s3Url}`);

        // Add download file to cleanup
        tempFilesToCleanup.push(downloadResult.filePath);

        // Update record - keep only successful video URL
        await videoTracker.updateVideo(videoId, {
            status: "synced",
            videoUrl: source.url, // The successful URL
            s3Url,
            downloadedSourceIndex: sourceIndex,
            videoSources: null, // Clear sources array
            failedAttempts: null, // Clear failed attempts
            syncedAt: new Date().toISOString(),
            error: null
        });

        return {
            success: true,
            sourceIndex,
            s3Url,
            attempt
        };
    } catch (err) {
        Logging.error(`Download failed for video ${videoId}, source ${sourceIndex + 1}, attempt ${attempt}: ${err.message}`);

        // Record failed attempt
        const failedAttempts = record.failedAttempts || [];
        failedAttempts.push({
            sourceIndex,
            attempt,
            url: source.url,
            error: err.message,
            timestamp: new Date().toISOString()
        });

        await videoTracker.updateVideo(videoId, { failedAttempts });

        // Retry logic: 1 retry per source
        if (attempt < MAX_ATTEMPTS_PER_SOURCE) {
            // Retry same source
            Logging.info(`Retrying source ${sourceIndex + 1} (attempt ${attempt + 1}/${MAX_ATTEMPTS_PER_SOURCE})`);
            await videoDownloadQueue.add({
                videoId,
                sourceIndex,
                attempt: attempt + 1
            }, {
                delay: 3000 // 3s delay before retry
            });

            return {
                success: false,
                sourceIndex,
                attempt,
                willRetry: true,
                error: err.message
            };
        } else {
            // Move to next source (reset attempt counter)
            Logging.info(`Source ${sourceIndex + 1} exhausted, moving to source ${sourceIndex + 2}`);
            await videoDownloadQueue.add({
                videoId,
                sourceIndex: sourceIndex + 1,
                attempt: 1 // Reset attempt for new source
            }, {
                delay: 2000 // 2s delay before next source
            });

            return {
                success: false,
                sourceIndex,
                attempt,
                nextSource: sourceIndex + 1,
                error: err.message
            };
        }
    } finally {
        // Always cleanup temp files
        await cleanupTempFiles(tempFilesToCleanup);
    }
});

// Queue event listeners
videoDownloadQueue.on("completed", (job, result) => {
    Logging.info(`Download job ${job.id} completed for video ${job.data.videoId}:`, result);
});

videoDownloadQueue.on("failed", (job, err) => {
    Logging.error(`Download job ${job.id} failed for video ${job.data.videoId}:`, err.message);
});

videoDownloadQueue.on("error", (error) => {
    Logging.error("Video download queue error:", error);
});

module.exports = { videoDownloadQueue };
