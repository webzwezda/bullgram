import { ProfileIdentityCard } from '../features/profile/ProfileIdentityCard.jsx';
import { ProfileTelegramCard } from '../features/profile/ProfileTelegramCard.jsx';

export function ProfilePage() {
  return (
    <section className="page">
      <div className="space-y-6">
        <ProfileIdentityCard />
        <ProfileTelegramCard />
      </div>
    </section>
  );
}

export default ProfilePage;
