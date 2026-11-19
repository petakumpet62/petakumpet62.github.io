export type MapCoordinates = {
  latitude: number;
  longitude: number;
};

export type MapPoint = MapCoordinates & {
  id: string;
  label: string;
  color: string;
};

export type MapPath = {
  id: string;
  color: string;
  coordinates: MapCoordinates[];
};

export type MapPanelMessage =
  | { type: 'pin-place'; latitude: number; longitude: number }
  | { type: 'map-interaction' };

export type MapPanelProps = {
  center: MapCoordinates;
  radiusMeters: number;
  points: MapPoint[];
  paths?: MapPath[];
  isLightTheme: boolean;
  fullScreen?: boolean;
  canPlacePin?: boolean;
  dismissPinOnInteraction?: boolean;
  onMapPress?: (location: MapCoordinates) => void;
  onMapInteraction?: () => void;
};

export function dispatchMapPanelMessage(message: string, props: MapPanelProps) {
  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch (error) {
    console.error('Map panel sent an invalid message:', error);
    return;
  }
  if (!payload || typeof payload !== 'object') return;

  const mapMessage = payload as Record<string, unknown>;
  if (
    mapMessage.type === 'pin-place' &&
    typeof mapMessage.latitude === 'number' &&
    Number.isFinite(mapMessage.latitude) &&
    typeof mapMessage.longitude === 'number' &&
    Number.isFinite(mapMessage.longitude)
  ) {
    props.onMapPress?.({
      latitude: mapMessage.latitude,
      longitude: mapMessage.longitude,
    });
  } else if (mapMessage.type === 'map-interaction') {
    props.onMapInteraction?.();
  }
}
