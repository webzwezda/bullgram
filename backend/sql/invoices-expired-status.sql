-- invoices_status_check не допускал 'expired', который пишет cleanup
-- в jobs/invoice-auto-detect.job.js (markExpiredInvoices). Применено как
-- supabase migration 20260821070000.
alter table public.invoices
  drop constraint invoices_status_check;

alter table public.invoices
  add constraint invoices_status_check
  check (status = any (array['pending', 'awaiting_receipt', 'wait_admin', 'paid', 'rejected', 'expired']));
