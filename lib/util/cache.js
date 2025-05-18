/**
 * @class CacheManager
 * @classdesc Handles response caching for better performance using NodeCache
 */
const Redis = require('ioredis');
const NodeCache = require("node-cache");
const util = require("hive-js-util");

/**
 * Enhanced Cache Manager with Redis primary and NodeCache fallback
 */
class CacheManager {
    /**
     * Create a new CacheManager instance
     * @param {number} ttl - Default TTL in seconds
     */
    constructor(ttl = 3600) {
        this.defaultTtl = ttl;
        this.keyPrefix = process.env.REDIS_KEY_PREFIX || 'hbapi:';
        
        // Initialize memory cache (always available as fallback)
        this.memoryCache = new NodeCache({ 
            stdTTL: ttl,
            checkperiod: Math.min(ttl, 600), // Check expiration every 10 minutes or TTL (whichever is smaller)
            useClones: false // For better performance
        });
        
        // Initialize Redis if enabled
        this.redisEnabled = process.env.REDIS_ENABLED === 'true';
        this.redisAvailable = false;
        
        if (this.redisEnabled) {
            try {
                // Set up Redis connection options with password support
                const redisOptions = {
                    retryStrategy: (times) => {
                        const delay = Math.min(times * 100, 3000);
                        return delay;
                    }
                };

                // Add password if provided
                if (process.env.REDIS_PASSWORD) {
                    redisOptions.password = process.env.REDIS_PASSWORD;
                    util.Logging.info('Using Redis with password authentication');
                }

                // Initialize Redis client with URL and options
                this.redis = new Redis(
                    process.env.REDIS_URL || 'redis://localhost:6379',
                    redisOptions
                );
                
                // Set up event handlers
                this.redis.on('connect', () => {
                    this.redisAvailable = true;
                    util.Logging.info('Connected to Redis cache');
                });
                
                this.redis.on('error', (err) => {
                    this.redisAvailable = false;
                    util.Logging.warn(`Redis connection error: ${err.message}. Using memory cache fallback.`);
                });
            } catch (err) {
                this.redisAvailable = false;
                util.Logging.warn(`Failed to initialize Redis: ${err.message}. Using memory cache only.`);
            }
        } else {
            util.Logging.info('Redis cache disabled by environment. Using memory cache only.');
        }
    }

    /**
     * Generate cache key with prefix for Redis
     * @param {string} key - Original cache key
     * @returns {string} Prefixed key
     * @private
     */
    _redisKey(key) {
        return `${this.keyPrefix}${key}`;
    }

    /**
     * Get a value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any>} Cached value or null if not found
     */
    async get(key) {
        // Try Redis first if available
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const data = await this.redis.get(this._redisKey(key));
                if (data) {
                    return JSON.parse(data);
                }
            } catch (err) {
                util.Logging.debug(`Redis get error: ${err.message}. Falling back to memory cache.`);
                // Fall back to memory cache on error
            }
        }
        
        // Try memory cache
        return this.memoryCache.get(key);
    }

    /**
     * Set a value in cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<boolean>} Success status
     */
    async set(key, value, ttl = this.defaultTtl) {
        // Always set in memory cache
        this.memoryCache.set(key, value, ttl);
        
        // Try Redis if available
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const data = JSON.stringify(value);
                await this.redis.set(this._redisKey(key), data, 'EX', ttl);
                return true;
            } catch (err) {
                util.Logging.debug(`Redis set error: ${err.message}. Value stored in memory cache only.`);
                return false;
            }
        }
        
        return true;
    }

    /**
     * Delete a value from cache
     * @param {string} key - Cache key
     * @returns {Promise<boolean>} Success status
     */
    async delete(key) {
        // Delete from memory cache
        this.memoryCache.del(key);
        
        // Delete from Redis if available
        if (this.redisEnabled && this.redisAvailable) {
            try {
                await this.redis.del(this._redisKey(key));
                return true;
            } catch (err) {
                util.Logging.debug(`Redis delete error: ${err.message}`);
                return false;
            }
        }
        
        return true;
    }

    /**
     * Clear all cache or by pattern
     * @param {string} pattern - Key pattern to clear (default: all)
     * @returns {Promise<boolean>} Success status
     */
    async clear(pattern = '*') {
        // Clear memory cache (no pattern support in NodeCache, so clear all)
        this.memoryCache.flushAll();
        
        // Clear Redis if available
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const keys = await this.redis.keys(`${this.keyPrefix}${pattern}`);
                if (keys.length > 0) {
                    await this.redis.del(keys);
                }
                return true;
            } catch (err) {
                util.Logging.debug(`Redis clear error: ${err.message}`);
                return false;
            }
        }
        
        return true;
    }

    /**
     * Get cache statistics
     * @returns {Promise<object>} Cache statistics
     */
    async getStats() {
        const stats = {
            memoryCache: {
                keys: this.memoryCache.keys().length,
                hits: this.memoryCache.getStats().hits,
                misses: this.memoryCache.getStats().misses
            },
            redis: {
                available: this.redisAvailable,
                enabled: this.redisEnabled
            }
        };
        
        // Get Redis stats if available
        if (this.redisEnabled && this.redisAvailable) {
            try {
                const keyCount = await this.redis.keys(`${this.keyPrefix}*`).then(keys => keys.length);
                stats.redis.keys = keyCount;
            } catch (err) {
                util.Logging.debug(`Redis stats error: ${err.message}`);
            }
        }
        
        return stats;
    }
}

module.exports = CacheManager;
