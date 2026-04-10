# Domain Migration: bullrun.ru

## Plan

- [x] Inspect live nginx, certificates, backend env, and auth runtime on production.
- [x] Confirm current blockers for auth migration: `SITE_URL`, `API_EXTERNAL_URL`, Google callback, redirect allow list still point to `prsng.ru`.
- [x] Update repo defaults and `ops/nginx/bullrun.ru.conf` to match the active v2 product runtime.
- [x] Update production nginx so `bullrun.ru` serves the product runtime only, without self-hosted infra paths.
- [x] Update production backend env defaults to `bullrun.ru` and restart backend safely.
- [x] Update self-hosted Supabase Auth env to `bullrun.ru`, while temporarily keeping `prsng.ru` in redirect allow lists during migration.
- [x] Verify `https://bullrun.ru/` and `https://bullrun.ru/app`, plus confirm excluded infra paths on `bullrun.ru` return `404`.
- [ ] After Google OAuth is updated in Google Cloud, verify admin login on `bullrun.ru`.
- [ ] Only after successful auth verification, decide whether to 301 `prsng.ru` to `bullrun.ru`.

## Notes

- Current live product runs on `prsng.ru`, while `bullrun.ru` serves maintenance only.
- Google OAuth currently depends on self-hosted Supabase Auth values under `/home/n8nuser/supabase/docker/.env`.
- Safer migration path is dual-domain support first, redirect later.
- `bullrun.ru` must expose only product routes. Self-hosted operator paths such as `secretvpn`, `portainer`, `vault`, `mail`, `umami`, and other infra endpoints stay on `prsng.ru`.
- `prsng.ru` must become infra-only. Product paths such as `/`, `/app`, `/api`, `/auth`, `/rest`, and `/realtime` should not serve the site there.

## Review

- `bullrun.ru` now serves the public site and `/app`, and `tonconnect-manifest.json` now points to `bullrun.ru`.
- `bullrun.ru` now returns `404` for product-external infra paths such as `/portainer/`, so they no longer leak into the SPA.
- Backend `.env` now uses `SUPABASE_URL=https://bullrun.ru` and `PUBLIC_APP_ORIGIN=https://bullrun.ru`.
- Live `supabase-auth` container now uses `GOTRUE_SITE_URL=https://bullrun.ru`, `API_EXTERNAL_URL=https://bullrun.ru`, `GOTRUE_URI_ALLOW_LIST=https://bullrun.ru/**,https://prsng.ru/**`, and `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://bullrun.ru/auth/v1/callback`.
- Remaining external dependency: update the Google OAuth client to include `bullrun.ru` origin and callback before testing Google sign-in.
- Residual risk: Yandex OAuth redirect is still hardcoded in the self-hosted compose file to `prsng.ru`. That is separate from the current Google login path.
