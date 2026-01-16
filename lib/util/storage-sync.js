/**
 * @class StorageSync
 * @classdesc Bi-directional sync service between VideoTracker and S3 storage
 * Handles scanning S3 inventory, reconciliation, and orphan management
 */
const { Logging } = require("hive-js-util");
const { s3Storage } = require("./s3-storage");

// Default cache TTL: 5 minutes (in seconds)
const DEFAULT_CACHE_TTL_SECONDS = 300;

/**
 * Storage Sync Service for managing S3 inventory and reconciliation
 */
class StorageSync {
    constructor() {
        // Cache for S3 inventory
        this._inventory = null;
        this._lastScanTime = null;
        this._scanning = false;

        // Cache for reconciliation results
        this._reconcileCache = null;
        this._lastReconcileTime = null;
        this._reconciling = false;

        // Storage stats
        this._totalStorageSize = 0;
    }

    /**
     * Get cache TTL in milliseconds from CACHE_TTL env (in seconds)
     * @returns {number} Cache TTL in milliseconds
     */
    get CACHE_TTL() {
        const ttlSeconds = parseInt(process.env.CACHE_TTL) || DEFAULT_CACHE_TTL_SECONDS;
        return ttlSeconds * 1000;
    }

    /**
     * Get the VideoTracker instance lazily to avoid circular dependency
     * @returns {object} VideoTracker instance
     */
    _getVideoTracker() {
        // Lazy require to avoid circular dependency
        const { videoTracker } = require("./video-tracker");
        return videoTracker;
    }

    /**
     * Scan S3 storage and build inventory
     * @param {boolean} forceRefresh - Force refresh even if cache exists
     * @returns {Promise<Map>} Map of S3 key to object info
     */
    async scanStorage(forceRefresh = false) {
        if (!s3Storage.isConfigured()) {
            throw new Error("S3 is not configured");
        }

        // Return cached inventory if available and not forcing refresh
        if (!forceRefresh && this._inventory && this._lastScanTime) {
            const cacheAge = Date.now() - this._lastScanTime;
            if (cacheAge < this.CACHE_TTL) {
                Logging.debug("StorageSync: Returning cached inventory");
                return this._inventory;
            }
        }

        // Prevent concurrent scans
        if (this._scanning) {
            throw new Error("Scan already in progress");
        }

        this._scanning = true;
        const inventory = new Map();
        let continuationToken = null;
        let totalObjects = 0;
        let totalSize = 0;

        try {
            Logging.info("StorageSync: Starting S3 inventory scan...");

            do {
                const response = await s3Storage.listObjects(continuationToken);

                for (const obj of response.contents) {
                    // Get metadata for each object
                    const metadata = await s3Storage.getObjectMetadata(obj.Key);

                    inventory.set(obj.Key, {
                        key: obj.Key,
                        size: obj.Size,
                        lastModified: obj.LastModified,
                        s3Url: s3Storage.getPublicUrl(obj.Key),
                        videoUrl: metadata?.videoUrl || null,
                        sourceUrl: metadata?.sourceUrl || null,
                        uploadedAt: metadata?.uploadedAt || null
                    });
                    totalObjects++;
                    totalSize += obj.Size || 0;
                }

                continuationToken = response.nextContinuationToken;
            } while (continuationToken);

            this._inventory = inventory;
            this._lastScanTime = Date.now();
            this._totalStorageSize = totalSize;

            Logging.info(`StorageSync: Scan complete. Found ${totalObjects} objects (${this._formatBytes(totalSize)}) in S3`);
            return inventory;
        } finally {
            this._scanning = false;
        }
    }

    /**
     * Format bytes to human readable string
     * @param {number} bytes - Size in bytes
     * @returns {string} Formatted string
     */
    _formatBytes(bytes) {
        if (!bytes || bytes === 0) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB"];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
    }

    /**
     * Get cached inventory or scan if not available
     * @returns {Promise<Map>} S3 inventory
     */
    async getInventory() {
        if (!this._inventory) {
            return this.scanStorage();
        }
        return this._inventory;
    }

    /**
     * Clear all caches
     */
    clearCache() {
        this._inventory = null;
        this._lastScanTime = null;
        this._reconcileCache = null;
        this._lastReconcileTime = null;
        this._totalStorageSize = 0;
    }

    /**
     * Reconcile local tracker with S3 storage
     * Detects orphans, missing files, and out-of-sync records
     * @param {object} options - Reconciliation options
     * @param {boolean} options.forceRefresh - Force refresh: clears all cache and scans S3 fresh
     * @returns {Promise<object>} Reconciliation result
     */
    async reconcile(options = {}) {
        const { forceRefresh = false } = options;

        if (!s3Storage.isConfigured()) {
            throw new Error("S3 is not configured");
        }

        // If force refresh, clear all caches first
        if (forceRefresh) {
            Logging.info("StorageSync: Force refresh requested, clearing all caches...");
            this.clearCache();
        }

        // Return cached result if available and not forcing refresh
        if (!forceRefresh && this._reconcileCache && this._lastReconcileTime) {
            const cacheAge = Date.now() - this._lastReconcileTime;
            if (cacheAge < this.CACHE_TTL) {
                Logging.debug("StorageSync: Returning cached reconciliation result");
                return {
                    ...this._reconcileCache,
                    fromCache: true,
                    cacheAge,
                    lastUpdated: this._lastReconcileTime
                };
            }
        }

        // Prevent concurrent reconciliations
        if (this._reconciling) {
            if (this._reconcileCache) {
                return {
                    ...this._reconcileCache,
                    fromCache: true,
                    reconciling: true,
                    lastUpdated: this._lastReconcileTime
                };
            }
            throw new Error("Reconciliation already in progress");
        }

        this._reconciling = true;
        Logging.info("StorageSync: Starting full S3 scan and reconciliation...");

        try {
            const [inventory, trackedVideos] = await Promise.all([
                this.scanStorage(true), // Always scan fresh when reconciling
                this._getVideoTracker().getAll()
            ]);

            const result = {
                orphanFiles: [], // Files in S3 but not tracked
                missingInS3: [], // Tracked as synced but not in S3
                synced: [], // Properly synced
                outOfSync: [], // s3Url mismatch
                pending: [], // Not yet synced
                summary: {
                    totalInS3: inventory.size,
                    totalTracked: trackedVideos.length,
                    orphanCount: 0,
                    missingCount: 0,
                    syncedCount: 0,
                    pendingCount: 0
                }
            };

            // Build lookup maps
            const trackedByS3Url = new Map();
            const trackedByVideoUrl = new Map();

            for (const video of trackedVideos) {
                if (video.s3Url) {
                    trackedByS3Url.set(video.s3Url, video);
                }
                if (video.videoUrl) {
                    trackedByVideoUrl.set(video.videoUrl, video);
                }
            }

            // Check each S3 object
            for (const [key, s3Object] of inventory) {
                const trackedVideo = trackedByS3Url.get(s3Object.s3Url);

                if (!trackedVideo) {
                // Check if we can match by videoUrl from metadata
                    const matchByVideoUrl = s3Object.videoUrl
                        ? trackedByVideoUrl.get(s3Object.videoUrl)
                        : null;

                    if (matchByVideoUrl) {
                    // Found by videoUrl but s3Url doesn't match - out of sync
                        result.outOfSync.push({
                            s3Object,
                            trackedVideo: matchByVideoUrl,
                            issue: "s3Url mismatch"
                        });
                    } else {
                    // Orphan file - in S3 but not tracked
                        result.orphanFiles.push(s3Object);
                    }
                } else {
                // Properly synced
                    result.synced.push({
                        s3Object,
                        trackedVideo
                    });
                }
            }

            // Check each tracked video
            for (const video of trackedVideos) {
                if (video.status === "synced" && video.s3Url) {
                    const s3Key = s3Storage.extractKeyFromUrl(video.s3Url);
                    if (s3Key && !inventory.has(s3Key)) {
                    // Marked as synced but not in S3
                        result.missingInS3.push(video);
                    }
                } else if (video.status === "pending") {
                    result.pending.push(video);
                }
            }

            // Update summary with total storage size
            result.summary.orphanCount = result.orphanFiles.length;
            result.summary.missingCount = result.missingInS3.length;
            result.summary.syncedCount = result.synced.length;
            result.summary.pendingCount = result.pending.length;
            result.summary.totalStorageSize = this._totalStorageSize;
            result.summary.totalStorageSizeFormatted = this._formatBytes(this._totalStorageSize);

            // Calculate orphan size
            result.summary.orphanSize = result.orphanFiles.reduce((sum, f) => sum + (f.size || 0), 0);
            result.summary.orphanSizeFormatted = this._formatBytes(result.summary.orphanSize);

            Logging.info("StorageSync: Reconciliation complete. " +
            `Orphans: ${result.summary.orphanCount}, ` +
            `Missing: ${result.summary.missingCount}, ` +
            `Synced: ${result.summary.syncedCount}, ` +
            `Total size: ${result.summary.totalStorageSizeFormatted}`);

            // Cache the result
            this._reconcileCache = result;
            this._lastReconcileTime = Date.now();

            return {
                ...result,
                fromCache: false,
                lastUpdated: this._lastReconcileTime
            };
        } finally {
            this._reconciling = false;
        }
    }

    /**
     * Import an orphan file from S3 into the tracker
     * @param {string} s3Key - S3 key of the orphan file
     * @returns {Promise<object>} Imported video record
     */
    async importOrphan(s3Key) {
        if (!s3Storage.isConfigured()) {
            throw new Error("S3 is not configured");
        }

        // Get metadata from S3
        const metadata = await s3Storage.getObjectMetadata(s3Key);
        if (!metadata) {
            throw new Error(`Object not found: ${s3Key}`);
        }

        const videoTracker = this._getVideoTracker();
        const s3Url = s3Storage.getPublicUrl(s3Key);

        // Check if already tracked by s3Url
        const allVideos = await videoTracker.getAll();
        const existing = allVideos.find(v => v.s3Url === s3Url);
        if (existing) {
            Logging.info(`StorageSync: Object ${s3Key} already tracked as ${existing.id}`);
            return existing;
        }

        // Create new record with synced status
        const videoUrl = metadata.videoUrl || s3Url; // Use stored videoUrl or s3Url as fallback

        // Use internal method to create record directly with synced status
        const record = {
            id: require("uuid").v4(),
            sourceUrl: metadata.sourceUrl || "",
            videoUrl: videoUrl,
            s3Url: s3Url,
            mimeType: metadata.contentType || "video/mp4",
            isHLS: false,
            status: "synced",
            downloadPath: null,
            downloadSize: metadata.size,
            downloadContentType: metadata.contentType,
            downloadedAt: null,
            syncedAt: metadata.uploadedAt || new Date().toISOString(),
            error: null,
            createdAt: metadata.uploadedAt || new Date().toISOString(),
            importedFromS3: true
        };

        // Save using videoTracker's internal save
        await videoTracker._save(record);

        Logging.info(`StorageSync: Imported orphan ${s3Key} as video ${record.id}`);

        // Clear inventory cache since we modified the tracker
        this.clearCache();

        return record;
    }

    /**
     * Delete an orphan file from S3
     * @param {string} s3Key - S3 key of the orphan file
     * @returns {Promise<boolean>} True if deleted successfully
     */
    async deleteOrphan(s3Key) {
        if (!s3Storage.isConfigured()) {
            throw new Error("S3 is not configured");
        }

        await s3Storage.deleteObject(s3Key);

        Logging.info(`StorageSync: Deleted orphan file from S3: ${s3Key}`);

        // Clear inventory cache
        this.clearCache();

        return true;
    }

    /**
     * Bulk import multiple orphan files
     * @param {string[]} s3Keys - Array of S3 keys to import
     * @returns {Promise<object>} Import results
     */
    async bulkImportOrphans(s3Keys) {
        const results = {
            imported: 0,
            failed: 0,
            errors: []
        };

        for (const key of s3Keys) {
            try {
                await this.importOrphan(key);
                results.imported++;
            } catch (err) {
                results.failed++;
                results.errors.push({ key, error: err.message });
            }
        }

        Logging.info(`StorageSync: Bulk import complete. Imported: ${results.imported}, Failed: ${results.failed}`);
        return results;
    }

    /**
     * Bulk delete multiple orphan files
     * @param {string[]} s3Keys - Array of S3 keys to delete
     * @returns {Promise<object>} Delete results
     */
    async bulkDeleteOrphans(s3Keys) {
        const results = {
            deleted: 0,
            failed: 0,
            errors: []
        };

        for (const key of s3Keys) {
            try {
                await this.deleteOrphan(key);
                results.deleted++;
            } catch (err) {
                results.failed++;
                results.errors.push({ key, error: err.message });
            }
        }

        Logging.info(`StorageSync: Bulk delete complete. Deleted: ${results.deleted}, Failed: ${results.failed}`);
        return results;
    }

    /**
     * Fix missing in S3 records by resetting their status to pending
     * @param {string[]} videoIds - Array of video IDs to fix
     * @returns {Promise<object>} Fix results
     */
    async fixMissingInS3(videoIds) {
        const videoTracker = this._getVideoTracker();
        const results = {
            fixed: 0,
            failed: 0,
            errors: []
        };

        for (const id of videoIds) {
            try {
                await videoTracker.updateVideo(id, {
                    status: "pending",
                    s3Url: null,
                    syncedAt: null,
                    error: "Reset: File was missing from S3"
                });
                results.fixed++;
            } catch (err) {
                results.failed++;
                results.errors.push({ id, error: err.message });
            }
        }

        Logging.info(`StorageSync: Fixed ${results.fixed} missing-in-S3 records`);
        return results;
    }

    /**
     * Get sync status overview
     * @returns {Promise<object>} Status overview
     */
    async getStatus() {
        const configured = s3Storage.isConfigured();

        if (!configured) {
            return {
                configured: false,
                scanning: false,
                reconciling: false,
                lastScanTime: null,
                lastReconcileTime: null,
                inventorySize: 0,
                totalStorageSize: 0,
                totalStorageSizeFormatted: "0 B"
            };
        }

        const now = Date.now();
        const scanCacheAge = this._lastScanTime ? now - this._lastScanTime : null;
        const reconcileCacheAge = this._lastReconcileTime ? now - this._lastReconcileTime : null;

        return {
            configured: true,
            scanning: this._scanning,
            reconciling: this._reconciling,
            lastScanTime: this._lastScanTime,
            lastReconcileTime: this._lastReconcileTime,
            inventorySize: this._inventory?.size || 0,
            totalStorageSize: this._totalStorageSize,
            totalStorageSizeFormatted: this._formatBytes(this._totalStorageSize),
            scanCacheValid: scanCacheAge !== null && scanCacheAge < this.CACHE_TTL,
            reconcileCacheValid: reconcileCacheAge !== null && reconcileCacheAge < this.CACHE_TTL,
            scanCacheAge,
            reconcileCacheAge,
            cacheTTL: this.CACHE_TTL,
            hasCachedReconcile: !!this._reconcileCache
        };
    }

    /**
     * Get cached reconciliation result if available
     * @returns {object|null} Cached result or null
     */
    getCachedReconcile() {
        if (!this._reconcileCache || !this._lastReconcileTime) {
            return null;
        }

        const cacheAge = Date.now() - this._lastReconcileTime;
        if (cacheAge >= this.CACHE_TTL) {
            return null;
        }

        return {
            ...this._reconcileCache,
            fromCache: true,
            cacheAge,
            lastUpdated: this._lastReconcileTime
        };
    }
}

// Singleton instance
const storageSync = new StorageSync();

module.exports = {
    StorageSync,
    storageSync
};
