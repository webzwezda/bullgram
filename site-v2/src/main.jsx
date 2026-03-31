import React from 'react';
import ReactDOM from 'react-dom/client';

const root = ReactDOM.createRoot(document.getElementById('root'));
const isHomeRoute = window.location.pathname === '/';

async function bootstrap() {
  if (isHomeRoute) {
    const [{ HomePage }] = await Promise.all([
      import('./pages/HomePage.jsx')
    ]);

    root.render(
      <React.StrictMode>
        <HomePage />
      </React.StrictMode>
    );
    return;
  }

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
