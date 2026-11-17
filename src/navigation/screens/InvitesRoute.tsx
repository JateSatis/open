import { useRouter } from '@/navigation';

import { InvitesScreen } from '@/features/chats/InvitesScreen';

export function InvitesRoute() {
  const router = useRouter();

  return (
    <InvitesScreen
      onOpenChat={(chatId) => router.push({ name: 'Chat', params: { chatId } })}
      onOpenPerson={(userId) => router.push({ name: 'Person', params: { userId } })}
      onOpenOwnProfile={() => router.navigate({ name: 'Tabs', params: { screen: 'profile' } })}
    />
  );
}
