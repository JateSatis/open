import { useLocalSearchParams } from 'expo-router';

import { PopViewerScreen } from '@/features/pops/PopViewerScreen';

/** Просмотр попсов выдачи поиска «Ленты» с выбранного попа. */
export default function SearchPopViewerRoute() {
  const { q, start } = useLocalSearchParams<{ q: string; start: string }>();
  return <PopViewerScreen source="search" query={q} startId={start} />;
}
