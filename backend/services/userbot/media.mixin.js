// Media mixin — download chat media (documents/photos/video/audio/voice)
// from Telegram via teleproto into an INTERNAL temp store.
//
// Why an internal store instead of returning bytes in the operation result:
//   - MCP results are JSON text; multi-MB base64 would blow up tool responses
//     (and mcp-remote truncates big payloads client-side anyway).
//   - The public /uploads static must not gain a new exposure surface.
//
// Consumers:
//   - bullgram_userbot_media_download (REST GET) streams the file bytes.
//   - bullgram_userbot_media_save (MCP + REST POST) returns metadata plus a
//     short-lived signed URL (utils/media-link.js) — brmcp_ tokens cannot call
//     REST, so the signed link is their only byte path.
//
// Files older than MEDIA_STORE_TTL_MS (default 1h) are swept opportunistically
// on every save. No DB, no cron.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';
import { summarizeMedia } from '../../shared/content-sanitizer.js';
import { wrapTelegramError } from './telegram-errors.js';
import { clampLimit, normalizeChatIdInput, normalizeMessageIdInput, safeDisconnect } from './helpers.js';
import { assertUserbotOperatable } from './botfather-lib.js';

export const MEDIA_MAX_BYTES_DEFAULT = 200 * 1024 * 1024;
export const MEDIA_STORE_TTL_MS_DEFAULT = 60 * 60 * 1000;

function envInt(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function mediaStoreRoot() {
    return path.join(process.cwd(), 'uploads-internal', 'chat-media');
}

function safeFileName(name, messageId, mime) {
    const base = String(name || '').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim();
    if (base) return base;
    const extByMime = {
        'application/pdf': 'pdf',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'audio/ogg': 'oga',
        'audio/mpeg': 'mp3'
    };
    return `media-${messageId}.${extByMime[mime] || 'bin'}`;
}

// Documents carry an explicit size; photos expose per-size entries.
function declaredMediaSize(media, meta) {
    if (meta?.kind === 'document') return Number(meta.size_bytes) || null;
    if (meta?.kind === 'photo') return Number(meta.size_bytes) || null;
    return null;
}

export const MediaMixin = (Base) => class extends Base {
    /**
     * Fetch one message and its media metadata. Throws MEDIA_NOT_FOUND /
     * MEDIA_UNSUPPORTED when there is nothing downloadable.
     */
    async getChatMedia(userbot, { chatId, messageId } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const mid = normalizeMessageIdInput(messageId);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeerForRead(client, userbot, id);
            const messages = await withTimeout(
                client.getMessages(peer, { ids: [mid] }),
                30_000,
                'getChatMedia'
            );
            const message = Array.isArray(messages) ? messages.find((m) => m?.id) : null;
            if (!message || !message.media) {
                throw new MCPError(ERROR_CODES.MEDIA_NOT_FOUND,
                    `Message ${mid} in chat ${id} not found or has no media.`, {});
            }
            const meta = summarizeMedia(message.media);
            const kind = meta?.kind;
            if (kind !== 'document' && kind !== 'photo') {
                throw new MCPError(ERROR_CODES.MEDIA_UNSUPPORTED,
                    `Message ${mid} media kind "${kind}" is not downloadable `
                    + '(downloadable: document (incl. video/audio/voice), photo).', { requested_kind: kind });
            }
            return { message, meta, chatId: id, messageId: mid };
        } catch (error) {
            if (error instanceof MCPError) throw error;
            throw await wrapTelegramError(this.supabase, userbot, error, 'getChatMedia');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Download the media of one message into the internal store.
     * Single client session: resolve → fetch message → size check → download.
     * Returns { file_path (relative to the store root), absolute_path,
     * file_name, mime, size_bytes, sha256, chat_id, message_id }.
     */
    async downloadChatMedia(userbot, { chatId, messageId, ownerId, maxBytes } = {}) {
        const maxBytesLimit = clampLimit(maxBytes ?? envInt('MEDIA_MAX_BYTES', MEDIA_MAX_BYTES_DEFAULT), 1024, 2 * 1024 * 1024 * 1024);
        assertUserbotOperatable(userbot);
        const normalizedChatId = normalizeChatIdInput(chatId);
        const mid = normalizeMessageIdInput(messageId);

        const client = await this.createAuthorizedClient(userbot);
        let localTmpPath = null;
        try {
            const peer = await this.resolveChatPeerForRead(client, userbot, normalizedChatId);
            const messages = await withTimeout(
                client.getMessages(peer, { ids: [mid] }),
                30_000,
                'downloadChatMedia:fetch'
            );
            const message = Array.isArray(messages) ? messages.find((m) => m?.id) : null;
            if (!message || !message.media) {
                throw new MCPError(ERROR_CODES.MEDIA_NOT_FOUND,
                    `Message ${mid} in chat ${normalizedChatId} not found or has no media.`, {});
            }
            const meta = summarizeMedia(message.media);
            const kind = meta?.kind;
            if (kind !== 'document' && kind !== 'photo') {
                throw new MCPError(ERROR_CODES.MEDIA_UNSUPPORTED,
                    `Message ${mid} media kind "${kind}" is not downloadable `
                    + '(downloadable: document (incl. video/audio/voice), photo).', { requested_kind: kind });
            }
            const declared = declaredMediaSize(message.media, meta);
            if (declared && declared > maxBytesLimit) {
                throw new MCPError(ERROR_CODES.MEDIA_TOO_LARGE,
                    `Media is ${declared} bytes, above the ${maxBytesBytesLabel(maxBytesLimit)} limit. `
                    + 'Raise MEDIA_MAX_BYTES or pass a larger max_bytes.', { size_bytes: declared, max_bytes: maxBytesLimit });
            }

            const fileLabel = safeFileName(meta?.file_name, mid, meta?.mime);
            const dir = path.join(mediaStoreRoot(), String(ownerId || 'unknown'), String(userbot?.id || 'unknown'), normalizedChatId);
            fs.mkdirSync(dir, { recursive: true });
            localTmpPath = path.join(dir, `${mid}.part`);
            const finalPath = path.join(dir, `${mid}-${fileLabel}`);

            // Size-scaled timeout: ~1s per MB over a 60s base, hard cap 10 min.
            const timeoutMs = Math.min(600_000, 60_000 + Math.ceil((declared || 0) / (1024 * 1024)) * 1_000);
            await withTimeout(
                client.downloadMedia(message, { outputFile: localTmpPath }),
                timeoutMs,
                'downloadChatMedia'
            );
            if (!fs.existsSync(localTmpPath)) {
                throw new MCPError(ERROR_CODES.TELEGRAM_ERROR, 'downloadMedia produced no file.', {});
            }
            const size = fs.statSync(localTmpPath).size;
            if (size > maxBytesLimit) {
                fs.unlinkSync(localTmpPath);
                throw new MCPError(ERROR_CODES.MEDIA_TOO_LARGE,
                    `Downloaded media is ${size} bytes, above the ${maxBytesBytesLabel(maxBytesLimit)} limit.`,
                    { size_bytes: size, max_bytes: maxBytesLimit });
            }
            fs.renameSync(localTmpPath, finalPath);
            const sha256 = await sha256File(finalPath);

            sweepExpiredMedia(dir);

            return {
                file_path: path.relative(mediaStoreRoot(), finalPath),
                absolute_path: finalPath,
                file_name: fileLabel,
                mime: meta?.mime || null,
                size_bytes: size,
                sha256,
                chat_id: normalizedChatId,
                message_id: mid
            };
        } catch (error) {
            if (localTmpPath) { try { fs.unlinkSync(localTmpPath); } catch {} }
            if (error instanceof MCPError) throw error;
            throw await wrapTelegramError(this.supabase, userbot, error, 'downloadChatMedia');
        } finally {
            await safeDisconnect(client);
        }
    }
};

function maxBytesBytesLabel(bytes) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 1 ? Math.round(mb) : Math.round(bytes / 1024)}${mb >= 1 ? 'MB' : 'KB'}`;
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

// Opportunistic TTL sweep: remove stored media older than the TTL window.
// Runs on every save — cheap (readdir over one chat dir), no cron needed.
export function sweepExpiredMedia(dir, ttlMs = envInt('MEDIA_STORE_TTL_MS', MEDIA_STORE_TTL_MS_DEFAULT), now = Date.now()) {
    try {
        for (const name of fs.readdirSync(dir)) {
            if (name.endsWith('.part')) continue;
            const full = path.join(dir, name);
            try {
                const stat = fs.statSync(full);
                if (stat.isFile() && now - stat.mtimeMs > ttlMs) fs.unlinkSync(full);
            } catch {}
        }
    } catch {}
}
