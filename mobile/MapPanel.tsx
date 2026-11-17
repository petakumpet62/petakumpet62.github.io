import { StyleSheet, Text, View } from 'react-native';
import type { MapPanelProps } from './MapPanel.types';

export function MapPanel(props: MapPanelProps) {
  return (
    <View style={[styles.container, props.fullScreen && styles.fullScreenContainer]}>
      <Text style={styles.text}>Peta tidak tersedia pada platform ini.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 300,
    overflow: 'hidden',
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreenContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 0,
    borderRadius: 0,
    marginBottom: 0,
  },
  text: {
    color: '#334155',
  },
});
