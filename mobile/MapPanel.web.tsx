import { createElement, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { dispatchMapPanelMessage, type MapPanelProps } from './MapPanel.types';
import { MAP_HTML, serializeMapData } from './mapHtml';

export function MapPanel(props: MapPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mapData = useMemo(() => serializeMapData(props), [props]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(mapData, '*');
  }, [mapData]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || typeof event.data !== 'string') return;
      dispatchMapPanelMessage(event.data, props);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [props]);

  const iframe = createElement('iframe', {
    ref: (element: HTMLIFrameElement | null) => {
      iframeRef.current = element;
    },
    srcDoc: MAP_HTML,
    title: 'Peta permainan PETAK',
    onLoad: () => iframeRef.current?.contentWindow?.postMessage(mapData, '*'),
    sandbox: 'allow-scripts allow-same-origin',
    style: { width: '100%', height: '100%', minHeight: 0, display: 'block', border: 0 },
  });

  return <View style={[styles.container, props.fullScreen && styles.fullScreenContainer]}>{iframe}</View>;
}

const styles = StyleSheet.create({
  container: {
    height: 300,
    overflow: 'hidden',
    borderRadius: 12,
    marginBottom: 12,
  },
  fullScreenContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 0,
    borderRadius: 0,
    marginBottom: 0,
  },
});
