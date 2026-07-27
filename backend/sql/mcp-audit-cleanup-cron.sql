-- Daily cleanup of mcp_tool_log rows older than 90 days.
-- Plan 01 Migration 3. Requires pg_cron extension.

select cron.schedule(
  'mcp_audit_log_cleanup',
  '0 3 * * *',  -- daily at 03:00 UTC
  $$
    delete from public.mcp_tool_log
    where started_at < now() - interval '90 days';
  $$
);
