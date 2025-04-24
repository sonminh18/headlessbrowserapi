const puppeteer = require("./puppeteer");
// Try to load phantom but make it optional
let phantom;
try {
    phantom = require("./phantom");
} catch (err) {
    console.warn("PhantomJS engine could not be loaded:", err.message);
    phantom = null;
}

// Define the available engines
const ENGINES = {
    puppeteer: puppeteer
};

// Add phantom engine if available
if (phantom) {
    ENGINES.phantom = phantom;
} else {
    console.log("Running without PhantomJS engine");
}

// Initialize all engines
async function init() {
    for (const [name, engineModule] of Object.entries(ENGINES)) {
        if (engineModule && typeof engineModule.singleton === "function") {
            try {
                const instance = engineModule.singleton();
                // Initialize engine if it has an init method
                if (instance && typeof instance.init === "function") {
                    await instance.init();
                }
            } catch (err) {
                console.error(`Error initializing ${name} engine:`, err);
            }
        }
    }
}

// Destroy all engines
async function destroy() {
    for (const [name, engineModule] of Object.entries(ENGINES)) {
        if (engineModule && typeof engineModule.singleton === "function") {
            try {
                const instance = engineModule.singleton();
                // Close engine if it has a close method
                if (instance && typeof instance.close === "function") {
                    await instance.close();
                }
                // For backwards compatibility
                if (instance && typeof instance.destroy === "function") {
                    await instance.destroy();
                }
            } catch (err) {
                console.error(`Error destroying ${name} engine:`, err);
            }
        }
    }
}

module.exports = {
    ENGINES: ENGINES,
    init: init,
    destroy: destroy
};
