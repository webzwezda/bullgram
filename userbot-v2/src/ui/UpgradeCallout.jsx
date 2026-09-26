const DEFAULT_ACTIONS = {
  // Апгрейд тарифа в этом приложении живёт на профиле ('/billing' относительный
  // путь под basename /userbot вёл бы в несуществующий /userbot/billing —
  // план 2026-09-26-userbot-product-split, Фаза 3).
  trial: { label: 'Открыть Trial', href: '/profile' },
  pro: { label: 'Перейти на Pro', href: '/profile' }
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
