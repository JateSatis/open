import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { BlockedUsers } from '@/features/moderation/BlockedUsers';

/** «Заблокированные» — из «Конфиденциальности». */
export default function BlockedUsersScreen() {
  const router = useRouter();

  return (
    <Screen edges={['bottom']}>
      <BlockedUsers
        onOpenPerson={(personId) =>
          router.push({ pathname: '/profile/[userId]', params: { userId: personId } })
        }
      />
    </Screen>
  );
}
