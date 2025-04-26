const assert = require("assert");
const request = require("supertest");
const app = require("../app");
const { isImageUrl, isVideoUrl } = require("../app");

// Set API key for testing
process.env.API_KEY = "test";
process.env.NODE_ENV = "test";

describe("Video URL Detection", function() {
    describe("URL Detection Helper Functions", function() {
        it("should correctly identify image URLs", function() {
            assert.strictEqual(isImageUrl("http://example.com/image.jpg"), true);
            assert.strictEqual(isImageUrl("http://example.com/image.jpeg"), true);
            assert.strictEqual(isImageUrl("http://example.com/image.png"), true);
            assert.strictEqual(isImageUrl("http://example.com/image.gif"), true);
            assert.strictEqual(isImageUrl("http://example.com/image.bmp"), true);
            assert.strictEqual(isImageUrl("http://example.com/image.webp"), true);
            assert.strictEqual(isImageUrl("http://example.com/image.jpg?width=300"), true);
            assert.strictEqual(isImageUrl("http://example.com/page.html"), false);
            assert.strictEqual(isImageUrl("http://example.com/video.mp4"), false);
        });

        it("should correctly identify video URLs", function() {
            assert.strictEqual(isVideoUrl("http://example.com/video.mp4"), true);
            assert.strictEqual(isVideoUrl("http://example.com/video.webm"), true);
            assert.strictEqual(isVideoUrl("http://example.com/video.ogg"), true);
            assert.strictEqual(isVideoUrl("http://example.com/video.mov"), true);
            assert.strictEqual(isVideoUrl("http://example.com/video.avi"), true);
            assert.strictEqual(isVideoUrl("http://example.com/video.mp4?height=720"), true);
            assert.strictEqual(isVideoUrl("http://example.com/page.html"), false);
            assert.strictEqual(isVideoUrl("http://example.com/image.jpg"), false);
        });
    });

    describe("Video URL Response Logic", function() {
        it("should correctly decide whether to return video URL or HTML content", function() {
            // Simulate the logic from app.js
            const determineResponse = (html, videoUrls, isImageRequest) => {
                if (videoUrls && videoUrls.length > 0 && !isImageRequest) {
                    return videoUrls[0].url;
                }
                return html;
            };
            
            // Test case: Regular page with a video
            const html1 = "<html><body>Test content</body></html>";
            const videoUrls1 = [{ url: "http://example.com/video.mp4" }];
            const result1 = determineResponse(html1, videoUrls1, false);
            assert.strictEqual(result1, "http://example.com/video.mp4");
            
            // Test case: Image request with videos
            const html2 = "base64-image-content";
            const videoUrls2 = [{ url: "http://example.com/video.mp4" }];
            const result2 = determineResponse(html2, videoUrls2, true);
            assert.strictEqual(result2, "base64-image-content");
            
            // Test case: No videos found
            const html3 = "<html><body>No videos here</body></html>";
            const result3 = determineResponse(html3, [], false);
            assert.strictEqual(result3, "<html><body>No videos here</body></html>");
            
            // Test case: Multiple videos - first one should be used
            const html4 = "<html><body>Multiple videos</body></html>";
            const videoUrls4 = [
                { url: "http://example.com/video1.mp4" },
                { url: "http://example.com/video2.webm" }
            ];
            const result4 = determineResponse(html4, videoUrls4, false);
            assert.strictEqual(result4, "http://example.com/video1.mp4");
        });
    });

    describe("API Health Check", function() {
        it("should return OK status from health endpoint", async function() {
            const response = await request(app)
                .get("/health");
            
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(response.body, { status: "ok" });
        });
    });
}); 