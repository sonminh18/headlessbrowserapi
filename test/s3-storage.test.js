const assert = require("assert");
const { S3Storage } = require("../lib/util/s3-storage");
const { conf } = require("../lib/util/config");

describe("S3Storage", () => {
    let originalS3Config;

    beforeEach(() => {
        // Save original config
        originalS3Config = conf.S3;
    });

    afterEach(() => {
        // Restore original config
        conf.S3 = originalS3Config;
    });

    describe("isConfigured", () => {
        it("should return false when not configured", () => {
            const storage = new S3Storage();
            conf.S3 = {};
            assert.strictEqual(storage.isConfigured(), false);
        });

        it("should return false when partially configured", () => {
            const storage = new S3Storage();
            conf.S3 = {
                endpoint: "https://s3.example.com",
                bucket: "test-bucket"
                // Missing accessKeyId and secretAccessKey
            };
            assert.strictEqual(storage.isConfigured(), false);
        });

        it("should return true when fully configured", () => {
            const storage = new S3Storage();
            conf.S3 = {
                endpoint: "https://s3.example.com",
                bucket: "test-bucket",
                accessKeyId: "test-key",
                secretAccessKey: "test-secret"
            };
            assert.strictEqual(storage.isConfigured(), true);
        });
    });

    describe("generateKey", () => {
        it("should generate unique keys with default prefix", () => {
            const storage = new S3Storage();
            conf.S3 = { keyPrefix: "videos/" };

            const key1 = storage.generateKey("http://example.com/video.mp4");
            const key2 = storage.generateKey("http://example.com/video.mp4");

            assert.ok(key1.startsWith("videos/"));
            assert.ok(key1.endsWith(".mp4"));
            assert.notStrictEqual(key1, key2); // Should be unique
        });

        it("should generate keys with custom prefix", () => {
            const storage = new S3Storage();
            conf.S3 = { keyPrefix: "custom/path/" };

            const key = storage.generateKey("http://example.com/video.mp4", "webm");

            assert.ok(key.startsWith("custom/path/"));
            assert.ok(key.endsWith(".webm"));
        });

        it("should generate keys with default prefix when keyPrefix is empty", () => {
            const storage = new S3Storage();
            conf.S3 = {};

            const key = storage.generateKey("http://example.com/video.mp4");

            assert.ok(key.startsWith("videos/"));
        });
    });

    describe("getPublicUrl", () => {
        it("should generate path-style URL when pathStyle is true", () => {
            const storage = new S3Storage();
            conf.S3 = {
                endpoint: "https://s3.example.com",
                bucket: "test-bucket",
                pathStyle: true
            };

            const url = storage.getPublicUrl("videos/test.mp4");

            assert.strictEqual(url, "https://s3.example.com/test-bucket/videos/test.mp4");
        });

        it("should generate virtual-hosted style URL when pathStyle is false", () => {
            const storage = new S3Storage();
            conf.S3 = {
                endpoint: "https://s3.example.com",
                bucket: "test-bucket",
                pathStyle: false
            };

            const url = storage.getPublicUrl("videos/test.mp4");

            assert.strictEqual(url, "https://test-bucket.s3.example.com/videos/test.mp4");
        });

        it("should handle endpoint with trailing slash", () => {
            const storage = new S3Storage();
            conf.S3 = {
                endpoint: "https://s3.example.com/",
                bucket: "test-bucket",
                pathStyle: true
            };

            const url = storage.getPublicUrl("videos/test.mp4");

            assert.strictEqual(url, "https://s3.example.com/test-bucket/videos/test.mp4");
        });
    });

    describe("resetClient", () => {
        it("should reset the client instance", () => {
            const storage = new S3Storage();
            conf.S3 = {
                endpoint: "https://s3.example.com",
                bucket: "test-bucket",
                accessKeyId: "test-key",
                secretAccessKey: "test-secret",
                region: "us-east-1"
            };

            // Get client once
            storage._getClient();
            assert.ok(storage._client !== null);

            // Reset
            storage.resetClient();
            assert.strictEqual(storage._client, null);
        });
    });
});


