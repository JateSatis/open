import { Screen } from '@/components/Screen';
import { BlockedUsers, type BlockedUsersProps } from '@/features/moderation/BlockedUsers';

export function BlockedUsersScreen({ onOpenPerson }: BlockedUsersProps) {
  return (
    <Screen edges={['bottom']}>
      <BlockedUsers onOpenPerson={onOpenPerson} />
    </Screen>
  );
}
