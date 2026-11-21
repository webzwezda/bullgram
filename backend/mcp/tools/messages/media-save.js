// bullgram_userbot_media_save — download a message's media to the server-side
// internal store and return metadata + a short-lived signed download URL.
//
// Why a signed URL: brmcp_ (MCP) tokens are rejected on the REST surface, so
// an MCP agent cannot stream bytes itself. The signed link is public but
// HMAC'd, path-scoped and expires (default 15 min). brapi_ (REST) callers can
// also use the binary GET .../media endpoint directly.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { signMediaToken, MEDIA_URL_TTL_MS_DEFAULT } from '../../../utils/media-link.js';
import { loadOwnedUserbot } from '../account/health.js';

const MEDIA_URL_TTL_MS = readTtl();

function readTtl() {
    const n = Number(process.env.MEDIA_URL_TTL_MS);
    return Number.isFinite(n) && n > 0 ? n : MEDIA_URL_TTL_MS_DEFAULT;
}

export async function mediaSaveHandler({ supabase, req, args, userbotService }) {
    if (!req?.user?.id) {
        throw new MCPError(ERROR_CODES.INTERNAL, 'media_save requires authenticated user', {});
    }
    if (!isValidUuid(args?.userbot_id)) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
    }
    if (!args?.chat_id) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
    }
    if (!args?.message_id) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_id" is required.', {});
    }
    const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

    const saved = await userbotService.downloadChatMedia(userbot, {
        chatId: args.chat_id,
        messageId: args.message_id,
        ownerId: req.user.id,
        maxBytes: args?.max_bytes
    });

    const token = signMediaToken({ relPath: saved.file_path, ttlMs: MEDIA_URL_TTL_MS, mime: saved.mime });
    const base = `${req.protocol}://${req.get('host')}/api/external/v1`;
    return {
        file_name: saved.file_name,
        mime: saved.mime,
        size_bytes: saved.size_bytes,
        sha256: saved.sha256,
        download_url: `${base}/media/${token}`,
        expires_at: new Date(Date.now() + MEDIA_URL_TTL_MS).toISOString(),
        storage: 'server-temp'
    };
}

registerOperation('bullgram_userbot_media_save', {
    handler: mediaSaveHandler,
    requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
    requiresIntegrationToken: true,
    rateLimitClass: 'read',
    title: 'Save message media to server store',
    description: 'Download a message\'s media (document/photo; video & audio arrive as documents) from a chat '
        + 'into the server-side temp store and return { file_name, mime, size_bytes, sha256, download_url, expires_at }. '
        + 'download_url is a signed, expiring (15 min) link — fetch it right away to get the bytes. '
        + 'Size cap: 200MB by default (MEDIA_MAX_BYTES env; per-call max_bytes can lower it, not raise above the cap). '
        + 'Stored files are wiped after ~1h. For raw streaming with a brapi_ token use '
        + 'GET /userbots/{userbot_id}/chats/{chat_id}/messages/{message_id}/media.',
    inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['userbot_id', 'chat_id', 'message_id'],
        properties: {
            userbot_id: { type: 'string', format: 'uuid' },
            chat_id: { type: 'string', description: 'Telegram chat ID (channels start with -100).' },
            message_id: { type: 'string', description: 'Telegram message ID with the media.' },
            max_bytes: { type: 'integer', minimum: 1024, description: 'Override the size cap (cannot exceed the server cap).' }
        }
    },
    transports: {
        mcp: true,
        rest: { method: 'POST', path: '/userbots/{userbot_id}/chats/{chat_id}/messages/{message_id}/media/save', tags: ['userbots'], summary: 'Save message media to server store' }
    }
});
