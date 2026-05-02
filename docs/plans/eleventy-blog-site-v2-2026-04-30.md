# 11ty Blog As Separate Static Runtime

## Goal

Add a static Markdown blog at `/blog/`, built with Eleventy, while keeping the public product runtime v2-only:

- `/` stays the React/Vite homepage.
- `/pricing` and `/shop` stay React/Vite routes.
- `/blog/` becomes a separate static Eleventy runtime generated from `.md` files.
- The blog uses the same broad visual shell as the current homepage: left navigation, slate page background, and one rounded white content block in the main area.
- The blog sidebar is static. Do not port the React/Supabase auth widget into Eleventy.
- The blog uses a standalone CSS file that visually matches the current shell. Do not add Tailwind to the first blog iteration.

## User Correction Captured

Do not generate the blog into `site-v2/dist/blog/`.

The intended architecture is:

- create a top-level `blog/` folder;
- build Eleventy into `blog/_site/`;
- deploy `blog/_site/` to the server;
- configure nginx so `/blog/` is served from that deployed Eleventy `_site` output.

## Current Repo Facts

- `site-v2` is a React/Vite app.
- Root app shell already owns the left sidebar and main padded content area.
- Production deploy runs `npm --prefix site-v2 run build`, then rsyncs `site-v2/dist/`.
- There is no blog or Eleventy setup in the active runtime.
- Current nginx serves `/` from `/var/www/bullrun-site-v2` with SPA fallback to `/index.html`.
- Current nginx serves `/app/` from `/var/www/bullrun-admin-v2`.
- A separate `/blog/` nginx location should be added before `location /`.

## Architecture Decision

Use Eleventy as a separate top-level static content generator.

Recommended output path:

- source: `blog/`
- layouts/includes: `blog/_includes/`
- posts: `blog/posts/*.md`
- generated output: `blog/_site/`
- server path: `/var/www/bullrun-blog`

Build order:

1. Run the existing Vite builds for `site-v2` and `admin-v2`.
2. Run Eleventy build in `blog/`.
3. Deploy `site-v2/dist/` to `/var/www/bullrun-site-v2`.
4. Deploy `admin-v2/dist/` to `/var/www/bullrun-admin-v2`.
5. Deploy `blog/_site/` to `/var/www/bullrun-blog`.

This keeps the blog independent from the React build and makes nginx responsible for routing `/blog/` to the static `_site` output.

Styling decision:

- Do not use Tailwind in `blog/` for the first implementation.
- Create `blog/styles/blog.css` with hand-written CSS that matches the active `site-v2` shell.
- Reuse visual values rather than runtime code: slate background, white sidebar, blue active nav, rounded white main canvas, restrained article typography.

Auth decision:

- Do not make the left auth card dynamic in the 11ty blog.
- Replace it with a static block that looks related to the site auth card and links to `/app`.
- Reason: current auth state lives in React `AuthProvider` and Supabase client state; pulling it into static 11ty would add avoidable coupling.

Deployment modes:

- `npm run deploy:v2` should always build and deploy `site-v2`, `admin-v2`, and `blog`.
- `npm run deploy:blog` should build and deploy only `blog/_site/` for content-only publishing.
- Rollback should support the combined v2 release and, ideally, a focused blog rollback using the same timestamped backup structure.

## Nginx Plan

Add a location before `location /`:

```nginx
location ^~ /blog/ {
    alias /var/www/bullrun-blog/;
    try_files $uri $uri/ =404;
    add_header Cache-Control "public, max-age=3600";
}
```

Notes:

- Use `alias` because the URL prefix `/blog/` maps to the root of the built `_site`.
- Keep this block above the root SPA fallback so React does not catch `/blog/`.
- Add `location = /blog { return 301 /blog/; }` so the no-slash URL does not fall through to the React SPA.
- Use `=404` for missing blog files because this is a static Eleventy blog, not an SPA.
- If the blog needs immutable hashed assets later, split `/blog/assets/` with a longer cache TTL.

## URL Shape

- `/blog/` - blog index with latest posts.
- `/blog/my-post-slug/` - individual article pages.
- Optional later: `/blog/tag/telegram/` or `/blog/archive/`.
- Use simple slug URLs for the first implementation, not date-prefixed URLs.

Markdown frontmatter:

```yaml
---
title: "Как не терять оплативших пользователей в Telegram"
description: "Короткий лид для SEO и карточки списка."
date: 2026-04-30
tags:
  - telegram
  - access
---
```

## Visual Plan

Visual thesis:

The blog should feel like the same BullRun product surface as the homepage: calm slate shell, left operator-style navigation, and a crisp white reading canvas with large rounded corners.

Content plan:

- Blog index: compact intro, latest article list, optional featured article.
- Article page: title, date, description, Markdown body, back-to-blog link.
- Footer strip: soft CTA back to pricing/shop, but not a marketing-heavy landing page.

Interaction thesis:

- Left nav active state for `Блог`.
- Subtle hover states on article rows.
- No heavy animation for articles; readability wins.

Design rules:

- Recreate the shell geometry from `site-v2/src/App.jsx` in static HTML/CSS: slate background, left sidebar width, `p-4 sm:p-6 lg:p-8` main gutter.
- Use a single rounded white content block for the blog body, matching the homepage fix: `overflow-hidden`, large radius, white surface.
- Use a static sidebar login CTA instead of the real React `LoginCard`.
- Keep CSS local to `blog/styles/blog.css`; do not introduce Tailwind or Vite into `blog/`.
- Do not build a card grid as the main blog layout. Use article rows or a restrained list.
- Keep article typography readable: max width around `760px`, comfortable line height, strong headings, no negative letter spacing for body text.

## Implementation Steps

- [x] Create top-level `blog/`.
- [x] Add `blog/package.json` with Eleventy scripts.
- [x] Add `blog/.eleventy.cjs` or `blog/eleventy.config.cjs`.
- [x] Add build scripts:
  - root `build:blog`: `npm --prefix blog run build`
  - root `deploy:blog`: build and rsync only `blog/_site/`
- [x] Create `blog/_data/site.js` for title, nav, base URLs.
- [x] Create `blog/_includes/layouts/base.njk` for the shared blog shell.
- [x] Create static sidebar markup with nav links and a simple `/app` login CTA.
- [x] Create `blog/_includes/layouts/post.njk` for article pages.
- [x] Create `blog/index.njk` for the blog listing.
- [x] Create `blog/styles/blog.css`, copied by Eleventy to `_site/styles/blog.css`.
- [x] Create `blog/assets/` for post images and static blog media.
- [x] Add one starter Markdown post under `blog/posts/`.
- [x] Add `Блог` to the React left nav in `site-v2/src/App.jsx` as a normal external/static link to `/blog/`.
- [x] Skip homepage CTA for now to avoid cluttering the hero.
- [x] Update `ops/nginx/bullrun.ru.conf` with `/blog` redirect and `location ^~ /blog/`.
- [x] Update `ops/scripts/deploy-v2.sh` to build and rsync `blog/_site/` to `/var/www/bullrun-blog` on every v2 deploy.
- [x] Add `ops/scripts/deploy-blog.sh` and root `deploy:blog` for blog-only deploys.
- [x] Update rollback script so `v2` rollback restores site, admin, and blog together.
- [x] Add a focused `blog` rollback target.

## Verification Plan

- [x] Run `cd blog && npm run build`.
- [x] Confirm `blog/_site/index.html` exists.
- [x] Confirm at least one `blog/_site/<slug>/index.html` exists.
- [x] Inspect generated HTML for correct CSS path and nav links.
- [x] Run `npm run build:v2` to verify site, admin, and blog together.
- [x] Verify React routes still build normally.
- [x] Run `bash -n` on deploy and rollback scripts.
- [x] Run `nginx -t` on server after applying nginx config.
- [x] Before deploy, verify `site-v2/dist/index.html`, `admin-v2/dist/index.html`, and `blog/_site/index.html` are all present.
- [x] Deploy full frontend release with `npm run deploy:v2` after local builds pass.
- [x] Deploy content-only changes with `npm run deploy:blog` after `cd blog && npm run build` passes.
- [x] After deploy, verify:
  - `/` still serves React homepage.
  - `/app/` still serves admin app.
  - `/blog/` serves Eleventy index.
  - `/blog/<slug>/` serves an article.

## Risks And Guardrails

- `deploy:v2` currently uses `rsync --delete` only for site/admin dirs. Keep blog in a separate server dir so site deploy cannot delete it.
- Since `deploy:v2` will include blog, snapshot `/var/www/bullrun-blog` in the same release directory too.
- React Router wildcard must not hijack `/blog/`; nginx `location ^~ /blog/` must appear before root fallback.
- Avoid duplicating too much React UI in 11ty. Duplicate only the shell CSS needed for static pages.
- Do not port `AuthProvider`, `LoginCard`, or Supabase auth logic into the blog.
- Do not introduce legacy `/admin` wording or routes.
- Blog content should speak about BullRun as private Telegram paid-access infrastructure, not evasion tooling.

## Open Questions

- Resolved: show `/blog/` in the main left nav immediately.
- Resolved: start with Russian content only; no `ru/en` routing in the first implementation.
- Resolved: use simple post slugs like `/blog/post/`, not date-prefixed URLs.
- Resolved: store post images and static media in `blog/assets/`.
- Resolved: create one Russian starter post as editable placeholder content.
- Resolved: blog deploy should be both part of `deploy:v2` and available as separate `deploy:blog`.
- Resolved: no Tailwind for the first blog iteration; use hand-written matching CSS.
- Resolved: no dynamic auth widget in the first blog iteration; use static `/app` CTA.

## Review Notes

- Implemented locally and verified with `npm run build:v2`.
- `blog/_site/index.html` and `blog/_site/telegram-paid-access/index.html` are generated.
- Generated blog links use `/blog/...`, while output files stay rooted inside `_site/` for nginx `alias /var/www/bullrun-blog/`.
- `deploy:v2` now snapshots, builds, deploys, permissions, and verifies blog with site/admin.
- `deploy:blog` supports content-only publishing.
- `rollback.sh v2` restores site, admin, and blog together when that release has a blog backup; older pre-blog releases leave the current blog directory unchanged instead of aborting site/admin rollback.
- `rollback.sh blog` restores only blog and requires a blog backup.
- Reviewer findings addressed: pre-blog rollback compatibility, static 404 behavior for missing blog URLs, and stronger deploy verification for blog CSS plus at least one generated post page.
- Production deploy completed with `npm run deploy:v2`; rollback timestamp is `20260429-150541`.
- Production nginx config applied to both `/etc/nginx/sites-available/bullrun.ru` and `/etc/nginx/sites-enabled/bullrun.ru`.
- `nginx -t` passed and `nginx -s reload` completed.
- Live verification passed:
  - `https://bullrun.ru/` returns 200.
  - `https://bullrun.ru/app/` returns 200.
  - `https://bullrun.ru/blog` redirects to `/blog/`.
  - `https://bullrun.ru/blog/` returns 200 and contains the blog index.
  - `https://bullrun.ru/blog/telegram-paid-access/` returns 200 and contains the starter article.
  - `https://bullrun.ru/blog/does-not-exist/` returns 404.
  - `https://bullrun.ru/blog/styles/blog.css` returns 200.
- Follow-up cleanup completed: duplicate nginx warning came from a backup file inside `/etc/nginx/sites-enabled/` (`bullrun.ru..bak`), which nginx includes as active config. The backup was moved to `/etc/nginx/manual-backups/bullrun.ru.20260429-151047.enabled.bak`.
- `nginx -t` is now clean with no duplicate server-name warnings.
- nginx reloaded again after cleanup; `/`, `/app/`, `/blog/`, `/blog/telegram-paid-access/`, and `/blog/does-not-exist/` still return the expected statuses.
- Pagination test completed:
  - Added five extra test posts under `blog/posts/`.
  - `blog/index.njk` now uses Eleventy pagination with `size: 4`.
  - `/blog/` shows 4 latest posts and `Страница 1 из 2`.
  - `/blog/1/` shows the remaining 2 posts and `Страница 2 из 2`.
  - Pagination links use `/blog/1/` and `/blog/`.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260429-151557`.
- Sidebar visual refinement completed:
  - Blog sidebar now uses inline SVG icons for the same four main navigation items.
  - Static auth area now mirrors the main site's Google login card visually, while still linking to `/app` without pulling auth logic into 11ty.
  - `npm --prefix blog run build` passed.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260429-152748`.
  - Live `/blog/` returns 200 and contains the Google login label, SVG nav icons, and pagination.
  - Live pagination still shows 4 post links on `/blog/` and 2 post links on `/blog/1/`.
- Sidebar correction completed after visual review:
  - Replaced approximate icon drawings with closer static lucide SVG paths for dashboard, credit card, shopping bag, and newspaper.
  - Removed the extra decorative login overlay and tightened sidebar/login CSS toward the exact React/Tailwind classes used on the main site.
  - `npm --prefix blog run build` passed.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260429-153352`.
  - Live `/blog/` returns 200 and contains the refined nav, Google login label, `Страница 1 из 2`, and `/blog/1/` pagination link.
  - Live pagination still shows 4 post links on `/blog/` and 2 post links on `/blog/1/`.
- Category section completed:
  - Added `category` front matter to all current posts.
  - Added category pages under `/blog/category/telegram/`, `/blog/category/payments/`, `/blog/category/retention/`, and `/blog/category/shop/`.
  - Added a `Категории` section to the static blog sidebar with live post counts.
  - Blog post lists and article meta now show each post's main category.
  - `npm --prefix blog run build` passed and generated 12 files.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260430-111057`.
  - Live `/blog/category/telegram/` returns 200 and shows 3 posts.
  - Live category counts: `telegram=3`, `payments=1`, `retention=1`, `shop=1`.
  - Live main pagination still shows 4 post links on `/blog/` and 2 post links on `/blog/1/`.
- Blog sidebar menu simplified:
  - Removed the main site links from the static blog sidebar.
  - Left only `Все статьи` and `Телеграм` in the blog menu, with counts 6 and 3.
  - `npm --prefix blog run build` passed.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260430-111426`.
  - Live `/blog/` and `/blog/category/telegram/` both contain exactly 2 blog menu links.
- Telegram category pagination test completed:
  - Added five test posts with `category: telegram`.
  - Added `collections.telegramPosts` and enabled pagination on `/blog/category/telegram/` with `size: 4`.
  - Telegram category now generates `/blog/category/telegram/` and `/blog/category/telegram/1/`.
  - `npm --prefix blog run build` passed and generated 19 files.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260430-111812`.
  - Live `/blog/category/telegram/` shows 4 post links and `Страница 1 из 2`.
  - Live `/blog/category/telegram/1/` shows 4 post links and `Страница 2 из 2`.
  - Blog menu counts are now `Все статьи=11` and `Телеграм=8`; main blog pagination is now `Страница 1 из 3`.
- Telegram category URL shortened:
  - Changed Telegram category permalink from `/blog/category/telegram/` to `/blog/telegram/`.
  - Changed second page from `/blog/category/telegram/1/` to `/blog/telegram/1/`.
  - Updated sidebar and article category links to the new URL.
  - Ran a clean rebuild after removing `blog/_site`; old local `blog/_site/category/telegram/` was not regenerated.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260430-112156`.
  - Deploy deleted the old server `category/telegram/` files through `rsync --delete`.
  - Live `/blog/telegram/` and `/blog/telegram/1/` return 200 and each show 4 post links.
  - Live `/blog/category/telegram/` now returns 404.
- Mobile blog menu completed:
  - Replaced the mobile login link in the blog header with a hamburger button.
  - Added a static vanilla JS drawer controller for open, overlay close, link close, Escape close, and desktop resize cleanup.
  - Converted the mobile sidebar into a fixed left drawer with overlay, `100svh` height, and scroll lock while open.
  - Kept the desktop sidebar unchanged.
  - `npm --prefix blog run build` passed.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260501-074056`.
  - Live `/blog/` returns 200 and contains the drawer button, overlay, sidebar id, and `blog-menu-open` controller logic.
  - Live CSS contains the mobile drawer rules and the blog menu still has exactly 2 links.
- Mobile menu regression fixed:
  - Added CSS cache-busting with `site.assetVersion` because `/blog/styles/blog.css` is cached by nginx for one hour.
  - Removed the closed drawer edge by moving it fully offscreen.
  - Replaced the transform-based drawer with a `left`-based drawer.
  - Removed the drawer transition after cmux browser showed the CSS transition stayed on the first frame and prevented the drawer from reaching the open position.
  - Deployed via `npm run deploy:blog`; final rollback timestamp is `20260501-075131`.
  - Live HTML now references `/blog/styles/blog.css?v=20260501-5`.
  - Browser verification in cmux:
    - closed state: sidebar rect `left=-754`, `right=-434`, no shadow, pointer events disabled.
    - after clicking hamburger: `bodyClass=blog-menu-open`, `aria-expanded=true`, sidebar rect `left=0`, `right=320`, pointer events enabled.
    - after clicking overlay: menu closes and returns fully offscreen.
- Three-category blog taxonomy completed:
  - Public category menu now contains `Телеграм`, `Steam`, and `Крипта`, plus `Все статьи`.
  - Added category pages and paginated collections for `/blog/telegram/`, `/blog/steam/`, and `/blog/crypto/`.
  - Removed old public category pages for `/blog/category/payments/`, `/blog/category/retention/`, and `/blog/category/shop/`.
  - Reassigned old `payments`, `retention`, and `shop` test posts into the new three-category taxonomy.
  - Added five Steam placeholder posts and three Crypto placeholder posts so each new category has pagination with `size: 4`.
  - `npm --prefix blog run build` passed after a clean `_site` rebuild and generated 31 files.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260501-111835`.
  - Live menu counts are `Все статьи=19`, `Телеграм=9`, `Steam=5`, `Крипта=5`.
  - Live `/blog/telegram/` shows `Страница 1 из 3`.
  - Live `/blog/steam/` shows `Страница 1 из 2`; `/blog/steam/1/` has 1 post.
  - Live `/blog/crypto/` shows `Страница 1 из 2`; `/blog/crypto/1/` has 1 post.
  - Live `/blog/category/payments/` returns 404 after deploy cleanup.
- Placeholder cleanup completed:
  - Kept one article per category:
    - `telegram-paid-access.md` for `Телеграм`.
    - `steam-skins-market-basics.md` for `Steam`.
    - `crypto-ton-payments.md` for `Крипта`.
  - Deleted the extra test placeholder posts.
  - Category pagination templates remain in place with `size: 4`, so pagination will reappear automatically when a category has 5+ posts.
  - Clean rebuild generated 7 files and no pagination directories.
  - Deployed via `npm run deploy:blog`; rollback timestamp is `20260501-112321`.
  - Live counts are now `Все статьи=3`, `Телеграм=1`, `Steam=1`, `Крипта=1`.
  - Live `/blog/telegram/`, `/blog/steam/`, and `/blog/crypto/` each show exactly 1 post.
  - Old pagination URLs `/blog/1/`, `/blog/telegram/1/`, `/blog/steam/1/`, and `/blog/crypto/1/` return 404 after deploy cleanup.
