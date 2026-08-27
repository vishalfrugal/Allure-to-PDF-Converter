const { generateReport } = require("./src/allure-exporter");

const url = process.argv[2];

generateReport({ url }).catch(error => {
    console.error("Allure export failed:", error);
    process.exitCode = 1;
});
