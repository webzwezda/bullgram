import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0e1621',
      color: '#e9edf2',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 12 }}>BullRun Telegram Web</h1>
        <p style={{ fontSize: 16, opacity: 0.6 }}>Coming soon</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
