/**
 * Chat media download (fix 2026-11-21): MediaMixin.downloadChatMedia on a
 * mocked teleproto client, signed media links (utils/media-link.js) and the
 * symmetric brapi_-rejection guard in agent-mcp-auth.
 *
 * Запуск: node test/media-download.test.js (gate-01 гоняет все test/*.test.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-key-32-bytes-long-xxxxxxxxxxx!';

import { MediaMixin, sweepExpiredMedia, MEDIA_MAX_BYTES_DEFAULT } from '../services/userbot/media.mixin.js';
import { signMediaToken, verifyMediaToken } from '../utils/media-link.js';
import { authenticateAgentOrUserToken } from '../utils/agent-mcp-auth.js';
import { MCPError, ERROR_CODES } from '../shared/errors.js';

const BASE = class {
    constructor() { this.supabase = {}; }
};

const USERBOT = { id: 'ub-media-1', session_data: 'x' };
const OWNER_ID = 'owner-1';

let failures = 0;
function assertEqual(actual, expected, label) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    }
}
function assertThrows(fn, code, label) {
    try {
        fn();
        failures++;
        console.error(`  ✗ ${label}: expected MCPError ${code}, nothing thrown`);
    } catch (e) {
        assertEqual(e instanceof MCPError && e.code, code, label);
    }
}

function makeService({ message, downloadBytes, onGetMessages } = {}) {
    const dlCalls = [];
    const fakeClient = {
        async getMessages(_peer, params) {
            if (onGetMessages) return onGetMessages(params);
            return params.ids ? [message] : [];
        },
        async downloadMedia(_message, { outputFile }) {
            dlCalls.push(outputFile);
            fs.writeFileSync(outputFile, Buffer.from(downloadBytes ?? 'PDFBYTES'));
            return outputFile;
        },
        async disconnect() {}
    };
    const svc = new (MediaMixin(BASE))();
    svc.createAuthorizedClient = async () => fakeClient;
    svc.resolveChatPeerForRead = async () => ({});
    return { svc, dlCalls };
}

const root = () => path.join(process.cwd(), 'uploads-internal', 'chat-media');

async function main() {
    const DOC_MEDIA = {
        document: {
            mimeType: 'application/pdf',
            size: { value: 7 },
            attributes: [{ fileName: 'ИИ от Ивина Андрея.pdf' }]
        }
    };

    console.log('--- downloadChatMedia: happy path ---');
    {
        const { svc } = makeService({
            message: { id: 700, date: 1785204000, media: DOC_MEDIA },
            downloadBytes: 'PDFBYTES'
        });
        const res = await svc.downloadChatMedia(USERBOT, {
            chatId: '-100123',
            messageId: 700,
            ownerId: OWNER_ID
        });
        assertEqual(res.file_name, 'ИИ от Ивина Андрея.pdf', 'file name from document attributes');
        assertEqual(res.mime, 'application/pdf', 'mime from document');
        assertEqual(res.size_bytes, 8, 'size from disk');
        assertEqual(res.sha256.length, 64, 'sha256 computed');
        const abs = path.join(root(), res.file_path);
        assertEqual(fs.existsSync(abs), true, 'file stored under uploads-internal');
        assertEqual(fs.readFileSync(abs, 'utf8'), 'PDFBYTES', 'bytes match');
        assertEqual(res.file_path.includes('..'), false, 'path is relative inside store');
        fs.rmSync(path.join(root(), OWNER_ID), { recursive: true, force: true });
    }

    console.log('--- downloadChatMedia: rejections before download ---');
    {
        const oversized = {
            document: {
                mimeType: 'application/pdf',
                size: { value: 999999 },
                attributes: [{ fileName: 'huge.pdf' }]
            }
        };
        const { svc, dlCalls } = makeService({
            message: { id: 701, date: 1785204000, media: oversized }
        });
        let caught = null;
        try {
            await svc.downloadChatMedia(USERBOT, { chatId: '-100123', messageId: 701, ownerId: OWNER_ID, maxBytes: 1024 });
        } catch (e) { caught = e; }
        assertEqual(caught instanceof MCPError && caught.code, ERROR_CODES.MEDIA_TOO_LARGE, 'declared size above cap → MEDIA_TOO_LARGE');
        assertEqual(dlCalls.length, 0, 'no download attempted for oversized declared size');
        assertEqual(caught?.data?.size_bytes, 999999, 'error data carries size');
    }
    {
        const { svc } = makeService({
            message: { id: 702, date: 1785204000, media: { contact: { phoneNumber: '+7', firstName: 'X' } } }
        });
        let caught = null;
        try {
            await svc.downloadChatMedia(USERBOT, { chatId: '-100123', messageId: 702, ownerId: OWNER_ID });
        } catch (e) { caught = e; }
        assertEqual(caught instanceof MCPError && caught.code, ERROR_CODES.MEDIA_UNSUPPORTED, 'contact → MEDIA_UNSUPPORTED');
    }
    {
        const { svc } = makeService({ message: null });
        let caught = null;
        try {
            await svc.downloadChatMedia(USERBOT, { chatId: '-100123', messageId: 703, ownerId: OWNER_ID });
        } catch (e) { caught = e; }
        assertEqual(caught instanceof MCPError && caught.code, ERROR_CODES.MEDIA_NOT_FOUND, 'no media → MEDIA_NOT_FOUND');
    }

    console.log('--- sweepExpiredMedia ---');
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-sweep-'));
        const fresh = path.join(dir, 'fresh.bin');
        const stale = path.join(dir, 'stale.bin');
        fs.writeFileSync(fresh, 'a');
        fs.writeFileSync(stale, 'b');
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
        fs.utimesSync(stale, old, old);
        sweepExpiredMedia(dir, 60 * 60 * 1000);
        assertEqual(fs.existsSync(stale), false, 'stale file swept');
        assertEqual(fs.existsSync(fresh), true, 'fresh file kept');
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log('--- defaults exposed ---');
    {
        assertEqual(MEDIA_MAX_BYTES_DEFAULT, 200 * 1024 * 1024, 'default cap is 200MB');
    }

    console.log('--- signed media links ---');
    {
        const token = signMediaToken({ relPath: 'owner-1/ub-1/-100123/700-x.pdf', ttlMs: 60_000, mime: 'application/pdf' });
        const ok = verifyMediaToken(token);
        assertEqual(ok.ok, true, 'valid token verifies');
        assertEqual(ok.relPath, 'owner-1/ub-1/-100123/700-x.pdf', 'payload path preserved');
        assertEqual(ok.mime, 'application/pdf', 'mime preserved');

        const tampered = token.slice(0, -2) + 'xx';
        assertEqual(verifyMediaToken(tampered).ok, false, 'tampered token rejected');

        const expired = signMediaToken({ relPath: 'p', ttlMs: -1000 });
        assertEqual(verifyMediaToken(expired).reason, 'expired', 'expired token flagged');

        assertEqual(verifyMediaToken('garbage').ok, false, 'garbage token rejected');
    }

    console.log('--- brapi_ token explicitly rejected on MCP auth ---');
    {
        const fakeSupabase = { from: () => { throw new Error('should not be reached'); } };
        let caught = null;
        try {
            await authenticateAgentOrUserToken({
                supabase: fakeSupabase,
                authorizationHeader: 'Bearer brapi_shouldnotwork_here'
            });
        } catch (e) { caught = e; }
        assertEqual(caught instanceof MCPError && caught.code, ERROR_CODES.INTEGRATION_TOKEN_REQUIRED, 'brapi_ → INTEGRATION_TOKEN_REQUIRED');
        assertEqual(String(caught?.message || '').includes('brmcp_'), true, 'error message points to brmcp_');
    }

    // cleanup any stray store left by failed paths
    fs.rmSync(root(), { recursive: true, force: true });

    if (failures > 0) {
        console.error(`\nFAIL: ${failures} check(s) failed`);
        process.exit(1);
    }
    console.log('\nPASS: media download + signed links');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
