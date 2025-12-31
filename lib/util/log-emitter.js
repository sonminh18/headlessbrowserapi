/**
 * Log Emitter - Centralized log broadcaster for SSE streaming
 * Provides real-time log streaming to Admin Portal
 */
const EventEmitter = require('events');

class LogEmitter extends EventEmitter {
    constructor() {
        super();
        this._clients = new Set();
        this._buffer = []; // Keep last 100 logs for new clients
        this._maxBuffer = 100;
    }
    
    /**
     * Add a client response object for SSE streaming
     * @param {Response} res - Express response object
     */
    addClient(res) {
        // Send buffered logs to new client
        this._buffer.forEach(log => {
            res.write(`data: ${JSON.stringify(log)}\n\n`);
        });
        
        this._clients.add(res);
        res.on('close', () => this._clients.delete(res));
    }
    
    /**
     * Remove a client from the broadcast list
     * @param {Response} res - Express response object
     */
    removeClient(res) {
        this._clients.delete(res);
    }
    
    /**
     * Broadcast a log message to all connected clients
     * @param {string} level - Log level (info, warn, error, debug)
     * @param {string} message - Log message
     * @param {object} data - Additional data to include
     */
    broadcast(level, message, data = {}) {
        const log = {
            level,
            message,
            data,
            timestamp: new Date().toISOString()
        };
        
        // Add to buffer
        this._buffer.push(log);
        if (this._buffer.length > this._maxBuffer) {
            this._buffer.shift();
        }
        
        // Broadcast to all clients
        const payload = `data: ${JSON.stringify(log)}\n\n`;
        this._clients.forEach(res => {
            try {
                res.write(payload);
            } catch (err) {
                this._clients.delete(res);
            }
        });
    }
    
    /**
     * Log info message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    info(message, data = {}) {
        this.broadcast('info', message, data);
    }
    
    /**
     * Log warning message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    warn(message, data = {}) {
        this.broadcast('warn', message, data);
    }
    
    /**
     * Log error message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    error(message, data = {}) {
        this.broadcast('error', message, data);
    }
    
    /**
     * Log debug message
     * @param {string} message - Log message
     * @param {object} data - Additional data
     */
    debug(message, data = {}) {
        this.broadcast('debug', message, data);
    }
    
    /**
     * Get count of connected clients
     * @returns {number} Number of connected clients
     */
    getClientCount() {
        return this._clients.size;
    }
    
    /**
     * Clear the log buffer
     */
    clearBuffer() {
        this._buffer = [];
    }
}

// Singleton instance
const logEmitter = new LogEmitter();

module.exports = { logEmitter, LogEmitter };

