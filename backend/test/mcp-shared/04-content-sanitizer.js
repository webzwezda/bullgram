/**
 * Сценарий: content-sanitizer (sanitizeMessage / summarizeMedia / summarizeSender /
 * summarizeForward / sanitizeDialog / sanitizeParticipant) из test-mcp-shared.
 * Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { assertEqual } from './shared.js';
import {
  sanitizeMessage,
  summarizeMedia,
  summarizeSender,
  summarizeForward,
  sanitizeDialog,
  sanitizeParticipant
} from '../../shared/content-sanitizer.js';

export async function run() {

console.log('--- content-sanitizer.sanitizeMessage ---');
{
  const msg = {
    id: 100,
    date: new Date('2026-07-27T10:00:00Z'),
    sender: { id: 7, username: 'alice', firstName: 'Alice', bot: false, verified: true },
    senderId: 7,
    text: 'hi',
    media: null,
    replyTo: { replyToMsgId: 99 },
    fwdFrom: null
  };
  const s = sanitizeMessage(msg);
  assertEqual(s.id, '100', 'id stringified');
  assertEqual(s.date, '2026-07-27T10:00:00.000Z', 'date ISO');
  assertEqual(s.sender.username, 'alice', 'sender preserved');
  assertEqual(s.text, 'hi', 'text preserved');
  assertEqual(s.has_media, false, 'has_media false');
  assertEqual(s.media, null, 'media null');
  assertEqual(s.reply_to_message_id, '99', 'reply_to stringified');
  assertEqual(s.forward_from, null, 'forward_from null');
  assertEqual(s.untrusted_content, true, 'untrusted_content flag');
  assertEqual(typeof s._sanitization_note, 'string', 'sanitization note attached');
}
{
  // Long text truncation
  const t = sanitizeMessage({ id: 1, text: 'X'.repeat(5000) });
  assertEqual(t.text_truncated, true, 'long text flagged');
  assertEqual(t.text.endsWith('…[truncated]'), true, 'long text truncated with marker');
  assertEqual(t.text.length < 5000, true, 'truncated shorter than original');
}
{
  // Missing sender falls back to senderId
  const s = sanitizeMessage({ id: 1, senderId: 999, text: '' });
  assertEqual(s.sender.id, '999', 'fallback to senderId');
  assertEqual(s.sender.username, null, 'no username');
}

console.log('--- content-sanitizer.summarizeMedia ---');
{
  assertEqual(summarizeMedia(null), null, 'null media');
  assertEqual(summarizeMedia({ photo: { id: 'p1', sizes: [{ size: { value: 10 } }, { size: { value: 50 } }] } }).kind, 'photo', 'photo kind');
  assertEqual(summarizeMedia({ photo: { id: 'p1', sizes: [] } }).size_bytes, null, 'photo no sizes → null');
  assertEqual(summarizeMedia({ document: { mimeType: 'image/png', size: { value: 100 }, attributes: [{ fileName: 'a.png' }] } }).file_name, 'a.png', 'document filename');
  assertEqual(summarizeMedia({ webpage: { url: 'https://x', title: 'T', description: 'D' } }).kind, 'link_preview', 'webpage → link_preview');
  assertEqual(summarizeMedia({ contact: { phoneNumber: '+1', firstName: 'A' } }).kind, 'contact', 'contact');
  assertEqual(summarizeMedia({ geo: { lat: 1, long: 2 } }).kind, 'geo', 'geo');
  assertEqual(summarizeMedia({ poll: { poll: { question: 'Q?' } } }).question, 'Q?', 'poll question');
  assertEqual(summarizeMedia({ game: { title: 'G' } }).kind, 'game', 'game');
  assertEqual(summarizeMedia({ invoice: { title: 'I', currency: 'TON', totalAmount: 1000 } }).total_amount, '1000', 'invoice totalAmount stringified');
  assertEqual(summarizeMedia({ weird: true }).kind, 'unknown', 'unknown kind');
}

console.log('--- content-sanitizer.summarizeSender ---');
{
  const s = summarizeSender(null, 42);
  assertEqual(s.id, '42', 'fallback to senderId');
  assertEqual(s.is_bot, false, 'is_bot false');
  assertEqual(s.is_verified, false, 'is_verified false');
  const full = summarizeSender({ id: 1, username: 'u', firstName: 'F', lastName: 'L', bot: true, verified: true }, null);
  assertEqual(full.username, 'u', 'username');
  assertEqual(full.last_name, 'L', 'last_name');
  assertEqual(full.is_bot, true, 'is_bot true');
}

console.log('--- content-sanitizer.summarizeForward ---');
{
  assertEqual(summarizeForward(null), null, 'null forward');
  const f = summarizeForward({
    fromId: { className: 'PeerChannel', channelId: '-100123' },
    fromName: 'News',
    date: 1722000000
  });
  assertEqual(f.from_channel_id, '-100123', 'channel id');
  assertEqual(f.from_user_id, null, 'no user id');
  assertEqual(f.from_sender_name, 'News', 'name preserved');
  assertEqual(typeof f.date, 'string', 'date ISO string');
}

console.log('--- content-sanitizer.sanitizeDialog ---');
{
  const ch = sanitizeDialog({ entity: { className: 'Channel', id: -1001, title: 'News', username: 'news' }, unreadCount: 3, message: { id: 50 } });
  assertEqual(ch.kind, 'channel', 'channel kind');
  assertEqual(ch.name, 'News', 'title');
  assertEqual(ch.unread_count, 3, 'unread');
  assertEqual(ch.last_message_id, '50', 'last_message_id stringified');

  const mg = sanitizeDialog({ entity: { className: 'Channel', megagroup: true, title: 'Dev' } });
  assertEqual(mg.kind, 'megagroup', 'megagroup kind');

  const grp = sanitizeDialog({ entity: { className: 'Chat', title: 'Small' } });
  assertEqual(grp.kind, 'group', 'group kind');

  const pv = sanitizeDialog({ entity: { className: 'User', firstName: 'Bob', lastName: 'X' } });
  assertEqual(pv.kind, 'private', 'private kind');
  assertEqual(pv.name, 'Bob X', 'private name fallback');

  const unk = sanitizeDialog({ entity: { className: 'Other' }, title: 'Unknown' });
  assertEqual(unk.kind, 'unknown', 'unknown kind');
}

console.log('--- content-sanitizer.sanitizeParticipant ---');
{
  const admin = sanitizeParticipant({ user: { id: 8, firstName: 'A', bot: false, verified: false }, adminRights: {} });
  assertEqual(admin.is_admin, true, 'admin detected via adminRights');
  assertEqual(admin.first_name, 'A', 'first_name');

  const plain = sanitizeParticipant({ user: { id: 9, firstName: 'P' } });
  assertEqual(plain.is_admin, false, 'no adminRights → not admin');

  const bare = sanitizeParticipant({ id: 10, username: 'bare' });
  assertEqual(bare.id, '10', 'bare id');
  assertEqual(bare.username, 'bare', 'bare username');
}

}
