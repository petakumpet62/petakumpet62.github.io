import * as ExpoLocation from 'expo-location';

export type LocationFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type LocationSubscription = Pick<ExpoLocation.LocationSubscription, 'remove'>;

export interface LocationProvider {
  requestPermission(): Promise<boolean>;
  hasLocationServicesEnabled(): Promise<boolean>;
  getCurrentLocation(): Promise<LocationFix>;
  watchLocation(onLocation: (location: LocationFix) => void): Promise<LocationSubscription>;
}

function toLocationFix(position: ExpoLocation.LocationObject): LocationFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? 1000,
    timestamp: position.timestamp,
  };
}

export const deviceLocationProvider: LocationProvider = {
  async requestPermission() {
    const permission = await ExpoLocation.requestForegroundPermissionsAsync();
    return permission.granted;
  },

  hasLocationServicesEnabled() {
    return ExpoLocation.hasServicesEnabledAsync();
  },

  async getCurrentLocation() {
    const getFix = (accuracy: ExpoLocation.Accuracy) =>
      ExpoLocation.getCurrentPositionAsync({ accuracy });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Lokasi belum tersedia dalam batas waktu.')), 12_000);
    });

    try {
      const position = await Promise.race([getFix(ExpoLocation.Accuracy.High), timeout]);
      if (timeoutId) clearTimeout(timeoutId);
      return toLocationFix(position);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      const lastKnown = await ExpoLocation.getLastKnownPositionAsync({
        maxAge: 30_000,
        requiredAccuracy: 100,
      }).catch(() => null);
      if (lastKnown) return toLocationFix(lastKnown);
      throw error;
    }
  },

  watchLocation(onLocation) {
    return ExpoLocation.watchPositionAsync(
      {
        accuracy: ExpoLocation.Accuracy.High,
        distanceInterval: 5,
        timeInterval: 5000,
      },
      (position) => onLocation(toLocationFix(position))
    );
  },
};
