import { router } from '@/navigation';

import { EditProfileScreen } from '@/features/profile/EditProfileScreen';

export function EditProfileRoute() {
  return <EditProfileScreen onSaved={router.back} />;
}
