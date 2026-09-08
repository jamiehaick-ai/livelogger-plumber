# LiveLogger Plumber — Bryan Construction / Peterson Job

Fills Bryan Construction's actual Subcontractor Daily Report PDF (page 1) instead of generating a homemade report. This is a materially different build from the base LiveLogger Lite — the electrician copy stays on the simpler flat-field model until his own GC form shows up.

## How the PDF-fill actually works
`bryan-template.pdf` is the real Bryan Construction form, visually untouched, with its 74 page-1 field names renamed from meaningless IDs (`Text42`, `Check Box17`) to plain-English ones (`qc_inspections_performed`, `safety_meeting_yes`). See `bryan-field-map.json` (in the project) for the full old-name → new-name mapping. Page 2 (the continuation sheet) was left with its original names — out of scope for now, per the usage pattern below.

`index.html` fetches that template and fills it client-side with [pdf-lib](https://pdf-lib.js.org/) — no server round-trip for the PDF itself, matching the offline-first design of the rest of the app. `buildBryanPdf()` is the function that does this; every field name it references was checked against the real template's field list with a script, not guessed.

## What the AI actually extracts now
Structured, not flat — multiple work-activity rows (location code + description), multiple manpower rows (classification, workers, total hours — the AI computes workers × hours-per-worker itself, splitting into separate rows if the crew's hours differed), three independent safety yes/no answers (defaulting to "no" unless something was actually said), and optional schedule-impact / quality-control / next-day-planning fields that are only filled when mentioned.

**Required to save a report:** at least one work-activity row and at least one manpower row. Everything else is opportunistic — filled if mentioned, never blocked on.

## Known gaps, from the real handoff notes
- Signature fields (`Signature1`, `Signature2` on page 1) are real PDF `/Sig` fields, not text — this app leaves them blank for hand-signing after printing/exporting. No digital signing built.
- `Text40` (near the property-damage question) and `Text43`/`Text45` (Discrepancies / Directives Received) were never actually confirmed against a real filled report on this job — left unmapped/unused rather than guessed at.
- Report number (`Text54`) was never filled in any report on this job either; this app leaves it blank. Worth deciding later whether it should auto-increment.
- Page 2 (continuation sheet) isn't wired up — the real usage pattern never needed more than 4 work rows or 5 manpower rows in practice, so this wasn't built. The field-rename work only covers page 1.
- The 8A percentage ledger that used to matter on this job is done (the job's at 100%) and was intentionally never built into this app.

## Run it locally
1. `npm install`
2. Copy `.env.example` to `.env`, paste in a real key from console.anthropic.com -> API Keys
3. `npm start`
4. Open **http://localhost:3000** on this computer -- `bryan-template.pdf` is served automatically alongside `index.html` since it sits in the same folder Express serves statically.
5. To test on your phone over wifi: same network, then `http://<this-computer's-LAN-IP>:3000` (the server prints this on startup).

**One real limitation:** the offline queue and "Add to Home Screen" install only work over `https://` or on `localhost` itself -- a browser security rule, not a bug here. For real phone install, deploy for real (below).

## Deploying
Same two-path setup as the base app: `server.js` for Railway/Render, or `api/parse-example.js` for Vercel/Netlify. Both are kept in lockstep with the same system prompt and glossary -- if you change one, change both, or regenerate one from the other (this file was built with a small script that extracts the shared blocks straight out of `server.js`, so they can't silently drift).

## Still open
- **Report destination** -- right now "Download PDF" saves to the phone. Emailing it automatically to Bryan Construction is a small addition to the serverless function, not a rebuild.
- **Page 2 / continuation sheet** -- not wired up (see Known Gaps above).
- **Report numbering** -- decide whether `Text54` should auto-increment or stay manual/blank.
