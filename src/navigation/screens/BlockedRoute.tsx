import { useRouter } from '@/navigation';

import { BlockedUsersScreen } from '@/features/moderation/BlockedUsersScreen';

/** «Заблокированные» — из «Конфиденциальности». */
export function BlockedRoute() {
  const router = useRouter();

  return (
    <BlockedUsersScreen
      onOpenPerson={(personId) => router.push({ name: 'Person', params: { userId: personId } })}
    />
  );
}
