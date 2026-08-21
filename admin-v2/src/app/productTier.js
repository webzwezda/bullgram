export function getProductTierRules(plan = 'trial') {
  if (plan === 'pro') {
    return {
      id: 'pro',
      label: 'Pro',
      maxUserbots: Infinity,
      maxOwnedProxies: Infinity,
      canSendBroadcasts: true,
      canUseShopAdmin: true,
      canCreateMultipleUserbots: true,
      canCreateMultipleOwnedProxies: true,
      canUseTrialProxy: false,
      canBuyAssets: true,
      summary: 'Рабочий тариф Bullgram: безлимит запросов API/MCP, юзерботов и прокси, рассылки и продажи в Shop.'
    };
  }

  if (plan === 'normal') {
    return getProductTierRules('pro');
  }

  return {
    id: 'trial',
    label: 'Trial',
    maxUserbots: 1,
    maxOwnedProxies: 1,
    canSendBroadcasts: false,
    canUseShopAdmin: false,
    canCreateMultipleUserbots: false,
    canCreateMultipleOwnedProxies: false,
    canUseTrialProxy: false,
    canBuyAssets: true,
    summary: 'Trial нужен, чтобы быстро собрать первый контур: один свой юзербот, один свой прокси и возможность сразу купить готовые активы.'
  };
}
