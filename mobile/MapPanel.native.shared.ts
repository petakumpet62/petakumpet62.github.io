import { useEffect, useMemo, useRef, useState } from 'react';
import { dispatchMapPanelMessage, type MapPanelProps } from './MapPanel.types';
import { MAP_HTML, serializeMapData } from './mapHtml';

type MapWebViewHandle = {
  postMessage(message: string): void;
};

export function useNativeMapPanel(props: MapPanelProps) {
  const mapRef = useRef<MapWebViewHandle | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const mapData = useMemo(
    () => serializeMapData(props),
    [
      props.center.latitude,
      props.center.longitude,
      props.radiusMeters,
      props.points,
      props.paths,
      props.isLightTheme,
      props.canPlacePin,
      props.dismissPinOnInteraction,
    ]
  );

  useEffect(() => {
    if (isLoaded) mapRef.current?.postMessage(mapData);
  }, [isLoaded, mapData]);

  return {
    mapRef,
    mapHtml: MAP_HTML,
    onMessage: (message: string) => dispatchMapPanelMessage(message, props),
    onLoadEnd: () => setIsLoaded(true),
  };
}
