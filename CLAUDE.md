# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Thai-language self-assessment web app for screening schools in special/remote areas (สถานศึกษาพื้นที่ลักษณะพิเศษ) to qualify for the พ.ส.ศ. allowance (2,000 THB/month). Schools enter raw facts; the app converts them to scores across 5 dimensions weighted 30/10/30/20/10 = 100 points. Total ≥ 70 → "ระดับ 3 ยุ่งยากมากที่สุด" = eligible; 60–69 = ระดับ 2 and 50–59 = ระดับ 1 (registered but not paid).

Stack: Next.js 15 (App Router, TypeScript, strict) + MySQL (`mysql2`). Deployed with Docker Compose on an Ubuntu server at `/DATA/AppData/www/newssra` (see `docs/DEPLOY.md`).

## Commands

```bash
npm run dev        # dev server on :3000 (MySQL in Laragon must be running)
npm run build      # production build + type-check — run this to validate changes
npm run start      # serve the production build
npm run db:init    # create database `newssra` + tables (idempotent); app also auto-creates on first connection
```

No test suite or linter is configured. Local DB config lives in `.env.local` (Laragon default: root / empty password / db `newssra`). Production config goes in `.env.production` (gitignored; template in `.env.production.example`).

Don't run `npm run build` while a `npm run dev` server is running against the same folder — both write to `.next/` and will corrupt each other's cache (manifests as `Cannot find module './NNN.js'` on next dev requests). Stop the dev server first, or just delete `.next/` and restart dev if this happens.

To manually test: open the list page, create an assessment, and use the "เติมตัวอย่าง ▾" dropdown — pick any of the 5 sample profiles (see `lib/demo.ts`). Expected totals: boundary-pass=70 (ระดับ3, V09), severe-remote=98 (ระดับ3, V07), borderline-review=68 (ระดับ2, V09), level1-notpaid=55 (ระดับ1, no flags), urban-fail=12 (neutral, no flags).

## Architecture

Data flow: client form state → debounced PUT → server recomputes scores → MySQL. The DB row stores the full `state` JSON (source of truth) plus summary columns (`total_score`, `level_key`, `unit_name`, …) that the server derives on every write for the list page — never write summary columns from client-supplied values.

- `lib/types.ts` — shared types; `INDICATOR_IDS` (15 ids `"1.1"`…`"5.2"`) and `AssessmentState` (unit / responses / evidence / signed / submitted).
- `lib/criteria.ts` — `DIMENSIONS` + `INDICATORS`: single source of truth for criteria text, max scores, level options, evidence requirements. Indicator `kind` is either `"fields"` (raw inputs) or `"level"` (pick-one options; the selected option **index** is stored as a string in `responses[id].level`).
- `lib/scoring.ts` — pure scoring engine: `scoreIndicator` (the per-indicator switch), `flags` (validation flags), `levelFor`, `canSubmit`, `computeAll`. Used by both the client (instant UI) and the server (authoritative recompute on save/submit) — keep it framework-free.
- `lib/state.ts` — `makeBlankState`/`sanitizeState`. Every payload entering the server passes through `sanitizeState` (drops unknown keys, coerces types, caps lengths).
- **Evidence file uploads:** `EvidenceInfo.files: EvidenceFile[]` (`lib/types.ts`) holds metadata only (id, originalName, mimeType, size, sha256, uploadedAt) — the actual bytes live on the filesystem under `uploads/{assessmentId}/{indicatorId}/{fileId}` (`fileId` is a UUID and doubles as the on-disk filename, so no path ever depends on a user-supplied string). `lib/uploads.ts` (server-only: uses `node:fs`/`node:crypto`) does the disk I/O; `lib/upload-constants.ts` holds the shared allow-list/size-cap constants that both `lib/uploads.ts` and the client-safe `lib/state.ts`/`DimensionPanel.tsx` need, specifically so `lib/state.ts` (imported by the client component `AssessmentForm.tsx`) never pulls in `node:fs`. Upload/view/delete go through their own routes (`app/api/assessments/[id]/evidence/[indicatorId]/route.ts` and `.../[fileId]/route.ts`) instead of the general autosave PUT, since files can't travel through a JSON body — after a successful call, the client folds the returned metadata into `state.evidence[id].files` via the existing generic `onEvidence` patch handler (no new handler type needed). Allowed types: JPEG/PNG/WebP/PDF, 10MB/file, 10 files/indicator — enforced both client-side (`accept`, disabled state) and server-side (the actual gate). Deleting an assessment (`app/api/assessments/[id]/route.ts` DELETE) also calls `deleteAllEvidenceFiles()` so its upload folder doesn't linger on disk. Hidden in print like the rest of `.evidence-box`.
- **Stakeholder feedback (pilot-test mode):** `AssessmentState.feedback` is `Record<IndicatorId, IndicatorFeedback>` where `IndicatorFeedback = { opinion: "agree" | "agree-with-changes" | "disagree"; note: string }` (`lib/types.ts`) — a 3-option radio per indicator (`FEEDBACK_OPINIONS`/`FEEDBACK_OPINION_LABELS`), defaulting to `"agree"`. The note textarea only renders in the UI when opinion ≠ `"agree"` (`DimensionPanel.tsx`'s `FeedbackBox`), but switching back to `"agree"` does **not** clear a previously-typed note — it's just hidden, not deleted. `.generalFeedback` (plain string) is a separate, always-visible overall-comment box, unaffected by this. None of this is read by `lib/scoring.ts` or `canSubmit`. Both are hidden in print. `sanitizeState` migrates pre-radio rows (`feedback[id]` used to be a plain string) into `{opinion:"agree", note:<old text>}` so old rows don't break. `lib/repo.ts#listAllFeedback()` + `app/feedback/page.tsx` aggregate every assessment's opinions per indicator (as a distribution chart, reusing the dashboard's `.chart-bar-*` classes) plus the notes from anyone who picked 2 or 3.
- `lib/demo.ts` — `DEMO_PROFILES` (5 fictional sample schools spanning every score band) + `makeDemoState(id)`. Scores/levels shown in the picker are computed live via `lib/scoring.ts`, not hardcoded, so they can't drift from the actual data if a profile is edited.
- `app/dashboard/page.tsx` — analytics dashboard: pass/fail counts by level, score histogram, per-dimension averages, and per-option distribution for every `kind: "level"` indicator (the "radio button" choices) — all computed **live** via `lib/repo.ts#listAllStates()` + `computeAll()` on each row's real `state`, never from the cached `total_score`/`level_key` summary columns. This matters: those summary columns can drift from a row's actual `state` (e.g. if scoring rules ever change), so the dashboard is the one place that always reflects current rules, while the home list intentionally shows the fast cached columns. Charts are plain CSS bars/histograms (`.chart-bar-*`, `.histogram-*`, `.option-dist-*` in `app/globals.css`) — no charting library.
- `lib/db.ts` — lazy mysql2 pool (`getPool()`); creates database + table on first connection. Never connect at module top level: pages/routes must stay `dynamic = "force-dynamic"` so `next build` (and Docker builds, which have no DB) never touches MySQL.
- `lib/repo.ts` — all SQL for the `assessments` table.
- `app/api/assessments*` — REST routes: list/create, get/put/delete, and `POST [id]/submit` which validates `canSubmit` server-side and generates the reference number (`พสศ-{year}-{NNNN}`).
- `components/AssessmentForm.tsx` — client component owning form state + 800 ms debounced autosave; child components (`ScoreRail`, `UnitPanel`, `DimensionPanel`, `SummaryPanel`) are pure/presentational.
- `app/globals.css` — plain CSS with custom properties (no CSS framework); Sarabun via `next/font/google`. The `@media print` block (used by the "พิมพ์" button / browser print-to-PDF) is styled to resemble a formal Thai government form: colored section-header bands, fill-in-the-blank underlines instead of input boxes, level options rendered as a ☐/☑ checkbox list (pure CSS on the same `.level-option` buttons — no separate print template), and a signature block (`.print-signoff` in `SummaryPanel.tsx`, hidden on screen) at the end. When changing indicator/unit markup, re-check these print overrides still target the right selectors.

`legacy/` holds the original static prototype (localStorage version) — reference only, excluded from tsconfig and Docker.

## Domain Rules (from the spec — do not violate when touching scoring)

The authoritative spec is `docs/ข้อเสนอเกณฑ์และตัวชี้วัด-พสศ-v1.md`: per-indicator scoring tables in §4 (use the "เสนอ" column), cut-off logic in §5, roles/data model/workflow for the intended full system in §8, validation flags V01–V10 in §8.5. Implemented flags: V02, V04, V06, V07, V09 + app-local V00 (count > total students). Tone `"block"` prevents submission.

- Users enter raw data only (counts, minutes, level selections) — never add an input where a user types a score directly, and never trust client-computed scores (server recomputes via `lib/scoring.ts`).
- Normal conditions = 0 points; no free base points anywhere.
- Score ranges follow "เกิน a – ไม่เกิน b" (exclusive lower bound, inclusive upper), with no gaps or overlaps; percentages use 2 decimal places.
- PDPA: student data is aggregate totals only — the app must never collect or accept individual student name lists (ethnicity, poverty, disability, and registration status are sensitive data). Keep everything utf8mb4.
- No authentication yet (prototype scope); the spec's role system (§8.1) is future work — mention this when adding outward-facing features.

## Deployment

`Dockerfile` (multi-stage, standalone output) + `docker-compose.yml` (app on :3000 + MySQL 8.4 with data bind-mounted at `./data/mysql`, uploaded evidence files at `./data/uploads` → container `/app/uploads`). Both services read `.env.production`. Full runbook in `docs/DEPLOY.md`, including the variant that points at an existing host MySQL via `host.docker.internal`.

UI text and domain terminology are Thai — keep wording consistent with the spec when adding features.
