import { requestClient } from '@/api/requestClient';
import { dismissConfirmDialogs } from '@/components/ConfirmDialog/store';
import { useComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetMediaSheet } from '@/features/chats/MediaPickerSheet/sheetStore';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';
import { useMediaSelection } from '@/features/media/selectionStore';
import { stopVoice } from '@/features/media/voicePlayback';
import { dismissAlert } from '@/features/notifications/alertsStore';
import { unloadRecentSearches } from '@/features/search/recentSearches';
import { leaveCall } from '@/features/streams/callSession';
import { getCall } from '@/features/streams/callStore';
import { resetRinging } from '@/features/streams/incomingCall';
import { setActiveChatId } from '@/store/activeChat';
import { useSessionStore } from './sessionState';

/** Закрываем интерфейс до первого рендера следующего владельца.
 * Черновики, исходящие и оптимистичные правки остаются в сторах своего API.
 */
export function startAccountPresentation() {
  let owner = requestClient();
  function closePresentation() {
    if (!owner.retired) useComposerDrafts.forClient(owner).setState({ forwardPick: null });
    stopVoice();
    unloadRecentSearches();
    setActiveChatId(null);
    dismissConfirmDialogs();
    dismissAlert();
    resetRinging();
    if (getCall()) void leaveCall();
    closeComments();
    resetMediaSheet();
    useMediaSelection.getState().clear();
  }
  const unsubscribe = useSessionStore.subscribe((state, previous) => {
    const next = requestClient();
    if (owner === next && state.localAccountId === previous.localAccountId) return;
    if (previous.localAccountId !== undefined) closePresentation();
    owner = next;
  });
  return () => {
    unsubscribe();
    closePresentation();
  };
}
