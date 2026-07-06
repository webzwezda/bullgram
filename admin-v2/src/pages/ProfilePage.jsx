import { ProfileIdentityCard } from '../features/profile/ProfileIdentityCard.jsx';
import { ProfileContactsCard } from '../features/profile/ProfileContactsCard.jsx';
import { ProfilePurchasesCard } from '../features/profile/ProfilePurchasesCard.jsx';
import { PlatformTierUpgradeCard } from '../features/billing/PlatformTierUpgradeCard.jsx';

export function ProfilePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <ProfileIdentityCard />
      <ProfileContactsCard />
      <PlatformTierUpgradeCard />
      <ProfilePurchasesCard />
    </div>
  );
}

export default ProfilePage;
