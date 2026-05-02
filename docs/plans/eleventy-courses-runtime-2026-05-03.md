# Eleventy Courses Runtime - 2026-05-03

## Goal

Add a separate Eleventy runtime for free introductory BullRun courses under `/courses/`, independent from the blog runtime and deployable on its own.

## Scope

- [x] Create top-level `courses/` runtime.
- [x] Mirror the blog shell design with a course-aware left menu.
- [x] Add Telegram, Steam, and Crypto course pages.
- [x] Add starter lessons for each course.
- [x] Add SEO metadata with optional image handling.
- [x] Add sitemap and robots artifact for courses.
- [x] Add root package scripts for build/deploy/rollback.
- [x] Add deploy and rollback support for `/var/www/bullrun-courses`.
- [x] Add nginx route for `/courses/` and include the courses sitemap in root robots.
- [x] Verify production-style build output without running a local server.

## Guardrails

- Do not use Eleventy `pathPrefix`; use explicit `/courses` URL helpers to avoid `/courses/courses`.
- Do not emit image metadata unless `image` is explicitly provided in front matter.
- Clean `_site` before deploy/build verification when removing pages.
- Keep this runtime read-only/free for now; do not add paid access gates.

## Review Notes

Implemented `courses/` as a separate Eleventy runtime with explicit `/courses` URL helpers. Added three course pages and two starter lessons per course. Build output was checked for `/courses/courses`, broken default image metadata, sitemap URLs, and JSON-LD parsing.

Verification run:

- `npm --prefix courses install`
- `npm run build:courses`
- `bash -n ops/scripts/deploy-courses.sh`
- `bash -n ops/scripts/deploy-v2.sh`
- `bash -n ops/scripts/rollback.sh`

No local dev server was started.
