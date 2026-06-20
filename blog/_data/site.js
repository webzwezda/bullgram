export default {
  title: "BullRun Blog",
  description: "Практические заметки о монетизации закрытых Telegram-сообществ, оплатах, доступах и операционном контуре BullRun.",
  url: "https://bullgram.xyz",
  blogPath: "/blog",
  blogUrl: "https://bullgram.xyz/blog",
  assetVersion: "20260501-6",
  nav: [
    { href: "/", label: "Главная", icon: "dashboard" },
    { href: "/pricing", label: "Тарифы", icon: "credit-card" },
    { href: "/shop", label: "Shop", icon: "shopping-bag" },
    { href: "/blog/", label: "Блог", icon: "newspaper", active: true }
  ],
  categories: [
    {
      slug: "all",
      label: "Все статьи",
      href: "/",
      description: "Все публикации блога BullRun."
    },
    {
      slug: "telegram",
      label: "Телеграм",
      href: "/telegram/",
      description: "Боты, доступы, ручные сообщения и ограничения Telegram."
    },
    {
      slug: "steam",
      label: "Steam",
      href: "/steam/",
      description: "Скины, ликвидность, трейдинг и цифровые активы внутри Steam-рынка."
    },
    {
      slug: "crypto",
      label: "Крипта",
      href: "/crypto/",
      description: "TON, P2P, платежи, цифровые рынки и крипто-комьюнити."
    }
  ]
};
