export const SALES_LINKS = {
  trial: '/shop?offer=trial',
  p2p: '/shop?offer=p2p',
  ops: 'https://t.me/webzwezda',
  seller: '/shop?offer=seller'
};

export function SectionIntro({ eyebrow, title, text, actions = null }) {
  return (
    <div className="hero-card">
      {eyebrow ? <div className="hero-card__eyebrow">{eyebrow}</div> : null}
      <h1>{title}</h1>
      <p>{text}</p>
      {actions ? <div className="hero-card__actions">{actions}</div> : null}
    </div>
  );
}

export function FeatureGrid({ items }) {
  return (
    <div className="marketing-grid">
      {items.map((item) => (
        <div key={item.title} className="marketing-card">
          <div className="marketing-card__title">{item.title}</div>
          <div className="marketing-card__text">{item.text}</div>
          {item.meta ? <div className="marketing-card__meta">{item.meta}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function HighlightBand({ title, text, items }) {
  return (
    <section className="highlight-band">
      <div className="highlight-band__copy">
        <div className="highlight-band__eyebrow">Почему это покупают</div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <div className="highlight-band__list">
        {items.map((item) => (
          <div key={item} className="highlight-band__pill">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

export function CTASection({ title, text, primary, secondary }) {
  return (
    <section className="cta-panel">
      <div>
        <div className="cta-panel__eyebrow">Следующий шаг</div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <div className="cta-panel__actions">
        <a className="site-button site-button--primary" href={primary.href} target={primary.target || undefined} rel={primary.rel || undefined}>
          {primary.label}
        </a>
        {secondary ? (
          <a className="site-button" href={secondary.href} target={secondary.target || undefined} rel={secondary.rel || undefined}>
            {secondary.label}
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function LeadPathGrid({ items }) {
  return (
    <section className="lead-paths">
      {items.map((item) => (
        <article key={item.title} className="lead-path-card">
          <div className="lead-path-card__eyebrow">{item.eyebrow}</div>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
          <div className="lead-path-card__actions">
            <a
              className="site-button site-button--primary"
              href={item.primary.href}
              target={item.primary.target || undefined}
              rel={item.primary.rel || undefined}
            >
              {item.primary.label}
            </a>
            {item.secondary ? (
              <a
                className="site-button"
                href={item.secondary.href}
                target={item.secondary.target || undefined}
                rel={item.secondary.rel || undefined}
              >
                {item.secondary.label}
              </a>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}

export function OfferRouter({ items }) {
  return (
    <section className="offer-router">
      {items.map((item) => (
        <article key={item.title} className="offer-router__card">
          <div className="offer-router__eyebrow">{item.eyebrow}</div>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
          <a
            className="site-button site-button--primary"
            href={item.primary.href}
            target={item.primary.target || undefined}
            rel={item.primary.rel || undefined}
          >
            {item.primary.label}
          </a>
        </article>
      ))}
    </section>
  );
}
