const exporter = require("./src/allure-exporter");

function resolveGenerateReport(exporterModule) {
    if (typeof exporterModule === "function") {
        return exporterModule;
    }

    if (!exporterModule || typeof exporterModule !== "object") {
        return null;
    }

    return resolveGenerateReport(
        exporterModule.generateReport || exporterModule.default
    );
}

const generateReport = resolveGenerateReport(exporter);

if (!generateReport) {
    throw new TypeError("Unable to load generateReport from the exporter module.");
}

const url = process.argv[2];

generateReport({ url }).catch(error => {
    console.error("Allure export failed:", error);
    process.exitCode = 1;
});
