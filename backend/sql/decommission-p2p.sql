-- Decommision P2P / SBP payment flow.
-- Product moved to TON-only payments. P2P webhook infrastructure (SMS Forwarder,
-- PDF receipt parsing, manual/auto confirm) is fully removed from backend & frontend.
-- See docs/ or plan "P2P rip-out + n8n → api rename" for context.

-- 1. Integration tokens: drop p2p_webhook + n8n purposes, add 'api' (renamed from n8n).
ALTER TABLE public.integration_tokens
  DROP CONSTRAINT IF EXISTS integration_tokens_purpose_check;
ALTER TABLE public.integration_tokens
  ADD CONSTRAINT integration_tokens_purpose_check
    CHECK (purpose IN ('mcp', 'api', 'custom'));

-- 2. Drop P2P tables. Confirmed: no inbound FKs, no views, no triggers.
DROP TABLE IF EXISTS public.p2p_bank_events CASCADE;
DROP TABLE IF EXISTS public.p2p_webhook_settings CASCADE;

-- 3. Drop P2P columns from payment_settings.
ALTER TABLE public.payment_settings
  DROP COLUMN IF EXISTS sbp_phone,
  DROP COLUMN IF EXISTS sbp_bank,
  DROP COLUMN IF EXISTS sbp_fio,
  DROP COLUMN IF EXISTS p2p_webhook_token_id,
  DROP COLUMN IF EXISTS p2p_bank_event_id,
  DROP COLUMN IF EXISTS card_number_mask;

-- NOTE: Historical shop_purchases rows with payment_method='p2p' are KEPT as accounting.
-- They simply render as archived/unknown payment method in admin UI.
