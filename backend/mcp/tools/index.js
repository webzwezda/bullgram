// Barrel that imports every tool module for side-effect (self-registration).
// Plan 01 Phase 3 + Phase 5.
//
// Adding a new tool = create its file under mcp/tools/<domain>/<name>.js,
// then add the import here. The dispatcher picks it up automatically.

import './proxy/infra-summary.js';
import './proxy/proxy-preview.js';
import './proxy/proxy-import.js';

import './account/list-userbots.js';
import './account/health.js';
import './account/botfather-create-bot.js';
import './account/user-resolve.js';
import './dialogs/list-dialogs.js';
import './dialogs/join-chat.js';
import './dialogs/leave-chat.js';
import './dialogs/group-create.js';
import './dialogs/member-invite.js';
import './dialogs/member-promote.js';
import './dialogs/group-invite-link.js';
import './messages/fetch-messages.js';
import './messages/search-messages.js';
import './messages/send-message.js';
import './messages/edit-message.js';
import './messages/delete-message.js';
import './messages/forward-message.js';
import './messages/pin-message.js';
import './messages/mark-read.js';
import './participants/list-participants.js';

import './autopost/list-bots.js';
import './autopost/list-channels.js';
import './autopost/create-post.js';
import './autopost/posts-list.js';
import './autopost/channel-update.js';
import './autopost/delete-message.js';
import './autopost/bot-init.js';
import './autopost/checklist-create.js';
import './autopost/checklist-state.js';
import './autopost/checklist-list.js';
import './autopost/checklist-update.js';
import './autopost/checklist-cancel.js';
