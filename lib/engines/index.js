const puppeteer = require("./puppeteer");

// Define the available engines
const ENGINES = {
    puppeteer: puppeteer
};

// Initialize all engines
async function init() {
    const initializedEngines = [];
    
    try {
        const instance = puppeteer.singleton();
        // Initialize engine if it has an init method
        if (instance && typeof instance.init === "function") {
            await instance.init();
            initializedEngines.push('puppeteer');
        }
        console.log(`Initialized engine: puppeteer`);
    } catch (err) {
        console.error(`Error initializing puppeteer engine:`, err);
        throw new Error(`Critical engine puppeteer failed to initialize: ${err.message}`);
    }
}

// Destroy all engines
async function destroy() {
    try {
        const instance = puppeteer.singleton();
        // Close engine if it has a close method
        if (instance && typeof instance.close === "function") {
            await instance.close();
        }
        // For backwards compatibility
        if (instance && typeof instance.destroy === "function") {
            await instance.destroy();
        }
    } catch (err) {
        console.error(`Error destroying puppeteer engine:`, err);
    }
}

module.exports = {
    ENGINES: ENGINES,
    init: init,
    destroy: destroy
};
