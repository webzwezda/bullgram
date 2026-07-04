import { useAuth } from '../app/providers/AuthProvider.jsx';

export function SiteAuthGate({ children }) {
  const { loading, user, login } = useAuth();

  if (loading) {
    return (
      <div className="site-auth-gate site-auth-gate--loading">
        <div className="site-auth-gate__container">
          <div className="site-auth-gate__text">Загружаем Bullgram...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="site-auth-gate">
        <style>{`
          .site-auth-gate {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .site-auth-gate--loading {
            background: var(--surface);
          }
          .site-auth-gate__container {
            max-width: 1000px;
            width: 100%;
          }
          .site-auth-gate__text {
            text-align: center;
            font-size: 18px;
            color: var(--muted);
          }
          .site-auth-gate__card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 24px;
            box-shadow: var(--shadow);
            overflow: hidden;
          }
          .site-auth-gate__grid {
            display: grid;
            grid-template-columns: 1fr 360px;
            gap: 0;
          }
          @media (max-width: 1023px) {
            .site-auth-gate__grid {
              grid-template-columns: 1fr;
            }
          }
          .site-auth-gate__main {
            padding: 40px;
            position: relative;
            overflow: hidden;
          }
          .site-auth-gate__gradient {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 120px;
            background: linear-gradient(135deg, rgba(15, 118, 110, 0.1), rgba(15, 118, 110, 0.02));
            pointer-events: none;
          }
          .site-auth-gate__content {
            position: relative;
            display: grid;
            gap: 24px;
          }
          .site-auth-gate__badge {
            display: inline-flex;
            align-items: center;
            border-radius: 100px;
            border: 1px solid rgba(15, 118, 110, 0.2);
            background: rgba(15, 118, 110, 0.08);
            padding: 6px 14px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: var(--accent);
          }
          .site-auth-gate__title {
            margin: 0;
            font-size: clamp(28px, 4vw, 36px);
            line-height: 1.1;
            font-weight: 800;
          }
          .site-auth-gate__subtitle {
            margin: 0;
            font-size: 15px;
            line-height: 1.7;
            color: var(--muted);
          }
          .site-auth-gate__steps {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
          }
          @media (max-width: 768px) {
            .site-auth-gate__steps {
              grid-template-columns: 1fr;
            }
          }
          .site-auth-gate__step {
            background: #fff;
            border-radius: 16px;
            border: 1px solid var(--border);
            padding: 20px;
          }
          .site-auth-gate__step-number {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 8px;
          }
          .site-auth-gate__step-title {
            margin: 0 0 8px 0;
            font-size: 15px;
            font-weight: 700;
          }
          .site-auth-gate__step-text {
            margin: 0;
            font-size: 13px;
            line-height: 1.6;
            color: var(--muted);
          }
          .site-auth-gate__sidebar {
            background: linear-gradient(180deg, rgba(15, 118, 110, 0.05), rgba(255, 253, 248, 0.98));
            border-top: 1px solid var(--border);
            padding: 40px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          @media (min-width: 1024px) {
            .site-auth-gate__sidebar {
              border-top: 0;
              border-left: 1px solid var(--border);
            }
          }
          .site-auth-gate__sidebar-content {
            display: grid;
            gap: 20px;
          }
          .site-auth-gate__sidebar-label {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: var(--muted);
          }
          .site-auth-gate__sidebar-title {
            margin: 0;
            font-size: 24px;
            line-height: 1.2;
            font-weight: 800;
          }
          .site-auth-gate__sidebar-text {
            margin: 0;
            font-size: 14px;
            line-height: 1.6;
            color: var(--muted);
          }
          .site-auth-gate__login-note {
            background: #fff;
            border-radius: 16px;
            border: 1px solid var(--border);
            padding: 16px;
            font-size: 13px;
            line-height: 1.6;
            color: var(--muted);
          }
        `}</style>

        <div className="site-auth-gate__container">
          <div className="site-auth-gate__card">
            <div className="site-auth-gate__grid">
              <section className="site-auth-gate__main">
                <div className="site-auth-gate__gradient" />
                <div className="site-auth-gate__content">
                  <div className="site-auth-gate__badge">Bullgram</div>

                  <div>
                    <h1 className="site-auth-gate__title">
                      Сначала вход, потом платный Telegram-канал
                    </h1>
                    <p className="site-auth-gate__subtitle">
                      После входа откроется доступ к тарифам, покупке и рабочему кабинету для управления
                      подписчиками и доступами.
                    </p>
                  </div>

                  <div className="site-auth-gate__steps">
                    <div className="site-auth-gate__step">
                      <div className="site-auth-gate__step-number">01</div>
                      <h3 className="site-auth-gate__step-title">Google-вход</h3>
                      <p className="site-auth-gate__step-text">
                        Быстрая авторизация через Google без паролей и подтверждений.
                      </p>
                    </div>
                    <div className="site-auth-gate__step">
                      <div className="site-auth-gate__step-number">02</div>
                      <h3 className="site-auth-gate__step-title">Выбор тарифа</h3>
                      <p className="site-auth-gate__step-text">
                        Trial для старта или Normal для постоянной работы с каналом.
                      </p>
                    </div>
                    <div className="site-auth-gate__step">
                      <div className="site-auth-gate__step-number">03</div>
                      <h3 className="site-auth-gate__step-title">Рабочий кабинет</h3>
                      <p className="site-auth-gate__step-text">
                        После входа откроется доступ к управлению каналами, ботам и аналитике.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <aside className="site-auth-gate__sidebar">
                <div className="site-auth-gate__sidebar-content">
                  <div>
                    <div className="site-auth-gate__sidebar-label">Вход</div>
                    <h2 className="site-auth-gate__sidebar-title">Нужен вход через Google</h2>
                    <p className="site-auth-gate__sidebar-text">
                      Без авторизации не будет доступа к тарифам, покупке и рабочему кабинету.
                    </p>
                  </div>

                  <button className="site-button site-button--primary" type="button" onClick={login} style={{ width: '100%', height: '44px' }}>
                    Войти через Google
                  </button>

                  <div className="site-auth-gate__login-note">
                    После входа откроется доступ к тарифам и рабочему кабинету для управления
                    подписчиками.
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
