/**
 * Public surface of the media feature. Other features (chats today, posts
 * later) import from here and never reach into the files below, so the
 * internals — which Expo module records what, where the bytes are stored —
 * stay replaceable.
 *
 * The contract is `LocalMedia` in, `UploadedMedia` out. Writing the row in
 * `attachments` belongs to whoever sends the message.
 */

export { CameraCapture, type CameraCaptureProps } from './CameraCapture';
export { VideoNotePlayer, type VideoNotePlayerProps } from './VideoNotePlayer';
export { VideoNoteRecorder, type VideoNoteRecorderProps } from './VideoNoteRecorder';
export { VoicePlayer, type VoicePlayerProps } from './VoicePlayer';
export { VoiceRecorder, type VoiceRecorderProps } from './VoiceRecorder';

export {
  captureMediaWithSystemCamera,
  pickMediaFromLibrary,
  type PickMediaOptions,
  type PickMediaResult,
} from './pickMedia';

export { MediaUploadError, removeUploadedMedia, uploadMedia } from './storage';
export { useVoiceRecorder, type VoiceRecorder as VoiceRecorderApi } from './useVoiceRecorder';

export { MediaGrid, type MediaGridProps, type MediaListComponent } from './MediaGrid';
export { GridSkeleton, type GridSkeletonProps } from './GridSkeleton';
export { gridGeometry } from './MediaGrid/gridLayout';
export { MediaViewer, type MediaViewerItem, type MediaViewerProps } from './MediaViewer';
export { assetPreviewUri } from './lib/previewUri';
export {
  libraryAssetToLocalMedia,
  queryRecentMedia,
  requestMediaLibraryAccess,
  resolveAssetUri,
  resolveLibraryAsset,
  type LibraryAccess,
  type LibraryAsset,
  type MediaLibraryItem,
  type ResolvedLibraryAsset,
} from './mediaLibrary';
export {
  selectedAssets,
  useMediaSelection,
  useHasSelection,
  useSelectionCount,
  useSelectionSlot,
} from './selectionStore';
export { useGalleryAssets, type GalleryAssets, type GalleryStatus } from './useGalleryAssets';
export { prepareForUpload } from './lib/prepareForUpload';
export { uploadAllMedia } from './uploadAll';

export { MediaLimits } from './constants';
export { formatDuration } from './lib/formatDuration';
export type { LocalMedia, MediaKind, UploadedMedia } from './types';
