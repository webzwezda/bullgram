// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import crypto from 'crypto';
import { DEFAULT_FINGERPRINT, QR_FINGERPRINT_PROFILES, DEFAULT_QR_FINGERPRINT_PROFILE_ID } from './constants.js';

export const FingerprintMixin = (Base) => class extends Base {
    getQrFingerprintProfiles() {
        return Object.values(QR_FINGERPRINT_PROFILES).map((item) => ({
            id: item.id,
            label: item.label,
            note: item.note,
            is_system: true
        }));
    }

    getQrFingerprintProfile(profileId = DEFAULT_QR_FINGERPRINT_PROFILE_ID) {
        return QR_FINGERPRINT_PROFILES[profileId] || QR_FINGERPRINT_PROFILES[DEFAULT_QR_FINGERPRINT_PROFILE_ID];
    }

    async listQrFingerprintProfiles(ownerId) {
        try {
            const { data, error } = await this.supabase
                .from('userbot_fingerprint_presets')
                .select('id, owner_id, label, note, api_id, api_hash, device_model, system_version, app_version, system_lang_code, lang_code, sort_order, created_at')
                .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) throw error;

            return (data || []).map((row) => this._mapFingerprintPresetRow(row));
        } catch (error) {
            console.warn('[USERBOT_FINGERPRINT_PRESETS] fallback to built-in profiles:', error?.message || error);
            return this.getQrFingerprintProfiles();
        }
    }

    async getQrFingerprintProfileForOwner(ownerId, profileId = DEFAULT_QR_FINGERPRINT_PROFILE_ID) {
        if (!profileId) {
            return this.getQrFingerprintProfile(DEFAULT_QR_FINGERPRINT_PROFILE_ID);
        }

        try {
            const { data, error } = await this.supabase
                .from('userbot_fingerprint_presets')
                .select('id, owner_id, label, note, api_id, api_hash, device_model, system_version, app_version, system_lang_code, lang_code, sort_order, created_at')
                .eq('id', profileId)
                .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
                .maybeSingle();

            if (error) throw error;
            if (!data) return this.getQrFingerprintProfile(DEFAULT_QR_FINGERPRINT_PROFILE_ID);
            return this._mapFingerprintPresetRow(data);
        } catch (error) {
            console.warn('[USERBOT_FINGERPRINT_PRESET] fallback to built-in profile:', error?.message || error);
            return this.getQrFingerprintProfile(profileId);
        }
    }

    async saveQrFingerprintPreset(ownerId, input = {}) {
        const presetId = String(input.id || `custom_${crypto.randomUUID()}`);
        const label = String(input.label || '').trim();
        if (!label) {
            throw new Error('Назови свой пресет, чтобы потом не искать его вслепую.');
        }

        const fingerprint = this._normalizeFingerprint({
            ...input,
            api_id: input.api_id,
            api_hash: input.api_hash,
            deviceModel: input.device_model ?? input.deviceModel,
            systemVersion: input.system_version ?? input.systemVersion,
            appVersion: input.app_version ?? input.appVersion,
            systemLangCode: input.system_lang_code ?? input.systemLangCode,
            langCode: input.lang_code ?? input.langCode,
            profileId: presetId,
            profileLabel: label,
            source: 'custom_preset'
        });

        const payload = {
            id: presetId,
            owner_id: ownerId,
            label,
            note: String(input.note || '').trim() || null,
            api_id: Number(fingerprint.api_id),
            api_hash: fingerprint.api_hash,
            device_model: fingerprint.deviceModel,
            system_version: fingerprint.systemVersion,
            app_version: fingerprint.appVersion,
            system_lang_code: fingerprint.systemLangCode,
            lang_code: fingerprint.langCode,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await this.supabase
            .from('userbot_fingerprint_presets')
            .upsert(payload, { onConflict: 'id' })
            .select('id, owner_id, label, note, api_id, api_hash, device_model, system_version, app_version, system_lang_code, lang_code, sort_order, created_at')
            .single();

        if (error) throw error;
        return this._mapFingerprintPresetRow(data);
    }

    _mapFingerprintPresetRow(row = {}) {
        const profile = {
            id: row.id,
            label: row.label,
            note: row.note || '',
            is_system: !row.owner_id,
            owner_id: row.owner_id || null,
            fingerprint: {
                api_id: Number(row.api_id || DEFAULT_FINGERPRINT.api_id),
                api_hash: row.api_hash || DEFAULT_FINGERPRINT.api_hash,
                deviceModel: row.device_model || DEFAULT_FINGERPRINT.deviceModel,
                systemVersion: row.system_version || DEFAULT_FINGERPRINT.systemVersion,
                appVersion: row.app_version || DEFAULT_FINGERPRINT.appVersion,
                systemLangCode: row.system_lang_code || DEFAULT_FINGERPRINT.systemLangCode,
                langCode: row.lang_code || DEFAULT_FINGERPRINT.langCode
            }
        };

        return profile;
    }

    getDefaultFingerprint(profileId = DEFAULT_QR_FINGERPRINT_PROFILE_ID) {
        const profile = this.getQrFingerprintProfile(profileId);
        return {
            ...profile.fingerprint,
            api_id: Number(profile.fingerprint.api_id || this.apiId || DEFAULT_FINGERPRINT.api_id),
            api_hash: profile.fingerprint.api_hash || this.apiHash || DEFAULT_FINGERPRINT.api_hash,
            profileId: profile.id,
            profileLabel: profile.label,
            source: 'qr_profile'
        };
    }

    _normalizeFingerprint(fingerprint = {}) {
        const input = fingerprint && typeof fingerprint === 'object' ? fingerprint : {};
        const defaults = this.getDefaultFingerprint();

        return {
            api_id: Number(input.api_id || defaults.api_id),
            api_hash: input.api_hash || defaults.api_hash,
            deviceModel: input.deviceModel || defaults.deviceModel,
            systemVersion: input.systemVersion || defaults.systemVersion,
            appVersion: input.appVersion || defaults.appVersion,
            systemLangCode: input.systemLangCode || defaults.systemLangCode,
            langCode: input.langCode || defaults.langCode,
            profileId: input.profileId ?? input.fingerprint_profile_id ?? defaults.profileId ?? null,
            profileLabel: input.profileLabel ?? input.fingerprint_profile_label ?? defaults.profileLabel ?? null,
            source: input.source ?? input.fingerprint_source ?? defaults.source ?? null
        };
    }
};
