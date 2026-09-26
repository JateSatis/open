import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import type { Device } from '@/api/account';
import { confirm } from '@/components/ConfirmDialog';
import { LinkButton } from '@/components/LinkButton';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { Text } from '@/components/Text';
import {
  useDevices,
  useEndDeviceSession,
  useEndOtherSessions,
} from '@/features/auth/accountQueries';
import {
  deviceDetails,
  deviceTitle,
  formatLastSeen,
  orderDevices,
} from '@/features/auth/deviceDisplay';
import { useInstallationId } from '@/features/auth/useInstallationId';
import { describeLoadError } from '@/lib/network';

/** Устройства, где выполнен вход. Своё — первым и без кнопки завершения. */
export function DeviceList() {
  const installationId = useInstallationId();
  const { data, isPending, error } = useDevices();
  const endOne = useEndDeviceSession();
  const endOthers = useEndOtherSessions();
  const devices = orderDevices(data ?? [], installationId);
  const hasOthers = devices.some((device) => device.installationId !== installationId);

  const onEnd = async (device: Device) => {
    const agreed = await confirm({
      title: 'Завершить сеанс?',
      message: `${deviceTitle(device)} выйдет из аккаунта, как только снова откроет Open.`,
      confirmLabel: 'Завершить',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (agreed) endOne.mutate(device.id);
  };

  const onEndOthers = async () => {
    const agreed = await confirm({
      title: 'Завершить другие сеансы?',
      message: 'Все устройства, кроме этого, выйдут из аккаунта.',
      confirmLabel: 'Завершить все',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (agreed) endOthers.mutate();
  };

  const problem =
    endOne.error || endOthers.error
      ? 'Не удалось завершить сеанс. Попробуйте ещё раз.'
      : describeLoadError(error, 'Не удалось загрузить устройства');

  return (
    <SettingsSection title="Устройства">
      {isPending ? (
        <ActivityIndicator accessibilityLabel="Загрузка устройств" style={styles.loader} />
      ) : null}

      {devices.map((device, index) => {
        const isCurrent = device.installationId === installationId;

        return (
          <SettingsRow
            key={device.id}
            divided={index > 0}
            title={deviceTitle(device)}
            subtitle={`${deviceDetails(device)}\n${
              isCurrent ? 'Это устройство' : `Активность: ${formatLastSeen(device.lastSeenAt)}`
            }`}
            accessory={
              isCurrent ? null : (
                <LinkButton
                  label="Завершить"
                  color="danger"
                  accessibilityLabel={`Завершить сеанс: ${deviceTitle(device)}`}
                  loading={endOne.isPending && endOne.variables === device.id}
                  onPress={() => void onEnd(device)}
                />
              )
            }
          />
        );
      })}

      {hasOthers || problem ? (
        <View style={styles.footer}>
          {hasOthers ? (
            <LinkButton
              label="Завершить все, кроме этого"
              color="danger"
              loading={endOthers.isPending}
              onPress={() => void onEndOthers()}
            />
          ) : null}
          {problem ? (
            <Text variant="small" color="danger">
              {problem}
            </Text>
          ) : null}
        </View>
      ) : null}
    </SettingsSection>
  );
}
