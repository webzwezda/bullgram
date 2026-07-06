import { ProfileIdentityCard } from '../features/profile/ProfileIdentityCard.jsx';
import { ProfileContactsCard } from '../features/profile/ProfileContactsCard.jsx';
import { ProfilePurchasesCard } from '../features/profile/ProfilePurchasesCard.jsx';
import { PlatformTierUpgradeCard } from '../features/billing/PlatformTierUpgradeCard.jsx';

export function ProfilePage() {
  return (
    <section className="page">
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
