const http = require("http");
const util = require("hive-js-util");

// Configuration
const config = {
    host: "localhost",
    port: 3000,
    paths: [
        "/apis/scrape/v1/puppeteer?apikey=test&url=https://phimmoi.sale/phim-le/nang-cap",
        "/info"
    ],
    concurrency: 5,
    iterations: 10
};

// Benchmark a specific URL
async function benchmarkUrl(path) {
    const start = process.hrtime.bigint();

    return new Promise((resolve, reject) => {
        const req = http.request({
            host: config.host,
            port: config.port,
            path: path,
            method: "GET"
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1e6; // Convert to milliseconds

                resolve({
                    path,
                    statusCode: res.statusCode,
                    duration,
                    size: data.length
                });
            });
        });

        req.on("error", (err) => {
            reject(err);
        });

        req.end();
    });
}

// Run multiple iterations for a path
async function runIterations(path) {
    const results = [];

    for (let i = 0; i < config.iterations; i++) {
        try {
            util.Logging.info(`Running iteration ${i + 1}/${config.iterations} for ${path}`);
            const result = await benchmarkUrl(path);
            results.push(result);
        } catch (err) {
            util.Logging.error(`Error benchmarking ${path}: ${err.message}`);
        }
    }

    return results;
}

// Process and display results
function processResults(results) {
    const pathResults = {};

    // Group results by path
    for (const result of results) {
        if (!pathResults[result.path]) {
            pathResults[result.path] = [];
        }
        pathResults[result.path].push(result);
    }

    // Calculate stats for each path
    for (const [path, pathData] of Object.entries(pathResults)) {
        const durations = pathData.map(r => r.duration);
        const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        const min = Math.min(...durations);
        const max = Math.max(...durations);
        const median = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)];

        console.log(`\n========== Results for ${path} ==========`);
        console.log(`Iterations: ${pathData.length}`);
        console.log(`Avg response time: ${avg.toFixed(2)} ms`);
        console.log(`Min response time: ${min.toFixed(2)} ms`);
        console.log(`Max response time: ${max.toFixed(2)} ms`);
        console.log(`Median response time: ${median.toFixed(2)} ms`);
        console.log(`Avg response size: ${Math.round(pathData.reduce((sum, r) => sum + r.size, 0) / pathData.length)} bytes`);
    }
}

// Main benchmark function
async function runBenchmark() {
    util.Logging.info("Starting benchmark...");
    const allResults = [];

    for (const path of config.paths) {
        const results = await runIterations(path);
        allResults.push(...results);
    }

    processResults(allResults);
    util.Logging.info("Benchmark completed");
}

// Run the benchmark
runBenchmark().catch(err => {
    util.Logging.error(`Benchmark failed: ${err.message}`);
    process.exit(1);
});
