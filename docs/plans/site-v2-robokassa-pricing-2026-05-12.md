# Site v2 Robokassa pricing

## Context

Goal: prepare `/pricing` for Robokassa review by showing Trial, Normal, and custom order tariffs with visible buyer/legal information. Normal is the first active paid entry; custom order is visible but inactive for now.

User correction on verification: do not use localhost for this task; deploy first and verify the live server.

Robokassa requirements checked on 2026-05-12:
- public resource with no sale-page redirects;
- actual service description and real prices;
- contacts for buyer support;
- seller legal details in the site footer or visible legal block; user clarified the seller is self-employed, so the public seller block should use full name, INN, and city instead of OGRN/OGRNIP;
- offer / user agreement;
- terms for receiving the service, cancellation, and refunds;
- personal data policy if user data is collected.

Frontend thesis:
- visual thesis: quiet financial-service page, dense but clear, with Normal as the primary paid decision.
- content plan: hero, three tariffs, Normal delivery details, Robokassa readiness/legal information, final CTA.
- interaction thesis: clear active/inactive states for tariff actions, restrained CTA hover states, structured rows for moderation-critical information.

## Plan

- [x] Map current `/pricing` implementation.
- [x] Check current Robokassa public requirements.
- [x] Replace Normal with a custom-order paid tariff.
- [x] Add visible service delivery, cancellation, refund, offer, contacts, and seller details sections.
- [x] Build `site-v2`.
- [x] Return Trial, Normal, and inactive custom order tariff layout.
- [x] Replace self-employed seller placeholders with real public moderation data.
- [x] Deploy to server and verify live `/pricing`.
- [x] Publish filled offer DOCX on the site and add visible Robokassa-facing links.

## Review

`cd site-v2 && npm run build` passed on 2026-05-12 after the first custom-only version.
`cd site-v2 && npm run build` passed again after returning Trial, Normal, and inactive custom order.
`cd site-v2 && npm run build` passed after replacing self-employed seller placeholders. Passport data was intentionally not added to public code.

Local preview was started before the correction and stopped. Future checks for this task should use the deployed server only.

Production deploy completed with `npm run deploy:v2`, deploy timestamp `20260512-095259`.
Live verification on `https://bullrun.ru/pricing` confirmed:
- HTTP 200;
- Trial, Normal, and inactive custom order are visible;
- Normal shows `2 900 ₽` for `30 дней доступа` at the time of this 2026-05-12 verification;
- seller block shows full name, INN, region, email, and phone;
- browser console/errors check returned OK;
- passport data is not present in the visible page text.

Offer update on 2026-05-12:
- filled and adapted `/Users/webzwezda/Desktop/oferta_270415104864.docx` for BullRun as дистанционная услуга / доступ к сервису, not physical goods sale;
- published site copy at `site-v2/public/docs/oferta_270415104864.docx`;
- added public offer link on `/pricing` and pre-payment offer link on `/billing/normal`;
- `cd site-v2 && npm run build` passed;
- deployed with `npm run deploy:v2`, deploy timestamp `20260512-124423`;
- live `https://bullrun.ru/docs/oferta_270415104864.docx` returns `200` with DOCX MIME and expected size;
- live `/pricing?offer_check=20260512124423` contains `Скачать публичную оферту`;
- live browser console/errors check returned `OK`.

Correction on 2026-05-14:
- user clarified that BullRun `Normal` should be `900 ₽` for `365 дней доступа`;
- active code, offer DOCX, Robokassa receipt nomenclature, env examples, and server env must use `900 / 365`;
- old `2 900 / 30 дней` wording is no longer valid for BullRun Normal.
