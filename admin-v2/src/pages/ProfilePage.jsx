import { ProfileIdentityCard } from '../features/profile/ProfileIdentityCard.jsx';
import { ProfileWalletCard } from '../features/profile/ProfileWalletCard.jsx';
import { ProfileTelegramCard } from '../features/profile/ProfileTelegramCard.jsx';

export function ProfilePage() {
  return (
    <section className="page">
      <div className="space-y-6">
        <ProfileIdentityCard />
        <ProfileWalletCard />
        <ProfileTelegramCard />
      </div>
    </section>
  );
}

export default ProfilePage;
