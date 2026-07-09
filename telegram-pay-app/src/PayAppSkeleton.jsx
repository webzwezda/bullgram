export function PayAppSkeleton({ invoiceId, onActivate }) {
    return (
        <div className="pay-app" onClick={onActivate} onTouchStart={onActivate}>
            <div className="pay-card" style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, color: 'var(--tg-hint)' }}>Грузим платёж…</div>
                    <button
                        className="pay-button pay-button--ghost"
                        style={{ marginTop: 20 }}
                        onClick={(e) => { e.stopPropagation(); onActivate?.(); }}
                    >
                        Нажмите, чтобы продолжить
                    </button>
                </div>
            </div>
            <p className="pay-hint" style={{ textAlign: 'center', marginTop: 16 }}>
                Заказ <code>{invoiceId ? invoiceId.slice(0, 8) + '…' : '—'}</code>
            </p>
        </div>
    );
}
