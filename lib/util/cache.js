/**
 * @class CacheManager
 * @classdesc Handles response caching for better performance using NodeCache
 */
const NodeCache = require("node-cache");
const util = require("hive-js-util");

class CacheManager {
    /**
     * Creates a new cache manager instance
     * @param {number} ttl - Time to live in seconds, default 3600 (1 hour)
     * @param {number} maxSize - Maximum cache size in items, default 1000
     */
    constructor(ttl = 3600, maxSize = 1000) {
        this.cache = new NodeCache({
            stdTTL: ttl,
            checkperiod: 120, // Check for expired keys every 2 minutes
            maxKeys: maxSize,
            useClones: false // Don't clone objects for better performance
        });

        // Log cache statistics periodically
        this.statsInterval = setInterval(() => {
            const stats = this.cache.getStats();
            util.Logging.debug(`Cache stats: ${stats.keys} keys, ${stats.hits} hits, ${stats.misses} misses`);
        }, 300000); // Every 5 minutes
    }

    /**
     * Get an item from the cache
     * @param {string} key - Cache key
     * @returns {Promise<string|null>} Cached content or null if not found/expired
     */
    async get(key) {
        return this.cache.get(key) || null;
    }

    /**
     * Set an item in the cache
     * @param {string} key - Cache key
     * @param {string} content - Content to cache
     * @returns {Promise<void>}
     */
    async set(key, content) {
        this.cache.set(key, content);
    }

    /**
     * Clear the cache and stop intervals
     */
    destroy() {
        clearInterval(this.statsInterval);
        this.cache.flushAll();
        this.cache.close();
    }
}

module.exports = CacheManager;
