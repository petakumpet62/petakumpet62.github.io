import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview/lib/WebView.ios';
import type { MapPanelProps } from './MapPanel.types';
import { useNativeMapPanel } from './MapPanel.native.shared';

export function MapPanel(props: MapPanelProps) {
  const { mapRef, mapHtml, onLoadEnd, onMessage } = useNativeMapPanel(props);
  return (
    <View style={[styles.container, props.fullScreen && styles.fullScreenContainer]}>
      <WebView
        ref={mapRef}
        style={props.fullScreen ? styles.fullScreenWebView : undefined}
        source={{ html: mapHtml }}
        originWhitelist={['*']}
        javaScriptEnabled
        onLoadEnd={onLoadEnd}
        onMessage={(event) => onMessage(event.nativeEvent.data)}
      />
    </View>
  );
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
  fullScreenWebView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
