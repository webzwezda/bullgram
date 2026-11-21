// bullgram_userbot_media_download — REST-only binary download of a message's
// media. Streams bytes (application/octet-stream) with a brapi_ Bearer token.
//
// The __binary marker is handled by external/operation-routes.js (streams the
// stored file instead of res.json) and flagged to the OpenAPI generator via
// transports.rest.binaryResponse. Deliberately NOT exposed via MCP — MCP
// agents use bullgram_userbot_media_save (signed URL) instead.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function mediaDownloadHandler({ supabase, req, args, userbotService }) {
    if (!req?.user?.id) {
        throw new MCPError(ERROR_CODES.INTERNAL, 'media_download requires authenticated user', {});
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

    return {
        __binary: true,
        filePath: saved.absolute_path,
        contentType: saved.mime || 'application/octet-stream',
        fileName: saved.file_name,
        sizeBytes: saved.size_bytes,
        sha256: saved.sha256
    };
}

registerOperation('bullgram_userbot_media_download', {
    handler: mediaDownloadHandler,
    requiredScopes: ['api:userbot:read'],
    requiresIntegrationToken: true,
    rateLimitClass: 'read',
    title: 'Download message media (binary)',
    description: 'Streams a message\'s media bytes (application/octet-stream) with Content-Disposition. '
        + 'Downloads into a server-side temp store first (files wiped after ~1h); the X-Media-SHA256 header '
        + 'lets you verify integrity. MCP agents: use bullgram_userbot_media_save instead (signed URL). '
        + 'Size cap 200MB by default (MEDIA_MAX_BYTES env).',
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
        mcp: false,
        rest: {
            method: 'GET',
            path: '/userbots/{userbot_id}/chats/{chat_id}/messages/{message_id}/media',
            tags: ['userbots'],
            summary: 'Download message media (binary stream)',
            binaryResponse: true
        }
    }
});
