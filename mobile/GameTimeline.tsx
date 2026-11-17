import { StyleSheet, Text, View } from 'react-native';

type GameTimelineProps = {
  eventLog: string[];
  showHeader?: boolean;
  isLightTheme?: boolean;
};

export function GameTimeline({
  eventLog,
  showHeader = true,
  isLightTheme = false,
}: GameTimelineProps) {
  const styles = isLightTheme
    ? {
        ...darkStyles,
        container: { ...darkStyles.container, ...lightStyles.container },
        header: { ...darkStyles.header, ...lightStyles.header },
        eyebrow: { ...darkStyles.eyebrow, ...lightStyles.eyebrow },
        title: { ...darkStyles.title, ...lightStyles.title },
        count: { ...darkStyles.count, ...lightStyles.count },
        entryCopy: { ...darkStyles.entryCopy, ...lightStyles.entryCopy },
        latest: { ...darkStyles.latest, ...lightStyles.latest },
        text: { ...darkStyles.text, ...lightStyles.text },
        empty: { ...darkStyles.empty, ...lightStyles.empty },
      }
    : darkStyles;

  return (
    <View style={styles.container}>
      {showHeader ? (
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>LINIMASA OPERASI</Text>
            <Text style={styles.title}>Log permainan</Text>
          </View>
          <Text style={styles.count}>{eventLog.length} AKTIVITAS</Text>
        </View>
      ) : null}
      {eventLog.length ? (
        eventLog.map((entry, index) => (
          <View key={`${entry}-${index}`} style={styles.entry}>
            <View style={styles.timeline}>
              <View style={[styles.dot, index === 0 && styles.latestDot]} />
              {index < eventLog.length - 1 ? <View style={styles.connector} /> : null}
            </View>
            <View style={styles.entryCopy}>
              {index === 0 ? <Text style={styles.latest}>TERBARU</Text> : null}
              <Text style={styles.text}>{entry}</Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>Belum ada aktivitas.</Text>
      )}
    </View>
  );
}

const darkStyles = StyleSheet.create({
  container: {
    backgroundColor: '#1f2d3d',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.2)',
  },
  eyebrow: {
    color: '#67e8f9',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: '#f3f7ff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 6,
  },
  count: {
    color: '#9db0c4',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  entry: {
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
  },
  timeline: {
    alignItems: 'center',
    width: 10,
    paddingTop: 13,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#64748b',
  },
  latestDot: {
    backgroundColor: '#67e8f9',
  },
  connector: {
    flex: 1,
    width: 1,
    marginTop: 3,
    backgroundColor: 'rgba(148, 163, 184, 0.24)',
  },
  entryCopy: {
    flex: 1,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.12)',
  },
  latest: {
    color: '#67e8f9',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.9,
    marginBottom: 2,
  },
  text: {
    color: '#dce7f3',
    fontSize: 12,
    lineHeight: 18,
  },
  empty: {
    color: '#9db0c4',
    fontSize: 12,
    paddingVertical: 12,
  },
});

const lightStyles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
  },
  header: {
    borderBottomColor: '#cbd5e1',
  },
  eyebrow: {
    color: '#0369a1',
  },
  title: {
    color: '#0f172a',
  },
  count: {
    color: '#475569',
  },
  entryCopy: {
    borderBottomColor: '#e2e8f0',
  },
  latest: {
    color: '#0369a1',
  },
  text: {
    color: '#1e293b',
  },
  empty: {
    color: '#475569',
  },
});
