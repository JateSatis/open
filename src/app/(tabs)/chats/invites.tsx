import { useRouter } from 'expo-router';

import { InvitesScreen } from '@/features/chats/InvitesScreen';

export default function InvitesRoute() {
  const router = useRouter();

  return (
    <InvitesScreen
      onOpenChat={(chatId) => router.push(`/chats/${chatId}`)}
      onOpenPerson={(userId) => router.push(`/chats/people/${userId}`)}
      onOpenOwnProfile={() => router.navigate('/profile')}
    />
  );
}
