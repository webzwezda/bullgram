import { ProfileIdentityCard } from '../features/profile/ProfileIdentityCard.jsx';
import { ProfileWalletCard } from '../features/profile/ProfileWalletCard.jsx';
import { ProfileTelegramCard } from '../features/profile/ProfileTelegramCard.jsx';

export function ProfilePage() {
  return (
    <section className="page">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Профиль</h1>
          <p className="text-sm text-slate-500 mt-1">
            Твой аккаунт: e-mail, кошелёк, Telegram — вход и связи в одном месте.
          </p>
        </div>
        <ProfileIdentityCard />
        <ProfileWalletCard />
        <ProfileTelegramCard />
      </div>
    </section>
  );
}

export default ProfilePage;
