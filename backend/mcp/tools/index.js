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
import './dialogs/list-dialogs.js';
import './dialogs/join-chat.js';
import './dialogs/leave-chat.js';
import './messages/fetch-messages.js';
import './messages/search-messages.js';
import './messages/send-message.js';
import './participants/list-participants.js';

import './autopost/list-bots.js';
import './autopost/list-channels.js';
import './autopost/create-post.js';
import './autopost/delete-message.js';
