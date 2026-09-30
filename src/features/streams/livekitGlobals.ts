// WebRTC и полифилы для livekit-client — до любого его использования. Файл
// импортируется первым в корневом layout (раздел «Стримы» в CLAUDE.md).
import { registerGlobals } from '@livekit/react-native';
import { CriticalTimers } from 'livekit-client';

import { backgroundTimers } from '../../../modules/call-service';

registerGlobals();

// Пинг сигнального канала LiveKit идёт на «критичных» таймерах. У свёрнутого
// приложения таймеры JS на Android стоят, и сервер выкинул бы нас из звонка,
// поэтому здесь они нативные.
// Таймер в React Native — число, а в типах livekit-client — объект Node,
// поэтому подменяются поля целиком, без проверки их типов.
if (backgroundTimers) {
  Object.assign(CriticalTimers, backgroundTimers);
}
