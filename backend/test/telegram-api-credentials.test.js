// Волна 5.3 (план 2026-11-07): fail-fast вместо хардкод-fallback api_id=4.
// Проверяет requireTelegramApiCredentials: валидный env → пара; отсутствие,
// мусор, 0/отрицательный id, пустой/пробельный hash → throw с внятной ошибкой.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { requireTelegramApiCredentials } from '../utils/telegram-api-credentials.js';

describe('requireTelegramApiCredentials', () => {
    it('returns the pair from env', () => {
        const { apiId, apiHash } = requireTelegramApiCredentials({
            TG_API_ID: '312868',
            TG_API_HASH: 'e530a4abc'
        });
        assert.strictEqual(apiId, 312868);
        assert.strictEqual(apiHash, 'e530a4abc');
    });

    it('throws when both are missing', () => {
        assert.throws(() => requireTelegramApiCredentials({}), /TG_API_ID\/TG_API_HASH must be set/);
    });

    it('throws on garbage id, zero, negative, or blank hash', () => {
        assert.throws(() => requireTelegramApiCredentials({ TG_API_ID: 'abc', TG_API_HASH: 'h' }));
        assert.throws(() => requireTelegramApiCredentials({ TG_API_ID: '0', TG_API_HASH: 'h' }));
        assert.throws(() => requireTelegramApiCredentials({ TG_API_ID: '-5', TG_API_HASH: 'h' }));
        assert.throws(() => requireTelegramApiCredentials({ TG_API_ID: '123', TG_API_HASH: '   ' }));
        assert.throws(() => requireTelegramApiCredentials({ TG_API_ID: '123' }));
    });
});
