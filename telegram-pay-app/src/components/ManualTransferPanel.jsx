import { useState } from 'react';

export function ManualTransferPanel({ invoice, amountLabel, transferUri, onVerify, verifyState }) {
    const [copiedField, setCopiedField] = useState(null);

    const copy = async (key, value) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(key);
            setTimeout(() => setCopiedField(null), 1500);
        } catch {
            // ignore — user can copy manually
        }
    };

    return (
        <div className="pay-card">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: 'var(--tg-hint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Ручной перевод TON
            </h3>

            <Field
                label="Сумма"
                value={amountLabel}
            />
            <Field
                label="Адрес кошелька"
                value={invoice.seller_wallet}
                mono
                onCopy={() => copy('address', invoice.seller_wallet)}
                copied={copiedField === 'address'}
            />
            <Field
                label="Комментарий (MEMO) — обязательно"
                value={invoice.memo}
                mono
                onCopy={() => copy('memo', invoice.memo)}
                copied={copiedField === 'memo'}
            />

            <a
                className="pay-button"
                style={{ marginTop: 16, textDecoration: 'none', display: 'inline-block' }}
                href={transferUri}
            >
                Открыть в TON-кошельке
            </a>

            <p className="pay-hint" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                После перевода нажмите «Я оплатил». Без MEMO платёж не будет зачислен автоматически.
            </p>

            <button
                type="button"
                className="pay-button"
                style={{ marginTop: 12 }}
                onClick={onVerify}
                disabled={verifyState === 'verifying'}
            >
                {verifyState === 'verifying' ? (
                    <><span className="pay-spinner" style={{ marginRight: 8 }} />Проверяем…</>
                ) : 'Я оплатил'}
            </button>

            {verifyState === 'not_found' ? (
                <p className="pay-hint" style={{ marginTop: 10, color: 'var(--tg-danger)' }}>
                    Платёж пока не найден в блокчейне. Подождите 1–2 минуты и попробуйте снова.
                </p>
            ) : null}
        </div>
    );
}

function Field({ label, value, mono, onCopy, copied }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--tg-hint)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {label}
            </div>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: 'rgba(0,0,0,0.04)',
                    borderRadius: 10,
                    border: '1px solid var(--tg-border)'
                }}
            >
                <code style={{
                    flex: 1,
                    fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {value}
                </code>
                {onCopy ? (
                    <button
                        type="button"
                        onClick={onCopy}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--tg-border)',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 12,
                            color: 'var(--tg-link)',
                            cursor: 'pointer'
                        }}
                    >
                        {copied ? 'Скопировано' : 'Копировать'}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
