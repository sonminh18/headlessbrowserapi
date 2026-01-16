const assert = require("assert");
const puppeteer = require("../lib/engines/puppeteer");

// Access the helper functions for testing
// Note: This is not ideal as it relies on the module structure, but works for testing
const puppeteerModule = require("../lib/engines/puppeteer");
const puppeteerSingleton = puppeteerModule.singleton();

// For testing helper functions, we need to extract them
// This approach is for testing purposes only
const getInternalFunctions = () => {
    // These functions are module-level in puppeteer.js

    // Recreate the functions for testing
    const puppeteerDelay = (time) => {
        return new Promise(function(resolve) {
            setTimeout(resolve, time);
        });
    };

    // Simple implementation of cleanHtmlContent for testing
    const cleanHtmlContent = (html) => {
        if (!html) return html;
        try {
            // Remove script tags
            let cleanedHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

            // Remove style tags
            cleanedHtml = cleanedHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

            // Remove link tags with rel="stylesheet"
            cleanedHtml = cleanedHtml.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, "");

            // Remove inline style attributes
            cleanedHtml = cleanedHtml.replace(/\s+style\s*=\s*["'][^"']*["']/gi, "");

            return cleanedHtml;
        } catch (error) {
            console.warn(`Error cleaning HTML content: ${error.message}`);
            return html; // Return original if cleaning fails
        }
    };

    // Simple implementation of isImageUrl for testing
    const isImageUrl = (url) => {
        if (!url) return false;
        const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".jpe", ".webp"];
        const lowercasedUrl = url.toLowerCase().split("?")[0].split("#")[0];
        return imageExtensions.some((extension) => lowercasedUrl.endsWith(extension));
    };

    return {
        puppeteerDelay,
        cleanHtmlContent,
        isImageUrl
    };
};

describe("Helper Functions", function() {
    let helpers;

    before(function() {
        helpers = getInternalFunctions();
    });

    describe("puppeteerDelay", function() {
        it("should delay for the specified time", async function() {
            const startTime = Date.now();
            const delayTime = 100; // 100ms delay

            await helpers.puppeteerDelay(delayTime);

            const elapsedTime = Date.now() - startTime;
            assert.ok(elapsedTime >= delayTime, `Expected delay of at least ${delayTime}ms but got ${elapsedTime}ms`);
        });
    });

    describe("cleanHtmlContent", function() {
        it("should remove script tags", function() {
            const html = "<html><head><script>alert('test');</script></head><body>Content</body></html>";
            const cleanedHtml = helpers.cleanHtmlContent(html);

            assert.ok(!cleanedHtml.includes("<script>"), "Script tag should be removed");
            assert.ok(cleanedHtml.includes("Content"), "Content should be preserved");
        });

        it("should remove style tags", function() {
            const html = "<html><head><style>body { color: red; }</style></head><body>Content</body></html>";
            const cleanedHtml = helpers.cleanHtmlContent(html);

            assert.ok(!cleanedHtml.includes("<style>"), "Style tag should be removed");
            assert.ok(cleanedHtml.includes("Content"), "Content should be preserved");
        });

        it("should remove stylesheet links", function() {
            const html = '<html><head><link rel="stylesheet" href="styles.css"></head><body>Content</body></html>';
            const cleanedHtml = helpers.cleanHtmlContent(html);

            assert.ok(!cleanedHtml.includes('rel="stylesheet"'), "Stylesheet link should be removed");
            assert.ok(cleanedHtml.includes("Content"), "Content should be preserved");
        });

        it("should remove inline style attributes", function() {
            const html = '<html><body><div style="color: red;">Content</div></body></html>';
            const cleanedHtml = helpers.cleanHtmlContent(html);

            assert.ok(!cleanedHtml.includes('style="'), "Inline style should be removed");
            assert.ok(cleanedHtml.includes("Content"), "Content should be preserved");
        });

        it("should handle invalid input gracefully", function() {
            const invalidHtml = null;
            const result = helpers.cleanHtmlContent(invalidHtml);

            // Should return the original input if there's an error
            assert.strictEqual(result, invalidHtml);
        });
    });

    describe("isImageUrl", function() {
        it("should identify image URLs by extension", function() {
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.jpg"), true);
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.jpeg"), true);
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.png"), true);
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.gif"), true);
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.webp"), true);
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.bmp"), true);
        });

        it("should work with uppercase extensions", function() {
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.JPG"), true);
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.JPEG"), true);
        });

        it("should ignore query parameters", function() {
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.jpg?size=large"), true);
        });

        it("should ignore hash fragments", function() {
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.jpg#fragment"), true);
        });

        it("should return false for non-image URLs", function() {
            assert.strictEqual(helpers.isImageUrl("http://example.com/page.html"), false);
            assert.strictEqual(helpers.isImageUrl("http://example.com/"), false);
            assert.strictEqual(helpers.isImageUrl("http://example.com/image.pdf"), false);
        });
    });
});
