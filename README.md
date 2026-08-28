# Allure to PDF Converter

Convert a published Allure report into one downloadable `ALLURE_COMPLETE_REPORT.pdf` file.

## Requirements

- Node.js 22.17 or newer
- A published Allure report URL accessible to the server
- A server with enough memory to run headless Chromium
- Writable storage for the temporary report files and generated PDF

## Installation

```bash
npm install
```

## Web application

Start the web server:

```bash
npm start
```

Open `http://localhost:3000`, enter an Allure report URL, and select **Generate PDF**. The final PDF is returned as a download link.

The server exposes these routes:

- `GET /` - web interface
- `POST /api/reports` - generate a report from a JSON body such as `{ "url": "https://example.com/allure/" }`
- `GET /api/reports/:jobId/download` - download the final PDF

## Command line

Generate a report directly from the terminal:

```bash
npm run export -- https://example.com/allure/
```

## Storage and cleanup

Each web request receives a unique job directory under `output/jobs/` locally. On Vercel, temporary files are written under `/tmp` because the deployed filesystem is read-only. Intermediate section PDFs are deleted after the final PDF is merged. Completed job directories are automatically deleted after one hour, including the final PDF.

Cleanup runs when the server starts and every 10 minutes while it is running. To configure a different retention period, set `REPORT_RETENTION_MS` in the deployment environment. The value is in milliseconds:

```env
REPORT_RETENTION_MS=3600000
```

Examples:

```env
# 30 minutes
REPORT_RETENTION_MS=1800000

# 24 hours
REPORT_RETENTION_MS=86400000
```

The default is one hour, so the environment variable is optional.

## Deployment notes

Set the start command to:

```bash
npm start
```