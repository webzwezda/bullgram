import './lib/buffer-polyfill.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tailwind.css';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';

const root = ReactDOM.createRoot(document.getElementById('root'));

async function bootstrap() {
  try {
    const [{ BrowserRouter }, { App }, { AuthProvider }, { TonConnectProvider }] = await Promise.all([
      import('react-router-dom'),
      import('./App.jsx'),
      import('./app/providers/AuthProvider.jsx'),
      import('./app/providers/TonConnectProvider.jsx')
    ]);

    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <TonConnectProvider>
            <AuthProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </AuthProvider>
          </TonConnectProvider>
        </ErrorBoundary>
      </React.StrictMode>
    );
  } catch (error) {
    console.error('Failed to bootstrap Bullgram app:', error);
  }
}

bootstrap();
