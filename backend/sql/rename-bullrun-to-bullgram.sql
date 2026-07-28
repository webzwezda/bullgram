-- Rebrand migration: rename bullrun_* identifiers to bullgram_*
-- Apply once on existing prod DB. Fresh installs use backend/sql/protected-referrals-ton-reserve.sql
-- and backend/sql/userbot-fingerprint-presets.sql which already use bullgram_*.

BEGIN;

ALTER TABLE public.referral_events
  RENAME COLUMN bullrun_fee_ton_amount TO bullgram_fee_ton_amount;

ALTER TABLE public.referral_reserve_accounts
  RENAME COLUMN bullrun_fee_accrued_ton TO bullgram_fee_accrued_ton;

UPDATE public.userbot_fingerprint_presets
  SET id = REPLACE(id, 'bullrun_', 'bullgram_')
  WHERE id LIKE 'bullrun_%';

COMMIT;
