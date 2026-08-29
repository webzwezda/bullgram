---
title: Quick Start
group: Get Started
order: 1
layout: layout.njk
---

Get up and running with Bullgram in a few minutes.

## 1. Create an account

Sign in with Google or Telegram — the Trial plan is free for 14 days, no card required.

## 2. Get an API token

Open **/app/integrations** in your dashboard and issue a token.

## 3. Make your first call

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://bullgram.xyz/api/external/v1/me
```

That's it — you are talking to the Bullgram API.
