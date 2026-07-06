import { ProfileIdentityCard } from '../features/profile/ProfileIdentityCard.jsx';
import { ProfileContactsCard } from '../features/profile/ProfileContactsCard.jsx';
import { ProfilePurchasesCard } from '../features/profile/ProfilePurchasesCard.jsx';
import { PlatformTierUpgradeCard } from '../features/billing/PlatformTierUpgradeCard.jsx';

export function ProfilePage() {
  return (
    <section className="page">
      <div className="page__header">
        <h1>Профиль</h1>
        <p>Кошельки, подписка и история покупок — всё в одном месте.</p>
      </div>

      <div className="space-y-6">
        <ProfileIdentityCard />
        <ProfileContactsCard />
        <PlatformTierUpgradeCard />
        <ProfilePurchasesCard />
      </div>
    </section>
  );
}

export default ProfilePage;
