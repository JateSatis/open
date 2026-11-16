import { useRouter } from 'expo-router';

import { ForwardScreen } from '@/features/chats/ForwardScreen';

export default function ForwardRoute() {
  const router = useRouter();

  return <ForwardScreen onClose={router.back} />;
}
