import { useRouteParams } from '@/navigation';
import { PopViewerScreen } from '@/features/pops/PopViewerScreen';
export function PopViewerRoute() {
  return <PopViewerScreen {...useRouteParams<'PopViewer'>()} />;
}
