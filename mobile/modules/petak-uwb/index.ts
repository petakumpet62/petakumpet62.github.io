import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type NativeUwbModule = {
  getAvailability(): Promise<{
    hardwareSupported: boolean;
    serviceAvailable: boolean;
  }>;
};

export type UwbAvailability =
  | { status: 'available' }
  | { status: 'unsupported-platform' }
  | { status: 'native-build-required' }
  | { status: 'unsupported-device' }
  | { status: 'temporarily-unavailable' }
  | { status: 'check-failed' };

const nativeUwbModule = requireOptionalNativeModule<NativeUwbModule>('PetakUwb');

export async function getUwbAvailability(): Promise<UwbAvailability> {
  if (Platform.OS !== 'android') return { status: 'unsupported-platform' };
  if (!nativeUwbModule) return { status: 'native-build-required' };

  const availability = await nativeUwbModule.getAvailability();
  if (!availability.hardwareSupported) return { status: 'unsupported-device' };
  if (!availability.serviceAvailable) return { status: 'temporarily-unavailable' };
  return { status: 'available' };
}
