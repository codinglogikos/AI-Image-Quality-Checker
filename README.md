# AI Image Quality Checker

Local Windows Node.js image checker with **browser-based Start, cost confirmation, progress and PDF reports**. **No frontend image uploads.**

## Setup
1. Install Node.js 20+.
2. Clone or download this repository.
3. In the project folder run `npm install`.
4. Copy `.env.example` to `.env`, and set `OPENAI_API_KEY`.
5. Create or open the project's `images` folder. Paste image files or nested folders inside.
6. Run `npm run report`, then open http://127.0.0.1:3000.
7. Click **Start Checking** in the browser. The popup shows total images, already checked, remaining, selected API model, estimated cost per 2,000 images, and the total estimated API cost for the remaining images.
8. Click **Yes, Continue** to authorize the API requests or **No, Cancel** to exit without sending any new image API requests. Progress and results update live in the browser.
9. Inspect the results, thumbnails and **Download PDF Report** button. The optional `npm run check` terminal workflow is still available.

## Folder structure
```text
AI-Image-Quality-Checker/
  images/                <- put images and nested folders here
  Defected/              <- FAIL images MOVED here (subfolders preserved)
  Review/                <- REVIEW images MOVED here (subfolders preserved)
  runtime/
    check-state.json     <- resume information
    report.json          <- report data
  check-images.js        <- terminal image inspection script
  engine.js              <- inspection engine
  server.js              <- read-only report server
  public/index.html      <- report dashboard
```

## How it works
- Recursively discovers supported JPEG, PNG, WEBP and TIFF images.
- Resumes after interruption using recorded filenames, sizes and modification timestamps; unchanged PASS images are not rechecked. Images moved to Defected/Review remain in the historical report.
- Checks image readability and a configurable minimum megapixel count locally.
- Sends resized copies to the OpenAI API for visual QA. Clear major defects = FAIL, uncertain cases = REVIEW, clean images = PASS. Errors remain in the input folder.
- Moves FAIL images to `Defected` and REVIEW images to `Review`, preserving nested subfolder paths. PASS images remain where they were.
- Never overwrites an existing destination image; filename conflicts get a unique suffix.
- Displays report with counts, scores, defect reasons, thumbnails of moved images and PDF export.

## Cost confirmation
Cost is estimated **before** sending new API requests using configured input/output token assumptions. The user must type Y to authorize proceeding. This is **not a hard spending cap**. Actual billed costs can differ; review the provider's current model prices and the configured token assumptions. A large number of files can incur significant charges.

## Limitations and precautions
- This is an initial implementation and has not yet been verified by a full local end-to-end run.
- AI inspection is fallible and does **not** guarantee Adobe Stock acceptance.
- No dedicated blur metric or complete Adobe Stock technical validation yet.
- Files are **moved**, not copied. Back up your originals before your first run.
- Stopping with Ctrl+C is best-effort; if a request is already in progress, wait for it to finish.
- For privacy, report server binds only to localhost (127.0.0.1).
- PDF and thumbnails use the report data stored locally.
- `.env`, `runtime`, `images`, `Defected`, and `Review` should not be committed to GitHub.
