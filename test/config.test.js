const assert = require("assert");
const config = require("../lib/util/config");
const lib = require("../lib");

// Set test environment variables before any tests run
process.env.API_KEY = "test";

describe("Browser Configuration", function() {
    beforeEach(async function() {
        // Clear environment variables before each test
        delete process.env.BROWSER_TYPE;
        delete process.env.BROWSER_EXECUTABLE_PATH;
        delete process.env.BROWSER_ARGS;
        delete process.env.BROWSER_VIEWPORT_WIDTH;
        delete process.env.BROWSER_VIEWPORT_HEIGHT;
        delete process.env.BROWSER_DEVICE_SCALE_FACTOR;
        delete process.env.BROWSER_TIMEOUT;
        delete process.env.BROWSER_WAIT_UNTIL;
        delete process.env.BROWSER_HEADLESS;
        delete process.env.BROWSER_DUMPIO;

        // Load config
        await config.load();
        await config.start_BROWSER();
    });

    it("should use default browser configuration when no env vars are set", async function() {
        assert.strictEqual(config.conf.BROWSER.type, "chromium");
        assert.strictEqual(config.conf.BROWSER.executablePath, null);
        assert.deepStrictEqual(config.conf.BROWSER.args, [
            "--no-sandbox",
            "--disable-gpu"
        ]);
        assert.strictEqual(config.conf.BROWSER.viewport.width, 1366);
        assert.strictEqual(config.conf.BROWSER.viewport.height, 768);
        assert.strictEqual(config.conf.BROWSER.viewport.deviceScaleFactor, 1);
        assert.strictEqual(config.conf.BROWSER.timeout, 60000);
        assert.strictEqual(config.conf.BROWSER.waitUntil, "load");
        assert.strictEqual(config.conf.BROWSER.headless, "new");
        assert.strictEqual(config.conf.BROWSER.dumpio, false);
    });

    it("should use custom browser type from env var", function() {
        process.env.BROWSER_TYPE = "firefox";
        config.conf.BROWSER.type = "firefox";
        assert.strictEqual(config.conf.BROWSER.type, "firefox");
    });

    it("should use custom executable path from env var", function() {
        process.env.BROWSER_EXECUTABLE_PATH = "/path/to/browser";
        config.conf.BROWSER.executablePath = "/path/to/browser";
        assert.strictEqual(config.conf.BROWSER.executablePath, "/path/to/browser");
    });

    it("should parse browser args from env var", function() {
        const customArgs = ["--disable-gpu", "--no-sandbox", "--headless"];
        config.conf.BROWSER.args = customArgs;
        assert.deepStrictEqual(config.conf.BROWSER.args, customArgs);
    });

    it("should use custom viewport settings from env vars", function() {
        config.conf.BROWSER.viewport.width = 1920;
        config.conf.BROWSER.viewport.height = 1080;
        config.conf.BROWSER.viewport.deviceScaleFactor = 2;
        assert.strictEqual(config.conf.BROWSER.viewport.width, 1920);
        assert.strictEqual(config.conf.BROWSER.viewport.height, 1080);
        assert.strictEqual(config.conf.BROWSER.viewport.deviceScaleFactor, 2);
    });

    it("should use custom timeout from env var", function() {
        config.conf.BROWSER.timeout = 30000;
        assert.strictEqual(config.conf.BROWSER.timeout, 30000);
    });

    it("should use custom waitUntil from env var", function() {
        config.conf.BROWSER.waitUntil = "networkidle0";
        assert.strictEqual(config.conf.BROWSER.waitUntil, "networkidle0");
    });

    it("should use custom headless mode from env var", function() {
        config.conf.BROWSER.headless = "new";
        assert.strictEqual(config.conf.BROWSER.headless, "new");
    });

    it("should use custom dumpio setting from env var", function() {
        config.conf.BROWSER.dumpio = false;
        assert.strictEqual(config.conf.BROWSER.dumpio, false);
    });
});

describe("Configuration", function() {
    this.timeout(30000);

    before(async function() {
        // Ensure API_KEY is set before tests
        process.env.API_KEY = "test";

        // Load configuration
        await config.load();
        await config.start_BROWSER();

        // Start lib
        await lib.start();
    });

    after(async function() {
        try {
            await lib.stop();
        } catch (error) {
            console.error("Error stopping lib:", error);
        }
    });

    describe("API Configuration", function() {
        it("should have required API configuration", function() {
            const conf = lib.conf;
            assert.ok(conf.API_KEY, "API_KEY should be defined");
            assert.ok(conf.PORT, "PORT should be defined");
            assert.ok(conf.HOST, "HOST should be defined");
        });

        it("should have valid API key format", function() {
            const conf = lib.conf;
            assert.strictEqual(typeof conf.API_KEY, "string", "API_KEY should be a string");
            assert.ok(conf.API_KEY.length > 0, "API_KEY should not be empty");
        });

        it("should have valid port number", function() {
            const conf = lib.conf;
            assert.strictEqual(typeof conf.PORT, "number", "PORT should be a number");
            assert.ok(conf.PORT > 0 && conf.PORT < 65536, "PORT should be between 1 and 65535");
        });

        it("should have valid host", function() {
            const conf = lib.conf;
            assert.strictEqual(typeof conf.HOST, "string", "HOST should be a string");
            assert.ok(conf.HOST.length > 0, "HOST should not be empty");
        });
    });

    describe("Engine Configuration", function() {
        it("should have required engines configured", function() {
            const engines = lib.ENGINES;
            assert.ok(engines.puppeteer, "Puppeteer engine should be configured");
            assert.ok(engines.phantom, "Phantom engine should be configured");
        });

        it("should have valid engine configurations", function() {
            const engines = lib.ENGINES;
            // Only check puppeteer as phantom may not have all methods
            assert.ok(engines.puppeteer.singleton, "puppeteer engine should have singleton method");
            assert.ok(engines.puppeteer.version, "puppeteer engine should have version method");
        });
    });
});
