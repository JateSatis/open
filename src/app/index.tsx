// First: livekit-client reads WebRTC globals while its modules are loading.
import '@/features/streams/livekitGlobals';

import { registerRootComponent } from 'expo';
import { AppRoot } from '@/AppRoot';
import { useIncomingLink } from '@/navigation/useIncomingLink';
import { AppRouter } from './AppRouter';

function App() {
  const incoming = useIncomingLink();
  return (
    <AppRoot>
      <AppRouter incoming={incoming} />
    </AppRoot>
  );
}
registerRootComponent(App);
