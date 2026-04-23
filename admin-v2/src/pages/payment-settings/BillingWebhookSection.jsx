import { APP_CONFIG } from '../../config.js';

export function BillingWebhookSection({ billingHealth, patchSettings, sendWebhookTest, settings }) {
  return (
    <div className="table-card">
      <div className="table-card__title">Дополнительно: webhook и ручная проверка</div>
      <div className="form-grid">
        <label className="field-group">
          <span>Режим</span>
          <select
            className="field"
            value={settings.billing_mode || 'manual'}
            onChange={(event) => patchSettings({ billing_mode: event.target.value })}
          >
            <option value="manual">manual</option>
            <option value="webhook">webhook</option>
          </select>
        </label>
        <label className="field-group">
          <span>Провайдер</span>
          <select
            className="field"
            value={settings.billing_provider || 'generic'}
            onChange={(event) => patchSettings({ billing_provider: event.target.value })}
          >
            <option value="generic">generic</option>
            <option value="cryptomus">cryptomus</option>
            <option value="cryptobot">cryptobot</option>
          </select>
        </label>
        <label className="field-group">
          <span>Shop / Merchant ID</span>
          <input
            className="field"
            value={settings.billing_shop_id || ''}
            onChange={(event) => patchSettings({ billing_shop_id: event.target.value })}
            placeholder="merchant-id"
          />
        </label>
        <label className="field-group">
          <span>Webhook secret</span>
          <input
            className="field"
            value={settings.billing_webhook_secret || ''}
            onChange={(event) => patchSettings({ billing_webhook_secret: event.target.value })}
            placeholder="secret"
          />
        </label>
        <label className="field-group" style={{ gridColumn: '1 / -1' }}>
          <span>API key провайдера</span>
          <input
            className="field"
            value={settings.billing_api_key || ''}
            onChange={(event) => patchSettings({ billing_api_key: event.target.value })}
            placeholder="api-key"
          />
        </label>
      </div>
      <div className="table-subtext" style={{ marginTop: 14, lineHeight: 1.8 }}>
        Webhook URL: <strong>{billingHealth?.webhook_url || `${APP_CONFIG.backendUrl}/api/payment/webhook/generic`}</strong>
      </div>
      <div className="table-actions" style={{ marginTop: 14 }}>
        <button className="inline-action" onClick={sendWebhookTest}>Тест webhook-а</button>
        <a className="inline-action" href="/app/customers?tab=orders" target="_blank" rel="noreferrer">Открыть заказы</a>
      </div>
    </div>
  );
}
