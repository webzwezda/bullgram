const DEFAULT_ACTIONS = {
  trial: { label: 'Открыть Trial', href: '/shop?offer=trial' },
  normal: { label: 'Перейти на Normal', href: '/shop?offer=normal' }
};

export function UpgradeCallout({
  title = 'Пора переводить контур на Normal',
  text,
  trialHref = DEFAULT_ACTIONS.trial.href,
  normalHref = DEFAULT_ACTIONS.normal.href,
  compact = false
}) {
  return (
    <div className={`upgrade-callout${compact ? ' upgrade-callout--compact' : ''}`}>
      <div className="upgrade-callout__eyebrow">Trial → Normal</div>
      <div className="upgrade-callout__title">{title}</div>
      <div className="upgrade-callout__text">
        {text || 'Trial нужен, чтобы быстро собрать первый контур руками. Как только упираешься в лимиты, переводи кабинет на Normal и открывай рабочий режим без базовых стопоров.'}
      </div>
      <div className="upgrade-callout__actions">
        <a className="ghost-button ghost-button--primary" href={normalHref}>
          {DEFAULT_ACTIONS.normal.label}
        </a>
        <a className="ghost-button" href={trialHref}>
          {DEFAULT_ACTIONS.trial.label}
        </a>
      </div>
    </div>
  );
}
