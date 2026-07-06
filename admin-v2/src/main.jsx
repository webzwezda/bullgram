import './lib/buffer-polyfill.js';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.jsx';
import { AuthProvider } from './app/providers/AuthProvider.jsx';
import { TonConnectProvider } from './app/providers/TonConnectProvider.jsx';
import './styles/tailwind.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TonConnectProvider>
      <AuthProvider>
        <BrowserRouter basename="/app">
          <App />
        </BrowserRouter>
      </AuthProvider>
    </TonConnectProvider>
  </React.StrictMode>
);
