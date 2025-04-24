const { conf, load, start } = require("yonius");
const { Logging } = require("hive-js-util");

const BROWSER_ALIAS = {
    h: "headless",
    head: "headless"
};

const start_BROWSER = async () => {
    // make sure the proper default values are set in the config
    conf.BROWSER = conf.BROWSER || {};
    conf.BROWSER.type = conf.BROWSER.type === undefined ? "chromium" : conf.BROWSER.type;
    conf.BROWSER.executablePath =
        conf.BROWSER.executablePath === undefined ? null : conf.BROWSER.executablePath;
    conf.BROWSER.args =
        conf.BROWSER.args === undefined
            ? ["--no-sandbox", "--disable-gpu"]
            : conf.BROWSER.args;
    conf.BROWSER.viewport = conf.BROWSER.viewport || {};
    conf.BROWSER.viewport.width =
        conf.BROWSER.viewport.width === undefined ? 1366 : conf.BROWSER.viewport.width;
    conf.BROWSER.viewport.height =
        conf.BROWSER.viewport.height === undefined ? 768 : conf.BROWSER.viewport.height;
    conf.BROWSER.viewport.deviceScaleFactor =
        conf.BROWSER.viewport.deviceScaleFactor === undefined
            ? 1
            : conf.BROWSER.viewport.deviceScaleFactor;
    conf.BROWSER.timeout =
        conf.BROWSER.timeout === undefined ? 60000 : conf.BROWSER.timeout;
    conf.BROWSER.waitUntil =
        conf.BROWSER.waitUntil === undefined ? "load" : conf.BROWSER.waitUntil;
    conf.BROWSER.headless =
        conf.BROWSER.headless === undefined ? "false" : conf.BROWSER.headless;
    conf.BROWSER.dumpio = conf.BROWSER.dumpio === undefined ? true : conf.BROWSER.dumpio;

    // Ensure API_KEY is set
    conf.API_KEY = process.env.API_KEY || conf.API_KEY || "test-api-key";

    // Set default host and port if not already set
    conf.HOST = conf.HOST || process.env.HOST || "127.0.0.1";
    conf.PORT = conf.PORT || parseInt(process.env.PORT || "3000");

    // Log configuration
    Logging.debug(`Browser type: ${conf.BROWSER.type}`);
    Logging.debug(`Browser executable path: ${conf.BROWSER.executablePath}`);
    Logging.debug(`Browser args: ${conf.BROWSER.args}`);
    Logging.debug(`Browser viewport: ${JSON.stringify(conf.BROWSER.viewport)}`);
    Logging.debug(`Browser timeout: ${conf.BROWSER.timeout}`);
    Logging.debug(`Browser waitUntil: ${conf.BROWSER.waitUntil}`);
    Logging.debug(`Browser headless: ${conf.BROWSER.headless}`);
    Logging.debug(`Browser dumpio: ${conf.BROWSER.dumpio}`);
    Logging.debug(`API key: ${'*'.repeat(conf.API_KEY?.length || 0)}`);
    Logging.debug(`Host: ${conf.HOST}`);
    Logging.debug(`Port: ${conf.PORT}`);
};

module.exports = {
    conf: conf,
    load: load,
    start: start,
    start_BROWSER: start_BROWSER
};
