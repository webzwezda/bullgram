import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { Outlet } from 'react-router-dom';
import { TONCONNECT_MANIFEST_URL } from '../lib/ton-connect.js';

export function PayLayout() {
  return (
    <TonConnectUIProvider
      manifestUrl={TONCONNECT_MANIFEST_URL}
      restoreConnection
      walletsListConfiguration={{ include: ['tonkeeper', 'mytonwallet', 'tonwallet'] }}
    >
      <Outlet />
    </TonConnectUIProvider>
  );
}
