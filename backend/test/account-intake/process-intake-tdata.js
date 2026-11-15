// processIntakeBatch на tdata-only пачке: полный путь приёмки с настоящей
// конвертацией (крипта реальная, Telegram офлайн), включая пин из заметки.
import { makeMockSupabase, assert, runIntake } from './shared.js';
import { buildTdataFiles } from './tdata-fixture.js';
import { packSessionString } from '../../services/tdata.service.js';
import { TELEGRAM_DC_IPV4 } from '../../services/userbot/constants.js';
import { decrypt } from '../../utils/crypto.js';

async function makeTdataPackFixture(overrides = {}) {
    const built = await buildTdataFiles({ folder: 'account-1', dcId: 2, ...overrides.fixture });
    return {
        pack: {
            key: 'tdata:account-1/account-1',
            label: 'account-1',
            sessionEntry: null,
            jsonEntry: null,
            tdataEntries: built.files,
            passwordEntry: overrides.passwordEntry || null,
            scope: 'account-1',
            tdataOnly: true
        },
        built
    };
}

export async function runProcessIntakeTdata() {
    console.log('— processIntakeBatch: tdata-only пачка —');

    {
        const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
        const restoreCalls = [];
        const { pack, built } = await makeTdataPackFixture();
        const { batch } = await runIntake(supabase, [pack], {
            saveRecoverySource: async (args) => { restoreCalls.push(args); }
        });

        const account = supabase._tables.tg_accounts[0];
        assert(Boolean(account) && account.runtime_status === 'pending_activation', 'tdata-аккаунт в safe-mode');
        assert(account.custom_label === 'account-1', 'custom_label = имя папки (телефона в tdata нет)');
        assert(account.proxy_id, 'managed-прокси привязан');

        const sessionData = JSON.parse(decrypt(account.session_data));
        const expected = packSessionString(2, TELEGRAM_DC_IPV4[2], 443, built.authKey);
        assert(sessionData.token === expected, 'в session_data лежит сконвертированная строка сессии');
        assert(sessionData.source === 'tdata_import', 'auth_source = tdata_import');

        assert(restoreCalls.length === 1, 'recovery source сохранён');
        const restore = restoreCalls[0];
        assert(restore.sessionOriginalName === 'account-1.session', 'имя синтезированного .session из лейбла пачки');
        assert(restore.jsonOriginalName === 'account-1.json', 'имя синтезированного .json');
        assert(Buffer.isBuffer(restore.sessionBuffer) && restore.sessionBuffer.length > 0, 'session-блоб — настоящий sqlite');
        assert(Buffer.isBuffer(restore.tdataZipBuffer) && restore.tdataZipBuffer.length > 0, 'оригинальный tdata ушёл в блоб (правило продажи)');
        assert(restore.fingerprint?.source === 'tdata_import', 'fingerprint_source = tdata_import (явный выбор, не дефолт вслепую)');
        assert(restore.fingerprint?.api_id === 4, 'fingerprint из дефолтного профиля платформы');
        assert(String(restore.intakeBatchId).length > 0, 'intake_batch_id проброшен (отлёжка подхватит)');

        assert(batch.status === 'completed' && batch.processed === 1 && batch.failed === 0, 'батч завершён 1/0');
    }

    {
        // Пин на tdata + заметка с паролем: приёмка снимает ключ паролем из заметки
        const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
        const { pack } = await makeTdataPackFixture({
            fixture: { passcode: 'Pin777' },
            passwordEntry: { relPath: 'account-1/пароль.txt', name: 'пароль.txt', buffer: Buffer.from('Пароль: Pin777') }
        });
        const { batch } = await runIntake(supabase, [pack], {});
        assert(batch.status === 'completed' && batch.processed === 1, 'пин снят паролем из заметки, аккаунт принят');
    }

    {
        // Пин есть, заметки нет → честный провал айтема, прокси освобождён
        const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
        const { pack } = await makeTdataPackFixture({ fixture: { passcode: 'Pin777' } });
        const { batch, proxy } = await runIntake(supabase, [pack], {});
        assert(batch.items[0].status === 'failed' && String(batch.items[0].error).includes('заметку'), 'без пароля — понятная ошибка про заметку');
        assert(supabase._tables.tg_accounts.length === 0, 'аккаунт не вставлен');
        assert(proxy.released.length === 1, 'прокси освобождён');
    }
}
