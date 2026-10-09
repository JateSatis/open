import { lazy, Suspense } from 'react';

import type { PreviewLayerProps } from './PreviewLayer';
import { useMediaPreviewOpen } from './previewStore';

export {
  handlePreviewBack,
  openMediaPreview,
  publishPreviewGallery,
  registerGridCell,
  resetMediaPreview,
  unregisterGridCell,
  useMediaPreviewOpen,
} from './previewStore';

/**
 * Слой предпросмотра тянет за собой Skia — тяжёлый модуль. Он загружается
 * только при первом открытии предпросмотра, а не вместе с шитом: шит должен
 * открываться так же быстро, как без редактора.
 */
const PreviewLayer = lazy(() =>
  import('./PreviewLayer').then((module) => ({ default: module.PreviewLayer })),
);

export type MediaPreviewProps = PreviewLayerProps;

/** Предпросмотр файлов шита — рисуется, только пока открыт. */
export function MediaPreview(props: MediaPreviewProps) {
  const open = useMediaPreviewOpen();

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <PreviewLayer {...props} />
    </Suspense>
  );
}
