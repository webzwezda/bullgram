import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { TONCONNECT_MANIFEST_URL } from '../../lib/ton-connect.js';

export function TonConnectProvider({ children }) {
  return (
    <TonConnectUIProvider
      manifestUrl={TONCONNECT_MANIFEST_URL}
      restoreConnection
      // analytics.ton.org недоступен (connection refused) — глушим телеметрию SDK.
      analytics={{ mode: 'off' }}
      walletsListConfiguration={{ include: ['tonkeeper', 'mytonwallet', 'tonwallet'] }}
    >
      {children}
    </TonConnectUIProvider>
  );
}
