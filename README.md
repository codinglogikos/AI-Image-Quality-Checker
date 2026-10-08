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
  server.js              <- browser-run API and report server
  public/index.html      <- run controls and report dashboard
```

## How it works
- Recursively discovers supported JPEG, PNG, WEBP and TIFF images.
- Resumes after interruption using recorded filenames, sizes and modification timestamps; unchanged PASS images are not rechecked. Images moved to Defected/Review remain in the historical report.
- Checks image readability and a configurable minimum megapixel count locally.
- Sends one overview plus four overlapping high-detail crops per image to the OpenAI API for stricter stock-quality screening. Serious visible defects = FAIL, moderate or uncertain defects = REVIEW, and no meaningful detected defects = PASS. The report includes concrete fix suggestions. Errors remain in the input folder.
- Moves FAIL images to `Defected` and REVIEW images to `Review`, preserving nested subfolder paths. PASS images remain where they were.
- Never overwrites an existing destination image; filename conflicts get a unique suffix.
- Displays report with counts, scores, defect reasons, thumbnails of moved images and PDF export.

## Strict stock review\n- A new review version causes unchanged images still in the `images/` folder to be checked again. Previously moved FAIL/REVIEW images are not automatically rechecked unless you manually copy them back into `images/`.\n- The strict mode uses five image views per file and can cost more than the previous one-view review. Update your local `.env` token estimates to `ESTIMATED_INPUT_TOKENS=11000` and `ESTIMATED_OUTPUT_TOKENS=750` before starting; these remain estimates, not a cap.\n- Back up originals before checking: FAIL and REVIEW images are moved.\n\n## Cost confirmation
Cost is estimated **before** sending new API requests using configured input/output token assumptions. The user must click **Yes, Continue** in the browser to authorize proceeding (or type Y when using the optional terminal CLI). This is **not a hard spending cap**. Actual billed costs can differ; review the provider's current model prices and the configured token assumptions. A large number of files can incur significant charges.

## Limitations and precautions
- This is an initial implementation and has not yet been verified by a full local end-to-end run.
- AI inspection is fallible and does **not** guarantee Adobe Stock acceptance.
- There is no dedicated numeric blur metric or official Adobe Stock acceptance integration; AI assessments can still miss defects. The model's quality score is NOT an Adobe score.
- Files are **moved**, not copied. Back up your originals before your first run.
- Stop After Current Image is best-effort; an in-flight API request can finish and incur charges.
- For privacy, report server binds only to localhost (127.0.0.1).
- PDF and thumbnails use the report data stored locally.
- `.env`, `runtime`, `images`, `Defected`, and `Review` should not be committed to GitHub.
