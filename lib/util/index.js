const base = require("./base");
const config = require("./config");
const errors = require("./errors");
const s3Storage = require("./s3-storage");
const videoDownloader = require("./video-downloader");
const urlTracker = require("./url-tracker");
const videoTracker = require("./video-tracker");

Object.assign(module.exports, base);
Object.assign(module.exports, config);
Object.assign(module.exports, errors);
Object.assign(module.exports, s3Storage);
Object.assign(module.exports, videoDownloader);
Object.assign(module.exports, urlTracker);
Object.assign(module.exports, videoTracker);
