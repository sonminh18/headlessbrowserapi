const { conf, load, start } = require("yonius");
const { Logging } = require("hive-js-util");

// Default timeout in milliseconds
const DEFAULT_BROWSER_TIMEOUT = 30000;

const BROWSER_ALIAS = {
    h: "headless",
    head: "headless"
};

const start_BROWSER = async () => {
    // make sure the proper default values are set in the config
    conf.BROWSER = conf.BROWSER || {};
    conf.BROWSER.type = conf.BROWSER.type === undefined ? "chromium" : conf.BROWSER.type;

    // Use PUPPETEER_EXECUTABLE_PATH if available, otherwise use configured path
    conf.BROWSER.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
        conf.BROWSER.executablePath ||
        null;

    // Parse browser args from environment variable if provided
    if (process.env.BROWSER_ARGS) {
        conf.BROWSER.args = process.env.BROWSER_ARGS.split(",");
    } else {
        conf.BROWSER.args = conf.BROWSER.args === undefined
            ? [
                "--no-sandbox", 
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-extensions",
                "--disable-features=site-per-process",
                "--disable-background-networking",
                "--js-flags=--expose-gc --max-old-space-size=512"
              ]
            : conf.BROWSER.args;
    }

    conf.BROWSER.viewport = conf.BROWSER.viewport || {};
    conf.BROWSER.viewport.width =
        parseInt(process.env.BROWSER_VIEWPORT_WIDTH) ||
        conf.BROWSER.viewport.width === undefined
            ? 1366
            : conf.BROWSER.viewport.width;
    conf.BROWSER.viewport.height =
        parseInt(process.env.BROWSER_VIEWPORT_HEIGHT) ||
        conf.BROWSER.viewport.height === undefined
            ? 768
            : conf.BROWSER.viewport.height;
    conf.BROWSER.viewport.deviceScaleFactor =
        conf.BROWSER.viewport.deviceScaleFactor === undefined
            ? 1
            : conf.BROWSER.viewport.deviceScaleFactor;
    conf.BROWSER.timeout =
        parseInt(process.env.BROWSER_TIMEOUT) ||
        conf.BROWSER.timeout === undefined
            ? DEFAULT_BROWSER_TIMEOUT
            : conf.BROWSER.timeout;
    conf.BROWSER.waitUntil =
        process.env.BROWSER_WAIT_UNTIL ||
        conf.BROWSER.waitUntil === undefined
            ? "load"
            : conf.BROWSER.waitUntil;

    // Parse headless mode from environment variable
    if (process.env.BROWSER_HEADLESS) {
        conf.BROWSER.headless = process.env.BROWSER_HEADLESS === "false" ? false : "new";
    } else {
        conf.BROWSER.headless = conf.BROWSER.headless === undefined ? "new" : conf.BROWSER.headless;
    }

    conf.BROWSER.dumpio = process.env.BROWSER_DUMPIO === "true" ||
        (conf.BROWSER.dumpio === undefined ? false : conf.BROWSER.dumpio);

    // Set max concurrency for browser pool
    conf.BROWSER.maxConcurrency = parseInt(process.env.BROWSER_MAX_CONCURRENCY) ||
        conf.BROWSER.maxConcurrency ||
        5;

    // Ensure API_KEY is set
    conf.API_KEY = process.env.API_KEY || conf.API_KEY || "test-api-key";

    // Set API calls limit
    conf.API_CALLS_LIMIT = parseInt(process.env.API_CALLS_LIMIT) || 1000;

    // Set default host and port if not already set
    conf.HOST = conf.HOST || process.env.HOST || "127.0.0.1";
    conf.PORT = conf.PORT || parseInt(process.env.PORT || "3000");

    // Log configuration
    Logging.debug(`Browser type: ${conf.BROWSER.type}`);
    Logging.debug(`Browser executable path: ${conf.BROWSER.executablePath || "auto-detected"}`);
    Logging.debug(`Browser args: ${conf.BROWSER.args}`);
    Logging.debug(`Browser viewport: ${JSON.stringify(conf.BROWSER.viewport)}`);
    Logging.debug(`Browser timeout: ${conf.BROWSER.timeout}`);
    Logging.debug(`Browser waitUntil: ${conf.BROWSER.waitUntil}`);
    Logging.debug(`Browser headless: ${conf.BROWSER.headless}`);
    Logging.debug(`Browser dumpio: ${conf.BROWSER.dumpio}`);
    Logging.debug(`Browser max concurrency: ${conf.BROWSER.maxConcurrency}`);
    Logging.debug(`API key: ${"*".repeat(conf.API_KEY?.length || 0)}`);
    Logging.debug(`API calls limit: ${conf.API_CALLS_LIMIT}`);
    Logging.debug(`Host: ${conf.HOST}`);
    Logging.debug(`Port: ${conf.PORT}`);
};

module.exports = {
    conf: conf,
    load: load,
    start: start,
    start_BROWSER: start_BROWSER,
    DEFAULT_BROWSER_TIMEOUT: DEFAULT_BROWSER_TIMEOUT
};
