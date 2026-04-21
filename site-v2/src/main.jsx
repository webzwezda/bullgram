import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tailwind.css';

const root = ReactDOM.createRoot(document.getElementById('root'));

async function bootstrap() {
  const [{ BrowserRouter }, { App }, { AuthProvider }] = await Promise.all([
    import('react-router-dom'),
    import('./App.jsx'),
    import('./app/providers/AuthProvider.jsx'),
    import('./styles/site.css')
  ]);

  root.render(
    <React.StrictMode>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </React.StrictMode>
  );
}

bootstrap();
