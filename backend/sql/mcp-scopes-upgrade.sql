-- Atomic migration: replace deprecated 'mcp:use' scope with granular scopes.
-- Plan 01 Migration 2.
--
-- Before: tokens issued with purpose='mcp' had scopes = ['mcp:use']
-- After:  same tokens have scopes = ['mcp:proxy:read', 'mcp:userbot:read']
--
-- Run inside a transaction so partial states are impossible.

begin;

update public.integration_tokens
set scopes = array(
  select distinct s from unnest(
    array_replace(
      array_replace(scopes, 'mcp:use', 'mcp:proxy:read'),
      'mcp:use', 'mcp:userbot:read'
    )
  ) as s
  where s <> 'mcp:use'
)
where purpose = 'mcp' and 'mcp:use' = any(scopes);

commit;
