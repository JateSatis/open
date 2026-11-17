import { useRouteParams } from '@/navigation';

import { UserChats } from '@/features/profile/UserChats';

export function DialogsRoute() {
  const { userId } = useRouteParams<'Dialogs'>();

  return <UserChats userId={userId} />;
}
