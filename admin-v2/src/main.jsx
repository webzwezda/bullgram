import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { App } from './App.jsx';
import { AuthProvider } from './app/providers/AuthProvider.jsx';
import { getTonConnectManifestUrl } from './utils/ton-checkout.js';
import './styles/tailwind.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={getTonConnectManifestUrl()} language="ru">
      <AuthProvider>
        <BrowserRouter basename="/app">
          <App />
        </BrowserRouter>
      </AuthProvider>
    </TonConnectUIProvider>
  </React.StrictMode>
);
