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
    const position = await ExpoLocation.getCurrentPositionAsync({
      accuracy: ExpoLocation.Accuracy.High,
    });
    return toLocationFix(position);
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
