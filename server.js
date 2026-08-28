const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const generateReport = require("./src/allure-exporter.js");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
// Vercel's deployed files are read-only. /tmp is the writable directory.
const OUTPUT_ROOT = process.env.VERCEL
    ? path.join(process.env.TMPDIR || "/tmp", "allure-pdf-export")
    : path.join(__dirname, "output");
const JOBS_DIR = path.join(OUTPUT_ROOT, "jobs");
const REPORT_RETENTION_MS = Number(process.env.REPORT_RETENTION_MS) || 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const activeJobs = new Set();

function cleanupExpiredReports() {
    if (!fs.existsSync(JOBS_DIR)) {
        return;
    }

    const expirationTime = Date.now() - REPORT_RETENTION_MS;

    for (const entry of fs.readdirSync(JOBS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || activeJobs.has(entry.name)) {
            continue;
        }

        const jobDir = path.join(JOBS_DIR, entry.name);
        const createdAt = fs.statSync(jobDir).mtimeMs;

        if (createdAt < expirationTime) {
            fs.rmSync(jobDir, { recursive: true, force: true });
            console.log(`Expired report removed: ${entry.name}`);
        }
    }
}

function sendFile(response, filePath, contentType) {
    response.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
}

function parseRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", chunk => {
            body += chunk;
            if (body.length > 10_000) {
                request.destroy();
                reject(new Error("Request body is too large."));
            }
        });

        request.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("Request body must be valid JSON."));
            }
        });

        request.on("error", reject);
    });
}

function isValidUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && requestUrl.pathname === "/") {
        return sendFile(response, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/reports") {
        let jobId;

        try {
            const { url } = await parseRequestBody(request);

            if (!isValidUrl(url)) {
                return sendJson(response, 400, { error: "Enter a valid http(s) Allure report URL." });
            }

            jobId = crypto.randomUUID();
            const jobDir = path.join(JOBS_DIR, jobId);
            const pdfPath = path.join(jobDir, "ALLURE_COMPLETE_REPORT.pdf");

            fs.mkdirSync(jobDir, { recursive: true });
            activeJobs.add(jobId);
            console.log(`Starting report job ${jobId} for ${url}`);
            const result = await generateReport({
                url,
                outputDir: path.join(jobDir, "pages"),
                finalPdfPath: pdfPath
            });
            activeJobs.delete(jobId);

            return sendJson(response, 201, {
                id: jobId,
                downloadUrl: `/api/reports/${jobId}/download`
            });
        } catch (error) {
            if (jobId) {
                activeJobs.delete(jobId);
            }

            console.error("Report request failed:", error);
            return sendJson(response, 500, { error: error.message || "Report generation failed." });
        }
    }

    const downloadMatch = requestUrl.pathname.match(/^\/api\/reports\/([^/]+)\/download$/);
    if (request.method === "GET" && downloadMatch) {
        const jobId = downloadMatch[1];
        const pdfPath = path.join(JOBS_DIR, jobId, "ALLURE_COMPLETE_REPORT.pdf");

        if (!fs.existsSync(pdfPath)) {
            return sendJson(response, 404, { error: "Report not found." });
        }

        response.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": "attachment; filename=ALLURE_COMPLETE_REPORT.pdf"
        });
        return fs.createReadStream(pdfPath).pipe(response);
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
});

fs.mkdirSync(JOBS_DIR, { recursive: true });
cleanupExpiredReports();
const cleanupTimer = setInterval(cleanupExpiredReports, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

server.listen(PORT, () => {
    console.log(`Allure PDF web app running at http://localhost:${PORT}`);
    console.log(`Reports expire after ${REPORT_RETENTION_MS / 60000} minutes.`);
});
