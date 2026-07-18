/**
 * ChecklistService — фасад для удобной работы из routes и server.js.
 *
 * Делегирует lifecycle в bot-lifecycle, операции над списками — в lists.service.
 */

import { Telegraf } from 'telegraf';
import {
    startChecklistBot,
    getChecklistBot,
    stopChecklistBot,
    stopAllChecklistBots,
    getActiveChecklistBotIds
} from './bot-lifecycle.js';
import {
    createAndPost,
    toggleItem,
    reloadList,
    deleteList as deleteListOp
} from './lists.service.js';

export class ChecklistService {
    constructor(supabase) {
        this.supabase = supabase;
    }

    startBot(botId, token, ownerId) {
        startChecklistBot(botId, token, ownerId, this.supabase);
    }

    getBot(botId) {
        return getChecklistBot(botId);
    }

    stopBot(botId) {
        stopChecklistBot(botId);
    }

    stopAll() {
        stopAllChecklistBots();
    }

    activeIds() {
        return getActiveChecklistBotIds();
    }

    /**
     * Валидирует токен через telegram.getMe, возвращает { id, username, first_name }.
     * Бросает Error при невалидном токене.
     */
    static async validateToken(token) {
        const tg = new Telegraf(token);
        return tg.telegram.getMe();
    }

    async createList(opts) {
        return createAndPost({ ...opts, supabase: this.supabase });
    }

    async toggleListItem(listId, idx) {
        return toggleItem(this.supabase, listId, idx);
    }

    async reloadList(listId) {
        return reloadList(this.supabase, listId);
    }

    async deleteList({ listId, ownerId }) {
        return deleteListOp(this.supabase, { listId, ownerId });
    }
}

export {
    startChecklistBot,
    getChecklistBot,
    stopChecklistBot,
    stopAllChecklistBots,
    getActiveChecklistBotIds,
    createAndPost,
    toggleItem,
    reloadList
};
