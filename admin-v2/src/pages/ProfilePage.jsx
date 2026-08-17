import { ProfileIdentityCard } from '../features/profile/ProfileIdentityCard.jsx';

export function ProfilePage() {
  return (
    <section className="page">
      <div className="space-y-6">
        <ProfileIdentityCard />
      </div>
    </section>
  );
}

export default ProfilePage;
