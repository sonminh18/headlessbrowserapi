const { S3Client, HeadBucketCommand, DeleteObjectCommand, ListObjectVersionsCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { createReadStream } = require("fs");
const { stat } = require("fs/promises");
const { v4: uuid } = require("uuid");
const { conf } = require("./config");
const { Logging } = require("hive-js-util");

/**
 * S3Storage class for uploading videos to S3-compatible storage
 * Supports streaming upload to handle large files efficiently
 */
class S3Storage {
    constructor() {
        this._client = null;
    }

    /**
     * Lazy initialization of S3 client
     * @returns {S3Client|null} S3 client instance or null if not configured
     */
    _getClient() {
        if (!this._client && this.isConfigured()) {
            this._client = new S3Client({
                endpoint: conf.S3.endpoint,
                region: conf.S3.region,
                credentials: {
                    accessKeyId: conf.S3.accessKeyId,
                    secretAccessKey: conf.S3.secretAccessKey
                },
                forcePathStyle: conf.S3.pathStyle
            });
        }
        return this._client;
    }

    /**
     * Check if S3 is properly configured with all required credentials
     * @returns {boolean} True if all required S3 configuration is present
     */
    isConfigured() {
        return !!(
            conf.S3?.endpoint &&
            conf.S3?.bucket &&
            conf.S3?.accessKeyId &&
            conf.S3?.secretAccessKey
        );
    }

    /**
     * Validate S3 connection by checking bucket access
     * @returns {Promise<boolean>} True if connection is valid
     * @throws {Error} If S3 is not configured or bucket is not accessible
     */
    async validateConnection() {
        const client = this._getClient();
        if (!client) {
            throw new Error("S3 is not configured");
        }

        await client.send(new HeadBucketCommand({ Bucket: conf.S3.bucket }));
        return true;
    }

    /**
     * Stream upload from file path to S3
     * Uses multipart upload for large files automatically
     * @param {string} filePath - Path to the file to upload
     * @param {string} key - S3 object key
     * @param {string} contentType - MIME type of the file
     * @returns {Promise<string>} Public URL of the uploaded file
     * @throws {Error} If upload fails or S3 is not configured
     */
    async uploadFromFile(filePath, key, contentType = "video/mp4") {
        const client = this._getClient();
        if (!client) {
            throw new Error("S3 is not configured");
        }

        const fileStats = await stat(filePath);
        const fileStream = createReadStream(filePath);

        const upload = new Upload({
            client,
            params: {
                Bucket: conf.S3.bucket,
                Key: key,
                Body: fileStream,
                ContentType: contentType,
                ContentLength: fileStats.size
            },
            // Multipart upload settings for large files
            queueSize: 4, // Concurrent parts
            partSize: 10 * 1024 * 1024 // 10MB per part
        });

        // Track upload progress for debugging
        upload.on("httpUploadProgress", (progress) => {
            if (progress.total) {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                Logging.debug(`Upload progress: ${percent}%`);
            }
        });

        await upload.done();
        Logging.info(`Successfully uploaded file to S3: ${key}`);

        return this.getPublicUrl(key);
    }

    /**
     * Generate S3 key for video using filename from URL
     * @param {string} originalUrl - Original video URL to extract filename from
     * @param {string} extension - File extension (fallback)
     * @returns {string} S3 key with prefix and sanitized filename
     */
    generateKey(originalUrl, extension = "mp4") {
        const prefix = conf.S3?.keyPrefix || "videos/";
        
        // Try to extract filename from URL
        let filename = this._extractFilenameFromUrl(originalUrl, extension);
        
        // Add short unique suffix to avoid collisions (8 chars from UUID)
        const uniqueSuffix = uuid().split("-")[0];
        
        // Insert suffix before extension
        const lastDot = filename.lastIndexOf(".");
        if (lastDot > 0) {
            filename = `${filename.substring(0, lastDot)}-${uniqueSuffix}${filename.substring(lastDot)}`;
        } else {
            filename = `${filename}-${uniqueSuffix}.${extension}`;
        }
        
        return `${prefix}${filename}`;
    }

    /**
     * Extract and sanitize filename from URL
     * @param {string} url - Video URL
     * @param {string} fallbackExt - Fallback extension
     * @returns {string} Sanitized filename
     */
    _extractFilenameFromUrl(url, fallbackExt = "mp4") {
        try {
            const parsed = new URL(url);
            let pathname = parsed.pathname;
            
            // Get the last segment of the path
            let filename = pathname.split("/").pop() || "";
            
            // Remove query string if present in filename
            filename = filename.split("?")[0];
            
            // Decode URL encoding
            try {
                filename = decodeURIComponent(filename);
            } catch {
                // Keep original if decode fails
            }
            
            // If no filename or just extension, generate from path
            if (!filename || filename.length < 3) {
                // Try to use meaningful part of path
                const pathParts = pathname.split("/").filter(p => p && p.length > 2);
                if (pathParts.length > 0) {
                    filename = pathParts[pathParts.length - 1];
                } else {
                    // Use hostname as fallback
                    filename = parsed.hostname.replace(/\./g, "-");
                }
            }
            
            // Sanitize filename: remove special chars, keep alphanumeric, dash, underscore, dot
            filename = filename
                .replace(/[^a-zA-Z0-9\-_\.]/g, "-") // Replace special chars with dash
                .replace(/-+/g, "-")                 // Collapse multiple dashes
                .replace(/^-|-$/g, "")               // Remove leading/trailing dashes
                .toLowerCase();
            
            // Replace HLS extensions with the actual output format
            // HLS streams (.m3u8, .m3u) are converted to MP4
            filename = filename.replace(/\.(m3u8|m3u)$/i, `.${fallbackExt}`);
            
            // Ensure filename has extension
            if (!filename.match(/\.[a-zA-Z0-9]{2,4}$/)) {
                filename = `${filename}.${fallbackExt}`;
            }
            
            // Limit filename length (max 100 chars)
            if (filename.length > 100) {
                const ext = filename.substring(filename.lastIndexOf("."));
                filename = filename.substring(0, 100 - ext.length) + ext;
            }
            
            return filename || `video.${fallbackExt}`;
        } catch {
            // Fallback to UUID if URL parsing fails
            return `video-${uuid().split("-")[0]}.${fallbackExt}`;
        }
    }

    /**
     * Get public URL for uploaded file
     * Uses CDN URL if configured, otherwise falls back to S3 URL
     * @param {string} key - S3 object key
     * @returns {string} Public URL for the object
     */
    getPublicUrl(key) {
        // Use CDN URL if configured (e.g., Cloudflare CDN)
        if (conf.S3.cdnUrl) {
            const cdnBase = conf.S3.cdnUrl.replace(/\/$/, "");
            return `${cdnBase}/${key}`;
        }

        const endpoint = conf.S3.endpoint.replace(/\/$/, "");
        const bucket = conf.S3.bucket;

        if (conf.S3.pathStyle) {
            return `${endpoint}/${bucket}/${key}`;
        }

        // Virtual-hosted style
        const url = new URL(endpoint);
        return `${url.protocol}//${bucket}.${url.host}/${key}`;
    }

    /**
     * Delete an object from S3 (including all versions for B2 compatibility)
     * Backblaze B2 uses versioning - a simple DeleteObject only creates a "hide marker"
     * This method deletes all versions to permanently remove the file
     * @param {string} key - S3 object key to delete
     * @returns {Promise<boolean>} True if deletion was successful
     * @throws {Error} If S3 is not configured or deletion fails
     */
    async deleteObject(key) {
        const client = this._getClient();
        if (!client) {
            throw new Error("S3 is not configured");
        }

        let deletedCount = 0;

        try {
            // List all versions of the object (for B2 versioning support)
            const listResponse = await client.send(new ListObjectVersionsCommand({
                Bucket: conf.S3.bucket,
                Prefix: key
            }));

            const versionsToDelete = [];

            // Collect all versions
            if (listResponse.Versions) {
                for (const version of listResponse.Versions) {
                    if (version.Key === key) {
                        versionsToDelete.push({ Key: version.Key, VersionId: version.VersionId });
                    }
                }
            }

            // Collect all delete markers (hidden files in B2)
            if (listResponse.DeleteMarkers) {
                for (const marker of listResponse.DeleteMarkers) {
                    if (marker.Key === key) {
                        versionsToDelete.push({ Key: marker.Key, VersionId: marker.VersionId });
                    }
                }
            }

            // Delete all versions and markers
            for (const item of versionsToDelete) {
                await client.send(new DeleteObjectCommand({
                    Bucket: conf.S3.bucket,
                    Key: item.Key,
                    VersionId: item.VersionId
                }));
                deletedCount++;
                Logging.debug(`Deleted version ${item.VersionId} of ${item.Key}`);
            }

            // If no versions found, try simple delete (non-versioned bucket)
            if (versionsToDelete.length === 0) {
                await client.send(new DeleteObjectCommand({
                    Bucket: conf.S3.bucket,
                    Key: key
                }));
                deletedCount = 1;
            }

            Logging.info(`Successfully deleted file from S3: ${key} (${deletedCount} version(s))`);
            return true;
        } catch (err) {
            // If ListObjectVersions fails (e.g., versioning not enabled), fall back to simple delete
            if (err.name === 'NotImplemented' || err.Code === 'NotImplemented') {
                Logging.debug(`Versioning not supported, using simple delete for ${key}`);
                await client.send(new DeleteObjectCommand({
                    Bucket: conf.S3.bucket,
                    Key: key
                }));
                Logging.info(`Successfully deleted file from S3: ${key}`);
                return true;
            }
            throw err;
        }
    }

    /**
     * Extract S3 key from public URL (supports CDN, path-style, and virtual-hosted URLs)
     * @param {string} url - Public URL of the S3 object
     * @returns {string|null} S3 key or null if URL doesn't match
     */
    extractKeyFromUrl(url) {
        if (!url || !this.isConfigured()) {
            return null;
        }

        // Try CDN URL first
        if (conf.S3.cdnUrl) {
            const cdnBase = conf.S3.cdnUrl.replace(/\/$/, "") + "/";
            if (url.startsWith(cdnBase)) {
                return url.substring(cdnBase.length);
            }
        }

        const endpoint = conf.S3.endpoint.replace(/\/$/, "");
        const bucket = conf.S3.bucket;

        // Path-style URL: endpoint/bucket/key
        if (conf.S3.pathStyle) {
            const prefix = `${endpoint}/${bucket}/`;
            if (url.startsWith(prefix)) {
                return url.substring(prefix.length);
            }
        } else {
            // Virtual-hosted style: bucket.host/key
            const parsedEndpoint = new URL(endpoint);
            const prefix = `${parsedEndpoint.protocol}//${bucket}.${parsedEndpoint.host}/`;
            if (url.startsWith(prefix)) {
                return url.substring(prefix.length);
            }
        }

        return null;
    }

    /**
     * Reset the S3 client (useful for testing or reconfiguration)
     */
    resetClient() {
        this._client = null;
    }
}

// Singleton instance
const s3Storage = new S3Storage();

module.exports = {
    S3Storage,
    s3Storage
};


