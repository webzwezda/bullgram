# Blog SEO Discover Fixes - 2026-05-02

## Goal

Make the Eleventy blog generate clean `/blog/` URLs and avoid broken image metadata so future posts have a safer baseline for Google indexing and Discover eligibility.

## Checklist

- [x] Remove double `/blog/blog` URL generation.
- [x] Add `max-image-preview:large` to indexable pages.
- [x] Only emit `og:image`, `twitter:image`, JSON-LD `image`, and article cover markup when a page explicitly defines `image`.
- [x] Add `dateModified`, `mainEntityOfPage`, and publisher data to article JSON-LD.
- [x] Point blog feed, sitemap, and robots metadata at `/blog/`.
- [x] Add nginx root `/robots.txt` and `/sitemap.xml` handling for the blog sitemap.
- [x] Keep the Markdown kitchen-sink page out of public collections and sitemap.
- [x] Verify `npm --prefix blog run build`.

## Rules Learned

- Do not rely on Eleventy `pathPrefix` for this deployment shape. The blog is deployed as `_site` into an nginx alias under `/blog/`, so links should use explicit blog URL helpers.
- Do not add a default social image unless the file actually exists and is suitable for Discover. Future posts should define their own `image` and `imageAlt` when they need rich previews.
- Clean `blog/_site` before final verification when removing or hiding pages, because Eleventy does not automatically delete stale generated files.

## Review

The generated HTML now uses `/blog/styles/blog.css`, `/blog/<slug>/`, and `/app` correctly. JSON-LD scripts parse as valid JSON. Sitemap excludes the hidden Markdown demo page. The remaining ranking requirement is editorial: real posts need useful content and large relevant images, preferably 1200px+ wide.
