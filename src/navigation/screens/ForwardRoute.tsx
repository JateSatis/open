import { useRouter } from '@/navigation';

import { ForwardScreen } from '@/features/chats/ForwardScreen';

export function ForwardRoute() {
  const router = useRouter();

  return <ForwardScreen onClose={router.back} />;
}
