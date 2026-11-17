import { useNavigation, type NativeStackNavigationProp } from '@/navigation';
import type { ParamListBase } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import type { ChatListRow } from '@/features/chats/islands/rows';

/** Hold the last attached list while Android detaches a native stack screen.
 * Logical focus precedes native onAppear, so it cannot release this snapshot. */
export function useAttachedHistoryRows(rows: ChatListRow[], scope: string): ChatListRow[] {
  const nav = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: ChatListRow[] } | null>(null);
  useEffect(() => {
    const start = nav.addListener('transitionStart', ({ data }) => {
      if (data.closing)
        setSnapshot((current) => (current?.scope === scope ? current : { scope, rows }));
    });
    const end = nav.addListener('transitionEnd', ({ data }) => {
      if (!data.closing) setSnapshot(null);
    });
    return () => {
      start();
      end();
    };
  }, [nav, rows, scope]);
  return snapshot?.scope === scope ? snapshot.rows : rows;
}
