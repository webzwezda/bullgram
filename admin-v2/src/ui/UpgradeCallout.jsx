const DEFAULT_ACTIONS = {
  trial: { label: 'Открыть Trial', href: '/billing' },
  pro: { label: 'Перейти на Pro', href: '/billing' }
};

export function UpgradeCallout({
  title = 'Пора переводить контур на Pro',
  text,
  trialHref = DEFAULT_ACTIONS.trial.href,
  proHref = DEFAULT_ACTIONS.pro.href,
  compact = false
}) {
  return (
    <div className={`upgrade-callout${compact ? ' upgrade-callout--compact' : ''}`}>
      <div className="upgrade-callout__eyebrow">Trial → Pro</div>
      <div className="upgrade-callout__title">{title}</div>
      <div className="upgrade-callout__text">
        {text || 'Trial нужен, чтобы быстро собрать первый контур руками. Как только упираешься в лимиты, переводи кабинет на Pro и открывай рабочий режим без базовых стопоров.'}
      </div>
      <div className="upgrade-callout__actions">
        <a className="ghost-button ghost-button--primary" href={proHref}>
          {DEFAULT_ACTIONS.pro.label}
        </a>
        <a className="ghost-button" href={trialHref}>
          {DEFAULT_ACTIONS.trial.label}
        </a>
      </div>
    </div>
  );
}
