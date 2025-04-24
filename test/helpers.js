const yonius = require("yonius");

// Initialize yonius with test configuration
const initYonius = async () => {
    // Load yonius with test configuration
    await yonius.load({
        HOST: "127.0.0.1",
        PORT: "3000",
        BROWSER_TYPE: "chrome",
        BROWSER_EXECUTABLE_PATH: "/usr/bin/chrome",
        BROWSER_ARGS: '["--no-sandbox", "--disable-gpu"]',
        BROWSER_VIEWPORT_WIDTH: "1366",
        BROWSER_VIEWPORT_HEIGHT: "768",
        BROWSER_DEVICE_SCALE_FACTOR: "1",
        BROWSER_TIMEOUT: "60000",
        BROWSER_WAIT_UNTIL: "load",
        BROWSER_HEADLESS: "false",
        BROWSER_DUMPIO: "true",
        LEVEL: "DEBUG"
    });
};

module.exports = {
    initYonius
};
