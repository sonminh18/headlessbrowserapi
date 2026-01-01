/**
 * @class URLTracker
 * @classdesc Tracks URL processing status in Redis
 */
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const util = require('hive-js-util');

// URL status constants
const URL_STATUS = {
    WAITING: 'waiting',
    PROCESSING: 'processing',
    DONE: 'done',
    CANCELLED: 'cancelled',
    ERROR: 'error'
};

/**
 * URL Tracker Service for tracking URL processing status
 */
class URLTracker {
    constructor() {
        this.keyPrefix = process.env.REDIS_KEY_PREFIX || 'hbapi:';
        this.urlsKey = `${this.keyPrefix}urls`;
        this.redisEnabled = process.env.REDIS_ENABLED === 'true';
        this.redisAvailable = false;
        this.redis = null;
        
        // In-memory fallback
        this.memoryStore = new Map();
        
        if (this.redisEnabled) {
            this._initRedis();
        }
    }
    
    /**
     * Initialize Redis connection
     * @private
     */
    _initRedis() {
        try {
            const redisOptions = {
                retryStrategy: (times) => {
                    const delay = Math.min(times * 100, 3000);
                    return delay;
                }
            };

            if (process.env.REDIS_PASSWORD) {
                redisOptions.password = process.env.REDIS_PASSWORD;
            }

            this.redis = new Redis(
                process.env.REDIS_URL || 'redis://localhost:6379',
                redisOptions
            );
            
            this.redis.on('connect', () => {
                this.redisAvailable = true;
                util.Logging.info('URLTracker: Connected to Redis');
            });
            
            this.redis.on('error', (err) => {
                this.redisAvailable = false;
                util.Logging.warn(`URLTracker Redis error: ${err.message}`);
            });
        } catch (err) {
            this.redisAvailable = false;
            util.Logging.warn(`URLTracker: Failed to initialize Redis: ${err.message}`);
        }
    }
    
    /**
     * Add a new URL to track
     * @param {string} url - The URL to track
     * @returns {Promise<object>} The created URL record
     */
    async addUrl(url) {
        const record = {
            id: uuidv4(),
            url,
            status: URL_STATUS.WAITING,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            error: null
        };
        
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.hset(this.urlsKey, record.id, JSON.stringify(record));
            } catch (err) {
                util.Logging.warn(`URLTracker addUrl Redis error: ${err.message}`);
                this.memoryStore.set(record.id, record);
            }
        } else {
            this.memoryStore.set(record.id, record);
        }
        
        return record;
    }
    
    /**
     * Update URL status
     * @param {string} id - URL record ID
     * @param {string} status - New status
     * @param {string} error - Error message (optional)
     * @param {object} result - Scrape result (optional)
     * @param {string} cacheKey - Cache key for retrieving cached response (optional)
     * @param {string} snapshotUrl - Snapshot URL for error debugging (optional)
     * @returns {Promise<object|null>} Updated record or null if not found
     */
    async updateStatus(id, status, error = null, result = null, cacheKey = null, snapshotUrl = null) {
        let record = await this.getById(id);
        
        if (!record) {
            return null;
        }
        
        record.status = status;
        
        if (status === URL_STATUS.PROCESSING) {
            record.startedAt = new Date().toISOString();
        } else if (status === URL_STATUS.DONE || status === URL_STATUS.ERROR || status === URL_STATUS.CANCELLED) {
            record.completedAt = new Date().toISOString();
        }
        
        if (error) {
            record.error = error;
        }
        
        // Store cache key for later retrieval
        if (cacheKey) {
            record.cacheKey = cacheKey;
        }
        
        // Store snapshot URL for error debugging
        if (snapshotUrl) {
            record.snapshotUrl = snapshotUrl;
        }
        
        // Store scrape result
        if (result) {
            record.result = {
                htmlLength: result.html ? result.html.length : 0,
                htmlPreview: result.html ? result.html.substring(0, 500) : null,
                videoUrls: result.videoUrls || [],
                cached: result.cached || false,
                title: this._extractTitle(result.html)
            };
        }
        
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.hset(this.urlsKey, id, JSON.stringify(record));
            } catch (err) {
                util.Logging.warn(`URLTracker updateStatus Redis error: ${err.message}`);
                this.memoryStore.set(id, record);
            }
        } else {
            this.memoryStore.set(id, record);
        }
        
        return record;
    }
    
    /**
     * Extract page title from HTML
     * @private
     */
    _extractTitle(html) {
        if (!html) return null;
        const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        return match ? match[1].trim() : null;
    }
    
    /**
     * Cancel a URL (only if waiting or processing)
     * @param {string} id - URL record ID
     * @returns {Promise<object|null>} Updated record or null
     */
    async cancelUrl(id) {
        const record = await this.getById(id);
        
        if (!record) {
            return null;
        }
        
        if (record.status !== URL_STATUS.WAITING && record.status !== URL_STATUS.PROCESSING) {
            return record; // Already completed
        }
        
        return this.updateStatus(id, URL_STATUS.CANCELLED);
    }
    
    /**
     * Get URL record by ID
     * @param {string} id - URL record ID
     * @returns {Promise<object|null>} URL record or null
     */
    async getById(id) {
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const data = await this.redis.hget(this.urlsKey, id);
                return data ? JSON.parse(data) : null;
            } catch (err) {
                util.Logging.warn(`URLTracker getById Redis error: ${err.message}`);
            }
        }
        
        return this.memoryStore.get(id) || null;
    }
    
    /**
     * Get all URL records
     * @param {object} options - Filter options
     * @param {string} options.status - Filter by status
     * @param {string} options.search - Search query for URL
     * @param {number} options.limit - Limit results
     * @param {number} options.offset - Offset for pagination
     * @param {boolean} options.countOnly - Return only total count
     * @returns {Promise<object[]|object>} Array of URL records or { records, total }
     */
    async getAll(options = {}) {
        let records = [];
        
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const data = await this.redis.hgetall(this.urlsKey);
                records = Object.values(data).map(item => JSON.parse(item));
            } catch (err) {
                util.Logging.warn(`URLTracker getAll Redis error: ${err.message}`);
                records = Array.from(this.memoryStore.values());
            }
        } else {
            records = Array.from(this.memoryStore.values());
        }
        
        // Sort by createdAt descending
        records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Filter by status
        if (options.status) {
            records = records.filter(r => r.status === options.status);
        }
        
        // Search filter - search in URL
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            records = records.filter(r => 
                r.url && r.url.toLowerCase().includes(searchLower)
            );
        }
        
        // Get total count before pagination
        const total = records.length;
        
        // Return only count if requested
        if (options.countOnly) {
            return { total };
        }
        
        // Pagination
        const offset = options.offset || 0;
        const limit = options.limit || records.length;
        const paginatedRecords = records.slice(offset, offset + limit);
        
        // Return with total if pagination is used
        if (options.limit !== undefined || options.offset !== undefined) {
            return { records: paginatedRecords, total };
        }
        
        return paginatedRecords;
    }
    
    /**
     * Get statistics
     * @returns {Promise<object>} Statistics object
     */
    async getStats() {
        const records = await this.getAll();
        
        const stats = {
            total: records.length,
            byStatus: {
                [URL_STATUS.WAITING]: 0,
                [URL_STATUS.PROCESSING]: 0,
                [URL_STATUS.DONE]: 0,
                [URL_STATUS.CANCELLED]: 0,
                [URL_STATUS.ERROR]: 0
            }
        };
        
        for (const record of records) {
            if (stats.byStatus[record.status] !== undefined) {
                stats.byStatus[record.status]++;
            }
        }
        
        return stats;
    }
    
    /**
     * Delete a URL record
     * @param {string} id - URL record ID
     * @returns {Promise<boolean>} Success status
     */
    async delete(id) {
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.hdel(this.urlsKey, id);
                return true;
            } catch (err) {
                util.Logging.warn(`URLTracker delete Redis error: ${err.message}`);
            }
        }
        
        return this.memoryStore.delete(id);
    }
    
    /**
     * Delete multiple URL records by IDs
     * @param {string[]} ids - Array of URL record IDs to delete
     * @returns {Promise<object>} Results with deleted count and failed IDs
     */
    async deleteMany(ids) {
        const results = { 
            deleted: 0, 
            failed: [] 
        };
        
        for (const id of ids) {
            try {
                const success = await this.delete(id);
                if (success) {
                    results.deleted++;
                } else {
                    results.failed.push(id);
                }
            } catch (err) {
                results.failed.push(id);
            }
        }
        
        util.Logging.info(`URLTracker: Bulk deleted ${results.deleted}/${ids.length} URLs`);
        return results;
    }
    
    /**
     * Clear all URL records
     * @returns {Promise<boolean>} Success status
     */
    async clearAll() {
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.del(this.urlsKey);
                return true;
            } catch (err) {
                util.Logging.warn(`URLTracker clearAll Redis error: ${err.message}`);
            }
        }
        
        this.memoryStore.clear();
        return true;
    }
}

// Singleton instance
const urlTracker = new URLTracker();

module.exports = {
    URLTracker,
    urlTracker,
    URL_STATUS
};

