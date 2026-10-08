# AI Image Quality Checker

A local Node.js image quality inspection dashboard for Windows.

## Installation
1. Install Node.js 20 or later.
2. Clone or download this repository.
3. Open a terminal in the project folder and run `npm install`.
4. Copy `.env.example` to `.env` and set your OpenAI API key.
5. Run `npm start`.
6. Open http://127.0.0.1:3000 in your browser.
7. Enter the absolute path of a local folder containing images, set an estimated USD budget, and click **Start**.

## Features
- Recursive scanning of folders and nested subfolders.
- Local file decoding and minimum-megapixel screening.
- AI review of malformed anatomy, shadows, reflections, objects, text and other visual artifacts.
- PASS, REVIEW, FAIL and ERROR statuses.
- FAIL images copied to `runtime/<job-id>/Defected`; REVIEW images copied to `runtime/<job-id>/Review`. Original files remain unchanged.
- Detailed `Quality_Report.csv` including original path, image size, status, score, issues and estimated token cost.
- Dashboard progress, stop and resume.
- Configurable AI model and estimated budget.

## Important limitations
- This is an initial implementation, not a fully tested production release.
- The AI review is advisory and does not guarantee Adobe Stock acceptance.
- Local screening currently checks decodability and megapixels, but **does not yet implement** a dedicated blur detector or full Adobe technical-rule validation.
- Resume works for stopped/interrupted jobs; exhausted budgets require a new job.
- The spending cap is an estimate based on token pricing configured in `.env`, **not** a provider-enforced hard limit.
- Processing is sequential; asynchronous OpenAI Batch API support is not implemented.
- Verify the selected model's current availability and pricing before use.
- Do not expose the local dashboard to the public internet.

## Security
- Server listens on 127.0.0.1.
- API key is stored in `.env`, which is excluded from Git.
- Source images are never served by the dashboard.
- Resized image copies are sent to the OpenAI API for analysis.

## Supported files
JPEG, PNG, WEBP, TIFF.

## Outputs
Each run creates `runtime/<job-id>/Quality_Report.csv`, with copied images in the `Defected` and `Review` folders as needed.
