const assert = require("assert");
const path = require("path");
const { tmpdir } = require("os");
const {
    validateVideoUrl,
    getTempFilePath,
    getExtension
} = require("../lib/util/video-downloader");

describe("VideoDownloader", () => {
    describe("validateVideoUrl", () => {
        it("should accept valid https URLs", () => {
            assert.doesNotThrow(() => {
                validateVideoUrl("https://example.com/video.mp4");
            });
        });

        it("should accept valid http URLs", () => {
            assert.doesNotThrow(() => {
                validateVideoUrl("http://example.com/video.mp4");
            });
        });

        it("should return parsed URL object", () => {
            const result = validateVideoUrl("https://example.com/video.mp4");
            assert.ok(result instanceof URL);
            assert.strictEqual(result.hostname, "example.com");
        });

        it("should reject localhost URLs", () => {
            assert.throws(
                () => {
                    validateVideoUrl("http://localhost/video.mp4");
                },
                /Blocked hostname/
            );
        });

        it("should reject 127.x.x.x URLs", () => {
            assert.throws(
                () => {
                    validateVideoUrl("http://127.0.0.1/video.mp4");
                },
                /Blocked hostname/
            );
        });

        it("should reject 10.x.x.x private IP ranges", () => {
            assert.throws(
                () => {
                    validateVideoUrl("http://10.0.0.1/video.mp4");
                },
                /Blocked hostname/
            );
        });

        it("should reject 192.168.x.x private IP ranges", () => {
            assert.throws(
                () => {
                    validateVideoUrl("http://192.168.1.1/video.mp4");
                },
                /Blocked hostname/
            );
        });

        it("should reject 172.16-31.x.x private IP ranges", () => {
            assert.throws(
                () => {
                    validateVideoUrl("http://172.16.0.1/video.mp4");
                },
                /Blocked hostname/
            );

            assert.throws(
                () => {
                    validateVideoUrl("http://172.31.255.255/video.mp4");
                },
                /Blocked hostname/
            );
        });

        it("should reject link-local IP addresses", () => {
            assert.throws(
                () => {
                    validateVideoUrl("http://169.254.0.1/video.mp4");
                },
                /Blocked hostname/
            );
        });

        it("should reject non-http protocols", () => {
            assert.throws(
                () => {
                    validateVideoUrl("file:///etc/passwd");
                },
                /Invalid protocol/
            );

            assert.throws(
                () => {
                    validateVideoUrl("ftp://example.com/video.mp4");
                },
                /Invalid protocol/
            );
        });

        it("should reject invalid URLs", () => {
            assert.throws(
                () => {
                    validateVideoUrl("not-a-valid-url");
                },
                /Invalid video URL/
            );
        });
    });

    describe("getTempFilePath", () => {
        it("should generate path in temp directory", () => {
            const tmpPath = getTempFilePath("mp4");
            assert.ok(tmpPath.startsWith(tmpdir()));
            assert.ok(tmpPath.includes("video-"));
            assert.ok(tmpPath.endsWith(".mp4"));
        });

        it("should use mp4 as default extension", () => {
            const tmpPath = getTempFilePath();
            assert.ok(tmpPath.endsWith(".mp4"));
        });

        it("should support different extensions", () => {
            const webmPath = getTempFilePath("webm");
            assert.ok(webmPath.endsWith(".webm"));

            const movPath = getTempFilePath("mov");
            assert.ok(movPath.endsWith(".mov"));
        });

        it("should generate unique paths", () => {
            const path1 = getTempFilePath("mp4");
            const path2 = getTempFilePath("mp4");
            assert.notStrictEqual(path1, path2);
        });
    });

    describe("getExtension", () => {
        it("should extract extension from URL", () => {
            assert.strictEqual(getExtension("https://example.com/video.mp4", null), "mp4");
            assert.strictEqual(getExtension("https://example.com/video.webm", null), "webm");
            assert.strictEqual(getExtension("https://example.com/video.mov", null), "mov");
        });

        it("should handle URLs with query parameters", () => {
            assert.strictEqual(
                getExtension("https://example.com/video.mp4?token=abc123", null),
                "mp4"
            );
        });

        it("should fall back to content type when URL has no extension", () => {
            assert.strictEqual(getExtension("https://example.com/video", "video/mp4"), "mp4");
            assert.strictEqual(getExtension("https://example.com/video", "video/webm"), "webm");
            assert.strictEqual(
                getExtension("https://example.com/video", "video/quicktime"),
                "mov"
            );
        });

        it("should return mp4 as default when extension cannot be determined", () => {
            assert.strictEqual(getExtension("https://example.com/video", null), "mp4");
            assert.strictEqual(
                getExtension("https://example.com/video", "application/octet-stream"),
                "mp4"
            );
        });

        it("should ignore non-video extensions in URL", () => {
            assert.strictEqual(getExtension("https://example.com/file.txt", "video/mp4"), "mp4");
        });
    });
});
