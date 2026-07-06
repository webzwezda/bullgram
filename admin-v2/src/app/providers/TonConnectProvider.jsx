import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { TONCONNECT_MANIFEST_URL } from '../../lib/ton-connect.js';

export function TonConnectProvider({ children }) {
  return (
    <TonConnectUIProvider
      manifestUrl={TONCONNECT_MANIFEST_URL}
      restoreConnection
      walletsListConfiguration={{ include: ['tonkeeper', 'mytonwallet', 'tonwallet'] }}
    >
      {children}
    </TonConnectUIProvider>
  );
}
