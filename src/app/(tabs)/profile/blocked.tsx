import { useRouter } from 'expo-router';

import { BlockedUsersScreen } from '@/features/moderation/BlockedUsersScreen';

/** «Заблокированные» — из «Конфиденциальности». */
export default function BlockedUsersRoute() {
  const router = useRouter();

  return (
    <BlockedUsersScreen
      onOpenPerson={(personId) =>
        router.push({ pathname: '/profile/[userId]', params: { userId: personId } })
      }
    />
  );
}
