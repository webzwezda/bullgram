import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { Outlet } from 'react-router-dom';
import { TONCONNECT_MANIFEST_URL } from '../lib/ton-connect.js';

export function PayLayout() {
  return (
    <TonConnectUIProvider
      manifestUrl={TONCONNECT_MANIFEST_URL}
      restoreConnection
      // analytics.ton.org недоступен (connection refused) — глушим телеметрию SDK.
      analytics={{ mode: 'off' }}
      walletsListConfiguration={{ include: ['tonkeeper', 'mytonwallet', 'tonwallet'] }}
    >
      <Outlet />
    </TonConnectUIProvider>
  );
}
