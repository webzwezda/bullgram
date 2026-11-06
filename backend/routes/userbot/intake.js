// Приёмка пачек аккаунтов (account shop intake) (стадия 2a разрезки userbot.routes.js).
// Зона: POST /intake/batch, GET /intake/batches, GET /intake/batch/:id и фабричная
// пометка зависших батчей sweepStaleIntakeBatches. Multer-инстанс `intakeUpload`
// и константа MAX_INTAKE_BATCH используются только этой зоной — переехали сюда.
import multer from 'multer';
import os from 'os';
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { groupAccountPacks, normalizeEntries, unpackZipEntries } from '../../services/account-pack.service.js';
import { processIntakeBatch } from '../../services/account-intake.service.js';
import { cleanupUploadedFiles, launchManagedProxyVerification } from './helpers-proxy.js';
import { MAX_MANAGED_PROXIES_GLOBAL, MAX_MANAGED_PROXIES_PER_ADMIN } from './constants.js';

// Приёмка пачек аккаунтов: zip и loose-файлы, поле `files` (до 400 файлов по 30 МБ).
const intakeUpload = multer({
    dest: os.tmpdir(),
    limits: {
        files: 400,
        fileSize: 30 * 1024 * 1024
    }
});

// Лимит одной приёмки пачек аккаунтов (POST /intake/batch): 100 аккаунтов за раз.
const MAX_INTAKE_BATCH = 100;

export function registerIntake(router, ctx) {
    const { supabase, userbotService, managedProxyService } = ctx;
    // Зависшие «processing» — обработка жила в памяти и умерла вместе с
    // перезапуском сервера. Честно помечаем такие батчи упавшими. Зовём из
    // обоих GET, чтобы поллинг одиночной пачки тоже видел честный статус.
    async function sweepStaleIntakeBatches(ownerId) {
        const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await supabase
            .from('account_import_batches')
            .update({ status: 'failed', error: 'Прерван перезапуском сервера.', updated_at: new Date().toISOString() })
            .eq('owner_id', ownerId)
            .eq('status', 'processing')
            .lt('updated_at', staleBefore);
    }

    router.post('/intake/batch', authenticateUser, intakeUpload.fields([
        { name: 'files', maxCount: 400 }
    ]), async (req, res) => {
        const uploadedFiles = req.files?.files || [];
        try {
            if (req.profile?.role !== 'admin') {
                return res.status(403).json({ error: 'Приёмка пачек доступна только платформенному админу.' });
            }

            const files = req.files?.files || [];
            if (!files.length) {
                return res.status(400).json({ error: 'Загрузи zip или файлы пачек: .session + .json, опционально папки tdata и заметка с паролем.' });
            }

            let relPaths = [];
            if (req.body?.paths) {
                try {
                    relPaths = JSON.parse(req.body.paths);
                } catch {
                    return res.status(400).json({ error: 'Поле paths должно быть JSON-массивом относительных путей файлов.' });
                }
            }
            if (!Array.isArray(relPaths)) {
                return res.status(400).json({ error: 'Поле paths должно быть JSON-массивом относительных путей файлов.' });
            }

            let entries;
            try {
                entries = await normalizeEntries(files, relPaths);
            } catch (sizeError) {
                return res.status(400).json({ error: sizeError?.message || 'Не удалось прочитать загруженные файлы.' });
            }
            let expanded;
            try {
                expanded = unpackZipEntries(entries);
            } catch (zipError) {
                return res.status(400).json({ error: zipError?.message || 'Не удалось распаковать загруженные архивы.' });
            }

            const { packs, rejects } = groupAccountPacks(expanded);
            if (!packs.length) {
                return res.status(400).json({
                    error: 'В загрузке не нашлось ни одной полной пачки (.session + .json). Проверь состав файлов.',
                    rejects
                });
            }

            if (packs.length > MAX_INTAKE_BATCH) {
                return res.status(403).json({
                    error: `За одну приёмку нельзя принять больше ${MAX_INTAKE_BATCH} аккаунтов. Разбей загрузку на части.`,
                    total: packs.length
                });
            }

            // Ёмкость managed-прокси — те же лимиты, что у ручной выдачи админу.
            const managedSummary = managedProxyService.getStateSummary();
            if (Number(managedSummary.total || 0) + packs.length > MAX_MANAGED_PROXIES_GLOBAL) {
                const freeSlots = Math.max(0, MAX_MANAGED_PROXIES_GLOBAL - Number(managedSummary.total || 0));
                return res.status(403).json({
                    error: `На сервере лимит managed-прокси (${MAX_MANAGED_PROXIES_GLOBAL}). Свободно слотов: ${freeSlots}.`
                });
            }

            const { count: ownerManagedCount, error: ownerCountError } = await supabase
                .from('proxies')
                .select('*', { count: 'exact', head: true })
                .eq('owner_id', req.user.id)
                .eq('provision_source', 'manual_admin');
            if (ownerCountError) throw ownerCountError;

            if (Number(ownerManagedCount || 0) + packs.length > MAX_MANAGED_PROXIES_PER_ADMIN) {
                const freeSlots = Math.max(0, MAX_MANAGED_PROXIES_PER_ADMIN - Number(ownerManagedCount || 0));
                return res.status(403).json({
                    error: `У одного админа нельзя держать больше ${MAX_MANAGED_PROXIES_PER_ADMIN} серверных прокси. Свободно слотов: ${freeSlots}.`
                });
            }

            const items = packs.map((pack) => ({ key: pack.key, label: pack.label, status: 'queued' }));
            const { data: batchRow, error: batchError } = await supabase
                .from('account_import_batches')
                .insert({
                    owner_id: req.user.id,
                    status: 'processing',
                    total: packs.length,
                    processed: 0,
                    failed: 0,
                    items
                })
                .select('id')
                .single();
            if (batchError || !batchRow?.id) {
                throw new Error(`Не удалось создать журнал приёмки: ${batchError?.message || 'пустой ответ'}. Проверь, что применена миграция backend/sql/account-shop-intake.sql.`);
            }

            // Файлы уже прочитаны в память — временные копии можно удалять.
            cleanupUploadedFiles(uploadedFiles);

            // Fire-and-forget: роут отвечает сразу, прогресс пишется в строку батча
            // после каждого айтема — UI поллит GET /intake/batch/:id. Страховочный
            // catch — на случай, если внутренний предохранитель сам упадёт.
            processIntakeBatch({
                supabase,
                userbotService,
                managedProxyService,
                ownerId: req.user.id,
                batchId: batchRow.id,
                packs,
                items,
                launchVerification: (proxy) => launchManagedProxyVerification({
                    supabase,
                    userbotService,
                    ownerId: req.user.id,
                    proxyId: proxy.id,
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username,
                    password: proxy.password
                })
            }).catch((runError) => {
                console.error('[USERBOT_INTAKE] batch crashed:', runError?.message || runError);
            });

            return res.json({
                success: true,
                batch_id: batchRow.id,
                total: packs.length,
                rejected: rejects
            });
        } catch (error) {
            console.error('[USERBOT_INTAKE] failed:', error?.message || error);
            return res.status(500).json({ error: error?.message || 'Приёмка не прошла. Попробуй еще раз.' });
        } finally {
            cleanupUploadedFiles(uploadedFiles);
        }
    });

    router.get('/intake/batches', authenticateUser, async (req, res) => {
        try {
            if (req.profile?.role !== 'admin') {
                return res.status(403).json({ error: 'Приёмка пачек доступна только платформенному админу.' });
            }

            // Зависшие «processing» — см. sweepStaleIntakeBatches.
            await sweepStaleIntakeBatches(req.user.id);

            const { data, error } = await supabase
                .from('account_import_batches')
                .select('id, status, total, processed, failed, error, created_at, updated_at')
                .eq('owner_id', req.user.id)
                .order('created_at', { ascending: false })
                .limit(20);
            if (error) throw error;

            return res.json({ batches: data || [] });
        } catch (error) {
            console.error('[USERBOT_INTAKE] batches failed:', error?.message || error);
            return res.status(500).json({ error: 'Не удалось загрузить журнал приёмки.' });
        }
    });

    router.get('/intake/batch/:id', authenticateUser, async (req, res) => {
        try {
            if (req.profile?.role !== 'admin') {
                return res.status(403).json({ error: 'Приёмка пачек доступна только платформенному админу.' });
            }

            await sweepStaleIntakeBatches(req.user.id);

            const { data, error } = await supabase
                .from('account_import_batches')
                .select('*')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Партия приёмки не найдена.' });

            return res.json({ batch: data });
        } catch (error) {
            console.error('[USERBOT_INTAKE] batch failed:', error?.message || error);
            return res.status(500).json({ error: 'Не удалось загрузить партию приёмки.' });
        }
    });

}
