import { useRouter } from '@/navigation';
import { Screen } from '@/components/Screen';
import { BlockedUsers } from '@/features/moderation/BlockedUsers';

export function BlockedUsersScreen() {
  const router = useRouter();
  const onOpenPerson = (userId: string) => router.push({ name: 'Person', params: { userId } });
  return (
    <Screen edges={['bottom']}>
      <BlockedUsers onOpenPerson={onOpenPerson} />
    </Screen>
  );
}
