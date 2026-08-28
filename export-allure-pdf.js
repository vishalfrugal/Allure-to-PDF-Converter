const exporter = require("./src/allure-exporter");
const generateReport = exporter.generateReport || exporter.default?.generateReport;

const url = process.argv[2];

generateReport({ url }).catch(error => {
    console.error("Allure export failed:", error);
    process.exitCode = 1;
});
