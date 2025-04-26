# Headless Browser API

A high-performance API for rendering web pages using headless browsers. This service provides endpoints to scrape web content using different browser engines like Puppeteer and PhantomJS.

## Features

- Support for multiple headless browser engines:
  - Puppeteer (Chrome/Chromium)
- Fast response times with integrated caching
- Custom user agent, cookies, proxy, and authentication support
- JavaScript and CSS cleanup for cleaner output
- Image handling and base64 encoding
- Local storage manipulation
- Custom JavaScript evaluation
- Delay capabilities for dynamic content
- Simple REST API interface
- Performance monitoring and benchmarking

## API Endpoints

### Scrape Content with a Specific Engine

```
GET /apis/scrape/v1/:engine
```

Parameters:
- `apikey` (required): Your API key for authentication
- `url` (required): The URL to scrape
- `custom_user_agent`: Custom user agent string
- `custom_cookies`: URL-encoded JSON object with cookies or string in format "name=value;name2=value2"
- `user_pass`: Basic authentication credentials (format: `username:password`)
- `basic_auth`: Alternative basic authentication via Authorization header (format: `username:password`)
- `timeout`: Timeout in milliseconds
- `delay`: Delay in milliseconds after page load to allow dynamic content to render
- `proxy_url`: Proxy server URL
- `proxy_auth`: Proxy authentication credentials (format: `username:password`)
- `cleanup`: Set to 'false' to disable removing JavaScript and CSS from output (default: 'true')
- `localstorage`: Local storage items to set in format "key=value;key2=value2"
- `eval`: Custom JavaScript to evaluate on the page (URL-encoded)

Response Format:
```json
{
  "html": "...", // The scraped HTML content from the target URL
  "apicalls": 1000, // The configured API calls limit 
  "url": "...", // The URL that was scraped
  "error": "..." // Optional - present only if there was an error
}
```

Examples:

Basic scraping:
```
GET /apis/scrape/v1/puppeteer?apikey=your_api_key&url=http://example.com&timeout=5000
```

With cleanup disabled:
```
GET /apis/scrape/v1/puppeteer?apikey=your_api_key&url=http://example.com&cleanup=false
```

With delay and local storage:
```
GET /apis/scrape/v1/puppeteer?apikey=your_api_key&url=http://example.com&delay=2000&localstorage=token=abc123;lastVisit=2023-05-01
```

With custom JavaScript evaluation:
```
GET /apis/scrape/v1/puppeteer?apikey=your_api_key&url=http://example.com&eval=document.querySelector('.popup-modal').click()
```

### Get API Information

```
GET /info
```

Returns information about the API, including version numbers for the API and each engine.

### Health Check

```
GET /health
```

Returns a simple status check to verify the API is running.

## Recent Optimizations

The API has been optimized for performance, reliability, and resource usage:

1. **Browser Pool Management**: Implemented an intelligent browser pool that efficiently manages browser instances and pages
2. **Improved Caching**: Using NodeCache for better memory management and performance
3. **Enhanced Media Support**: Configured to load all images and media content while blocking fonts and JavaScript resources
4. **Resource Filtering**: Smart resource management for better performance
5. **Error Handling**: Enhanced error handling with proper status codes and timeouts
6. **Memory Leaks Fixed**: Eliminated memory leaks by proper cleanup of browser resources
7. **Request Timeouts**: Added request timeout handling to prevent hanging requests
8. **Performance Metrics**: Added detailed performance monitoring and statistics
9. **Browser Stability**: Improved browser launch arguments for better stability in containerized environments

## Performance Benchmarks

You can run performance benchmarks using:

```
npm run benchmark
```

This will test response times and throughput for different API endpoints.

## Development

### Prerequisites

- Node.js (v16+)
- NPM (v7+)

### Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the server: `npm start`

For development with automatic restart:
```
npm run dev
```

### Environment Variables

- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 127.0.0.1)
- `API_KEY`: API key for authentication
- `API_CALLS_LIMIT`: Maximum API calls allowed (returned in response, default: 1000)
- `BROWSER_ARGS`: Additional browser arguments (comma-separated)
- `BROWSER_EXECUTABLE_PATH`: Path to browser executable
- `BROWSER_HEADLESS`: Set to "false" to disable headless mode
- `BROWSER_TIMEOUT`: Default page timeout in ms
- `BROWSER_VIEWPORT_WIDTH`: Browser viewport width
- `BROWSER_VIEWPORT_HEIGHT`: Browser viewport height
- `BROWSER_WAIT_UNTIL`: Page load strategy (networkidle0, networkidle2, load, domcontentloaded)
- `BROWSER_MAX_CONCURRENCY`: Maximum concurrent browser instances

### Testing

Run the tests with:

```npm test
```

For test coverage:
```
npm run test:coverage
```

## License

Apache-2.0


