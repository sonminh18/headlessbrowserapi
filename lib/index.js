const config = require("./util/config");
const engines = require("./engines");
const util = require("hive-js-util");

// Export the engines
const ENGINES = engines.ENGINES;

// Export the configuration
const conf = config.conf;

/**
 * Initialize the library
 * @returns {Promise<void>}
 */
const init = async () => {
    await engines.init();
};

/**
 * Start the library and load configurations
 * @returns {Promise<void>}
 */
const start = async () => {
    // Load the configuration
    await config.load();
    
    // Initialize browser configuration
    await config.start_BROWSER();
};

/**
 * Stop the library and cleanup resources
 * @returns {Promise<void>}
 */
const stop = async () => {
    await destroy();
};

/**
 * Destroy all resources
 * @returns {Promise<void>}
 */
const destroy = async () => {
    await engines.destroy();
};

/**
 * Verify API key in the request
 * @param {Object} req - Express request object
 * @returns {boolean} True if the key is valid
 * @throws {Error} If the key is invalid
 */
const verifyKey = (req) => {
    // If no API key is required, return true
    if (!conf.API_KEY) {
        return true;
    }
    
    // Get the API key from the request query
    const keyValue = req.query.key;
    
    // If no key is provided, throw an error
    if (!keyValue) {
        const error = new Error("API key is required");
        error.code = 400;
        throw error;
    }
    
    // Check if the key is valid
    if (keyValue !== conf.API_KEY) {
        const error = new Error("Invalid API key");
        error.code = 400;
        throw error;
    }
    
    return true;
};

module.exports = {
    ENGINES: ENGINES,
    conf: conf,
    init: init,
    start: start,
    stop: stop,
    destroy: destroy,
    verifyKey: verifyKey
};
