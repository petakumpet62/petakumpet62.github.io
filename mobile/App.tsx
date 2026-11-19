import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import {
  AudioPlayer,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioStream,
} from 'expo-audio';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path } from 'react-native-svg';
import { Asset } from 'expo-asset';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  type ImageSourcePropType,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  useColorScheme,
  View,
  useWindowDimensions,
} from 'react-native';
import { io, Socket } from 'socket.io-client';
import { GameTimeline } from './GameTimeline';
import { MapPanel } from './MapPanel';
import type { MapPath, MapPoint } from './MapPanel.types';
import {
  createCompanionSpeechSegments,
  findEnglishSpeechVoice,
  getCompanionSpeechStyle,
  type CompanionId,
  type CompanionSpeechStyle,
} from './companionSpeech';
import { deviceLocationProvider } from './locationProvider';
import type { LocationFix, LocationSubscription } from './locationProvider';
import { getUwbAvailability } from './modules/petak-uwb';
import type { UwbAvailability } from './modules/petak-uwb';

type Role = 'SEEKER' | 'HIDER' | 'IMPOSTOR';
type Phase = 'LOBBY' | 'PREPARATION' | 'PLAYING' | 'FINISHED' | 'CANCELLED';
type CompanionPage =
  | 'home'
  | 'profile'
  | 'leaderboard'
  | 'lobby'
  | 'match'
  | 'results'
  | 'scanner';

type CompanionSpeechRecognitionResult = ArrayLike<{ transcript: string }> & {
  isFinal: boolean;
};
type CompanionSpeechRecognitionEvent = Event & {
  results: ArrayLike<CompanionSpeechRecognitionResult>;
  resultIndex: number;
};
type CompanionSpeechRecognitionErrorEvent = Event & {
  error: string;
};
type CompanionSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: CompanionSpeechRecognitionEvent) => void) | null;
  onerror: ((event: CompanionSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type CompanionSpeechRecognitionConstructor = new () => CompanionSpeechRecognition;
type CompanionSpeechRecognitionWindow = Window & {
  SpeechRecognition?: CompanionSpeechRecognitionConstructor;
  webkitSpeechRecognition?: CompanionSpeechRecognitionConstructor;
};

type AppAlert = {
  message: string;
};

type Mission = {
  id: string;
  label: string;
  goal: number;
  progress: number;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

type LandmarkTarget = Coordinates & {
  id: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  name: string;
  fixme: string;
};

type LandmarkSubmissionStatus = {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedName: string;
};

type LocationStatus = 'UNKNOWN' | 'INSIDE' | 'OUTSIDE' | 'INACCURATE' | 'UNCERTAIN' | null;
type ProximityThreatLevel = 'SAFE' | 'GREEN' | 'YELLOW' | 'RED';

const hiderThreatThemes: Record<
  ProximityThreatLevel,
  { background: string; card: string; accent: string; banner: string; bannerText: string }
> = {
  SAFE: {
    background: '#0f172a',
    card: '#16263b',
    accent: '#4dd9b5',
    banner: '#1c3b39',
    bannerText: '#b8f5df',
  },
  GREEN: {
    background: '#10251f',
    card: '#17362c',
    accent: '#4ade80',
    banner: '#14532d',
    bannerText: '#dcfce7',
  },
  YELLOW: {
    background: '#2a2412',
    card: '#3b321f',
    accent: '#facc15',
    banner: '#713f12',
    bannerText: '#fef3c7',
  },
  RED: {
    background: '#2b171d',
    card: '#451a1a',
    accent: '#fb7185',
    banner: '#7f1d1d',
    bannerText: '#ffe4e6',
  },
};

type Player = {
  id: string;
  name: string;
  avatarId: string;
  isHost: boolean;
  isReady: boolean;
  connected?: boolean;
  role: Role | null;
  isFound: boolean;
  isSpectator: boolean;
  challengeResult?: 'WON' | 'LOST' | null;
  challengeType?: 'ESCAPE' | 'CAPTURE' | null;
  secretMissionDone: boolean;
  missions: Mission[];
  badges: number | null;
  seekerRevealAvailable?: boolean;
  seekerRevealUsed?: boolean;
  seekerRevealCount?: number | null;
  seekerRevealCredits?: number | null;
  seekerRevealPurchaseCount?: number | null;
  seekerRevealPurchaseAvailable?: boolean;
  locationStatus?: LocationStatus;
  proximityLevel?: ProximityThreatLevel | null;
  distanceToSeeker?: number | null;
  liveLocation?: Coordinates;
  movementTrail?: Coordinates[];
};

type Room = {
  code: string;
  roundId: string;
  phase: Phase;
  status: string;
  winner: string | null;
  timeLeft: number;
  gameElapsedSeconds?: number | null;
  preparationTimeLeft: number;
  playRadiusMeters: number;
  playRadiusMode: 'FIXED' | 'RANDOM';
  playRadiusRandomFallback: boolean;
  playArea: { center: Coordinates; radiusMeters: number } | null;
  selfLocation: Coordinates | null;
  landmarkTargets: LandmarkTarget[] | null;
  seekerLocation: Coordinates | null;
  seekerRevealAvailable: boolean;
  seekerRevealUsed: boolean;
  seekerRevealCount?: number | null;
  seekerRevealCredits?: number | null;
  seekerRevealPurchaseCount?: number | null;
  seekerRevealPurchaseAvailable?: boolean;
  seekerScanCount: number | null;
  seekerScanPurchaseUsed: boolean;
  impostorLocationPin: (Coordinates & { id: string }) | null;
  badges: number | null;
  breachClues: Array<Coordinates & { id: string; playerName: string; createdAt: number }>;
  impostorDecoy: (Coordinates & { id: string; expiresAt: number }) | null;
  impostorDecoyQuota: number | null;
  impostorDecoysUsed: number | null;
  impostorDecoyActive: boolean;
  impostorDecoySelection: Coordinates | null;
  impostorObjectiveLocation: Coordinates | null;
  impostorObjectiveRadiusMeters: number | null;
  impostorDecoyMinimumDistanceMeters: number | null;
  proximityState?: {
    nearestDistanceMeters: number | null;
    threatLevel: ProximityThreatLevel;
    isCloseContact: boolean;
  } | null;
  selfPlayerId: string | null;
  selfReconnectToken?: string | null;
  players: Player[];
  eventLog: string[];
};

const SOCKET_URL =
  process.env.EXPO_PUBLIC_SOCKET_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000');
const SESSION_STORAGE_KEY = 'petak.active-session';
const ACCOUNT_STORAGE_KEY = 'petak.account-session';
const THEME_PREFERENCE_STORAGE_KEY = 'petak.theme-preference';
const SPEECH_VOICE_STORAGE_KEY = 'petak.speech-voice';
const COMPANION_VOICE_POSITION_STORAGE_KEY = 'petak.companion-voice-position';
const BROADCAST_INTRO_STORAGE_KEY = 'petak.broadcast-intro-seen';
const GETTING_STARTED_STORAGE_KEY = 'petak.getting-started-seen';
const LOBBY_MUSIC_ASSET = require('./assets/music/lobby-theme.wav');
const BROADCAST_SAMPLE_RATE = 24_000;
const BROADCAST_MAX_DURATION_SECONDS = 7;
const BROADCAST_ACK_TIMEOUT_MS = 25_000;
const ACCOUNT_REQUEST_TIMEOUT_MS = 15_000;
const STARTUP_LOADER_MINIMUM_MS = 450;
const SEEKER_SCAN_MARKER_DURATION_MS = 15_000;
const HIDER_MOVEMENT_GUIDANCE =
  'Jika ada peserta yang mendekat, menjauhlah sambil tetap berada di dalam zona permainan.';
const UNKNOWN_APPROACH_WARNING =
  `Hati-hati, peserta yang mendekat bisa jadi adalah Seeker. ${HIDER_MOVEMENT_GUIDANCE}`;

type SavedSession = {
  code: string;
  playerId: string;
  token: string;
};

type ThemePreference = 'dark' | 'light' | 'system';

const THEME_PREFERENCE_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
}> = [
  { value: 'dark', label: 'Gelap' },
  { value: 'light', label: 'Terang' },
  { value: 'system', label: 'Ikuti sistem' },
];

const roleDescription = (role: Role | null) => {
  switch (role) {
    case 'SEEKER':
      return 'Anda adalah Seeker. Cari Hider dan amankan area.';
    case 'IMPOSTOR':
      return 'Anda adalah Impostor. Pasang umpan, hindari Seeker, lalu capai titik sasaran.';
    case 'HIDER':
      return 'Anda adalah Hider. Bertahan dan lengkapi misi tim.';
    default:
      return 'Role akan dibagi saat permainan dimulai.';
  }
};

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const formatElapsedMinutes = (seconds: number | null | undefined) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  return `${Math.max(1, Math.ceil(seconds / 60))} mnt`;
};

const formatPlayRadius = (radiusMeters: number) =>
  radiusMeters >= 1_000 ? `${radiusMeters / 1_000} km` : `${radiusMeters} m`;

const formatNearbyDistance = (distanceMeters: number) =>
  distanceMeters >= 1_000
    ? `≈ ${(distanceMeters / 1_000).toFixed(1)} km`
    : `≈ ${distanceMeters} m`;

const isLiveGameLogEntry = (entry: string) =>
  entry.startsWith('Role dibagikan') ||
  entry.startsWith('Persiapan dimulai') ||
  entry.startsWith('Permainan dimulai') ||
  entry.includes(' menang:') ||
  entry.includes('menghentikan sesi darurat') ||
  entry.includes('terputus') ||
  entry.startsWith('Pemain yang tidak tersambung') ||
  entry.includes('tertangkap dan bergabung') ||
  entry === 'Aktivitas khusus terdeteksi.';

const PLAY_RADIUS_OPTIONS = [
  { label: '500 m', radiusMeters: 500, isRandom: false },
  { label: '1 km', radiusMeters: 1_000, isRandom: false },
  { label: '3 km', radiusMeters: 3_000, isRandom: false },
  { label: 'Acak', isRandom: true },
] as const;

const roleLabel = (role: Role | null) => {
  switch (role) {
    case 'SEEKER':
      return 'Seeker';
    case 'HIDER':
      return 'Hider';
    case 'IMPOSTOR':
      return 'Impostor';
    default:
      return 'Belum ditentukan';
  }
};

const winningRole = (winner: string | null): Role | null =>
  winner === 'SEEKER' || winner === 'HIDER' || winner === 'IMPOSTOR' ? winner : null;

const isWinningPlayer = (player: Player | null | undefined, winner: Role | null) => {
  if (!player || !winner || player.isSpectator) return false;
  return winner === 'HIDER'
    ? player.role !== 'SEEKER' && !player.isFound
    : player.role === winner;
};

const ROLE_REVEAL_AVATARS: Record<Role, ImageSourcePropType> = {
  SEEKER: require('./assets/role-avatars/seeker.png'),
  HIDER: require('./assets/role-avatars/hider.png'),
  IMPOSTOR: require('./assets/role-avatars/impostor.png'),
};

const ROLE_REVEAL_THEMES: Record<Role, { accent: string; background: string; border: string }> = {
  SEEKER: { accent: '#60a5fa', background: '#10294a', border: '#3b82f6' },
  HIDER: { accent: '#4ade80', background: '#102d24', border: '#22c55e' },
  IMPOSTOR: { accent: '#fb7185', background: '#351823', border: '#f43f5e' },
};

type AvatarUnlockStatus = {
  unlocked: boolean;
  role: 'HIDER' | 'SEEKER' | 'IMPOSTOR' | null;
  currentWins: number;
  requiredWins: number;
  currentMissions: number;
  requiredMissions: number;
};

type AccountResponse = {
  id: string;
  username: string;
  avatarId: string;
  companionId: CompanionId;
  companionStatsEnabled: boolean;
  badges: number;
  broadcastCredits: number;
  broadcastNextFreeAt: number;
  scanCredits: number;
  avatarProgress?: {
    wins: number;
    missionsByRole: Record<'hider' | 'seeker' | 'impostor', number>;
  };
  avatarUnlocks?: Record<string, AvatarUnlockStatus>;
  token?: string;
};

type CompanionStats = {
  games: number;
  wins: number;
  missionsByRole: Record<'hider' | 'seeker' | 'impostor', number>;
};

function isCompanionStats(value: unknown): value is CompanionStats {
  if (!value || typeof value !== 'object') return false;
  const stats = value as Partial<CompanionStats>;
  return Number.isSafeInteger(stats.games) && (stats.games ?? -1) >= 0 &&
    Number.isSafeInteger(stats.wins) && (stats.wins ?? -1) >= 0 &&
    Boolean(stats.missionsByRole) &&
    (['hider', 'seeker', 'impostor'] as const).every((role) => {
      const count = stats.missionsByRole?.[role];
      return Number.isSafeInteger(count) && (count ?? -1) >= 0;
    });
}

type AccountSession = AccountResponse & {
  token: string;
};

type DeviceSpeechVoice = Awaited<ReturnType<typeof Speech.getAvailableVoicesAsync>>[number];

type SpeechSequenceResult = 'done' | 'stopped' | 'error';

function speakUtterance(
  text: string,
  language: string,
  voiceId: string | null,
  style: CompanionSpeechStyle
): Promise<SpeechSequenceResult> {
  return new Promise((resolve) => {
    let isFinished = false;
    const finish = (result: SpeechSequenceResult) => {
      if (isFinished) return;
      isFinished = true;
      resolve(result);
    };

    try {
      Speech.speak(text, {
        language,
        rate: style.rate,
        pitch: style.pitch,
        voice: voiceId ?? undefined,
        onDone: () => finish('done'),
        onStopped: () => finish('stopped'),
        onError: () => finish('error'),
      });
    } catch {
      finish('error');
    }
  });
}

async function speakCompanionSpeech(
  message: string,
  indonesianVoiceId: string | null,
  englishVoice: DeviceSpeechVoice | null,
  style: CompanionSpeechStyle = getCompanionSpeechStyle('kanca')
) {
  for (const segment of createCompanionSpeechSegments(message)) {
    const useEnglishVoice = segment.language === 'en' && englishVoice !== null;
    let result = await speakUtterance(
      segment.language === 'en' && !useEnglishVoice
        ? segment.fallbackText ?? segment.text
        : segment.text,
      useEnglishVoice ? englishVoice.language : 'id-ID',
      useEnglishVoice ? englishVoice.identifier : indonesianVoiceId,
      style
    );
    if (result === 'stopped') return;

    if (result === 'error' && useEnglishVoice && segment.fallbackText) {
      console.warn('Suara Inggris gagal; memakai pelafalan pendekatan untuk istilah Companion.');
      result = await speakUtterance(segment.fallbackText, 'id-ID', indonesianVoiceId, style);
      if (result === 'stopped') return;
    }

    if (result === 'error') {
      throw new Error('TTS gagal membacakan salah satu bagian jawaban Companion.');
    }
  }
}

function enqueueSpeechTask(
  queue: { current: Promise<void> },
  task: () => Promise<void>
) {
  const nextTask = queue.current.catch(() => {}).then(task);
  queue.current = nextTask;
  return nextTask;
}

type LeaderboardPeriod = 'daily' | 'monthly';

type LeaderboardEntry = {
  rank: number;
  username: string;
  avatarId: string;
  badges: number;
  wins: number;
  games: number;
  winRate: number;
};

const DEFAULT_PROFILE_AVATAR_ID = 'petak-logo';
const DEFAULT_COMPANION_ID: CompanionId = 'kanca';
const SPECTATOR_TRACK_COLORS = ['#2563eb', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#65a30d'];
const PROFILE_AVATARS: Array<{
  id: string;
  name: string;
  label: string;
  image: ImageSourcePropType;
}> = [
  { id: 'petak-logo', name: 'PETAK +62', label: 'Logo PETAK UMPET +62', image: require('./assets/logo.png') },
  { id: 'profile-01', name: 'Aetherion', label: 'Penjelajah biru', image: require('./assets/profile-avatars/profile-01.png') },
  { id: 'profile-02', name: 'Nyxara', label: 'Teknisi', image: require('./assets/profile-avatars/profile-02.png') },
  { id: 'profile-03', name: 'Asterion', label: 'Pramuka', image: require('./assets/profile-avatars/profile-03.png') },
  { id: 'profile-04', name: 'Sylvara', label: 'Penyamar hijau', image: require('./assets/profile-avatars/profile-04.png') },
  { id: 'profile-05', name: 'Vespera', label: 'Penyamar merah', image: require('./assets/profile-avatars/profile-05.png') },
  { id: 'profile-06', name: 'Neonix', label: 'Penjelajah neon', image: require('./assets/profile-avatars/profile-06.png') },
  { id: 'profile-07', name: 'Umbra', label: 'Pengintai', image: require('./assets/profile-avatars/profile-07.png') },
  { id: 'profile-08', name: 'Noctis', label: 'Penjelajah malam', image: require('./assets/profile-avatars/profile-08.png') },
  { id: 'profile-09', name: 'Voltaris', label: 'Teknisi biru', image: require('./assets/profile-avatars/profile-09.png') },
  { id: 'profile-10', name: 'Thalassa', label: 'Pengintai hijau', image: require('./assets/profile-avatars/profile-10.png') },
  { id: 'profile-11', name: 'Verdantia', label: 'Penjelajah hutan', image: require('./assets/profile-avatars/profile-11.png') },
  { id: 'profile-12', name: 'Obsidian', label: 'Infiltrator', image: require('./assets/profile-avatars/profile-12.png') },
  { id: 'profile-13', name: 'Eryndor', label: 'Pengamat', image: require('./assets/profile-avatars/profile-13.png') },
  { id: 'profile-14', name: 'Solstice', label: 'Strategis', image: require('./assets/profile-avatars/profile-14.png') },
  { id: 'profile-15', name: 'Zephyra', label: 'Pengelana', image: require('./assets/profile-avatars/profile-15.png') },
];

const PROFILE_COMPANIONS: Array<{
  id: CompanionId;
  name: string;
  image: ImageSourcePropType;
  animatedImage: ImageSourcePropType;
}> = [
  {
    id: 'kanca',
    name: 'Kanca',
    image: require('./assets/companions/v2/kanca.png'),
    animatedImage: require('./assets/companions/v2/kanca_idle.webp'),
  },
  {
    id: 'tara',
    name: 'Tara',
    image: require('./assets/companions/v2/tara.png'),
    animatedImage: require('./assets/companions/v2/tara_idle.webp'),
  },
  {
    id: 'komo',
    name: 'Komo',
    image: require('./assets/companions/v2/komo.png'),
    animatedImage: require('./assets/companions/v2/komo_idle.webp'),
  },
  {
    id: 'cendi',
    name: 'Cendi',
    image: require('./assets/companions/v2/cendi.png'),
    animatedImage: require('./assets/companions/v2/cendi_idle.webp'),
  },
  {
    id: 'bako',
    name: 'Bako',
    image: require('./assets/companions/v2/bako.png'),
    animatedImage: require('./assets/companions/v2/bako_idle.webp'),
  },
];

function isCompanionId(value: unknown): value is CompanionId {
  return PROFILE_COMPANIONS.some((companion) => companion.id === value);
}

function getProfileCompanion(companionId: CompanionId) {
  return PROFILE_COMPANIONS.find((companion) => companion.id === companionId)
    ?? PROFILE_COMPANIONS[0];
}

function getProfileAvatarSource(avatarId?: string) {
  return PROFILE_AVATARS.find((avatar) => avatar.id === avatarId)?.image
    ?? PROFILE_AVATARS[0].image;
}

type NearbyRoom = {
  code: string;
  distanceMeters: number;
  playerCount: number;
  playRadiusMeters: number;
  playRadiusMode: 'FIXED' | 'RANDOM';
};

type BrowserAudioCapture = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  mutedOutput: GainNode;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = ACCOUNT_REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function encodeBroadcastPcm(chunks: Float32Array[], inputSampleRate: number) {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error('Sample rate mikrofon tidak valid.');
  }

  const inputLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  if (inputLength === 0) throw new Error('Tidak ada suara yang terekam.');
  const input = new Float32Array(inputLength);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }

  const outputLength = Math.min(
    BROADCAST_SAMPLE_RATE * BROADCAST_MAX_DURATION_SECONDS,
    Math.floor((inputLength * BROADCAST_SAMPLE_RATE) / inputSampleRate)
  );
  const pcm = new Uint8Array(outputLength * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = (index * inputSampleRate) / BROADCAST_SAMPLE_RATE;
    const sourceIndex = Math.floor(sourcePosition);
    const fraction = sourcePosition - sourceIndex;
    const first = input[Math.min(sourceIndex, input.length - 1)];
    const second = input[Math.min(sourceIndex + 1, input.length - 1)];
    const sample = first + (second - first) * fraction;
    const boundedSample = Math.max(-1, Math.min(1, sample));
    view.setInt16(index * 2, Math.round(boundedSample * (boundedSample < 0 ? 32768 : 32767)), true);
  }

  return pcm;
}

type WebLobbyMusicLoop = {
  context: AudioContext;
  gain: GainNode;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  active: boolean;
  unlocked: boolean;
  start: () => void;
  stop: () => void;
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const systemColorScheme = useColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>('dark');
  const [isThemePreferenceLoading, setIsThemePreferenceLoading] = useState(true);
  const isLightTheme =
    themePreference === 'light' ||
    (themePreference === 'system' && systemColorScheme === 'light');
  const styles = useMemo(() => createStyles(isLightTheme), [isLightTheme]);
  const [joinCode, setJoinCode] = useState(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
    const inviteCode = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() ?? '';
    return /^[A-Z0-9]{6}$/.test(inviteCode) ? inviteCode : '';
  });
  const [nearbyRooms, setNearbyRooms] = useState<NearbyRoom[]>([]);
  const [nearbyRoomsError, setNearbyRoomsError] = useState('');
  const [hasSearchedNearbyRooms, setHasSearchedNearbyRooms] = useState(false);
  const [isSearchingNearbyRooms, setIsSearchingNearbyRooms] = useState(false);
  const [account, setAccount] = useState<AccountSession | null>(null);
  const companionAccountRef = useRef<AccountSession | null>(null);
  companionAccountRef.current = account;
  const [isAccountLoading, setIsAccountLoading] = useState(true);
  const isStartupLoading = isAccountLoading || isThemePreferenceLoading;
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [appAlert, setAppAlert] = useState<AppAlert | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [profileAvatarError, setProfileAvatarError] = useState('');
  const [isSavingCompanion, setIsSavingCompanion] = useState(false);
  const [profileCompanionError, setProfileCompanionError] = useState('');
  const [isSavingCompanionPrivacy, setIsSavingCompanionPrivacy] = useState(false);
  const [companionPrivacyError, setCompanionPrivacyError] = useState('');
  const [companionStats, setCompanionStats] = useState<CompanionStats | null>(null);
  const [isLoadingCompanionStats, setIsLoadingCompanionStats] = useState(false);
  const [companionStatsError, setCompanionStatsError] = useState('');
  const [companionChatReply, setCompanionChatReply] = useState('');
  const [companionChatError, setCompanionChatError] = useState('');
  const [isCompanionVoiceListening, setIsCompanionVoiceListening] = useState(false);
  const [isCompanionVoiceEnabled, setIsCompanionVoiceEnabled] = useState(false);
  const [isCompanionVoicePanelOpen, setIsCompanionVoicePanelOpen] = useState(false);
  const [companionVoiceInterimTranscript, setCompanionVoiceInterimTranscript] = useState('');
  const [companionVoiceDraft, setCompanionVoiceDraft] = useState('');
  const [companionPanelPosition, setCompanionPanelPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [isCompanionVoiceSpeaking, setIsCompanionVoiceSpeaking] = useState(false);
  const [companionVoiceQueuedCount, setCompanionVoiceQueuedCount] = useState(0);
  const [companionVoiceActiveMessage, setCompanionVoiceActiveMessage] = useState('');
  const [isCompanionVoicePositionLoaded, setIsCompanionVoicePositionLoaded] = useState(false);
  const companionVoicePositionRef = useRef({
    x: 14,
    y: Math.max(12, viewportHeight - insets.bottom - 68),
  });
  const companionVoicePosition = useRef(
    new Animated.ValueXY(companionVoicePositionRef.current)
  ).current;
  const companionVoiceDragOriginRef = useRef(companionVoicePositionRef.current);
  const companionVoiceWasDraggedRef = useRef(false);
  const companionPanelPositionRef = useRef<{ left: number; top: number } | null>(null);
  const companionPanelDragOriginRef = useRef({ left: 0, top: 0 });
  const companionVoiceSoundBars = useRef(
    Array.from({ length: 5 }, () => new Animated.Value(0.2))
  ).current;
  const companionSpeechRecognitionRef = useRef<CompanionSpeechRecognition | null>(null);
  const companionVoiceEnabledRef = useRef(false);
  const companionVoiceTtsPausedRef = useRef(false);
  const companionVoicePageVisibleRef = useRef(true);
  const companionVoiceDraftRef = useRef('');
  const companionVoiceQueueRef = useRef<string[]>([]);
  const companionVoiceQueueProcessingRef = useRef(false);
  const companionVoiceDebounceTimerRef = useRef<number | null>(null);
  const companionVoiceRestartTimerRef = useRef<number | null>(null);
  const companionVoiceRestartDelayRef = useRef(350);
  const startCompanionVoiceRecognitionRef = useRef<() => void>(() => {});
  const enqueueCompanionVoiceMessageRef = useRef<(message: string) => boolean>(() => false);
  const processCompanionVoiceQueueRef = useRef<() => void>(() => {});
  const isCompanionVoiceProcessing = Boolean(
    companionVoiceInterimTranscript || companionVoiceDraft || companionVoiceActiveMessage
  );
  useEffect(() => {
    if (!isCompanionVoiceProcessing) {
      companionVoiceSoundBars.forEach((bar) => bar.setValue(0.2));
      return;
    }

    const animations = companionVoiceSoundBars.map((bar, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 90),
          Animated.timing(bar, {
            toValue: 1,
            duration: 220,
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.2,
            duration: 260,
            useNativeDriver: false,
          }),
        ])
      )
    );
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [companionVoiceSoundBars, isCompanionVoiceProcessing]);
  const clampCompanionVoicePosition = useCallback(
    (position: { x: number; y: number }) => {
      const minX = 12 + insets.left;
      const minY = 12 + insets.top;
      return {
        x: Math.min(
          Math.max(minX, viewportWidth - insets.right - 68),
          Math.max(minX, position.x)
        ),
        y: Math.min(
          Math.max(minY, viewportHeight - insets.bottom - 68),
          Math.max(minY, position.y)
        ),
      };
    },
    [insets.bottom, insets.left, insets.right, insets.top, viewportHeight, viewportWidth]
  );
  const saveCompanionVoicePosition = useCallback(() => {
    if (!account?.id) return;
    void AsyncStorage.setItem(
      `${COMPANION_VOICE_POSITION_STORAGE_KEY}:${account.id}`,
      JSON.stringify(companionVoicePositionRef.current)
    ).catch((error: unknown) => {
      console.error('Gagal menyimpan posisi tombol Companion', error);
    });
  }, [account?.id]);
  const companionVoicePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => {
          companionVoiceWasDraggedRef.current = false;
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
          const shouldStartDragging = Math.hypot(gestureState.dx, gestureState.dy) > 8;
          if (shouldStartDragging) companionVoiceWasDraggedRef.current = true;
          return shouldStartDragging;
        },
        onPanResponderGrant: () => {
          companionVoiceDragOriginRef.current = companionVoicePositionRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          const nextPosition = clampCompanionVoicePosition({
            x: companionVoiceDragOriginRef.current.x + gestureState.dx,
            y: companionVoiceDragOriginRef.current.y + gestureState.dy,
          });
          companionVoicePositionRef.current = nextPosition;
          companionVoicePosition.setValue(nextPosition);
        },
        onPanResponderRelease: saveCompanionVoicePosition,
        onPanResponderTerminate: saveCompanionVoicePosition,
      }),
    [
      clampCompanionVoicePosition,
      companionVoicePosition,
      saveCompanionVoicePosition,
    ]
  );
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<DeviceSpeechVoice[]>([]);
  const [selectedSpeechVoiceId, setSelectedSpeechVoiceId] = useState<string | null>(null);
  const [isSpeechVoiceLoading, setIsSpeechVoiceLoading] = useState(false);
  const [isSpeechVoiceSaving, setIsSpeechVoiceSaving] = useState(false);
  const [isSpeechVoicePreviewing, setIsSpeechVoicePreviewing] = useState(false);
  const [speechVoiceError, setSpeechVoiceError] = useState('');
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>('daily');
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardMinimumGames, setLeaderboardMinimumGames] = useState(5);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isCharacterSettingsOpen, setIsCharacterSettingsOpen] = useState(false);
  const [profileCharacterPicker, setProfileCharacterPicker] = useState<'avatar' | 'companion' | null>(null);
  const [isGameTimelineOpen, setIsGameTimelineOpen] = useState(false);
  const [isLobbyDetailsOpen, setIsLobbyDetailsOpen] = useState(false);
  const [isSelectingRandomRadius, setIsSelectingRandomRadius] = useState(false);
  const [isFeatureLauncherOpen, setIsFeatureLauncherOpen] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [resultPlayerSearch, setResultPlayerSearch] = useState('');
  const [roleRevealDismissedRoundId, setRoleRevealDismissedRoundId] = useState<string | null>(null);
  const [isGettingStartedVisible, setIsGettingStartedVisible] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  >('connecting');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isHomeHeroVisible, setIsHomeHeroVisible] = useState(true);
  const [locationError, setLocationError] = useState('');
  const [locationRetry, setLocationRetry] = useState(0);
  const [uwbAvailability, setUwbAvailability] = useState<UwbAvailability | null>(null);
  const [isCheckingUwbAvailability, setIsCheckingUwbAvailability] = useState(false);
  const [locationNotice, setLocationNotice] = useState('');
  const [boundaryNotice, setBoundaryNotice] = useState('');
  const [isProximityCaughtModalVisible, setIsProximityCaughtModalVisible] = useState(false);
  const [showLiveDetails, setShowLiveDetails] = useState(false);
  const [showLiveSettings, setShowLiveSettings] = useState(false);
  const [isLiveActionMenuOpen, setIsLiveActionMenuOpen] = useState(false);
  const [liveActionGestureSelection, setLiveActionGestureSelection] = useState<
    'skill' | 'broadcast' | 'exchange' | null
  >(null);
  const [liveBottomDockHeight, setLiveBottomDockHeight] = useState(122);
  const [showLiveGameLog, setShowLiveGameLog] = useState(true);
  const [liveGameLogMessages, setLiveGameLogMessages] = useState<
    Array<{ id: string; text: string }>
  >([]);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isBroadcastRecording, setIsBroadcastRecording] = useState(false);
  const [isBroadcastStarting, setIsBroadcastStarting] = useState(false);
  const [isBroadcastSending, setIsBroadcastSending] = useState(false);
  const [isBroadcastBuying, setIsBroadcastBuying] = useState(false);
  const [broadcastNotice, setBroadcastNotice] = useState('');
  const [isBuyingScanCredits, setIsBuyingScanCredits] = useState(false);
  const [scanNotice, setScanNotice] = useState('');
  const [isBuyingSeekerReveal, setIsBuyingSeekerReveal] = useState(false);
  const [seekerRevealNotice, setSeekerRevealNotice] = useState('');
  const [seekerScanMarker, setSeekerScanMarker] = useState<
    (Coordinates & { scanId: string }) | null
  >(null);
  const [isLoadingLandmarkTargets, setIsLoadingLandmarkTargets] = useState(false);
  const [landmarkTargetError, setLandmarkTargetError] = useState('');
  const [landmarkSubmissionStatuses, setLandmarkSubmissionStatuses] = useState<
    Record<string, LandmarkSubmissionStatus>
  >({});
  const [landmarkSubmissionNames, setLandmarkSubmissionNames] = useState<Record<string, string>>({});
  const [landmarkSubmissionError, setLandmarkSubmissionError] = useState('');
  const [landmarkSubmissionNotice, setLandmarkSubmissionNotice] = useState('');
  const [landmarkSubmittingId, setLandmarkSubmittingId] = useState<string | null>(null);
  const [lobbyPermissionStatus, setLobbyPermissionStatus] = useState<{
    location: boolean | null;
    microphone: boolean | null;
    isRequesting: boolean;
    error: string;
  }>({
    location: null,
    microphone: null,
    isRequesting: false,
    error: '',
  });
  const [lobbyRangeNotice, setLobbyRangeNotice] = useState('');
  const requestedLobbyPermissionRoomRef = useRef<string | null>(null);
  const previousLobbyRadiusRef = useRef<{
    code: string;
    radiusMeters: number;
    mode: Room['playRadiusMode'];
  } | null>(null);
  const showAppAlert = useCallback((message: string) => {
    setAppAlert({ message });
  }, []);
  const selectThemePreference = useCallback(
    (preference: ThemePreference) => {
      setThemePreference(preference);
      void AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference).catch((error: unknown) => {
        console.error('Gagal menyimpan preferensi tema PETAK', error);
        showAppAlert(
          'Preferensi tema gagal disimpan. Tema ini hanya berlaku sampai aplikasi ditutup.'
        );
      });
    },
    [showAppAlert]
  );
  const renderThemePreferenceControl = () => (
    <View style={styles.themePreferenceSection}>
      <Text style={styles.themePreferenceTitle}>Tema permainan</Text>
      <Text style={styles.themePreferenceHint}>
        Mode terang memudahkan membaca peta dan kontrol di luar ruangan. Pilihan disimpan di
        perangkat ini.
      </Text>
      <View style={styles.themePreferenceOptions}>
        {THEME_PREFERENCE_OPTIONS.map((option) => {
          const isSelected = themePreference === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              style={[
                styles.themePreferenceOption,
                isSelected && styles.themePreferenceOptionSelected,
              ]}
              onPress={() => selectThemePreference(option.value)}
            >
              <Text
                style={[
                  styles.themePreferenceOptionText,
                  isSelected && styles.themePreferenceOptionTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      companionVoicePageVisibleRef.current = isVisible;
      if (!isVisible) {
        companionSpeechRecognitionRef.current?.stop();
      } else if (companionVoiceEnabledRef.current && !companionVoiceTtsPausedRef.current) {
        startCompanionVoiceRecognitionRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleVisibilityChange();
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
  useEffect(() => {
    if (account) return;
    companionVoiceEnabledRef.current = false;
    companionVoiceTtsPausedRef.current = false;
    setIsCompanionVoiceEnabled(false);
    setIsCompanionVoicePanelOpen(false);
    setIsCompanionVoiceSpeaking(false);
    companionSpeechRecognitionRef.current?.stop();
    void Speech.stop().catch((error: unknown) => {
      console.error('Gagal menghentikan suara Companion setelah sesi berakhir', error);
    });
    if (companionVoiceDebounceTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(companionVoiceDebounceTimerRef.current);
      companionVoiceDebounceTimerRef.current = null;
    }
    if (companionVoiceRestartTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(companionVoiceRestartTimerRef.current);
      companionVoiceRestartTimerRef.current = null;
    }
    companionVoiceDraftRef.current = '';
    companionVoiceQueueRef.current = [];
    setCompanionVoiceDraft('');
    setCompanionVoiceInterimTranscript('');
    setCompanionVoiceQueuedCount(0);
    setCompanionVoiceActiveMessage('');
  }, [account?.token]);
  useEffect(() => {
    let isCancelled = false;
    if (!account?.id) {
      setIsCompanionVoicePositionLoaded(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsCompanionVoicePositionLoaded(false);
    const storageKey = `${COMPANION_VOICE_POSITION_STORAGE_KEY}:${account.id}`;
    void AsyncStorage.getItem(storageKey)
      .then((savedPosition) => {
        if (isCancelled || !savedPosition) return;
        const parsed: unknown = JSON.parse(savedPosition);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('x' in parsed) ||
          !('y' in parsed) ||
          typeof parsed.x !== 'number' ||
          !Number.isFinite(parsed.x) ||
          typeof parsed.y !== 'number' ||
          !Number.isFinite(parsed.y)
        ) {
          return;
        }
        companionVoicePositionRef.current = { x: parsed.x, y: parsed.y };
        companionVoicePosition.setValue(companionVoicePositionRef.current);
      })
      .catch((error: unknown) => {
        console.error('Gagal memuat posisi tombol Companion', error);
      })
      .finally(() => {
        if (!isCancelled) setIsCompanionVoicePositionLoaded(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [account?.id, companionVoicePosition]);
  useEffect(() => {
    if (!isCompanionVoicePositionLoaded) return;
    const nextPosition = clampCompanionVoicePosition(companionVoicePositionRef.current);
    companionVoicePositionRef.current = nextPosition;
    companionVoicePosition.setValue(nextPosition);
  }, [
    clampCompanionVoicePosition,
    companionVoicePosition,
    isCompanionVoicePositionLoaded,
  ]);
  useEffect(() => () => {
    companionVoiceEnabledRef.current = false;
    companionSpeechRecognitionRef.current?.stop();
    if (typeof window !== 'undefined') {
      if (companionVoiceDebounceTimerRef.current !== null) {
        window.clearTimeout(companionVoiceDebounceTimerRef.current);
      }
      if (companionVoiceRestartTimerRef.current !== null) {
        window.clearTimeout(companionVoiceRestartTimerRef.current);
      }
    }
    void Speech.stop().catch((error: unknown) => {
      console.error('Gagal membersihkan suara Companion', error);
    });
  }, []);
  useEffect(() => {
    let isCancelled = false;
    void AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
      .then((savedPreference) => {
        if (isCancelled || savedPreference === null) return;
        if (
          savedPreference === 'dark' ||
          savedPreference === 'light' ||
          savedPreference === 'system'
        ) {
          setThemePreference(savedPreference);
          return;
        }
        console.warn('Preferensi tema PETAK tidak dikenal; menggunakan tema gelap.');
      })
      .catch((error: unknown) => {
        console.error('Gagal memuat preferensi tema PETAK', error);
        if (!isCancelled) {
          showAppAlert('Preferensi tema gagal dimuat. Tema gelap digunakan untuk sesi ini.');
        }
      })
      .finally(() => {
        if (!isCancelled) setIsThemePreferenceLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [showAppAlert]);
  const checkUwbSupport = async () => {
    setIsCheckingUwbAvailability(true);
    try {
      setUwbAvailability(await getUwbAvailability());
    } catch (error) {
      console.error('Gagal memeriksa dukungan UWB PETAK', error);
      setUwbAvailability({ status: 'check-failed' });
    } finally {
      setIsCheckingUwbAvailability(false);
    }
  };
  const uwbAvailabilityMessage = uwbAvailability
    ? {
        available: 'UWB tersedia di perangkat ini; pengukuran antarperangkat belum diuji.',
        'unsupported-platform': 'Pemeriksaan UWB awal PETAK saat ini hanya tersedia di Android.',
        'native-build-required': 'Build native PETAK diperlukan; Expo Go tidak memuat modul UWB.',
        'unsupported-device': 'Perangkat ini tidak mendukung fitur UWB.',
        'temporarily-unavailable': 'Perangkat mendukung UWB, tetapi layanannya tidak tersedia saat ini.',
        'check-failed': 'Pemeriksaan UWB gagal. Lihat log aplikasi untuk detail.',
      }[uwbAvailability.status]
    : null;

  useEffect(() => {
    setLandmarkSubmissionStatuses({});
    setLandmarkSubmissionNames({});
    setLandmarkSubmissionError('');
    setLandmarkSubmissionNotice('');
    setLandmarkSubmittingId(null);
  }, [room?.code, room?.roundId]);
  useEffect(() => {
    if (!room) {
      previousLiveGameLogRef.current = null;
      setLiveGameLogMessages([]);
      for (const timer of liveGameLogTimersRef.current.values()) clearTimeout(timer);
      liveGameLogTimersRef.current.clear();
      return;
    }

    const key = `${room.code}:${room.roundId}`;
    if (room.phase === 'LOBBY') {
      previousLiveGameLogRef.current = { key, entries: room.eventLog };
      setLiveGameLogMessages([]);
      for (const timer of liveGameLogTimersRef.current.values()) clearTimeout(timer);
      liveGameLogTimersRef.current.clear();
      return;
    }

    if (room.phase !== 'PREPARATION' && room.phase !== 'PLAYING') return;

    const previous = previousLiveGameLogRef.current;
    if (!previous || previous.key !== key) {
      previousLiveGameLogRef.current = { key, entries: room.eventLog };
      setLiveGameLogMessages([]);
      return;
    }

    const entries = room.eventLog;
    let overlap = Math.min(entries.length, previous.entries.length);
    while (
      overlap > 0 &&
      !entries.slice(entries.length - overlap).every(
        (entry, index) => entry === previous.entries[index]
      )
    ) {
      overlap -= 1;
    }
    previousLiveGameLogRef.current = { key, entries };

    const newMessages = entries.slice(0, entries.length - overlap)
      .filter(isLiveGameLogEntry)
      .map((text) => {
        const id = `${key}:${++liveGameLogSequenceRef.current}`;
        const timer = setTimeout(() => {
          liveGameLogTimersRef.current.delete(id);
          setLiveGameLogMessages((current) => current.filter((message) => message.id !== id));
        }, 5_000);
        liveGameLogTimersRef.current.set(id, timer);
        return { id, text };
      });

    if (newMessages.length) {
      setLiveGameLogMessages((current) => [...newMessages, ...current].slice(0, 6));
    }
  }, [room?.code, room?.eventLog, room?.phase, room?.roundId]);
  useEffect(
    () => () => {
      for (const timer of liveGameLogTimersRef.current.values()) clearTimeout(timer);
      liveGameLogTimersRef.current.clear();
    },
    []
  );
  useEffect(() => {
    if (room?.phase !== 'LOBBY') setIsLobbyDetailsOpen(false);
  }, [room?.phase]);
  const [broadcastClock, setBroadcastClock] = useState(Date.now());
  const [isBroadcastIntroVisible, setIsBroadcastIntroVisible] = useState(false);
  const [broadcastFloatingSize, setBroadcastFloatingSize] = useState({ width: 62, height: 62 });
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const socketRef = useRef<Socket | null>(null);
  const savedSessionRef = useRef<SavedSession | null>(null);
  const previousRoomStateRef = useRef<{
    phase: Phase;
    preparationTimeLeft: number;
    timeLeft: number;
  } | null>(null);
  const previousLiveGameLogRef = useRef<{ key: string; entries: string[] } | null>(null);
  const liveGameLogSequenceRef = useRef(0);
  const liveGameLogTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const previousProximityOutcomeRef = useRef<{
    code: string;
    foundPlayerIds: Set<string>;
    challengeResult: Player['challengeResult'];
  } | null>(null);
  const previousScreenKeyRef = useRef<string | null>(null);
  const previousLocationStatusRef = useRef<LocationStatus>(null);
  const previousThreatLevelRef = useRef<ProximityThreatLevel | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const speechVoiceIdentifierRef = useRef<string | null>(selectedSpeechVoiceId);
  const englishSpeechVoiceRef = useRef<DeviceSpeechVoice | null>(null);
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const featureLauncherIdle = useRef(new Animated.Value(0)).current;
  const featureLauncherIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveActionPulse = useRef(new Animated.Value(0)).current;
  const startupLogoScale = useRef(new Animated.Value(0.92)).current;
  const startupLogoOpacity = useRef(new Animated.Value(0)).current;
  const proximityExplosionScale = useRef(new Animated.Value(0.45)).current;
  const proximityExplosionOpacity = useRef(new Animated.Value(0)).current;
  const broadcastChunksRef = useRef<Float32Array[]>([]);
  const broadcastSampleRateRef = useRef(BROADCAST_SAMPLE_RATE);
  const broadcastRecordingRef = useRef(false);
  const broadcastStartingRef = useRef(false);
  const broadcastStartRequestedRef = useRef(false);
  const broadcastStartedAtRef = useRef(0);
  const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekerScanMarkerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekerScanSequenceRef = useRef(0);
  const landmarkTargetRequestKeyRef = useRef<string | null>(null);
  const broadcastStopRef = useRef<() => void>(() => {});
  const browserAudioCaptureRef = useRef<BrowserAudioCapture | null>(null);
  const audioPlaybackRef = useRef<AudioPlayer | null>(null);
  const audioPlaybackListenerRef = useRef<{ remove: () => void } | null>(null);
  const broadcastSendingRef = useRef(false);
  const broadcastPendingMessageIdRef = useRef<string | null>(null);
  const broadcastDeliveredMessageIdRef = useRef<string | null>(null);
  const broadcastNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastIntroCheckedRef = useRef<string | null>(null);
  const gettingStartedCheckedRef = useRef<string | null>(null);
  const broadcastDragOriginRef = useRef({
    x: Math.max(12, viewportWidth - 74),
    y: Math.max(100, viewportHeight - 220),
  });
  const broadcastPositionRef = useRef(broadcastDragOriginRef.current);
  const broadcastDragOccurredRef = useRef(false);
  const liveActionGestureModeRef = useRef<'move' | 'select' | null>(null);
  const liveActionGestureSelectionRef = useRef<
    'skill' | 'broadcast' | 'exchange' | null
  >(null);
  const liveActionHandlersRef = useRef<{
    skill: () => void;
    broadcast: () => void;
    exchange: () => void;
  } | null>(null);
  const broadcastFloatingPosition = useRef(
    new Animated.ValueXY(broadcastPositionRef.current)
  ).current;
  const homeHeroOpacity = useRef(new Animated.Value(1)).current;
  const homeHeroHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webLobbyMusicRef = useRef<WebLobbyMusicLoop | null>(null);
  const lobbyMusicPlayer = useAudioPlayer(LOBBY_MUSIC_ASSET);
  const transitionPlayer = useAudioPlayer(require('./assets/sounds/transition.wav'));
  const countdownPlayer = useAudioPlayer(require('./assets/sounds/countdown.wav'));
  const warningPlayer = useAudioPlayer(require('./assets/sounds/warning.wav'));
  const attentionPlayer = useAudioPlayer(require('./assets/sounds/attention.wav'));
  const onMicrophoneBuffer = useCallback((buffer: { data: ArrayBuffer; sampleRate: number }) => {
    if (!broadcastRecordingRef.current || Platform.OS === 'web') return;
    broadcastSampleRateRef.current = buffer.sampleRate;
    broadcastChunksRef.current.push(new Float32Array(buffer.data.slice(0)));
  }, []);
  const microphoneAudioStream = useAudioStream({
    sampleRate: BROADCAST_SAMPLE_RATE,
    channels: 1,
    encoding: 'float32',
    onBuffer: onMicrophoneBuffer,
  });
  const hideHomeHero = useCallback(() => {
    if (homeHeroHideTimerRef.current) {
      clearTimeout(homeHeroHideTimerRef.current);
      homeHeroHideTimerRef.current = null;
    }

    Animated.timing(homeHeroOpacity, {
      toValue: 0,
      duration: 450,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setIsHomeHeroVisible(false);
    });
  }, [homeHeroOpacity]);

  useEffect(() => {
    homeHeroHideTimerRef.current = setTimeout(hideHomeHero, 8000);
    return () => {
      if (homeHeroHideTimerRef.current) clearTimeout(homeHeroHideTimerRef.current);
      homeHeroOpacity.stopAnimation();
    };
  }, [hideHomeHero, homeHeroOpacity]);

  const activePlayer = useMemo(() => {
    if (!room?.selfPlayerId) return null;
    return room.players.find((player) => player.id === room.selfPlayerId) ?? null;
  }, [room]);
  useEffect(() => {
    if (room?.phase !== 'PLAYING' || !activePlayer || activePlayer.isSpectator) {
      liveActionPulse.setValue(0);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(liveActionPulse, {
          toValue: 1,
          duration: 1350,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(liveActionPulse, {
          toValue: 0,
          duration: 1350,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [activePlayer?.id, activePlayer?.isSpectator, liveActionPulse, room?.phase]);
  useEffect(() => {
    if (
      room?.phase !== 'PLAYING' ||
      activePlayer?.isSpectator ||
      showLiveDetails ||
      showLiveSettings
    ) {
      setIsLiveActionMenuOpen(false);
    }
  }, [
    activePlayer?.isSpectator,
    room?.phase,
    showLiveDetails,
    showLiveSettings,
  ]);
  const roleRevealRole = activePlayer?.role ?? null;
  const roleRevealTheme = roleRevealRole ? ROLE_REVEAL_THEMES[roleRevealRole] : null;
  const resultRole = winningRole(room?.winner ?? null);
  const resultTheme = resultRole ? ROLE_REVEAL_THEMES[resultRole] : null;
  const activePlayerWon = isWinningPlayer(activePlayer, resultRole);
  const resultPlayerSearchQuery = resultPlayerSearch.trim().toLowerCase();
  const resultPlayers = room?.phase === 'FINISHED'
    ? room.players.filter((player) => {
        if (!resultPlayerSearchQuery) return true;
        const outcome = player.isSpectator
          ? 'penonton'
          : isWinningPlayer(player, resultRole)
            ? 'menang'
            : 'kalah';
        const searchableText = [
          player.name,
          `@${player.name}`,
          roleLabel(player.role),
          outcome,
          player.role !== 'SEEKER' ? (player.isFound ? 'ditemukan' : 'tidak ditemukan') : '',
          player.challengeResult === 'WON'
            ? 'tantangan menang'
            : player.challengeResult === 'LOST'
              ? 'tantangan kalah'
              : '',
          ...player.missions.map((mission) => mission.label),
        ].join(' ').toLowerCase();
        return searchableText.includes(resultPlayerSearchQuery);
      })
    : [];
  const isRoleRevealVisible = Boolean(
    room?.phase === 'PREPARATION' &&
    roleRevealRole &&
    roleRevealDismissedRoundId !== room.roundId
  );
  const dismissRoleReveal = useCallback(() => {
    if (room) setRoleRevealDismissedRoundId(room.roundId);
  }, [room?.roundId]);
  const mapPoints = useMemo<MapPoint[]>(() => {
    if (!room) return [];
    const points: MapPoint[] = [];
    if (room.selfLocation && !activePlayer?.isSpectator) {
      points.push({
        id: 'self',
        label: activePlayer?.role === 'SEEKER' ? 'Posisi seeker' : 'Posisi Anda',
        color: '#0f766e',
        ...room.selfLocation,
      });
    }
    if (activePlayer?.isSpectator && room.phase === 'PLAYING') {
      room.players.forEach((player, index) => {
        if (!player.liveLocation || player.isSpectator) return;
        points.push({
          id: `spectator-player-${player.id}`,
          label: `Posisi pemain · ${player.name}`,
          color: SPECTATOR_TRACK_COLORS[index % SPECTATOR_TRACK_COLORS.length],
          ...player.liveLocation,
        });
      });
    }
    if (activePlayer?.role === 'SEEKER') {
      if (seekerScanMarker) {
        points.push({
          id: `seeker-scan-detection-${seekerScanMarker.scanId}`,
          label: 'Pemain terdeteksi oleh scan',
          color: '#7c3aed',
          ...seekerScanMarker,
        });
      }
      points.push(
        ...room.breachClues.map((clue) => ({
          id: `breach-${clue.id}`,
          label: `${clue.playerName} · petunjuk keluar area`,
          color: '#ea580c',
          latitude: clue.latitude,
          longitude: clue.longitude,
        }))
      );
      if (room.impostorDecoy) {
        points.push({
          id: `impostor-decoy-${room.impostorDecoy.id}`,
          label: 'Sinyal umpan',
          color: '#f59e0b',
          latitude: room.impostorDecoy.latitude,
          longitude: room.impostorDecoy.longitude,
        });
      }
    }
    if (room.impostorLocationPin) {
      points.push({
        id: `impostor-location-pin-${room.impostorLocationPin.id}`,
        label: 'Titik lokasi',
        color: '#e11d48',
        latitude: room.impostorLocationPin.latitude,
        longitude: room.impostorLocationPin.longitude,
      });
    }
    if (activePlayer?.role === 'IMPOSTOR' && room.impostorDecoySelection) {
      points.push({
        id: 'impostor-decoy-selection',
        label: 'Pin umpan terpilih',
        color: '#f59e0b',
        ...room.impostorDecoySelection,
      });
    }
    if (activePlayer?.role === 'HIDER') {
      points.push(
        ...(room.landmarkTargets ?? []).map((target) => ({
          id: `osm-${target.id}`,
          label: target.name || target.fixme,
          color: '#2563eb',
          latitude: target.latitude,
          longitude: target.longitude,
        }))
      );
    }
    if (activePlayer?.role === 'IMPOSTOR' && room.impostorObjectiveLocation) {
      points.push({
        id: 'impostor-objective',
        label: 'Titik sasaran rahasia',
        color: '#a855f7',
        ...room.impostorObjectiveLocation,
      });
    }
    if (activePlayer?.role === 'HIDER' && room.seekerLocation) {
      points.push({
        id: 'revealed-seeker',
        label: 'Posisi seeker · reveal aktif',
        color: '#dc2626',
        ...room.seekerLocation,
      });
    }
    return points;
  }, [activePlayer?.role, room, seekerScanMarker]);
  const mapPaths = useMemo<MapPath[]>(() => {
    if (activePlayer?.isSpectator !== true || room?.phase !== 'PLAYING') return [];
    return room.players.flatMap((player, index) =>
      player.isSpectator || !player.movementTrail || player.movementTrail.length < 2
        ? []
        : [{
            id: `spectator-track-${player.id}`,
            color: SPECTATOR_TRACK_COLORS[index % SPECTATOR_TRACK_COLORS.length],
            coordinates: player.movementTrail,
          }]
    );
  }, [activePlayer?.isSpectator, room]);
  const mapLegendItems = useMemo(() => {
    const seen = new Set<string>();
    return mapPoints.filter((point) => {
      const key = `${point.color}:${point.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [mapPoints]);
  const isHiderThreatMode =
    activePlayer?.role === 'HIDER' && !activePlayer.isSpectator && room?.phase === 'PLAYING';
  const hiderThreatLevel = isHiderThreatMode
    ? room?.proximityState?.threatLevel ?? 'SAFE'
    : 'SAFE';
  const hiderThreatTheme = hiderThreatThemes[hiderThreatLevel];
  const isLiveMapScreen = Boolean(
    room?.playArea && (room.phase === 'PREPARATION' || room.phase === 'PLAYING')
  );
  const screenKey =
    isScannerOpen && account
      ? 'SCANNER'
      : room?.phase === 'PREPARATION' || room?.phase === 'PLAYING'
        ? 'GAME'
        : room?.phase === 'LOBBY'
          ? 'LOBBY'
          : room?.phase === 'FINISHED' || room?.phase === 'CANCELLED'
            ? 'RESULT'
            : account
              ? 'HOME'
              : 'AUTH';

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    if (featureLauncherIdleTimerRef.current !== null) {
      clearTimeout(featureLauncherIdleTimerRef.current);
      featureLauncherIdleTimerRef.current = null;
    }

    featureLauncherIdle.stopAnimation();
    Animated.timing(featureLauncherIdle, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();

    if (!isFeatureLauncherOpen) {
      featureLauncherIdleTimerRef.current = setTimeout(() => {
        featureLauncherIdleTimerRef.current = null;
        Animated.timing(featureLauncherIdle, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }).start();
      }, 3_000);
    }

    return () => {
      if (featureLauncherIdleTimerRef.current !== null) {
        clearTimeout(featureLauncherIdleTimerRef.current);
        featureLauncherIdleTimerRef.current = null;
      }
    };
  }, [featureLauncherIdle, isFeatureLauncherOpen]);

  useEffect(() => {
    let isCancelled = false;
    const accountId = account?.id;
    const storageKey = accountId ? `${SPEECH_VOICE_STORAGE_KEY}:${accountId}` : null;
    speechVoiceIdentifierRef.current = null;
    englishSpeechVoiceRef.current = null;
    setSelectedSpeechVoiceId(null);
    setAvailableSpeechVoices([]);
    setSpeechVoiceError('');

    if (!accountId || !storageKey) {
      setIsSpeechVoiceLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    const loadSpeechVoicePreference = async () => {
      setIsSpeechVoiceLoading(true);
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (isCancelled) return;
        englishSpeechVoiceRef.current = findEnglishSpeechVoice(voices);
        const indonesianVoices = voices
          .filter((voice) => /^id(?:[-_]|$)/i.test(voice.language))
          .sort((first, second) => first.name.localeCompare(second.name));
        setAvailableSpeechVoices(indonesianVoices);

        try {
          const savedVoiceId = await AsyncStorage.getItem(storageKey);
          if (isCancelled) return;
          if (savedVoiceId && indonesianVoices.some((voice) => voice.identifier === savedVoiceId)) {
            setSelectedSpeechVoiceId(savedVoiceId);
          } else {
            setSelectedSpeechVoiceId(null);
            if (savedVoiceId) {
              setSpeechVoiceError(
                'Suara tersimpan tidak tersedia di perangkat ini. Suara sistem akan digunakan.'
              );
            }
          }
        } catch (error) {
          if (isCancelled) return;
          console.error('Gagal membaca preferensi suara PETAK', error);
          setSpeechVoiceError('Preferensi suara tidak dapat dibaca. Suara sistem akan digunakan.');
        }
      } catch (error) {
        if (isCancelled) return;
        console.error('Gagal memuat daftar suara TTS PETAK', error);
        setSpeechVoiceError('Daftar suara perangkat tidak dapat dimuat. Suara sistem akan digunakan.');
      } finally {
        if (!isCancelled) setIsSpeechVoiceLoading(false);
      }
    };

    void loadSpeechVoicePreference();
    return () => {
      isCancelled = true;
    };
  }, [account?.id]);

  useEffect(() => {
    speechVoiceIdentifierRef.current = selectedSpeechVoiceId;
  }, [selectedSpeechVoiceId]);

  useEffect(() => {
    if (!account || isLiveMapScreen || isScannerOpen) {
      setIsFeatureLauncherOpen(false);
    }
  }, [account, isLiveMapScreen, isScannerOpen]);

  useEffect(() => {
    if (room?.phase !== 'FINISHED') setIsGameTimelineOpen(false);
  }, [room?.phase]);

  useEffect(() => {
    setResultPlayerSearch('');
  }, [room?.roundId]);

  useEffect(() => {
    if (!account) {
      setIsLeaderboardOpen(false);
      setIsProfileOpen(false);
      setIsCharacterSettingsOpen(false);
      setProfileCharacterPicker(null);
      setIsFeatureLauncherOpen(false);
    }
  }, [account]);

  useEffect(() => {
    if (!isStartupLoading) return;

    const entrance = Animated.parallel([
      Animated.timing(startupLogoOpacity, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.spring(startupLogoScale, {
        toValue: 1,
        speed: 14,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]);
    let pulse: Animated.CompositeAnimation | null = null;
    entrance.start(({ finished }) => {
      if (!finished) return;
      pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(startupLogoScale, {
            toValue: 1.035,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(startupLogoScale, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
    });

    return () => {
      entrance.stop();
      pulse?.stop();
    };
  }, [isStartupLoading, startupLogoOpacity, startupLogoScale]);

  useEffect(() => {
    let isCancelled = false;
    const loadingStartedAt = Date.now();
    let finishLoaderTimer: ReturnType<typeof setTimeout> | null = null;
    void AsyncStorage.getItem(ACCOUNT_STORAGE_KEY)
      .then(async (storedAccount) => {
        if (!storedAccount) return;
        const parsed = JSON.parse(storedAccount) as Partial<AccountSession>;
        if (
          typeof parsed.id !== 'string' ||
          typeof parsed.username !== 'string' ||
          typeof parsed.token !== 'string' ||
          !Number.isFinite(parsed.badges)
        ) {
          await AsyncStorage.removeItem(ACCOUNT_STORAGE_KEY);
          return;
        }

        const cachedAccount: AccountSession = {
          id: parsed.id,
          username: parsed.username,
          avatarId: typeof parsed.avatarId === 'string'
            ? parsed.avatarId
            : DEFAULT_PROFILE_AVATAR_ID,
          companionId: isCompanionId(parsed.companionId)
            ? parsed.companionId
            : DEFAULT_COMPANION_ID,
          companionStatsEnabled: parsed.companionStatsEnabled === true,
          badges: Number(parsed.badges),
          token: parsed.token,
          broadcastCredits: Number.isFinite(parsed.broadcastCredits) ? Number(parsed.broadcastCredits) : 0,
          broadcastNextFreeAt: Number.isFinite(parsed.broadcastNextFreeAt)
            ? Number(parsed.broadcastNextFreeAt)
            : 0,
          scanCredits: Number.isFinite(parsed.scanCredits) ? Number(parsed.scanCredits) : 0,
        };
        if (!isCancelled) setAccount(cachedAccount);
        const response = await fetchWithTimeout(`${SOCKET_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${cachedAccount.token}` },
        });
        if (response.status === 401) {
          await AsyncStorage.removeItem(ACCOUNT_STORAGE_KEY);
          if (!isCancelled) setAccount(null);
          return;
        }
        if (!response.ok) throw new Error(`Account request failed with status ${response.status}.`);
        const profile = (await response.json()) as AccountResponse;
        const refreshedAccount = {
          ...cachedAccount,
          ...profile,
          token: cachedAccount.token,
        };
        if (!isCancelled) setAccount(refreshedAccount);
      })
      .catch((error: unknown) => {
        console.error('Gagal memuat akun PETAK', error);
        if (!isCancelled) {
          setAuthError(
            error instanceof Error && error.name === 'AbortError'
              ? 'Server terlalu lama merespons. Menggunakan sesi tersimpan.'
              : 'Profil akun belum dapat diperiksa. Menggunakan sesi tersimpan.'
          );
        }
      })
      .finally(() => {
        if (isCancelled) return;
        const remainingLoaderTime = Math.max(
          0,
          STARTUP_LOADER_MINIMUM_MS - (Date.now() - loadingStartedAt)
        );
        finishLoaderTimer = setTimeout(() => {
          if (!isCancelled) setIsAccountLoading(false);
        }, remainingLoaderTime);
      });

    return () => {
      isCancelled = true;
      if (finishLoaderTimer) clearTimeout(finishLoaderTimer);
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    void AsyncStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account)).catch((error: unknown) => {
      console.error('Gagal menyimpan sesi akun PETAK', error);
    });
  }, [account]);

  useEffect(() => {
    if (!account?.companionStatsEnabled || !isProfileOpen) {
      setCompanionStats(null);
      setCompanionStatsError('');
      setIsLoadingCompanionStats(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingCompanionStats(true);
    setCompanionStatsError('');

    void fetchWithTimeout(`${SOCKET_URL}/api/auth/companion/stats`, {
      headers: { Authorization: `Bearer ${account.token}` },
    })
      .then(async (response) => {
        const result = await response.json() as CompanionStats & { error?: string };
        if (!response.ok) {
          throw new Error(result.error || 'Statistik Companion belum dapat dimuat.');
        }
        if (!isCompanionStats(result)) {
          throw new Error('Data statistik Companion tidak valid.');
        }
        if (!isCancelled) setCompanionStats(result);
      })
      .catch((error: unknown) => {
        console.error('Gagal memuat statistik Companion', error);
        if (!isCancelled) {
          setCompanionStatsError(
            error instanceof Error && error.name === 'AbortError'
              ? 'Server terlalu lama merespons. Coba buka kembali Profil.'
              : error instanceof Error
                ? error.message
                : 'Statistik Companion belum dapat dimuat.'
          );
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingCompanionStats(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [account?.companionStatsEnabled, account?.token, isProfileOpen]);

  useEffect(() => {
    setNearbyRooms([]);
    setNearbyRoomsError('');
    setHasSearchedNearbyRooms(false);
  }, [account?.id]);

  useEffect(() => {
    if (!account) {
      setLeaderboardEntries([]);
      setLeaderboardError('');
      setIsLeaderboardLoading(false);
      return;
    }
    if (!isLeaderboardOpen) return;

    let isCancelled = false;
    setIsLeaderboardLoading(true);
    setLeaderboardError('');
    setLeaderboardEntries([]);
    void fetchWithTimeout(`${SOCKET_URL}/api/leaderboard?period=${leaderboardPeriod}`, {
      headers: { Authorization: `Bearer ${account.token}` },
    })
      .then(async (response) => {
        const result = await response.json() as {
          error?: string;
          minimumGames?: number;
          entries?: LeaderboardEntry[];
        };
        if (!response.ok || !Array.isArray(result.entries)) {
          throw new Error(result.error || 'Leaderboard belum dapat dimuat.');
        }
        if (isCancelled) return;
        setLeaderboardEntries(result.entries);
        if (typeof result.minimumGames === 'number' && Number.isInteger(result.minimumGames)) {
          setLeaderboardMinimumGames(result.minimumGames);
        }
      })
      .catch((error: unknown) => {
        console.error('Gagal memuat leaderboard PETAK', error);
        if (!isCancelled) {
          setLeaderboardEntries([]);
          setLeaderboardError(
            error instanceof Error && error.name === 'AbortError'
              ? 'Server terlalu lama merespons. Coba lagi.'
              : error instanceof Error
                ? error.message
                : 'Leaderboard belum dapat dimuat.'
          );
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLeaderboardLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [account?.token, isLeaderboardOpen, leaderboardPeriod]);

  useEffect(() => {
    void setAudioModeAsync({
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
    }).catch((error: unknown) => {
      console.error('Gagal mengatur audio PETAK', error);
    });

    countdownPlayer.volume = 0.3;
    warningPlayer.volume = 0.35;
    attentionPlayer.volume = 0.35;
    lobbyMusicPlayer.loop = true;
    lobbyMusicPlayer.volume = 0.18;
    transitionPlayer.volume = 0.3;
  }, [attentionPlayer, countdownPlayer, lobbyMusicPlayer, transitionPlayer, warningPlayer]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.AudioContext) return;

    let disposed = false;
    let context: AudioContext;
    try {
      context = new window.AudioContext();
    } catch (error) {
      console.error('Gagal memulai audio loop Lobby', error);
      return;
    }

    const gain = context.createGain();
    gain.gain.value = 0.18;
    gain.connect(context.destination);

    const loop: WebLobbyMusicLoop = {
      context,
      gain,
      buffer: null,
      source: null,
      active: true,
      unlocked: false,
      start: () => {
        if (!loop.active || !loop.unlocked || !loop.buffer || loop.source) return;
        const source = context.createBufferSource();
        source.buffer = loop.buffer;
        source.loop = true;
        source.connect(gain);
        source.start();
        loop.source = source;
      },
      stop: () => {
        const source = loop.source;
        loop.source = null;
        if (!source) return;
        source.stop();
        source.disconnect();
      },
    };
    webLobbyMusicRef.current = loop;

    const unlockAudio = () => {
      void context.resume()
        .then(() => {
          if (disposed) return;
          loop.unlocked = context.state === 'running';
          loop.start();
        })
        .catch((error: unknown) => {
          console.error('Gagal mengaktifkan audio Lobby', error);
        });
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    const resumeWhenVisible = () => {
      if (document.visibilityState === 'visible' && loop.active && loop.unlocked) {
        unlockAudio();
      }
    };
    document.addEventListener('visibilitychange', resumeWhenVisible);

    void context.resume()
      .then(() => {
        if (disposed) return;
        if (context.state === 'running') loop.unlocked = true;
        loop.start();
      })
      .catch((error: unknown) => {
        console.warn('Autoplay musik menunggu interaksi pertama.', error);
      });

    void (async () => {
      const asset = await Asset.fromModule(LOBBY_MUSIC_ASSET).downloadAsync();
      const response = await fetch(asset.localUri ?? asset.uri);
      if (!response.ok) throw new Error(`Gagal memuat musik Lobby (${response.status}).`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (disposed) return;
      loop.buffer = buffer;
      loop.start();
    })().catch((error: unknown) => {
      if (disposed) return;
      console.error('Gagal memuat musik loop Lobby', error);
      loop.stop();
      webLobbyMusicRef.current = null;
      gain.disconnect();
      void context.close().catch((closeError: unknown) => {
        console.error('Gagal menutup audio context Lobby', closeError);
      });
      if (loop.active) lobbyMusicPlayer.play();
    });

    return () => {
      disposed = true;
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('visibilitychange', resumeWhenVisible);
      loop.stop();
      gain.disconnect();
      if (webLobbyMusicRef.current === loop) webLobbyMusicRef.current = null;
      void context.close().catch((error: unknown) => {
        console.error('Gagal menutup audio context Lobby', error);
      });
    };
  }, [lobbyMusicPlayer]);

  useEffect(() => {
    const shouldPlay = !room || room.phase === 'LOBBY';
    const webLoop = Platform.OS === 'web' ? webLobbyMusicRef.current : null;
    if (webLoop) {
      webLoop.active = shouldPlay;
      if (shouldPlay) webLoop.start();
      else webLoop.stop();
      return () => {
        if (shouldPlay) webLoop.stop();
      };
    }

    if (shouldPlay) lobbyMusicPlayer.play();
    else lobbyMusicPlayer.pause();

    return () => lobbyMusicPlayer.pause();
  }, [lobbyMusicPlayer, room?.phase]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const startLobbyMusic = () => {
      if (!webLobbyMusicRef.current && (!room || room.phase === 'LOBBY')) {
        lobbyMusicPlayer.play();
      }
    };
    window.addEventListener('pointerdown', startLobbyMusic, { once: true });
    return () => window.removeEventListener('pointerdown', startLobbyMusic);
  }, [lobbyMusicPlayer, room?.phase]);

  const playSound = (player: AudioPlayer) => {
    if (!soundEnabled) return;

    void player.seekTo(0)
      .then(() => player.play())
      .catch((error: unknown) => {
        console.error('Gagal memutar efek suara PETAK', error);
      });
  };

  const announceGameAlert = useCallback((message: string) => {
    if (!soundEnabledRef.current) return;

    const playAlertTone = () => {
      if (!soundEnabledRef.current) return;
      void attentionPlayer.seekTo(0)
        .then(() => attentionPlayer.play())
        .catch((error: unknown) => console.error('Gagal memutar alarm permainan', error));
    };
    if (
      Platform.OS === 'web' &&
      (typeof window === 'undefined' ||
        typeof window.speechSynthesis === 'undefined' ||
        typeof SpeechSynthesisUtterance === 'undefined')
    ) {
      playAlertTone();
      return;
    }

    try {
      void enqueueSpeechTask(speechQueueRef, () =>
        speakCompanionSpeech(
          message,
          speechVoiceIdentifierRef.current,
          englishSpeechVoiceRef.current
        )
      ).then(playAlertTone).catch((error: unknown) => {
        console.error('Gagal menyuarakan peringatan permainan', error);
        playAlertTone();
      });
    } catch (error) {
      console.error('Gagal memasukkan peringatan permainan ke antrean TTS', error);
      playAlertTone();
    }
  }, [attentionPlayer]);

  const selectSpeechVoice = async (voiceId: string | null) => {
    if (!account || isSpeechVoiceSaving) return;
    const previousVoiceId = selectedSpeechVoiceId;
    const storageKey = `${SPEECH_VOICE_STORAGE_KEY}:${account.id}`;
    setSelectedSpeechVoiceId(voiceId);
    setSpeechVoiceError('');
    setIsSpeechVoiceSaving(true);
    try {
      if (voiceId) await AsyncStorage.setItem(storageKey, voiceId);
      else await AsyncStorage.removeItem(storageKey);
    } catch (error) {
      console.error('Gagal menyimpan preferensi suara PETAK', error);
      setSelectedSpeechVoiceId(previousVoiceId);
      setSpeechVoiceError('Preferensi suara gagal disimpan. Coba pilih kembali.');
    } finally {
      setIsSpeechVoiceSaving(false);
    }
  };

  const previewSpeechVoice = async () => {
    if (isSpeechVoicePreviewing || isSpeechVoiceLoading) return;
    setSpeechVoiceError('');
    setIsSpeechVoicePreviewing(true);
    try {
      await Speech.stop();
      await enqueueSpeechTask(speechQueueRef, () =>
        speakCompanionSpeech(
          'Ini contoh suara peringatan PETAK.',
          selectedSpeechVoiceId,
          englishSpeechVoiceRef.current
        )
      );
      setIsSpeechVoicePreviewing(false);
    } catch (error) {
      console.error('Gagal memulai pratinjau suara PETAK', error);
      setSpeechVoiceError('Pratinjau suara gagal diputar pada perangkat ini.');
      setIsSpeechVoicePreviewing(false);
    }
  };

  useEffect(() => {
      if (!room) {
        previousProximityOutcomeRef.current = null;
        setIsProximityCaughtModalVisible(false);
        return;
      }

      const foundPlayerIds = new Set(
        room.players.filter((player) => player.isFound).map((player) => player.id)
      );
      const selfPlayer = room.players.find((player) => player.id === room.selfPlayerId);
      const challengeResult = selfPlayer?.challengeResult ?? null;
      const previous = previousProximityOutcomeRef.current;
      previousProximityOutcomeRef.current = {
        code: room.code,
        foundPlayerIds,
        challengeResult,
      };

      if (room.phase === 'LOBBY' || room.phase === 'PREPARATION') {
        setIsProximityCaughtModalVisible(false);
        return;
      }
      if (!previous || previous.code !== room.code) return;

      const newlyFoundPlayers = room.players.filter(
        (player) => player.isFound && !previous.foundPlayerIds.has(player.id)
      );
      const challengeResolved = Boolean(
        challengeResult && previous.challengeResult !== challengeResult
      );
      if (!newlyFoundPlayers.some((player) => player.id === room.selfPlayerId) && !challengeResolved) return;

      playSound(attentionPlayer);
      if (Platform.OS !== 'web') Vibration.vibrate([0, 900, 150, 450]);
      setIsProximityCaughtModalVisible(true);
  }, [attentionPlayer, room, soundEnabled]);

  useEffect(() => {
      if (!isProximityCaughtModalVisible) return;

      proximityExplosionScale.setValue(0.45);
      proximityExplosionOpacity.setValue(0);
      const animation = Animated.sequence([
        Animated.parallel([
          Animated.timing(proximityExplosionOpacity, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.spring(proximityExplosionScale, {
            toValue: 1.15,
            speed: 18,
            bounciness: 8,
            useNativeDriver: true,
          }),
        ]),
        Animated.spring(proximityExplosionScale, {
          toValue: 1,
          speed: 16,
          bounciness: 6,
          useNativeDriver: true,
        }),
      ]);
      animation.start();
      return () => animation.stop();
  }, [isProximityCaughtModalVisible, proximityExplosionOpacity, proximityExplosionScale]);

  useEffect(() => {
      if (isAccountLoading) return;

      const previousScreenKey = previousScreenKeyRef.current;
      previousScreenKeyRef.current = screenKey;
      if (
        previousScreenKey &&
        previousScreenKey !== screenKey &&
        !(previousScreenKey === 'LOBBY' && screenKey === 'GAME')
      ) {
        playSound(transitionPlayer);
      }
  }, [isAccountLoading, screenKey, soundEnabled, transitionPlayer]);

  useEffect(() => {
    if (!room) {
      previousRoomStateRef.current = null;
      return;
    }

    const previous = previousRoomStateRef.current;
    previousRoomStateRef.current = {
      phase: room.phase,
      preparationTimeLeft: room.preparationTimeLeft,
      timeLeft: room.timeLeft,
    };

    if (!previous || !soundEnabled) return;

    if (
      room.phase === 'PREPARATION' &&
      (previous.phase !== 'PREPARATION' || room.preparationTimeLeft < previous.preparationTimeLeft)
    ) {
      playSound(countdownPlayer);
    }

    if (previous.phase === 'PREPARATION' && room.phase === 'PLAYING') {
      playSound(attentionPlayer);
    }

    if (
      previous.phase === 'PLAYING' &&
      room.phase === 'PLAYING' &&
      previous.timeLeft > 10 &&
      room.timeLeft <= 10
    ) {
      playSound(warningPlayer);
    }
  }, [
    attentionPlayer,
    countdownPlayer,
    room?.phase,
    room?.preparationTimeLeft,
    room?.timeLeft,
    soundEnabled,
    warningPlayer,
  ]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      reconnection: true,
      autoConnect: false,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      const savedSession = savedSessionRef.current;
      if (savedSession) {
        socket.emit('reconnect-room', {
          code: savedSession.code,
          token: savedSession.token,
        });
      }
    });
    socket.on('disconnect', () => {
      setConnectionStatus(socket.active ? 'reconnecting' : 'disconnected');
    });
    socket.on('connect_error', (error) => {
      console.error('Gagal terhubung ke backend PETAK', error.message);
      setConnectionStatus(socket.active ? 'reconnecting' : 'disconnected');
    });
    socket.io.on('reconnect_attempt', () => setConnectionStatus('reconnecting'));
    socket.io.on('reconnect_failed', () => setConnectionStatus('disconnected'));

    socket.on('broadcast:balance', (balance: AccountResponse) => {
      setAccount((current) => current ? { ...current, ...balance, token: current.token } : current);
    });
    socket.on('seeker-scan:balance', (balance: AccountResponse) => {
      setAccount((current) => current ? { ...current, ...balance, token: current.token } : current);
    });
    socket.on('seeker-reveal:balance', (balance: AccountResponse) => {
      setAccount((current) => current ? { ...current, ...balance, token: current.token } : current);
    });
    socket.on(
      'account:avatar-progress',
      (progress: Pick<AccountResponse, 'avatarProgress' | 'avatarUnlocks'>) => {
        setAccount((current) => current ? { ...current, ...progress } : current);
      }
    );
    socket.on('landmark:targets', (targets: LandmarkTarget[]) => {
      setRoom((current) => current ? { ...current, landmarkTargets: targets } : current);
      setLandmarkTargetError('');
      setIsLoadingLandmarkTargets(false);
    });
    socket.on('landmark:targets:error', ({ message }: { message: string }) => {
      setLandmarkTargetError(message);
      setIsLoadingLandmarkTargets(false);
    });
    socket.on(
      'landmark:submission:statuses',
      (statuses: Record<string, LandmarkSubmissionStatus>) => {
        setLandmarkSubmissionStatuses(statuses);
      }
    );
    socket.on(
      'landmark:submission:result',
      ({ targetId, status, submittedName }: {
        targetId: string;
        status: LandmarkSubmissionStatus['status'];
        submittedName: string;
      }) => {
        setLandmarkSubmissionStatuses((current) => ({
          ...current,
          [targetId]: { status, submittedName },
        }));
        setLandmarkSubmissionError('');
        setLandmarkSubmissionNotice('Laporan tersimpan untuk ditinjau komunitas.');
        setLandmarkSubmittingId(null);
      }
    );
    socket.on(
      'landmark:submission:updated',
      ({ targetId, status, submittedName }: {
        targetId: string;
        status: LandmarkSubmissionStatus['status'];
        submittedName: string;
      }) => {
        setLandmarkSubmissionStatuses((current) => ({
          ...current,
          [targetId]: { status, submittedName },
        }));
      }
    );
    socket.on('landmark:submission:error', ({ message }: { message: string }) => {
      setLandmarkSubmissionError(message);
      setLandmarkSubmittingId(null);
    });
    socket.on('seeker-scan:result', ({ signalStrength, detectedLocation }: {
      signalStrength: 'STRONG' | 'MEDIUM' | 'WEAK' | 'NONE';
      detectedLocation: Coordinates | null;
    }) => {
      if (seekerScanMarkerTimerRef.current) {
        clearTimeout(seekerScanMarkerTimerRef.current);
        seekerScanMarkerTimerRef.current = null;
      }
      setSeekerScanMarker(
        detectedLocation
          ? { ...detectedLocation, scanId: String(++seekerScanSequenceRef.current) }
          : null
      );
      if (detectedLocation) {
        seekerScanMarkerTimerRef.current = setTimeout(() => {
          setSeekerScanMarker(null);
          seekerScanMarkerTimerRef.current = null;
        }, SEEKER_SCAN_MARKER_DURATION_MS);
      }
      const signalNotice =
        signalStrength === 'STRONG'
          ? 'Sinyal kuat: ada pemain sangat dekat.'
          : signalStrength === 'MEDIUM'
            ? 'Sinyal sedang: ada pemain di sekitar.'
            : signalStrength === 'WEAK'
              ? 'Sinyal lemah: pemain terdeteksi di batas jangkauan.'
              : 'Tidak ada sinyal dalam radius 30 m.';
      setScanNotice(
        detectedLocation
          ? `${signalNotice} Lokasi terdeteksi ditandai di peta selama 15 detik.`
          : signalNotice
      );
    });
    socket.on('seeker-scan:warning', () => {
      setScanNotice('Area Anda sedang dipindai. Bergeraklah dengan aman.');
      announceGameAlert('Perhatian, area Anda sedang dipindai. Seeker mungkin berada di dekat Anda.');
      if (Platform.OS !== 'web') Vibration.vibrate([0, 250, 150, 500]);
    });
    socket.on('special-ability:alert', () => {
      if (Platform.OS !== 'web') Vibration.vibrate([0, 250, 150, 500, 150, 250]);
      announceGameAlert('Perhatian, aktivitas khusus terdeteksi.');
    });
    socket.on('impostor:decoy:clue', () => {
      setScanNotice('Impostor memasang umpan. Titik umpan ditandai di peta.');
      announceGameAlert('Perhatian. Impostor memasang umpan. Titik umpan ditandai di peta.');
      if (Platform.OS !== 'web') Vibration.vibrate([0, 250, 150, 500]);
    });

    socket.on(
      'broadcast:receive',
      ({
        messageId,
        playbackToken,
      }: {
        messageId: string;
        playbackToken: string;
      }) => {
        if (messageId === broadcastPendingMessageIdRef.current) {
          broadcastDeliveredMessageIdRef.current = messageId;
          broadcastSendingRef.current = false;
          setIsBroadcastSending(false);
          setBroadcastNotice('Terkirim · diputar 1×');
        } else {
          setBroadcastNotice('Pesan diputar 1×');
        }
        audioPlaybackListenerRef.current?.remove();
        audioPlaybackRef.current?.release();
        try {
          const audioPlayer = createAudioPlayer(
            { uri: `${SOCKET_URL}/api/broadcast-audio/${encodeURIComponent(playbackToken)}` },
            { downloadFirst: true }
          );
          let hasStarted = false;
          audioPlaybackRef.current = audioPlayer;
          audioPlaybackListenerRef.current = audioPlayer.addListener(
            'playbackStatusUpdate',
            (status) => {
              if (status.isLoaded && !hasStarted) {
                hasStarted = true;
                audioPlayer.play();
              }
              if (status.didJustFinish) {
                audioPlaybackListenerRef.current?.remove();
                audioPlaybackListenerRef.current = null;
                audioPlayer.release();
                if (audioPlaybackRef.current === audioPlayer) audioPlaybackRef.current = null;
              }
            }
          );
        } catch (error) {
          console.error('Gagal memuat audio siaran PETAK', error);
          setBroadcastNotice('Audio siaran tidak dapat diputar.');
        }
      }
    );

    socket.on('room:state', (nextRoom: Room) => {
      const previousLobbyRadius = previousLobbyRadiusRef.current;
      setIsSelectingRandomRadius((pending) =>
        nextRoom.phase !== 'LOBBY' || nextRoom.playRadiusMode === 'RANDOM' ? false : pending
      );
      if (nextRoom.phase !== 'LOBBY' || previousLobbyRadius?.code !== nextRoom.code) {
        setLobbyRangeNotice('');
      } else if (
        previousLobbyRadius.radiusMeters !== nextRoom.playRadiusMeters ||
        previousLobbyRadius.mode !== nextRoom.playRadiusMode
      ) {
        const rangeChangeMessage =
          nextRoom.playRadiusMode === 'RANDOM'
            ? `Server memilih range acak ${formatPlayRadius(nextRoom.playRadiusMeters)}.`
            : `Host mengubah range menjadi ${formatPlayRadius(nextRoom.playRadiusMeters)}.`;
        const fallbackMessage = nextRoom.playRadiusRandomFallback
          ? ' Data peta tidak tersedia, jadi pilihan mempertimbangkan jumlah pemain saja.'
          : '';
        setLobbyRangeNotice(
          `${rangeChangeMessage} Semua pemain perlu siap kembali.${fallbackMessage}`
        );
      } else if (
        nextRoom.players.find((player) => player.id === nextRoom.selfPlayerId)?.isReady
      ) {
        setLobbyRangeNotice('');
      }
      previousLobbyRadiusRef.current = {
        code: nextRoom.code,
        radiusMeters: nextRoom.playRadiusMeters,
        mode: nextRoom.playRadiusMode,
      };
      setRoom(nextRoom);
      if (nextRoom.badges !== null) {
        const badges = nextRoom.badges;
        setAccount((current) => current ? { ...current, badges } : current);
      }
      if (nextRoom.selfPlayerId && nextRoom.selfReconnectToken) {
        const savedSession = {
          code: nextRoom.code,
          playerId: nextRoom.selfPlayerId,
          token: nextRoom.selfReconnectToken,
        };
        savedSessionRef.current = savedSession;
        void AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(savedSession)).catch((error: unknown) => {
          console.error('Gagal menyimpan sesi reconnect PETAK', error);
        });
      }
    });

    socket.on(
      'location-violation',
      ({ playerName }: { playerName: string }) => {
        setBoundaryNotice(`${playerName} keluar dari batas area. Petunjuk lokasi ditampilkan di peta.`);
        if (soundEnabledRef.current) {
          void attentionPlayer.seekTo(0)
            .then(() => attentionPlayer.play())
            .catch((error: unknown) => console.error('Gagal memutar peringatan batas area', error));
        }
        if (Platform.OS !== 'web') Vibration.vibrate([0, 350, 150, 350]);
      }
    );

    socket.on('room:left', () => {
      if (broadcastRecordingRef.current) broadcastStopRef.current();
      savedSessionRef.current = null;
      setIsSelectingRandomRadius(false);
      previousLobbyRadiusRef.current = null;
      setLobbyRangeNotice('');
      setRoom(null);
      setBoundaryNotice('');
      setLocationNotice('');
      void AsyncStorage.removeItem(SESSION_STORAGE_KEY).catch((error: unknown) => {
        console.error('Gagal menghapus sesi reconnect PETAK', error);
      });
    });

    socket.on('error-message', ({ message }: { message: string }) => {
      setIsSelectingRandomRadius(false);
      showAppAlert(message);
      if (message.startsWith('Sesi tidak dapat dipulihkan.')) {
        savedSessionRef.current = null;
        setRoom(null);
        void AsyncStorage.removeItem(SESSION_STORAGE_KEY).catch((error: unknown) => {
          console.error('Gagal menghapus sesi reconnect PETAK', error);
        });
      }
    });

    socket.on('location-update:rejected', ({ message }: { message: string }) => {
      setLocationError(message);
    });

    void AsyncStorage.getItem(SESSION_STORAGE_KEY)
      .then((storedSession) => {
        if (storedSession) {
          const parsed = JSON.parse(storedSession) as SavedSession;
          if (parsed.code && parsed.playerId && parsed.token) {
            savedSessionRef.current = parsed;
          } else {
            return AsyncStorage.removeItem(SESSION_STORAGE_KEY);
          }
        }
      })
      .catch((error: unknown) => {
        console.error('Gagal memuat sesi reconnect PETAK', error);
      })
      .finally(() => socket.connect());

    return () => {
      socket.io.off('reconnect_attempt');
      socket.io.off('reconnect_failed');
      socket.disconnect();
      if (seekerScanMarkerTimerRef.current) {
        clearTimeout(seekerScanMarkerTimerRef.current);
        seekerScanMarkerTimerRef.current = null;
      }
      audioPlaybackListenerRef.current?.remove();
      audioPlaybackRef.current?.release();
      audioPlaybackListenerRef.current = null;
      audioPlaybackRef.current = null;
    };
  }, [announceGameAlert, attentionPlayer]);

  useEffect(() => {
    if (
      !room ||
      room.phase !== 'PLAYING' ||
      activePlayer?.role !== 'HIDER' ||
      connectionStatus !== 'connected' ||
      room.landmarkTargets !== null
    ) {
      return;
    }

    const requestKey = `${room.code}:${room.roundId}`;
    if (landmarkTargetRequestKeyRef.current === requestKey) return;
    landmarkTargetRequestKeyRef.current = requestKey;
    setIsLoadingLandmarkTargets(true);
    setLandmarkTargetError('');
    socketRef.current?.emit('landmark:request-targets');
  }, [
    activePlayer?.role,
    connectionStatus,
    room?.code,
    room?.landmarkTargets,
    room?.phase,
    room?.roundId,
  ]);

  useEffect(() => {
    if (
      !room ||
      activePlayer?.isSpectator ||
      (room.phase !== 'PREPARATION' && room.phase !== 'PLAYING')
    ) {
      setLocationError('');
      previousLocationStatusRef.current = null;
      return;
    }
    if (connectionStatus !== 'connected') return;

    let isCancelled = false;
    let locationSubscription: LocationSubscription | null = null;
    const sendLocation = (position: LocationFix) => {
      if (!socketRef.current?.connected) return;
      const now = Date.now();
      if (!Number.isFinite(position.timestamp) || now - position.timestamp > 15_000) {
        setLocationError('Fix GPS sudah kedaluwarsa. Menunggu pembaruan lokasi baru.');
        return;
      }
      if (position.timestamp > now + 5_000) {
        setLocationError('Waktu GPS perangkat tidak sesuai. Periksa tanggal dan waktu perangkat.');
        return;
      }
      setLocationError('');
      socketRef.current.volatile.emit('location-update', {
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        fixTimestamp: position.timestamp,
      });
    };

    const startLocationUpdates = async () => {
      try {
        const permissionGranted = await deviceLocationProvider.requestPermission();
        if (isCancelled) return;
        if (!permissionGranted) {
          setLocationError('Izin lokasi diperlukan selama permainan agar batas area dapat diperiksa.');
          return;
        }

        setLocationError('');
        const initialPosition = await deviceLocationProvider.getCurrentLocation();
        if (isCancelled) return;
        sendLocation(initialPosition);
        const subscription = await deviceLocationProvider.watchLocation(sendLocation);
        if (isCancelled) subscription.remove();
        else locationSubscription = subscription;
      } catch (error) {
        if (isCancelled) return;
        console.error('Gagal mendapatkan lokasi GPS PETAK', error);
        setLocationError('Lokasi GPS tidak tersedia. Periksa layanan lokasi perangkat dan coba lagi.');
      }
    };

    void startLocationUpdates();
    return () => {
      isCancelled = true;
      locationSubscription?.remove();
    };
  }, [activePlayer?.isSpectator, connectionStatus, locationRetry, room?.code, room?.phase]);

  useEffect(() => {
    if (!room || (!isBroadcastRecording && !account)) return;
    const timer = setInterval(() => setBroadcastClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [account?.id, isBroadcastRecording, room?.code]);

  useEffect(() => {
    if (broadcastNoticeTimerRef.current) {
      clearTimeout(broadcastNoticeTimerRef.current);
      broadcastNoticeTimerRef.current = null;
    }

    if (
      !['Terkirim · diputar 1×', 'Pesan diputar 1×', 'Terkirim', 'Terkirim · 1 kredit'].includes(
        broadcastNotice
      )
    ) {
      return;
    }

    broadcastNoticeTimerRef.current = setTimeout(() => {
      setBroadcastNotice('');
      broadcastNoticeTimerRef.current = null;
    }, 2_200);
    return () => {
      if (broadcastNoticeTimerRef.current) {
        clearTimeout(broadcastNoticeTimerRef.current);
        broadcastNoticeTimerRef.current = null;
      }
    };
  }, [broadcastNotice]);

  useEffect(() => {
    setScanNotice('');
  }, [room?.code, room?.phase]);

  useEffect(() => {
    if (!room || room.phase !== 'PLAYING' || !account) {
      if (room?.phase !== 'PLAYING') setIsBroadcastIntroVisible(false);
      return;
    }

    const introKey = `${BROADCAST_INTRO_STORAGE_KEY}:${account.id}`;
    if (broadcastIntroCheckedRef.current === introKey) return;
    broadcastIntroCheckedRef.current = introKey;
    let isCancelled = false;
    void AsyncStorage.getItem(introKey)
      .then((seen) => {
        if (!isCancelled && seen !== 'true') setIsBroadcastIntroVisible(true);
      })
      .catch((error: unknown) => {
        console.error('Gagal memeriksa pengenalan pesan siaran PETAK', error);
        if (!isCancelled) setIsBroadcastIntroVisible(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [account?.id, room?.code, room?.phase, showAppAlert]);

  useEffect(() => {
    if (!account || room?.code || isScannerOpen) {
      setIsGettingStartedVisible(false);
      return;
    }

    const introKey = `${GETTING_STARTED_STORAGE_KEY}:${account.id}`;
    if (gettingStartedCheckedRef.current === introKey) return;
    gettingStartedCheckedRef.current = introKey;
    let isCancelled = false;
    void AsyncStorage.getItem(introKey)
      .then((seen) => {
        if (!isCancelled && seen !== 'true') setIsGettingStartedVisible(true);
      })
      .catch((error: unknown) => {
        console.error('Gagal memeriksa panduan awal PETAK', error);
        if (!isCancelled) setIsGettingStartedVisible(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [account?.id, isScannerOpen, room?.code]);

  useEffect(() => {
    const maxX = Math.max(12, viewportWidth - broadcastFloatingSize.width - 12);
    const liveBottomInset = Platform.OS === 'android' ? insets.bottom : 0;
    const maxY = Math.max(
      100,
      viewportHeight -
        broadcastFloatingSize.height -
        liveBottomDockHeight -
        liveBottomInset -
        20
    );
    const nextPosition = {
      x: Math.min(maxX, Math.max(12, broadcastPositionRef.current.x)),
      y: Math.min(maxY, Math.max(100, broadcastPositionRef.current.y)),
    };
    broadcastPositionRef.current = nextPosition;
    broadcastFloatingPosition.setValue(nextPosition);
  }, [
    broadcastFloatingPosition,
    broadcastFloatingSize,
    insets.bottom,
    liveBottomDockHeight,
    viewportHeight,
    viewportWidth,
  ]);

  useEffect(() => {
    const stream = microphoneAudioStream.stream;
    return () => {
      if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
      if (broadcastNoticeTimerRef.current) clearTimeout(broadcastNoticeTimerRef.current);
      broadcastRecordingRef.current = false;
      if (Platform.OS !== 'web') stream.stop();
      const capture = browserAudioCaptureRef.current;
      if (capture) {
        capture.processor.onaudioprocess = null;
        capture.source.disconnect();
        capture.processor.disconnect();
        capture.mutedOutput.disconnect();
        capture.stream.getTracks().forEach((track) => track.stop());
        void capture.context.close().catch((error: unknown) => {
          console.error('Gagal menutup input audio siaran PETAK', error);
        });
      }
    };
  }, [microphoneAudioStream.stream]);

  useEffect(() => {
    const locationStatus = activePlayer?.locationStatus ?? null;
    const previousStatus = previousLocationStatusRef.current;
    previousLocationStatusRef.current = locationStatus;

    if (
      locationStatus === 'OUTSIDE' &&
      previousStatus !== 'OUTSIDE' &&
      room?.phase === 'PLAYING' &&
      activePlayer?.role !== 'SEEKER'
    ) {
      setLocationNotice('Anda keluar dari zona permainan. Petunjuk lokasi telah dikirim kepada seeker.');
      playSound(warningPlayer);
      if (Platform.OS !== 'web') Vibration.vibrate([0, 300, 150, 300]);
    } else if (locationStatus === 'INSIDE') {
      setLocationNotice('');
    }
  }, [activePlayer?.locationStatus, activePlayer?.role, room?.phase, soundEnabled, warningPlayer]);

  useEffect(() => {
    const threatLevel = room?.proximityState?.threatLevel ?? 'SAFE';
    const previousThreatLevel = previousThreatLevelRef.current;
    previousThreatLevelRef.current = threatLevel;

    if (room?.phase !== 'PLAYING') {
      setLocationNotice((current) => current && current.includes('Ancaman') ? '' : current);
      return;
    }

    if (threatLevel === 'RED' && previousThreatLevel !== 'RED') {
      setLocationNotice('Ancaman kritis: jarak terlalu dekat. Keamanan aktif, getar 3 detik dipicu.');
      playSound(attentionPlayer);
      if (Platform.OS !== 'web') Vibration.vibrate([0, 3000, 150, 3000]);
      if (activePlayer?.role === 'HIDER') {
        announceGameAlert(UNKNOWN_APPROACH_WARNING);
      }
    } else if (threatLevel === 'YELLOW' && previousThreatLevel !== 'YELLOW') {
      setLocationNotice('Ancaman meningkat: zona waspada mulai aktif.');
      playSound(warningPlayer);
      if (Platform.OS !== 'web') Vibration.vibrate([0, 600, 150, 600]);
      if (activePlayer?.role === 'HIDER') {
        announceGameAlert(UNKNOWN_APPROACH_WARNING);
      }
    } else if (threatLevel === 'GREEN' && previousThreatLevel !== 'GREEN') {
      setLocationNotice('Peringatan: ada pemain lain dalam radius dekat.');
      if (activePlayer?.role === 'HIDER') {
        announceGameAlert(UNKNOWN_APPROACH_WARNING);
      }
    } else if (threatLevel === 'SAFE' && previousThreatLevel !== 'SAFE') {
      setLocationNotice('');
    }
  }, [
    activePlayer?.role,
    announceGameAlert,
    attentionPlayer,
    room?.phase,
    room?.proximityState?.threatLevel,
    soundEnabled,
    warningPlayer,
  ]);

  useEffect(() => {
    if (room?.phase !== 'PLAYING') setBoundaryNotice('');
  }, [room?.code, room?.phase]);

  const searchNearbyRooms = async () => {
    if (!account || isSearchingNearbyRooms) return;
    setIsSearchingNearbyRooms(true);
    setNearbyRoomsError('');
    setNearbyRooms([]);
    setHasSearchedNearbyRooms(true);

    try {
      const permissionGranted = await deviceLocationProvider.requestPermission();
      if (!permissionGranted) {
        setNearbyRoomsError('Izin lokasi diperlukan untuk mencari room di sekitar Anda.');
        return;
      }

      const location = await deviceLocationProvider.getCurrentLocation();
      if (location.accuracy > 50) {
        setNearbyRoomsError('Lokasi GPS kurang akurat. Coba lagi saat akurasi mencapai 50 m atau lebih baik.');
        return;
      }

      const response = await fetchWithTimeout(`${SOCKET_URL}/api/rooms/nearby`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ location }),
      });
      const responseBody = await response.text();
      let result: {
        error?: string;
        rooms?: NearbyRoom[];
      };
      try {
        result = JSON.parse(responseBody) as typeof result;
      } catch {
        throw new Error(
          response.status === 404
            ? 'Fitur pencarian room sekitar belum tersedia pada backend yang aktif. Restart backend dengan versi terbaru, lalu coba lagi.'
            : `Backend mengirim respons yang tidak valid (HTTP ${response.status}). Periksa koneksi backend, lalu coba lagi.`
        );
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error(`Backend mengirim respons yang tidak valid (HTTP ${response.status}). Coba lagi nanti.`);
      }
      if (!response.ok || !Array.isArray(result.rooms)) {
        throw new Error(result.error || 'Room sekitar belum dapat dimuat.');
      }

      setNearbyRooms(result.rooms);
    } catch (error) {
      console.error('Gagal mencari room sekitar PETAK', error);
      setNearbyRoomsError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Server terlalu lama merespons. Coba cari lagi.'
          : error instanceof Error
            ? error.message
            : 'Room sekitar belum dapat dimuat.'
      );
    } finally {
      setIsSearchingNearbyRooms(false);
    }
  };

  const createRoom = async () => {
    if (isCreatingRoom) return;
    if (!account) {
      showAppAlert('Login diperlukan untuk membuat room.');
      return;
    }
    if (!socketRef.current?.connected) {
      showAppAlert('Backend belum terhubung. Tunggu hingga koneksi pulih lalu coba lagi.');
      return;
    }
    setIsCreatingRoom(true);
    try {
      const permissionGranted = await deviceLocationProvider.requestPermission();
      if (!permissionGranted) {
        showAppAlert('Izin lokasi diperlukan untuk menentukan titik pusat room.');
        return;
      }

      const locationServicesEnabled = await deviceLocationProvider.hasLocationServicesEnabled();
      if (!locationServicesEnabled) {
        showAppAlert('Layanan Lokasi perangkat nonaktif. Aktifkan Location Services/GPS di pengaturan perangkat, lalu coba lagi.');
        return;
      }

      const position = await deviceLocationProvider.getCurrentLocation();
      if (position.accuracy > 50) {
        showAppAlert('Lokasi belum cukup akurat. Coba lagi di area dengan sinyal GPS yang lebih baik.');
        return;
      }

      socketRef.current?.emit('create-room', {
        centerLocation: position,
        authToken: account.token,
      });
      setJoinCode('');
    } catch (error) {
      console.error('Gagal menentukan titik pusat room PETAK', error);
      const locationUnavailable =
        error instanceof Error && /location is unavailable|cannot obtain current location/i.test(error.message);
      showAppAlert(
        locationUnavailable
          ? 'Layanan Lokasi aktif, tetapi perangkat belum mendapat fix GPS terkini. Pastikan izin lokasi presisi untuk PETAK/Expo Go aktif, coba di area terbuka, tunggu beberapa saat, lalu ulangi.'
          : 'Pengambilan lokasi gagal. Periksa izin dan Layanan Lokasi perangkat, lalu coba lagi.'
      );
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const joinRoom = (roomCode = joinCode) => {
    if (!account) {
      showAppAlert('Login diperlukan untuk bergabung ke room.');
      return;
    }
    const code = roomCode.trim().toUpperCase();

    if (!code) {
      showAppAlert('Masukkan kode room terlebih dahulu.');
      return;
    }

    if (!/^[A-Z0-9]{6}$/.test(code)) {
      showAppAlert('Kode room harus terdiri dari 6 karakter.');
      return;
    }

    socketRef.current?.emit('join-room', { code, authToken: account.token });
    setIsScannerOpen(false);
    setHasScanned(false);
    setScanError('');
  };

  const shareRoomInvite = async () => {
    if (!room || Platform.OS !== 'web' || typeof window === 'undefined') return;

    const inviteUrl = new URL(window.location.href);
    inviteUrl.search = '';
    inviteUrl.hash = '';
    inviteUrl.searchParams.set('room', room.code);

    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: 'Gabung ke room PETAK',
          text: `Buka tautan ini dan login untuk bergabung ke room ${room.code} di PETAK.`,
          url: inviteUrl.toString(),
        });
        return;
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API tidak tersedia.');
      }
      await navigator.clipboard.writeText(inviteUrl.toString());
      showAppAlert('Link undangan berhasil disalin. Login diperlukan sebelum bergabung.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Gagal membagikan link room PETAK', error);
      showAppAlert('Link undangan tidak dapat dibagikan. Silakan salin dan bagikan kode room secara manual.');
    }
  };

  const openRoomScanner = async () => {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (!permission.granted) {
      showAppAlert('Izin kamera diperlukan untuk memindai QR room.');
      return;
    }

    setHasScanned(false);
    setScanError('');
    setIsScannerOpen(true);
  };

  const handleRoomQrScanned = ({ data }: { data: string }) => {
    if (hasScanned) return;

    setHasScanned(true);
    const code = data.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setScanError('QR tidak berisi kode room PETAK yang valid.');
      return;
    }

    setJoinCode(code);
    joinRoom(code);
  };

  const startGame = () => {
    if (!room || !activePlayer || !activePlayer.isHost) return;
    if (lobbyPermissionStatus.location !== true || lobbyPermissionStatus.microphone !== true) return;
    socketRef.current?.emit('start-game');
  };

  const rematch = () => {
    socketRef.current?.emit('rematch');
  };

  const emergencyStop = () => {
    socketRef.current?.emit('emergency-stop');
  };

  const leaveRoom = () => {
    socketRef.current?.emit('leave-room');
  };

  const setPlayRadius = (radiusMeters?: number, random = false) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      showAppAlert('Koneksi room belum siap untuk mengubah radius.');
      return;
    }
    if (random) setIsSelectingRandomRadius(true);
    socket.emit('set-play-radius', random ? { random: true } : { radiusMeters });
  };

  const requestLobbyPermissions = useCallback(async () => {
    if (!room || room.phase !== 'LOBBY' || lobbyPermissionStatus.isRequesting) return;

    setLobbyPermissionStatus((current) => ({ ...current, isRequesting: true, error: '' }));
    let locationGranted = false;
    let microphoneGranted = false;
    const failedRequests: string[] = [];

    try {
      locationGranted = await deviceLocationProvider.requestPermission();
    } catch (error) {
      console.error('Gagal meminta izin lokasi untuk lobby PETAK', error);
      failedRequests.push('lokasi');
    }

    try {
      if (Platform.OS === 'web') {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('Browser tidak mendukung akses mikrofon.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        microphoneGranted = true;
      } else {
        const permission = await requestRecordingPermissionsAsync();
        microphoneGranted = permission.granted;
      }
    } catch (error) {
      console.error('Gagal meminta izin mikrofon untuk lobby PETAK', error);
      failedRequests.push('mikrofon');
    }

    setLobbyPermissionStatus({
      location: locationGranted,
      microphone: microphoneGranted,
      isRequesting: false,
      error: failedRequests.length
        ? `Permintaan izin ${failedRequests.join(' dan ')} gagal. Periksa pengaturan perangkat atau browser, lalu coba lagi.`
        : '',
    });
    if (!locationGranted || !microphoneGranted) {
      socketRef.current?.emit('player-ready', { isReady: false });
    }
  }, [lobbyPermissionStatus.isRequesting, room?.code, room?.phase]);

  useEffect(() => {
    if (!room || room.phase !== 'LOBBY') {
      requestedLobbyPermissionRoomRef.current = null;
      return;
    }
    if (requestedLobbyPermissionRoomRef.current === room.code) return;

    requestedLobbyPermissionRoomRef.current = room.code;
    setLobbyPermissionStatus({
      location: null,
      microphone: null,
      isRequesting: false,
      error: '',
    });
    void requestLobbyPermissions();
  }, [requestLobbyPermissions, room?.code, room?.phase]);

  const setPlayerReady = () => {
    if (!activePlayer || room?.phase !== 'LOBBY') return;
    if (lobbyPermissionStatus.location !== true || lobbyPermissionStatus.microphone !== true) return;
    socketRef.current?.emit('player-ready', { isReady: !activePlayer.isReady });
  };

  const submitLandmarkName = (target: LandmarkTarget) => {
    const name = (landmarkSubmissionNames[target.id] ?? target.name).trim();
    if (!name) {
      setLandmarkSubmissionError('Nama landmark wajib diisi.');
      return;
    }
    if (!socketRef.current?.connected || room?.phase !== 'PLAYING') {
      setLandmarkSubmissionError('Pastikan koneksi aktif dan permainan sedang berlangsung.');
      return;
    }
    setLandmarkSubmittingId(target.id);
    setLandmarkSubmissionError('');
    setLandmarkSubmissionNotice('');
    socketRef.current.emit('landmark:submit', { targetId: target.id, name });
  };

  const authenticateAccount = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setAuthError('');
    try {
      const response = await fetchWithTimeout(`${SOCKET_URL}/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });
      const result = (await response.json()) as {
        error?: string;
        token?: string;
        account?: AccountResponse;
      };
      if (!response.ok || !result.token || !result.account) {
        throw new Error(result.error || 'Akun tidak dapat diproses.');
      }

      const nextAccount: AccountSession = {
        ...result.account,
        token: result.token,
      };
      await AsyncStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(nextAccount));
      setAccount(nextAccount);
      setAuthPassword('');
    } catch (error) {
      console.error('Gagal memproses akun PETAK', error);
      setAuthError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Server terlalu lama merespons. Coba lagi.'
          : error instanceof Error
            ? error.message
            : 'Tidak dapat terhubung ke layanan akun.'
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  const saveProfileAvatar = async (avatarId: string) => {
    if (!account || isSavingAvatar || avatarId === account.avatarId) return;
    setIsSavingAvatar(true);
    setProfileAvatarError('');

    try {
      const response = await fetchWithTimeout(`${SOCKET_URL}/api/auth/avatar`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${account.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ avatarId }),
      });
      const responseType = response.headers.get('content-type') ?? '';
      if (!/json/i.test(responseType)) {
        throw new Error(
          response.status === 404
            ? 'Endpoint avatar belum ditemukan. Mulai ulang backend PETAK terbaru, lalu coba lagi.'
            : `Server mengembalikan halaman, bukan data avatar (HTTP ${response.status}). Pastikan backend PETAK terbaru berjalan.`
        );
      }
      const result = await response.json() as AccountResponse & { error?: string };
      if (!response.ok || result.avatarId !== avatarId) {
        throw new Error(result.error || 'Avatar belum dapat disimpan.');
      }

      setAccount((current) => current
        ? { ...current, ...result, token: current.token }
        : current);
      setProfileCharacterPicker(null);
      if (room?.phase === 'LOBBY' && socketRef.current?.connected) {
        socketRef.current.emit('player:avatar:select', { avatarId });
      }
    } catch (error) {
      console.error('Gagal memperbarui avatar profil PETAK', error);
      setProfileAvatarError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Server terlalu lama merespons. Coba pilih lagi.'
          : error instanceof Error
            ? error.message
            : 'Avatar belum dapat disimpan. Coba lagi.'
      );
    } finally {
      setIsSavingAvatar(false);
    }
  };

  const saveProfileCompanion = async (companionId: CompanionId) => {
    if (!account || isSavingCompanion || companionId === account.companionId) return;
    setIsSavingCompanion(true);
    setProfileCompanionError('');

    try {
      const response = await fetchWithTimeout(`${SOCKET_URL}/api/auth/companion`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${account.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companionId }),
      });
      const responseType = response.headers.get('content-type') ?? '';
      if (!/json/i.test(responseType)) {
        throw new Error(
          response.status === 404
            ? 'Endpoint Companion belum ditemukan. Mulai ulang backend PETAK terbaru, lalu coba lagi.'
            : `Server mengembalikan halaman, bukan data Companion (HTTP ${response.status}). Pastikan backend PETAK terbaru berjalan.`
        );
      }
      const result = await response.json() as AccountResponse & { error?: string };
      if (!response.ok || result.companionId !== companionId) {
        throw new Error(result.error || 'Pilihan Companion belum dapat disimpan.');
      }

      setAccount((current) => current
        ? { ...current, ...result, token: current.token }
        : current);
      setProfileCharacterPicker(null);
      setCompanionChatReply('');
      setCompanionChatError('');
    } catch (error) {
      console.error('Gagal memperbarui Companion profil PETAK', error);
      setProfileCompanionError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Server terlalu lama merespons. Coba pilih lagi.'
          : error instanceof Error
            ? error.message
            : 'Pilihan Companion belum dapat disimpan. Coba lagi.'
      );
    } finally {
      setIsSavingCompanion(false);
    }
  };

  const saveCompanionStatsConsent = async (enabled: boolean) => {
    if (!account || isSavingCompanionPrivacy || enabled === account.companionStatsEnabled) return;
    setIsSavingCompanionPrivacy(true);
    setCompanionPrivacyError('');

    try {
      const response = await fetchWithTimeout(`${SOCKET_URL}/api/auth/companion/privacy`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${account.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companionStatsEnabled: enabled }),
      });
      const responseType = response.headers.get('content-type') ?? '';
      if (!/json/i.test(responseType)) {
        throw new Error(
          response.status === 404
            ? 'Pengaturan privasi Companion belum tersedia. Mulai ulang backend PETAK terbaru.'
            : `Server mengembalikan halaman, bukan data privasi (HTTP ${response.status}).`
        );
      }

      const result = await response.json() as AccountResponse & { error?: string };
      if (!response.ok || result.companionStatsEnabled !== enabled) {
        throw new Error(result.error || 'Pengaturan privasi Companion belum dapat disimpan.');
      }
      setAccount((current) => current
        ? { ...current, ...result, token: current.token }
        : current);
      if (!enabled) setCompanionStats(null);
    } catch (error) {
      console.error('Gagal memperbarui izin statistik Companion', error);
      setCompanionPrivacyError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Server terlalu lama merespons. Coba lagi.'
          : error instanceof Error
            ? error.message
            : 'Pengaturan privasi Companion belum dapat disimpan.'
      );
    } finally {
      setIsSavingCompanionPrivacy(false);
    }
  };

  const enqueueCompanionVoiceMessage = (message: string) => {
    const normalizedMessage = message.trim().slice(0, 600);
    if (!account || !normalizedMessage) return false;
    if (companionVoiceQueueRef.current.length >= 5) {
      setCompanionChatError('Antrean Companion penuh. Tunggu jawaban selesai sebelum menambah pesan.');
      return false;
    }
    companionVoiceQueueRef.current.push(normalizedMessage);
    setCompanionVoiceQueuedCount(companionVoiceQueueRef.current.length);
    setCompanionChatError('');
    processCompanionVoiceQueueRef.current();
    return true;
  };
  enqueueCompanionVoiceMessageRef.current = enqueueCompanionVoiceMessage;

  const flushCompanionVoiceDraft = () => {
    if (companionVoiceDebounceTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(companionVoiceDebounceTimerRef.current);
      companionVoiceDebounceTimerRef.current = null;
    }
    const message = companionVoiceDraftRef.current.trim();
    if (!message) return;
    if (!enqueueCompanionVoiceMessageRef.current(message)) return;
    companionVoiceDraftRef.current = '';
    setCompanionVoiceDraft('');
    setCompanionVoiceInterimTranscript('');
  };

  const speakCompanionReply = async (reply: string, companionId: CompanionId) => {
    const shouldResumeListening = companionVoiceEnabledRef.current;
    if (shouldResumeListening) {
      companionVoiceTtsPausedRef.current = true;
      companionSpeechRecognitionRef.current?.stop();
    }
    setIsCompanionVoiceSpeaking(true);
    try {
      await Speech.stop();
      await new Promise<void>((resolve) => {
        let isFinished = false;
        let timeout: ReturnType<typeof setTimeout>;
        const finish = () => {
          if (isFinished) return;
          isFinished = true;
          clearTimeout(timeout);
          resolve();
        };
        timeout = setTimeout(() => {
          setCompanionChatError('TTS terlalu lama merespons. Antrean pesan dilanjutkan.');
          void Speech.stop().catch((error: unknown) => {
            console.error('Gagal menghentikan TTS yang melewati batas waktu', error);
          });
          finish();
        }, 90_000);
        void enqueueSpeechTask(speechQueueRef, () =>
          speakCompanionSpeech(
            reply,
            selectedSpeechVoiceId,
            englishSpeechVoiceRef.current,
            getCompanionSpeechStyle(companionId)
          )
        ).then(finish).catch((error: unknown) => {
          console.error('Gagal membacakan jawaban Companion', error);
          setCompanionChatError('Jawaban tampil, tetapi TTS gagal diputar.');
          finish();
        });
      });
    } catch (error) {
      console.error('Gagal memulai TTS jawaban Companion', error);
      setCompanionChatError('Jawaban tampil, tetapi TTS gagal diputar.');
    } finally {
      setIsCompanionVoiceSpeaking(false);
      companionVoiceTtsPausedRef.current = false;
      if (shouldResumeListening && companionVoiceEnabledRef.current && typeof window !== 'undefined') {
        if (companionVoiceRestartTimerRef.current !== null) {
          window.clearTimeout(companionVoiceRestartTimerRef.current);
        }
        companionVoiceRestartTimerRef.current = window.setTimeout(() => {
          companionVoiceRestartTimerRef.current = null;
          startCompanionVoiceRecognitionRef.current();
        }, 350);
      }
    }
  };

  const processCompanionVoiceQueue = async () => {
    if (companionVoiceQueueProcessingRef.current || !companionAccountRef.current) return;
    companionVoiceQueueProcessingRef.current = true;
    try {
      while (companionVoiceQueueRef.current.length > 0) {
        const queuedMessage = companionVoiceQueueRef.current.shift();
        const requestAccount: AccountSession | null = companionAccountRef.current;
        setCompanionVoiceQueuedCount(companionVoiceQueueRef.current.length);
        if (!queuedMessage || !requestAccount) break;
        setCompanionVoiceActiveMessage(queuedMessage);

        const companionContext: {
          page: CompanionPage;
          period?: LeaderboardPeriod;
          winner?: Role | null;
          outcome?: 'won' | 'lost' | 'spectator' | null;
        } = isProfileOpen || isCharacterSettingsOpen || profileCharacterPicker
          ? { page: 'profile' }
          : isLeaderboardOpen
            ? { page: 'leaderboard', period: leaderboardPeriod }
            : isScannerOpen
              ? { page: 'scanner' }
              : isLobbyDetailsOpen || room?.phase === 'LOBBY'
                ? { page: 'lobby' }
                : room?.phase === 'FINISHED'
                  ? {
                      page: 'results',
                      winner: winningRole(room.winner),
                      outcome: activePlayer?.isSpectator
                        ? 'spectator'
                        : activePlayer && resultRole
                          ? activePlayerWon ? 'won' : 'lost'
                          : null,
                    }
                  : room?.phase === 'PLAYING' || room?.phase === 'PREPARATION'
                    ? { page: 'match' }
                    : { page: 'home' };

        try {
          const response = await fetchWithTimeout(
            `${SOCKET_URL}/api/auth/companion/chat`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${requestAccount.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ message: queuedMessage, context: companionContext }),
            },
            35_000
          );
          const responseType = response.headers.get('content-type') ?? '';
          if (!/json/i.test(responseType)) {
            throw new Error(
              response.status === 404
                ? 'Chat Companion belum tersedia. Mulai ulang backend PETAK terbaru.'
                : `Server mengembalikan halaman, bukan jawaban Companion (HTTP ${response.status}).`
            );
          }

          const result = await response.json() as {
            reply?: unknown;
            error?: string;
            companionId?: string;
          };
          if (companionAccountRef.current?.token !== requestAccount.token) break;
          if (!response.ok) {
            throw new Error(
              `${result.error || 'Jawaban Companion belum dapat dimuat.'} (HTTP ${response.status})`
            );
          }
          if (
            typeof result.reply !== 'string' ||
            !result.reply.trim() ||
            result.companionId !== requestAccount.companionId
          ) {
            throw new Error(result.error || 'Jawaban Companion belum dapat dimuat.');
          }
          const reply = result.reply.trim();
          setCompanionChatReply(reply);
          setCompanionChatError('');
          await speakCompanionReply(reply, requestAccount.companionId);
        } catch (error) {
          if (companionAccountRef.current?.token !== requestAccount.token) break;
          const errorMessage = error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
          console.error(`Gagal mengirim pesan ke Companion: ${errorMessage}`, error);
          setCompanionChatError(
            error instanceof Error && error.name === 'AbortError'
              ? 'Chat melewati batas waktu. Coba lagi.'
              : error instanceof TypeError
                ? 'Tidak dapat terhubung ke server PETAK. Periksa koneksi lalu coba lagi.'
              : error instanceof Error
                ? error.message
                : 'Companion belum dapat menjawab. Coba lagi.'
          );
        }
      }
    } finally {
      flushCompanionVoiceDraft();
      companionVoiceQueueProcessingRef.current = false;
      setCompanionVoiceActiveMessage('');
      if (companionVoiceQueueRef.current.length > 0 && companionAccountRef.current) {
        processCompanionVoiceQueueRef.current();
      }
    }
  };
  processCompanionVoiceQueueRef.current = () => {
    void processCompanionVoiceQueue();
  };

  const startCompanionVoiceRecognition = () => {
    if (
      Platform.OS !== 'web' ||
      typeof window === 'undefined' ||
      !companionVoiceEnabledRef.current ||
      companionVoiceTtsPausedRef.current ||
      !companionVoicePageVisibleRef.current ||
      companionSpeechRecognitionRef.current
    ) return;
    if (!window.isSecureContext) {
      companionVoiceEnabledRef.current = false;
      setIsCompanionVoiceEnabled(false);
      setCompanionChatError('Input suara memerlukan koneksi aman HTTPS atau localhost.');
      return;
    }
    const speechWindow = window as CompanionSpeechRecognitionWindow;
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      companionVoiceEnabledRef.current = false;
      setIsCompanionVoiceEnabled(false);
      setCompanionChatError('Pengenalan suara belum didukung browser ini. Coba Chrome atau Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const finalTranscripts: string[] = [];
      const interimTranscripts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript.trim();
        if (!transcript) continue;
        if (event.results[index].isFinal) finalTranscripts.push(transcript);
        else interimTranscripts.push(transcript);
      }
      setCompanionVoiceInterimTranscript(interimTranscripts.join(' '));
      if (finalTranscripts.length === 0) return;
      companionVoiceDraftRef.current = [
        companionVoiceDraftRef.current,
        finalTranscripts.join(' '),
      ].filter(Boolean).join(' ').slice(0, 600);
      companionVoiceRestartDelayRef.current = 350;
      setCompanionVoiceDraft(companionVoiceDraftRef.current);
      if (companionVoiceDebounceTimerRef.current !== null) {
        window.clearTimeout(companionVoiceDebounceTimerRef.current);
      }
      companionVoiceDebounceTimerRef.current = window.setTimeout(
        flushCompanionVoiceDraft,
        1_500
      );
    };
    recognition.onerror = (event) => {
      setCompanionVoiceInterimTranscript('');
      if (event.error === 'no-speech') return;
      const messages: Record<string, string> = {
        'not-allowed': 'Izin mikrofon ditolak. Izinkan mikrofon di browser untuk memakai suara.',
        'service-not-allowed': 'Layanan pengenalan suara browser tidak diizinkan.',
        'audio-capture': 'Mikrofon tidak ditemukan atau sedang digunakan aplikasi lain.',
        network: 'Layanan transkripsi browser terganggu. PETAK akan mencoba kembali otomatis.',
        'language-not-supported': 'Pengenalan bahasa Indonesia tidak didukung browser ini.',
      };
      setCompanionChatError(messages[event.error] ?? 'Pengenalan suara gagal. Periksa izin mikrofon.');
      if (event.error === 'network') {
        companionVoiceRestartDelayRef.current = 5_000;
      } else if (event.error === 'audio-capture' || event.error === 'language-not-supported') {
        companionVoiceRestartDelayRef.current = 350;
        companionVoiceEnabledRef.current = false;
        setIsCompanionVoiceEnabled(false);
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        companionVoiceEnabledRef.current = false;
        setIsCompanionVoiceEnabled(false);
      }
    };
    recognition.onend = () => {
      setIsCompanionVoiceListening(false);
      setCompanionVoiceInterimTranscript('');
      if (companionSpeechRecognitionRef.current === recognition) {
        companionSpeechRecognitionRef.current = null;
      }
      if (
        companionVoiceEnabledRef.current &&
        !companionVoiceTtsPausedRef.current &&
        companionVoicePageVisibleRef.current
      ) {
        if (companionVoiceRestartTimerRef.current !== null) {
          window.clearTimeout(companionVoiceRestartTimerRef.current);
        }
        companionVoiceRestartTimerRef.current = window.setTimeout(() => {
          companionVoiceRestartTimerRef.current = null;
          startCompanionVoiceRecognitionRef.current();
        }, companionVoiceRestartDelayRef.current);
      }
    };

    try {
      recognition.start();
      companionSpeechRecognitionRef.current = recognition;
      setIsCompanionVoiceListening(true);
    } catch (error) {
      console.error('Gagal memulai input suara Companion', error);
      setCompanionChatError('Mikrofon tidak dapat dimulai. Periksa izin browser lalu coba lagi.');
      companionVoiceEnabledRef.current = false;
      setIsCompanionVoiceEnabled(false);
    }
  };
  startCompanionVoiceRecognitionRef.current = startCompanionVoiceRecognition;

  const stopCompanionVoice = () => {
    companionVoiceEnabledRef.current = false;
    setIsCompanionVoiceEnabled(false);
    flushCompanionVoiceDraft();
    setCompanionVoiceInterimTranscript('');
    companionSpeechRecognitionRef.current?.stop();
    setIsCompanionVoiceListening(false);
    if (companionVoiceRestartTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(companionVoiceRestartTimerRef.current);
      companionVoiceRestartTimerRef.current = null;
    }
  };

  const toggleCompanionVoice = () => {
    if (!account || Platform.OS !== 'web') return;
    setIsCompanionVoicePanelOpen(true);
    setCompanionChatError('');
    if (companionVoiceEnabledRef.current) {
      stopCompanionVoice();
      return;
    }
    companionVoiceEnabledRef.current = true;
    setIsCompanionVoiceEnabled(true);
    companionVoiceRestartDelayRef.current = 350;
    startCompanionVoiceRecognitionRef.current();
  };

  const closeCompanionVoicePanel = () => {
    if (companionVoiceEnabledRef.current) stopCompanionVoice();
    setIsCompanionVoicePanelOpen(false);
  };

  const openCharacterSettings = (picker: 'avatar' | 'companion' | null = null) => {
    setProfileCharacterPicker(picker);
    setIsCharacterSettingsOpen(true);
  };

  const closeCharacterSettings = () => {
    setProfileCharacterPicker(null);
    setIsCharacterSettingsOpen(false);
  };

  const logoutAccount = async () => {
    if (!account || room || isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const response = await fetchWithTimeout(`${SOCKET_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${account.token}` },
      });
      if (!response.ok) throw new Error(`Account logout failed with status ${response.status}.`);
      await AsyncStorage.removeItem(ACCOUNT_STORAGE_KEY);
      setAccount(null);
      setAuthPassword('');
      setAuthError('');
      setIsCharacterSettingsOpen(false);
      setProfileCharacterPicker(null);
      setIsProfileOpen(false);
    } catch (error) {
      console.error('Gagal logout akun PETAK', error);
      showAppAlert(
        error instanceof Error && error.name === 'AbortError'
          ? 'Server terlalu lama merespons. Anda belum logout; coba lagi.'
          : 'Logout gagal. Periksa koneksi lalu coba lagi.'
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  const activateSeekerReveal = () => {
    socketRef.current?.emit('activate-seeker-reveal');
  };

  const isLocationInside =
    activePlayer?.locationStatus === 'INSIDE' && !locationError && connectionStatus === 'connected';
  const locationStatusMessage = locationError || (
    connectionStatus !== 'connected'
      ? activePlayer?.locationStatus
        ? `GPS terakhir ${activePlayer.locationStatus === 'INSIDE' ? 'di dalam zona' : activePlayer.locationStatus === 'OUTSIDE' ? 'di luar zona' : activePlayer.locationStatus === 'UNCERTAIN' ? 'belum pasti dekat tepi zona' : 'belum akurat'} · menunggu verifikasi ulang.`
        : 'Menunggu koneksi untuk memverifikasi lokasi GPS.'
      : activePlayer?.locationStatus === 'INSIDE'
        ? room
          ? `Anda berada di dalam area permainan (${formatPlayRadius(room.playRadiusMeters)}).`
          : 'Anda berada di dalam area permainan.'
        : activePlayer?.locationStatus === 'OUTSIDE'
          ? room
            ? `Anda di luar area. Kembali ke dalam radius ${formatPlayRadius(room.playRadiusMeters)}.`
            : 'Anda berada di luar area permainan.'
          : activePlayer?.locationStatus === 'INACCURATE'
            ? 'Sinyal GPS kurang akurat. Tunggu lokasi yang lebih tepat.'
            : activePlayer?.locationStatus === 'UNCERTAIN'
              ? 'Posisi GPS belum cukup pasti untuk menentukan batas zona. Tunggu fix berikutnya atau menjauh dari tepi zona.'
            : 'Menunggu lokasi GPS terbaru. Pastikan izin lokasi aktif.'
  );
  const impostorDecoyQuota = room?.impostorDecoyQuota ?? 0;
  const impostorDecoysUsed = room?.impostorDecoysUsed ?? 0;
  const impostorDecoysRemaining = Math.max(0, impostorDecoyQuota - impostorDecoysUsed);
  const canSelectImpostorDecoyPin =
    room?.phase === 'PLAYING' &&
    !activePlayer?.isSpectator &&
    activePlayer?.role === 'IMPOSTOR' &&
    isLocationInside &&
    !room.impostorDecoyActive &&
    impostorDecoysRemaining > 0;
  const canPlaceImpostorDecoy =
    canSelectImpostorDecoyPin && Boolean(room?.impostorDecoySelection);
  const impostorDecoyButtonLabel = room?.impostorDecoyActive
    ? 'Umpan aktif · tunggu'
    : impostorDecoysRemaining === 0
      ? 'Jatah umpan habis'
      : !room?.impostorDecoySelection
        ? 'Pilih pin di peta'
        : `Pasang umpan · ${impostorDecoysUsed}/${impostorDecoyQuota}`;

  const handleAction = (action: 'scan' | 'impostor-decoy') => {
    if (!room || room.phase !== 'PLAYING' || !isLocationInside) return;
    if (action === 'scan') setScanNotice('Memindai area sekitar...');
    socketRef.current?.emit('player-action', { action });
  };
  const requestLandmarkTargets = () => {
    if (!room || !socketRef.current?.connected) return;
    landmarkTargetRequestKeyRef.current = `${room.code}:${room.roundId}`;
    setIsLoadingLandmarkTargets(true);
    setLandmarkTargetError('');
    socketRef.current.emit('landmark:request-targets');
  };
  const seekerScanCount = room?.seekerScanCount ?? 0;
  const canUseSeekerScan =
    room?.phase === 'PLAYING' &&
    !activePlayer?.isSpectator &&
    activePlayer?.role === 'SEEKER' &&
    isLocationInside &&
    seekerScanCount < 6 &&
    (seekerScanCount < 3 || (account?.scanCredits ?? 0) > 0);
  const canExchangeScanCredits =
    room?.phase === 'PLAYING' &&
    !activePlayer?.isSpectator &&
    activePlayer?.role === 'SEEKER' &&
    !room.seekerScanPurchaseUsed &&
    seekerScanCount < 6 &&
    (account?.scanCredits ?? 0) < 3 &&
    (account?.badges ?? 0) > 0;

  const beginBroadcastRecording = async () => {
    if (
      broadcastRecordingRef.current ||
      broadcastStartingRef.current ||
      broadcastSendingRef.current ||
      isBroadcastBuying
    ) return;
    if (!room || !account || connectionStatus !== 'connected') {
      setBroadcastNotice('Hubungkan akun dan room terlebih dahulu.');
      return;
    }

    const cooldownRemaining = Math.max(0, account.broadcastNextFreeAt - Date.now());
    if (cooldownRemaining > 0 && account.broadcastCredits < 1) {
      setBroadcastNotice('Jatah gratis sedang cooldown. Tukar 1 badge untuk mendapatkan 7 siaran.');
      return;
    }

    broadcastStartRequestedRef.current = true;
    broadcastStartingRef.current = true;
    setIsBroadcastStarting(true);
    broadcastChunksRef.current = [];
    broadcastSampleRateRef.current = BROADCAST_SAMPLE_RATE;
    setBroadcastNotice('Mengaktifkan mikrofon...');
    let pendingBrowserStream: MediaStream | null = null;
    let pendingBrowserContext: AudioContext | null = null;

    try {
      if (Platform.OS !== 'web') {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          broadcastStartRequestedRef.current = false;
          setBroadcastNotice('Izin mikrofon diperlukan untuk merekam pesan siaran.');
          return;
        }
      }
      if (!broadcastStartRequestedRef.current) {
        setBroadcastNotice('Pengaktifan mikrofon dibatalkan.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
      });

      if (Platform.OS === 'web') {
        if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioContext === 'undefined') {
          throw new Error('Perekaman mikrofon tidak didukung browser ini.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        pendingBrowserStream = stream;
        if (!broadcastStartRequestedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          pendingBrowserStream = null;
          setBroadcastNotice('Pengaktifan mikrofon dibatalkan.');
          return;
        }

        const context = new window.AudioContext();
        pendingBrowserContext = context;
        await context.resume();
        if (!broadcastStartRequestedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          pendingBrowserStream = null;
          await context.close();
          pendingBrowserContext = null;
          setBroadcastNotice('Pengaktifan mikrofon dibatalkan.');
          return;
        }
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(4096, 1, 1);
        const mutedOutput = context.createGain();
        mutedOutput.gain.value = 0;
        browserAudioCaptureRef.current = { context, stream, source, processor, mutedOutput };
        processor.onaudioprocess = (event) => {
          if (!broadcastRecordingRef.current) return;
          broadcastChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(mutedOutput);
        mutedOutput.connect(context.destination);
        broadcastSampleRateRef.current = context.sampleRate;
        pendingBrowserStream = null;
        pendingBrowserContext = null;
      } else {
        broadcastRecordingRef.current = true;
        await microphoneAudioStream.stream.start();
        if (!broadcastStartRequestedRef.current) {
          broadcastRecordingRef.current = false;
          microphoneAudioStream.stream.stop();
          setBroadcastNotice('Pengaktifan mikrofon dibatalkan.');
          return;
        }
      }

      broadcastRecordingRef.current = true;
      broadcastStartedAtRef.current = Date.now();
      setIsBroadcastRecording(true);
      setBroadcastNotice('Merekam hingga 7 detik. Ketuk lagi untuk berhenti dan mengirim.');
      broadcastTimerRef.current = setTimeout(() => {
        broadcastStartRequestedRef.current = false;
        broadcastStopRef.current();
      }, BROADCAST_MAX_DURATION_SECONDS * 1000);
    } catch (error) {
      broadcastRecordingRef.current = false;
      broadcastStartRequestedRef.current = false;
      console.error('Gagal memulai perekaman siaran PETAK', error);
      setBroadcastNotice(error instanceof Error ? error.message : 'Mikrofon tidak dapat digunakan.');
      if (Platform.OS !== 'web') {
        microphoneAudioStream.stream.stop();
      } else {
        const capture = browserAudioCaptureRef.current;
        browserAudioCaptureRef.current = null;
        if (capture) {
          capture.processor.onaudioprocess = null;
          capture.source.disconnect();
          capture.processor.disconnect();
          capture.mutedOutput.disconnect();
          capture.stream.getTracks().forEach((track) => track.stop());
          void capture.context.close().catch((closeError: unknown) => {
            console.error('Gagal menutup input audio siaran PETAK', closeError);
          });
        } else {
          pendingBrowserStream?.getTracks().forEach((track) => track.stop());
          if (pendingBrowserContext && pendingBrowserContext.state !== 'closed') {
            void pendingBrowserContext.close().catch((closeError: unknown) => {
              console.error('Gagal menutup input audio siaran PETAK', closeError);
            });
          }
        }
      }
      void setAudioModeAsync({ allowsRecording: false }).catch((modeError: unknown) => {
        console.error('Gagal menutup mode perekaman audio PETAK', modeError);
      });
    } finally {
      broadcastStartingRef.current = false;
      setIsBroadcastStarting(false);
    }
  };

  const finishBroadcastRecording = async () => {
    broadcastStartRequestedRef.current = false;
    if (broadcastTimerRef.current) {
      clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
    if (!broadcastRecordingRef.current) return;

    broadcastRecordingRef.current = false;
    setIsBroadcastRecording(false);
    if (Platform.OS === 'web') {
      const capture = browserAudioCaptureRef.current;
      browserAudioCaptureRef.current = null;
      if (capture) {
        capture.processor.onaudioprocess = null;
        capture.source.disconnect();
        capture.processor.disconnect();
        capture.mutedOutput.disconnect();
        capture.stream.getTracks().forEach((track) => track.stop());
        void capture.context.close().catch((error: unknown) => {
          console.error('Gagal menutup input audio siaran PETAK', error);
        });
      }
    } else {
      microphoneAudioStream.stream.stop();
    }
    void setAudioModeAsync({ allowsRecording: false }).catch((error: unknown) => {
      console.error('Gagal menutup mode perekaman audio PETAK', error);
    });

    let pcm: Uint8Array;
    try {
      pcm = encodeBroadcastPcm(broadcastChunksRef.current, broadcastSampleRateRef.current);
    } catch (error) {
      setBroadcastNotice(error instanceof Error ? error.message : 'Audio siaran tidak valid.');
      return;
    }
    broadcastChunksRef.current = [];

    const socket = socketRef.current;
    if (!socket?.connected) {
      setBroadcastNotice('Koneksi terputus. Audio siaran tidak terkirim.');
      return;
    }
    broadcastSendingRef.current = true;
    setIsBroadcastSending(true);
    setBroadcastNotice('Menyamarkan suara di server dan mengirim...');
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    broadcastPendingMessageIdRef.current = messageId;
    broadcastDeliveredMessageIdRef.current = null;
    socket.timeout(BROADCAST_ACK_TIMEOUT_MS).emit(
      'broadcast:send',
      { pcm, sampleRate: BROADCAST_SAMPLE_RATE, messageId },
      (
        timeoutError: Error | null,
        result?: { ok: boolean; error?: string; isPaid?: boolean; account?: AccountResponse }
      ) => {
        broadcastSendingRef.current = false;
        setIsBroadcastSending(false);
        if (timeoutError || !result) {
          if (broadcastDeliveredMessageIdRef.current === messageId) {
            setBroadcastNotice('Terkirim · diputar 1×');
            return;
          }
          console.error('Server tidak mengonfirmasi pesan siaran sebelum batas waktu.');
          setBroadcastNotice(
            'Status siaran belum terkonfirmasi. Jangan kirim ulang dulu; periksa apakah pemain lain menerima audio.'
          );
          return;
        }
        if (broadcastDeliveredMessageIdRef.current === messageId) {
          setBroadcastNotice('Terkirim · diputar 1×');
          return;
        }
        if (!result.ok) {
          setBroadcastNotice(result.error || 'Siaran tidak dapat dikirim.');
          return;
        }
        if (result.account) {
          setAccount((current) =>
            current ? { ...current, ...result.account, token: current.token } : current
          );
        }
        setBroadcastNotice(
          result.isPaid ? 'Terkirim · 1 kredit' : 'Terkirim'
        );
      }
    );
  };
  broadcastStopRef.current = () => {
    void finishBroadcastRecording();
  };

  const cancelBroadcastRecording = useCallback(async () => {
    broadcastStartRequestedRef.current = false;
    if (broadcastTimerRef.current) {
      clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
    if (!broadcastRecordingRef.current) {
      broadcastChunksRef.current = [];
      return;
    }

    broadcastRecordingRef.current = false;
    broadcastChunksRef.current = [];
    setIsBroadcastRecording(false);
    if (Platform.OS === 'web') {
      const capture = browserAudioCaptureRef.current;
      browserAudioCaptureRef.current = null;
      if (capture) {
        capture.processor.onaudioprocess = null;
        capture.source.disconnect();
        capture.processor.disconnect();
        capture.mutedOutput.disconnect();
        capture.stream.getTracks().forEach((track) => track.stop());
        void capture.context.close().catch((error: unknown) => {
          console.error('Gagal menutup input audio siaran PETAK', error);
        });
      }
    } else {
      microphoneAudioStream.stream.stop();
    }
    void setAudioModeAsync({ allowsRecording: false }).catch((error: unknown) => {
      console.error('Gagal menutup mode perekaman audio PETAK', error);
    });
  }, [microphoneAudioStream.stream]);

  const broadcastPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
          const shouldStartDragging = Math.hypot(gestureState.dx, gestureState.dy) > 14;
          if (shouldStartDragging && !broadcastDragOccurredRef.current) {
            broadcastDragOccurredRef.current = true;
            liveActionGestureModeRef.current = isLiveActionMenuOpen ? 'select' : 'move';
            liveActionGestureSelectionRef.current = null;
            setLiveActionGestureSelection(null);
            if (
              liveActionGestureModeRef.current === 'move' &&
              broadcastStartingRef.current
            ) {
              void cancelBroadcastRecording();
            }
          }
          return shouldStartDragging;
        },
        onPanResponderGrant: () => {
          broadcastDragOriginRef.current = broadcastPositionRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          if (liveActionGestureModeRef.current === 'select') {
            const distance = Math.hypot(gestureState.dx, gestureState.dy);
            if (distance < 28) {
              liveActionGestureSelectionRef.current = null;
              setLiveActionGestureSelection(null);
              return;
            }
            const menuOpensLeft =
              broadcastPositionRef.current.x > viewportWidth / 2 ||
              broadcastPositionRef.current.x + 250 > viewportWidth - 12;
            const side = menuOpensLeft ? -1 : 1;
            const gestureX = gestureState.dx / distance;
            const gestureY = gestureState.dy / distance;
            const skillVectorLength = Math.hypot(side * 0.85, -0.52);
            const broadcastVectorLength = Math.hypot(side * 0.95, 0.31);
            const skillScore =
              gestureX * (side * 0.85 / skillVectorLength) +
              gestureY * (-0.52 / skillVectorLength);
            const broadcastScore =
              gestureX * (side * 0.95 / broadcastVectorLength) +
              gestureY * (0.31 / broadcastVectorLength);
            const exchangeVectorLength = Math.hypot(side, -0.07);
            const exchangeScore =
              gestureX * (side / exchangeVectorLength) +
              gestureY * (-0.07 / exchangeVectorLength);
            const selection =
              activePlayer?.role === 'SEEKER' && canExchangeScanCredits
                ? exchangeScore > Math.max(skillScore, broadcastScore)
                  ? 'exchange'
                  : skillScore > broadcastScore
                    ? 'skill'
                    : 'broadcast'
                : skillScore > broadcastScore
                  ? 'skill'
                  : 'broadcast';
            if (liveActionGestureSelectionRef.current !== selection) {
              liveActionGestureSelectionRef.current = selection;
              setLiveActionGestureSelection(selection);
            }
            return;
          }
          const nextPosition = {
            x: Math.min(
              Math.max(12, viewportWidth - broadcastFloatingSize.width - 12),
              Math.max(12, broadcastDragOriginRef.current.x + gestureState.dx)
            ),
            y: Math.min(
              Math.max(
                100,
                viewportHeight -
                  broadcastFloatingSize.height -
                  liveBottomDockHeight -
                  (Platform.OS === 'android' ? insets.bottom : 0) -
                  20
              ),
              Math.max(100, broadcastDragOriginRef.current.y + gestureState.dy)
            ),
          };
          broadcastPositionRef.current = nextPosition;
          broadcastFloatingPosition.setValue(nextPosition);
        },
        onPanResponderRelease: () => {
          const selection = liveActionGestureSelectionRef.current;
          const handlers = liveActionHandlersRef.current;
          if (liveActionGestureModeRef.current === 'select' && selection && handlers) {
            handlers[selection]();
          }
          liveActionGestureModeRef.current = null;
          liveActionGestureSelectionRef.current = null;
          setLiveActionGestureSelection(null);
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderTerminate: () => {
          if (broadcastStartingRef.current) void cancelBroadcastRecording();
          liveActionGestureModeRef.current = null;
          liveActionGestureSelectionRef.current = null;
          setLiveActionGestureSelection(null);
        },
      }),
    [
      broadcastFloatingPosition,
      broadcastFloatingSize,
      cancelBroadcastRecording,
      activePlayer?.role,
      canExchangeScanCredits,
      insets.bottom,
      isLiveActionMenuOpen,
      liveBottomDockHeight,
      viewportHeight,
      viewportWidth,
    ]
  );

  const purchaseBroadcastCredits = () => {
    const socket = socketRef.current;
    if (!socket?.connected || isBroadcastBuying) {
      setBroadcastNotice('Koneksi room belum siap untuk menukar badge.');
      return;
    }
    setIsBroadcastBuying(true);
    socket.timeout(8_000).emit(
      'broadcast:purchase',
      (timeoutError: Error | null, result: { ok: boolean; error?: string; account?: AccountResponse }) => {
        setIsBroadcastBuying(false);
        if (timeoutError) {
          setBroadcastNotice('Server belum mengonfirmasi penukaran badge. Coba lagi.');
          return;
        }
        if (!result.ok || !result.account) {
          setBroadcastNotice(result.error || 'Badge tidak dapat ditukar.');
          return;
        }
        setAccount((current) =>
          current ? { ...current, ...result.account, token: current.token } : current
        );
        setBroadcastNotice('1 badge ditukar menjadi 7 kredit siaran.');
      }
    );
  };

  const purchaseSeekerScanCredits = () => {
    const socket = socketRef.current;
    if (!socket?.connected || isBuyingScanCredits) {
      setScanNotice('Koneksi room belum siap untuk menukar badge.');
      return;
    }

    setIsBuyingScanCredits(true);
    socket.timeout(8_000).emit(
      'seeker-scan:purchase',
      (timeoutError: Error | null, result: {
        ok: boolean;
        error?: string;
        account?: AccountResponse;
      }) => {
        setIsBuyingScanCredits(false);
        if (timeoutError) {
          setScanNotice('Penukaran belum dikonfirmasi. Saldo Anda aman; coba lagi.');
          return;
        }
        if (!result.ok || !result.account) {
          setScanNotice(result.error || 'Badge tidak dapat ditukar.');
          return;
        }

        setAccount((current) =>
          current ? { ...current, ...result.account, token: current.token } : current
        );
        setScanNotice('1 badge ditukar menjadi 3 scan tambahan.');
      }
    );
  };

  const purchaseSeekerRevealCredit = () => {
    const socket = socketRef.current;
    if (!socket?.connected || isBuyingSeekerReveal) {
      setSeekerRevealNotice('Koneksi room belum siap untuk menukar badge.');
      return;
    }

    setIsBuyingSeekerReveal(true);
    socket.timeout(8_000).emit(
      'seeker-reveal:purchase',
      (timeoutError: Error | null, result: {
        ok: boolean;
        error?: string;
        account?: AccountResponse;
      }) => {
        setIsBuyingSeekerReveal(false);
        if (timeoutError) {
          setSeekerRevealNotice('Penukaran belum dikonfirmasi. Saldo Anda aman; coba lagi.');
          return;
        }
        if (!result.ok || !result.account) {
          setSeekerRevealNotice(result.error || 'Badge tidak dapat ditukar.');
          return;
        }

        setAccount((current) =>
          current ? { ...current, ...result.account, token: current.token } : current
        );
        setSeekerRevealNotice('1 badge ditukar menjadi 1 Reveal tambahan.');
      }
    );
  };

  const dismissBroadcastIntro = () => {
    setIsBroadcastIntroVisible(false);
    if (!account) return;
    void AsyncStorage.setItem(`${BROADCAST_INTRO_STORAGE_KEY}:${account.id}`, 'true').catch(
      (error: unknown) => {
        console.error('Gagal menyimpan pengenalan pesan siaran PETAK', error);
      }
    );
  };

  const dismissGettingStarted = () => {
    setIsGettingStartedVisible(false);
    if (!account) return;
    void AsyncStorage.setItem(`${GETTING_STARTED_STORAGE_KEY}:${account.id}`, 'true').catch(
      (error: unknown) => {
        console.error('Gagal menyimpan status panduan awal PETAK', error);
      }
    );
  };

  const renderSeekerScanPanel = () => {
    if (!room || !account || activePlayer?.role !== 'SEEKER') return null;

    const scanButtonLabel =
      seekerScanCount >= 6
        ? 'Batas scan tercapai'
        : seekerScanCount >= 3 && account.scanCredits < 1
          ? 'Butuh kredit scan'
          : 'Scan area';

    return (
      <View style={styles.seekerScanPanel}>
        <View style={styles.seekerScanStatusRow}>
          <Text style={styles.seekerScanStatus}>
            Scan {seekerScanCount}/6 · Gratis {Math.max(0, 3 - seekerScanCount)} · Kredit {account.scanCredits}
          </Text>
          <Text style={styles.seekerScanRange}>30 m</Text>
        </View>
        {scanNotice ? (
          <Text accessibilityLiveRegion="polite" style={styles.seekerScanNotice}>
            {scanNotice}
          </Text>
        ) : null}
        <View style={styles.seekerScanActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scanButtonLabel}
            accessibilityHint="Memindai radius 30 meter. Hasil hanya memberi tingkat sinyal, bukan posisi tepat."
            disabled={!canUseSeekerScan || isBuyingScanCredits}
            style={[
              styles.seekerScanButton,
              styles.seekerScanPrimaryButton,
              (!canUseSeekerScan || isBuyingScanCredits) && styles.disabledButton,
            ]}
            onPress={() => handleAction('scan')}
          >
            <Text style={styles.seekerScanButtonText}>{scanButtonLabel}</Text>
          </Pressable>
          {canExchangeScanCredits ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tukar 1 badge menjadi 3 scan"
              disabled={isBuyingScanCredits}
              style={[
                styles.seekerScanButton,
                styles.seekerScanExchangeButton,
                isBuyingScanCredits && styles.disabledButton,
              ]}
              onPress={purchaseSeekerScanCredits}
            >
              {isBuyingScanCredits ? (
                <ActivityIndicator color="#fde68a" size="small" />
              ) : (
                <Text style={styles.seekerScanExchangeText}>Tukar badge · +3</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  const renderSeekerRevealPanel = () => {
    if (!room || activePlayer?.role !== 'HIDER') return null;

    const revealCount = room.seekerRevealCount ?? 0;
    const revealCredits = room.seekerRevealCredits ?? 0;
    return (
      <View style={styles.badgePanel}>
        <Text style={styles.badgeText}>
          Reveal {revealCount}/3 · Gratis {revealCount === 0 ? 1 : 0} · Kredit {revealCredits} · Tukar {room.seekerRevealPurchaseCount ?? 0}/2
        </Text>
        <Text style={styles.mutedText}>
          1 Reveal gratis per game, lalu tukar 1 badge untuk setiap Reveal tambahan. Maksimal 3 kali.
        </Text>
        <Text style={styles.mutedText}>Badge kemenangan: {room.badges ?? 0}</Text>
        {room.seekerLocation ? (
          <Text style={styles.mutedText}>Reveal seeker aktif selama 10 detik.</Text>
        ) : null}
        {seekerRevealNotice ? (
          <Text accessibilityLiveRegion="polite" style={styles.seekerScanNotice}>
            {seekerRevealNotice}
          </Text>
        ) : null}
        <Pressable
          disabled={!room.seekerRevealAvailable || !isLocationInside}
          style={[
            styles.secondaryButton,
            (!room.seekerRevealAvailable || !isLocationInside) && styles.disabledButton,
          ]}
          onPress={activateSeekerReveal}
        >
          <Text style={styles.secondaryText}>
            {room.seekerRevealAvailable
              ? revealCount === 0
                ? 'Gunakan Reveal gratis'
                : 'Gunakan Reveal'
              : 'Reveal belum tersedia'}
          </Text>
        </Pressable>
        {room.seekerRevealPurchaseAvailable ? (
          <Pressable
            disabled={isBuyingSeekerReveal}
            style={[
              styles.secondaryButton,
              isBuyingSeekerReveal && styles.disabledButton,
            ]}
            onPress={purchaseSeekerRevealCredit}
          >
            {isBuyingSeekerReveal ? (
              <ActivityIndicator color="#fde68a" size="small" />
            ) : (
              <Text style={styles.secondaryText}>Tukar 1 badge · +1 Reveal</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    );
  };

  const roleRevealModal = (
    <Modal
      visible={isRoleRevealVisible}
      transparent
      animationType="fade"
      onRequestClose={dismissRoleReveal}
    >
      <View style={styles.roleRevealBackdrop}>
        <View
          accessibilityViewIsModal
          style={[
            styles.roleRevealCard,
            roleRevealTheme && {
              backgroundColor: roleRevealTheme.background,
              borderColor: roleRevealTheme.border,
            },
          ]}
        >
          <Text style={[styles.roleRevealEyebrow, roleRevealTheme && { color: roleRevealTheme.accent }]}>
            IDENTITAS RAHASIA TERUNGKAP
          </Text>
          {roleRevealRole ? (
            <Image
              accessibilityLabel={`Ilustrasi role ${roleLabel(roleRevealRole)}`}
              source={ROLE_REVEAL_AVATARS[roleRevealRole]}
              resizeMode="cover"
              style={[
                styles.roleRevealImage,
                {
                  width: Math.min(viewportWidth * 0.52, 220),
                  height: Math.min(viewportWidth * 0.52, 220),
                  borderColor: roleRevealTheme?.accent,
                },
              ]}
            />
          ) : null}
          <Text style={[styles.roleRevealTitle, roleRevealTheme && { color: roleRevealTheme.accent }]}>
            {roleLabel(roleRevealRole)}
          </Text>
          <Text style={styles.roleRevealDescription}>{roleDescription(roleRevealRole)}</Text>
          <Text style={styles.roleRevealHint}>
            Rahasiakan role ini dari pemain lain.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={[
              styles.roleRevealButton,
              roleRevealTheme && { backgroundColor: roleRevealTheme.border },
            ]}
            onPress={dismissRoleReveal}
          >
            <Text style={styles.roleRevealButtonText}>LANJUT KE ARENA</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const broadcastIntroModal = (
    <Modal
      visible={isBroadcastIntroVisible && room?.phase === 'PLAYING'}
      transparent
      animationType="fade"
      onRequestClose={dismissBroadcastIntro}
    >
      <View style={styles.broadcastModalBackdrop}>
        <View style={styles.broadcastModalCard}>
          <Text style={styles.broadcastModalEyebrow}>FITUR BARU · LIVE</Text>
          <Text style={styles.broadcastModalTitle}>Pesan Siaran</Text>
          <Text style={styles.broadcastModalText}>
            Ketuk ikon mikrofon untuk mulai merekam, lalu ketuk lagi untuk berhenti dan mengirim. Rekaman berhenti otomatis setelah 7 detik.
          </Text>
          <Text style={styles.broadcastModalText}>
            Pitch dan karakter suara disamarkan di server, lalu diputar satu kali kepada pemain yang sedang terhubung di room. Siaran tidak disimpan.
          </Text>
          <Text style={styles.broadcastModalText}>
            Satu siaran gratis tersedia setiap menit. Saat jatah habis, tukar 1 badge untuk mendapatkan 7 siaran tambahan.
          </Text>
          <Pressable style={styles.broadcastModalButton} onPress={dismissBroadcastIntro}>
            <Text style={styles.broadcastModalButtonText}>MENGERTI</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const gettingStartedModal = (
    <Modal
      visible={isGettingStartedVisible && Boolean(account) && !room && !isScannerOpen}
      transparent
      animationType="fade"
      onRequestClose={dismissGettingStarted}
    >
      <View style={styles.gettingStartedBackdrop}>
        <ScrollView
          style={{ maxHeight: viewportHeight * 0.88, width: '100%' }}
          contentContainerStyle={styles.gettingStartedScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View accessibilityViewIsModal style={styles.gettingStartedCard}>
            <Image
              accessibilityLabel="Logo PETAK UMPET +62"
              source={require('./assets/logo.png')}
              resizeMode="contain"
              style={styles.gettingStartedLogo}
            />
            <Text style={styles.gettingStartedEyebrow}>PANDUAN PEMAIN BARU</Text>
            <Text style={styles.gettingStartedTitle}>Selamat datang di PETAK!</Text>
            <Text style={styles.gettingStartedDescription}>
              Ajak teman, pilih arena, lalu jalankan misi bersama.
            </Text>
            <View style={styles.gettingStartedStep}>
              <Text style={styles.gettingStartedStepNumber}>01</Text>
              <View style={styles.gettingStartedStepCopy}>
                <Text style={styles.gettingStartedStepTitle}>Buat atau gabung room</Text>
                <Text style={styles.gettingStartedStepText}>
                  Buat room untuk menjadi host, atau masukkan kode/scan QR dari teman.
                </Text>
              </View>
            </View>
            <View style={styles.gettingStartedStep}>
              <Text style={styles.gettingStartedStepNumber}>02</Text>
              <View style={styles.gettingStartedStepCopy}>
                <Text style={styles.gettingStartedStepTitle}>Aktifkan lokasi</Text>
                <Text style={styles.gettingStartedStepText}>
                  GPS membantu menjaga permainan tetap berada di dalam zona yang disepakati.
                </Text>
              </View>
            </View>
            <View style={styles.gettingStartedStep}>
              <Text style={styles.gettingStartedStepNumber}>03</Text>
              <View style={styles.gettingStartedStepCopy}>
                <Text style={styles.gettingStartedStepTitle}>Kenali role, lalu bergerak</Text>
                <Text style={styles.gettingStartedStepText}>
                  Role Anda dibuka saat persiapan. Ikuti misi dan utamakan keselamatan di area bermain.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              style={styles.gettingStartedButton}
              onPress={dismissGettingStarted}
            >
              <Text style={styles.gettingStartedButtonText}>SIAP, MULAI BERMAIN</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  const appAlertModal = (
    <Modal
      visible={appAlert !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setAppAlert(null)}
    >
      <View style={styles.appAlertBackdrop}>
        <View
          accessibilityViewIsModal
          style={styles.appAlertCard}
        >
          <View style={styles.appAlertIcon}>
            <Text style={styles.appAlertIconText}>!</Text>
          </View>
          <Text style={styles.appAlertEyebrow}>PESAN PETAK</Text>
          <Text accessibilityRole="alert" style={styles.appAlertMessage}>
            {appAlert?.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.appAlertButton}
            onPress={() => setAppAlert(null)}
          >
            <Text style={styles.appAlertButtonText}>MENGERTI</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const leaderboardModal = (
    <Modal
      visible={isLeaderboardOpen}
      animationType="slide"
      onRequestClose={() => setIsLeaderboardOpen(false)}
    >
      <SafeAreaView style={styles.leaderboardModalContainer}>
        <View style={styles.leaderboardModalHeader}>
          <View style={styles.leaderboardModalHeading}>
            <Text style={styles.leaderboardModalEyebrow}>PERFORMA PEMAIN</Text>
            <Text style={styles.leaderboardModalTitle}>Leaderboard</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tutup leaderboard"
            style={styles.leaderboardModalClose}
            onPress={() => setIsLeaderboardOpen(false)}
          >
            <Text style={styles.leaderboardModalCloseText}>×</Text>
          </Pressable>
        </View>
        <FlatList
          data={leaderboardEntries}
          keyExtractor={(entry) => `${entry.rank}-${entry.username}`}
          contentContainerStyle={styles.leaderboardModalList}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          ListHeaderComponent={
            <View>
              <View style={styles.leaderboardSummary}>
                <View style={styles.leaderboardSummaryItem}>
                  <Text style={styles.leaderboardSummaryLabel}>PERIODE</Text>
                  <Text style={styles.leaderboardSummaryValue}>
                    {leaderboardPeriod === 'daily' ? 'Hari ini · UTC' : 'Bulan ini · UTC'}
                  </Text>
                </View>
                <View style={styles.leaderboardSummaryItem}>
                  <Text style={styles.leaderboardSummaryLabel}>SYARAT</Text>
                  <Text style={styles.leaderboardSummaryValue}>
                    Minimal {leaderboardMinimumGames} game
                  </Text>
                </View>
                <View style={styles.leaderboardCriteria}>
                  <Text style={styles.leaderboardSummaryLabel}>URUTAN PERINGKAT</Text>
                  <Text style={styles.leaderboardCriteriaText}>
                    Badge saat ini → kemenangan → win rate → jumlah game
                  </Text>
                </View>
              </View>
              <View style={styles.leaderboardPeriodRow}>
                {(['daily', 'monthly'] as const).map((period) => {
                  const isSelected = leaderboardPeriod === period;
                  return (
                    <Pressable
                      key={period}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      style={[
                        styles.leaderboardPeriodButton,
                        isSelected && styles.leaderboardPeriodButtonSelected,
                      ]}
                      onPress={() => setLeaderboardPeriod(period)}
                    >
                      <Text
                        style={[
                          styles.leaderboardPeriodText,
                          isSelected && styles.leaderboardPeriodTextSelected,
                        ]}
                      >
                        {period === 'daily' ? 'Harian' : 'Bulanan'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          }
          ListEmptyComponent={
            isLeaderboardLoading ? (
              <ActivityIndicator
                color={isLightTheme ? '#42610f' : '#c3f36b'}
                style={styles.leaderboardLoading}
              />
            ) : leaderboardError ? (
              <Text style={styles.connectionOffline}>{leaderboardError}</Text>
            ) : (
              <Text style={styles.leaderboardEmpty}>
                Belum ada pemain yang menyelesaikan {leaderboardMinimumGames} game pada periode ini.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.leaderboardEntry,
                item.rank <= 3 && styles.leaderboardEntryTop,
                item.rank === 1 && styles.leaderboardEntryFirst,
              ]}
            >
              <View
                style={[
                  styles.leaderboardRank,
                  item.rank === 1 && styles.leaderboardRankFirst,
                  item.rank === 2 && styles.leaderboardRankSecond,
                  item.rank === 3 && styles.leaderboardRankThird,
                ]}
              >
                <Text style={styles.leaderboardRankText}>{item.rank}</Text>
              </View>
              <Image
                accessibilityLabel={`Avatar ${item.username}`}
                source={getProfileAvatarSource(item.avatarId)}
                resizeMode={item.avatarId === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                style={styles.leaderboardAvatar}
              />
              <View style={styles.leaderboardPlayer}>
                <Text numberOfLines={1} style={styles.leaderboardUsername}>@{item.username}</Text>
                <View style={styles.leaderboardMetaRow}>
                  <View style={styles.leaderboardBadgePill}>
                    <Text style={styles.leaderboardBadges}>✦ {item.badges} badge</Text>
                  </View>
                  <Text style={styles.leaderboardRecord}>{item.wins} menang · {item.games} game</Text>
                </View>
              </View>
              <View style={styles.leaderboardRateColumn}>
                <Text style={styles.leaderboardWinRate}>
                  {(item.winRate * 100).toFixed(1)}%
                </Text>
                <Text style={styles.leaderboardWinRateLabel}>WIN RATE</Text>
              </View>
            </View>
          )}
        />
        {Platform.OS === 'web' && account && !isCompanionVoicePanelOpen &&
        isCompanionVoicePositionLoaded ? (
          <Animated.View
            {...companionVoicePanResponder.panHandlers}
            style={[
              styles.companionVoiceDraggable,
              companionVoicePosition.getLayout(),
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Buka chat AI Companion"
              accessibilityHint="Ketuk untuk membuka; seret untuk memindahkan"
              accessibilityState={{ expanded: false }}
              style={styles.companionVoicePanelLauncher}
              onPressIn={() => {
                companionVoiceWasDraggedRef.current = false;
              }}
              onPress={() => {
                if (companionVoiceWasDraggedRef.current) return;
                const nextPosition = companionPanelPositionRef.current
                  ? clampCompanionPanelPosition(companionPanelPositionRef.current)
                  : getCompanionPanelPosition(companionVoicePositionRef.current);
                companionPanelPositionRef.current = nextPosition;
                setCompanionPanelPosition(nextPosition);
                setIsCompanionVoicePanelOpen(true);
              }}
            >
              <Text style={styles.companionVoiceLauncherIcon}>✦</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );

  const selectedProfileAvatar = PROFILE_AVATARS.find((avatar) => avatar.id === account?.avatarId)
    ?? PROFILE_AVATARS[0];
  const selectedProfileCompanion = getProfileCompanion(account?.companionId ?? DEFAULT_COMPANION_ID);
  const companionPanelMaxHeight = Math.min(
    420,
    Math.max(1, viewportHeight - insets.top - insets.bottom - 24)
  );
  const companionPanelWidth = Math.min(
    330,
    Math.max(1, viewportWidth - insets.left - insets.right - 24)
  );
  const clampCompanionPanelPosition = useCallback(
    (position: { left: number; top: number }) => {
      const minLeft = 12 + insets.left;
      const minTop = 12 + insets.top;
      return {
        left: Math.min(
          Math.max(minLeft, viewportWidth - insets.right - companionPanelWidth - 12),
          Math.max(minLeft, position.left)
        ),
        top: Math.min(
          Math.max(minTop, viewportHeight - insets.bottom - companionPanelMaxHeight - 12),
          Math.max(minTop, position.top)
        ),
      };
    },
    [
      companionPanelMaxHeight,
      companionPanelWidth,
      insets.bottom,
      insets.left,
      insets.right,
      insets.top,
      viewportHeight,
      viewportWidth,
    ]
  );
  const getCompanionPanelPosition = (voicePosition: { x: number; y: number }) => {
    const { x, y } = voicePosition;
    const top = y > companionPanelMaxHeight + 24
      ? y - companionPanelMaxHeight - 10
      : Math.min(y + 66, viewportHeight - insets.bottom - companionPanelMaxHeight - 12);
    return clampCompanionPanelPosition({ left: x, top });
  };
  const companionPanelPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gestureState) =>
          Math.hypot(gestureState.dx, gestureState.dy) > 8,
        onPanResponderGrant: () => {
          if (companionPanelPositionRef.current) {
            companionPanelDragOriginRef.current = companionPanelPositionRef.current;
          }
        },
        onPanResponderMove: (_event, gestureState) => {
          const nextPosition = clampCompanionPanelPosition({
            left: companionPanelDragOriginRef.current.left + gestureState.dx,
            top: companionPanelDragOriginRef.current.top + gestureState.dy,
          });
          companionPanelPositionRef.current = nextPosition;
          setCompanionPanelPosition(nextPosition);
        },
      }),
    [clampCompanionPanelPosition]
  );
  const renderCompanionVoiceSoundBars = () => (
    <View
      accessibilityLabel="Transkrip suara sedang diproses"
      accessibilityLiveRegion="polite"
      style={styles.companionVoiceSoundBars}
    >
      {companionVoiceSoundBars.map((bar, index) => (
        <Animated.View
          key={index}
          style={[
            styles.companionVoiceSoundBar,
            {
              height: bar.interpolate({
                inputRange: [0, 1],
                outputRange: [4, 16],
              }),
            },
          ]}
        />
      ))}
    </View>
  );

  const companionVoiceControl = (
    Platform.OS === 'web' && account ? (
      <View pointerEvents="box-none" style={styles.companionVoiceOverlay}>
        {isCompanionVoicePanelOpen && companionPanelPosition ? (
          <View
            style={[
              styles.companionVoicePanel,
              {
                left: companionPanelPosition.left,
                top: companionPanelPosition.top,
                width: companionPanelWidth,
                maxHeight: companionPanelMaxHeight,
              },
            ]}
          >
            <View
              {...companionPanelPanResponder.panHandlers}
              style={styles.companionVoicePanelHeader}
            >
              <View style={styles.companionVoicePanelHeading}>
                <Text style={styles.companionVoicePanelEyebrow}>AI COMPANION</Text>
                <Text numberOfLines={1} style={styles.companionVoicePanelTitle}>
                  {selectedProfileCompanion.name}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isCompanionVoiceEnabled
                    ? 'Tutup panel dan matikan mikrofon Companion'
                    : 'Tutup panel suara Companion'
                }
                style={styles.companionVoicePanelClose}
                onPress={closeCompanionVoicePanel}
              >
                <Text style={styles.companionVoicePanelCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.companionVoicePanelBody}
              contentContainerStyle={styles.companionVoicePanelContent}
            >
              {companionVoiceDraft || companionVoiceInterimTranscript ? (
                <View style={styles.companionVoicePanelMessage}>
                  <View style={styles.companionVoicePanelMessageHeading}>
                    <Text style={styles.companionVoicePanelLabel}>Terdengar</Text>
                    {renderCompanionVoiceSoundBars()}
                  </View>
                  <Text style={styles.companionVoicePanelText}>
                    {[companionVoiceDraft, companionVoiceInterimTranscript].filter(Boolean).join(' ')}
                  </Text>
                </View>
              ) : null}
              {companionVoiceActiveMessage ? (
                <View style={styles.companionVoicePanelMessage}>
                  <View style={styles.companionVoicePanelMessageHeading}>
                    <Text style={styles.companionVoicePanelLabel}>Sedang diproses</Text>
                    {renderCompanionVoiceSoundBars()}
                  </View>
                  <Text style={styles.companionVoicePanelText}>{companionVoiceActiveMessage}</Text>
                </View>
              ) : null}
              {companionVoiceQueuedCount > 0 ? (
                <Text style={styles.companionVoicePanelQueue}>
                  {companionVoiceQueuedCount} pesan menunggu
                </Text>
              ) : null}
              {companionChatReply ? (
                <View style={styles.companionVoicePanelReply}>
                  <Text style={styles.companionVoicePanelLabel}>{selectedProfileCompanion.name}</Text>
                  <Text style={styles.companionVoicePanelText}>{companionChatReply}</Text>
                </View>
              ) : null}
              {companionChatError ? (
                <Text accessibilityRole="alert" style={styles.companionVoicePanelError}>
                  {companionChatError}
                </Text>
              ) : null}
              <Text style={styles.companionVoicePanelHint}>
                Ucapan dikirim setelah hening 1,5 detik. Maksimal 5 pesan menunggu; mikrofon dijeda saat Companion berbicara. Audio mungkin diproses layanan browser, sedangkan hanya transkrip yang dikirim ke PETAK.
              </Text>
            </ScrollView>
            <View style={styles.companionVoicePanelMicControl}>
              <View style={styles.companionVoicePanelMicCopy}>
                <Text style={styles.companionVoicePanelMicTitle}>Mikrofon</Text>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.companionVoicePanelMicStatus,
                    isCompanionVoiceEnabled && styles.companionVoicePanelMicStatusActive,
                  ]}
                >
                  {isCompanionVoiceSpeaking
                    ? 'Companion sedang berbicara'
                    : isCompanionVoiceListening
                      ? 'Mendengarkan'
                      : isCompanionVoiceEnabled
                        ? 'Menyiapkan mikrofon...'
                        : 'Mati'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel={
                  isCompanionVoiceEnabled
                    ? 'Matikan mikrofon Companion'
                    : 'Aktifkan mikrofon Companion'
                }
                accessibilityState={{ checked: isCompanionVoiceEnabled }}
                style={[
                  styles.companionVoiceMicSwitch,
                  isCompanionVoiceEnabled && styles.companionVoiceMicSwitchEnabled,
                ]}
                onPress={toggleCompanionVoice}
              >
                <View
                  style={[
                    styles.companionVoiceMicSwitchKnob,
                    isCompanionVoiceEnabled && styles.companionVoiceMicSwitchKnobEnabled,
                  ]}
                />
              </Pressable>
            </View>
          </View>
        ) : null}
        {!isCompanionVoicePanelOpen && !isLeaderboardOpen && isCompanionVoicePositionLoaded ? (
          <Animated.View
            {...companionVoicePanResponder.panHandlers}
            style={[
              styles.companionVoiceDraggable,
              companionVoicePosition.getLayout(),
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Buka chat AI Companion ${selectedProfileCompanion.name}`}
              accessibilityHint="Ketuk untuk membuka; seret untuk memindahkan"
              accessibilityState={{ expanded: false }}
              style={styles.companionVoicePanelLauncher}
              onPressIn={() => {
                companionVoiceWasDraggedRef.current = false;
              }}
              onPress={() => {
                if (companionVoiceWasDraggedRef.current) return;
                const nextPosition = companionPanelPositionRef.current
                  ? clampCompanionPanelPosition(companionPanelPositionRef.current)
                  : getCompanionPanelPosition(companionVoicePositionRef.current);
                companionPanelPositionRef.current = nextPosition;
                setCompanionPanelPosition(nextPosition);
                setIsCompanionVoicePanelOpen(true);
              }}
            >
              <Text style={styles.companionVoiceLauncherIcon}>✦</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    ) : null
  );
  const companionVoiceModal = isLeaderboardOpen && isCompanionVoicePanelOpen ? (
    <Modal
      visible={isLeaderboardOpen && isCompanionVoicePanelOpen}
      transparent
      animationType="fade"
      onRequestClose={closeCompanionVoicePanel}
    >
      <View pointerEvents="box-none" style={styles.companionVoiceModalContainer}>
        {companionVoiceControl}
      </View>
    </Modal>
  ) : null;

  const profileModal = (
    <Modal
      visible={isProfileOpen && Boolean(account)}
      animationType="slide"
      onRequestClose={() => {
        if (isCharacterSettingsOpen) {
          closeCharacterSettings();
          return;
        }
        setIsProfileOpen(false);
      }}
    >
      <SafeAreaView
        style={[
          styles.profileModalContainer,
          isCharacterSettingsOpen && styles.profileCharacterPaletteContainer,
        ]}
      >
        <View
          style={[
            styles.leaderboardModalHeader,
            isCharacterSettingsOpen && styles.profileCharacterPaletteHeader,
          ]}
        >
          <View style={styles.leaderboardModalHeading}>
            <Text
              style={[
                styles.leaderboardModalEyebrow,
                isCharacterSettingsOpen && styles.profileCharacterPaletteEyebrow,
              ]}
            >
              {isCharacterSettingsOpen ? 'PERSONALISASI' : 'AKUN PEMAIN'}
            </Text>
            <Text
              style={[
                styles.leaderboardModalTitle,
                isCharacterSettingsOpen && styles.profileCharacterPaletteTitle,
              ]}
            >
              {isCharacterSettingsOpen ? 'Karakter' : 'Profil'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tutup profil"
            style={[
              styles.leaderboardModalClose,
              isCharacterSettingsOpen && styles.profileCharacterPaletteClose,
            ]}
            onPress={() => {
              closeCharacterSettings();
              setIsProfileOpen(false);
            }}
          >
            <Text
              style={[
                styles.leaderboardModalCloseText,
                isCharacterSettingsOpen && styles.profileCharacterPaletteCloseText,
              ]}
            >
              ×
            </Text>
          </Pressable>
        </View>
        {account ? (
          <ScrollView
            contentContainerStyle={[
              styles.profileContent,
              isCharacterSettingsOpen && styles.profileCharacterPaletteContent,
            ]}
          >
            {!isCharacterSettingsOpen ? (
              <>
                <View style={styles.profileIdentityShowcase}>
                  <View style={styles.profileIdentityCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Pilih avatar profil, saat ini ${selectedProfileAvatar.name}`}
                      style={styles.profileAvatarTapTarget}
                      onPress={() => openCharacterSettings('avatar')}
                    >
                      <Image
                        accessible={false}
                        accessibilityLabel={`Avatar profil ${account.username}`}
                        source={selectedProfileAvatar.image}
                        resizeMode={account.avatarId === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                        style={styles.profileAvatar}
                      />
                      <View pointerEvents="none" style={styles.profileAvatarEditBadge}>
                        <Text style={styles.profileAvatarEditBadgeText}>✎</Text>
                      </View>
                    </Pressable>
                    <View style={styles.profileIdentityDetails}>
                      <Text numberOfLines={1} style={styles.profileUsername}>@{account.username}</Text>
                      <Text style={styles.profileCaption}>AKUN PETAK</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Pilih AI Companion, saat ini ${selectedProfileCompanion.name}`}
                    style={styles.profileIdentityCompanionOverlay}
                    onPress={() => openCharacterSettings('companion')}
                  >
                    <Image
                      accessibilityLabel={`AI Companion ${selectedProfileCompanion.name}`}
                      source={
                        Platform.OS === 'web'
                          ? selectedProfileCompanion.animatedImage
                          : selectedProfileCompanion.image
                      }
                      resizeMode="contain"
                      style={styles.profileIdentityCompanion}
                    />
                    <View style={styles.profileIdentityCompanionTag}>
                      <Text style={styles.profileIdentityCompanionTagText}>AI</Text>
                    </View>
                    <View pointerEvents="none" style={styles.profileIdentityCompanionEditBadge}>
                      <Text style={styles.profileAvatarEditBadgeText}>✎</Text>
                    </View>
                  </Pressable>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Atur AI Companion dan karakter akun"
                  style={styles.profileCharacterSettingsButton}
                  onPress={() => openCharacterSettings()}
                >
                  <View style={styles.profileCharacterSettingsCopy}>
                    <Text style={styles.profileCharacterSettingsTitle}>Karakter & Companion</Text>
                    <Text style={styles.profileCharacterSettingsHint}>
                      {getProfileCompanion(account.companionId).name} · atur tampilan karakter
                    </Text>
                  </View>
                  <Text style={styles.profileCharacterSettingsArrow}>›</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Kembali ke profil"
                  style={[
                    styles.profileCharacterBackButton,
                    styles.profileCharacterPaletteBackButton,
                  ]}
                  onPress={closeCharacterSettings}
                >
                  <Text
                    style={[
                      styles.profileCharacterBackText,
                      styles.profileCharacterPaletteAccentText,
                    ]}
                  >
                    ‹  Kembali ke profil
                  </Text>
                </Pressable>

                <View style={styles.profileCharacterSelectionCards}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Avatar akun ${selectedProfileAvatar.name}. ${profileCharacterPicker === 'avatar' ? 'Tutup' : 'Tampilkan'} pilihan avatar.`}
                    accessibilityState={{ expanded: profileCharacterPicker === 'avatar' }}
                    style={[
                      styles.profileCharacterSelectionCard,
                      styles.profileCharacterPaletteCard,
                      profileCharacterPicker === 'avatar' && styles.profileCharacterSelectionCardOpen,
                      profileCharacterPicker === 'avatar' && styles.profileCharacterPaletteCardOpen,
                    ]}
                    onPress={() => setProfileCharacterPicker((current) => current === 'avatar' ? null : 'avatar')}
                  >
                    <Image
                      source={selectedProfileAvatar.image}
                      resizeMode={selectedProfileAvatar.id === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                      style={styles.profileCharacterSelectionAvatar}
                    />
                    <View style={styles.profileCharacterSelectionCopy}>
                      <Text
                        style={[
                          styles.profileCharacterSelectionEyebrow,
                          styles.profileCharacterPaletteEyebrow,
                        ]}
                      >
                        AVATAR AKUN
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.profileCharacterSelectionName,
                          styles.profileCharacterPaletteText,
                        ]}
                      >
                        {selectedProfileAvatar.name}
                      </Text>
                      <Text
                        style={[
                          styles.profileCharacterSelectionAction,
                          styles.profileCharacterPaletteMuted,
                        ]}
                      >
                        {profileCharacterPicker === 'avatar' ? 'Tutup pilihan' : 'Lihat pilihan'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.profileCharacterSelectionArrow,
                        styles.profileCharacterPaletteAccentText,
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`AI Companion ${selectedProfileCompanion.name}. ${profileCharacterPicker === 'companion' ? 'Tutup' : 'Tampilkan'} pilihan Companion.`}
                    accessibilityState={{ expanded: profileCharacterPicker === 'companion' }}
                    style={[
                      styles.profileCharacterSelectionCard,
                      styles.profileCharacterPaletteCard,
                      profileCharacterPicker === 'companion' && styles.profileCharacterSelectionCardOpen,
                      profileCharacterPicker === 'companion' && styles.profileCharacterPaletteCardOpen,
                    ]}
                    onPress={() => setProfileCharacterPicker((current) => current === 'companion' ? null : 'companion')}
                  >
                    <Image
                      source={
                        Platform.OS === 'web'
                          ? selectedProfileCompanion.animatedImage
                          : selectedProfileCompanion.image
                      }
                      resizeMode="contain"
                      style={styles.profileCharacterSelectionCompanion}
                    />
                    <View style={styles.profileCharacterSelectionCopy}>
                      <Text
                        style={[
                          styles.profileCharacterSelectionEyebrow,
                          styles.profileCharacterPaletteEyebrow,
                        ]}
                      >
                        AI COMPANION
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.profileCharacterSelectionName,
                          styles.profileCharacterPaletteText,
                        ]}
                      >
                        {selectedProfileCompanion.name}
                      </Text>
                      <Text
                        style={[
                          styles.profileCharacterSelectionAction,
                          styles.profileCharacterPaletteMuted,
                        ]}
                      >
                        {profileCharacterPicker === 'companion' ? 'Tutup pilihan' : 'Lihat pilihan'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.profileCharacterSelectionArrow,
                        styles.profileCharacterPaletteAccentText,
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>
                </View>

                {profileCharacterPicker === null ? (
                  <Text
                    style={[
                      styles.profileCharacterChooserHint,
                      styles.profileCharacterPaletteMuted,
                    ]}
                  >
                    Ketuk avatar atau Companion untuk membuka pilihan.
                  </Text>
                ) : null}

                {profileCharacterPicker === 'companion' ? (
                  <>
                    <View style={styles.profileSectionHeader}>
                      <Text
                        style={[
                          styles.profileSectionTitle,
                          styles.profileCharacterPaletteText,
                        ]}
                      >
                        AI Companion
                      </Text>
                      <Text
                        style={[
                          styles.profileSectionMeta,
                          styles.profileCharacterPaletteMuted,
                        ]}
                      >
                        PILIHAN PEMAIN
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.profileCompanionHint,
                        styles.profileCharacterPaletteMuted,
                      ]}
                    >
                      Pilih teman petualanganmu. Untuk saat ini, Companion hanya menjadi identitas visual; fitur AI belum aktif.
                    </Text>
                    <View style={styles.profileCompanionGrid}>
                      {PROFILE_COMPANIONS.map((companion) => {
                        const isSelected = account.companionId === companion.id;
                        return (
                          <Pressable
                            key={companion.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Pilih AI Companion ${companion.name}`}
                            accessibilityState={{ selected: isSelected, disabled: isSavingCompanion }}
                            disabled={isSavingCompanion}
                            style={[
                              styles.profileCompanionChoice,
                              styles.profileCharacterPaletteChoice,
                              isSelected && styles.profileCompanionChoiceSelected,
                              isSelected && styles.profileCharacterPaletteChoiceSelected,
                              isSavingCompanion && styles.disabledButton,
                            ]}
                            onPress={() => {
                              if (isSelected) {
                                setProfileCharacterPicker(null);
                                return;
                              }
                              void saveProfileCompanion(companion.id);
                            }}
                          >
                            <Image
                              accessibilityLabel={`Karakter Companion ${companion.name}`}
                              source={companion.image}
                              resizeMode="contain"
                              style={styles.profileCompanionImage}
                            />
                            <Text
                              style={[
                                styles.profileCompanionName,
                                styles.profileCharacterPaletteText,
                              ]}
                            >
                              {companion.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                      <View
                        accessible
                        accessibilityRole="text"
                        accessibilityLabel="BUDI, bot sistem PETAK. Tidak dapat dipilih sebagai Companion."
                        style={[
                          styles.profileCompanionChoice,
                          styles.profileCharacterPaletteChoice,
                          styles.profileSystemCompanionChoice,
                        ]}
                      >
                        <Image
                          accessible={false}
                          source={require('./assets/companions/v2/budi.webp')}
                          resizeMode="contain"
                          style={styles.profileCompanionImage}
                        />
                        <Text
                          style={[
                            styles.profileCompanionName,
                            styles.profileCharacterPaletteText,
                          ]}
                        >
                          BUDI
                        </Text>
                        <Text style={styles.profileSystemCompanionBadge}>BOT SISTEM</Text>
                      </View>
                    </View>
                    <View style={styles.profileSystemCompanionNotice}>
                      <Text style={styles.profileSystemCompanionNoticeTitle}>PERHATIAN · BUDI BUKAN PILIHAN</Text>
                      <Text style={styles.profileSystemCompanionNoticeText}>
                        BUDI adalah bot sistem yang menggantikan pemain setelah batas reconnect terlewati. BUDI tidak bisa dipilih sebagai Companion akun.
                      </Text>
                    </View>
                    {isSavingCompanion ? (
                      <View style={styles.profileAvatarStatus}>
                        <ActivityIndicator color="#c3f36b" size="small" />
                        <Text
                          style={[
                            styles.profileAvatarStatusText,
                            styles.profileCharacterPaletteAccentText,
                          ]}
                        >
                          Menyimpan Companion...
                        </Text>
                      </View>
                    ) : profileCompanionError ? (
                      <Text accessibilityRole="alert" style={styles.profileCompanionError}>
                        {profileCompanionError}
                      </Text>
                    ) : null}
                  </>
                ) : null}

                {profileCharacterPicker === 'avatar' ? (
                  <>
                    <View style={styles.profileSectionHeader}>
                      <Text
                        style={[
                          styles.profileSectionTitle,
                          styles.profileCharacterPaletteText,
                        ]}
                      >
                        Karakter akun
                      </Text>
                      <Text
                        style={[
                          styles.profileSectionMeta,
                          styles.profileCharacterPaletteMuted,
                        ]}
                      >
                        SEMUA IDENTITAS
                      </Text>
                    </View>
                    <View style={styles.profileAvatarChoiceGrid}>
                      {PROFILE_AVATARS.map((avatar) => {
                        const isSelected = account.avatarId === avatar.id;
                        const unlock = account.avatarUnlocks?.[avatar.id];
                        const isLocked = Boolean(unlock && !unlock.unlocked);
                        const requiredRole = unlock?.role
                          ? { HIDER: 'Hider', SEEKER: 'Seeker', IMPOSTOR: 'Impostor' }[unlock.role]
                          : '';
                        return (
                          <Pressable
                            key={avatar.id}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isLocked && unlock
                                ? `${avatar.name}, terkunci. ${requiredRole}: ${unlock.currentWins} dari ${unlock.requiredWins} kemenangan dan ${unlock.currentMissions} dari ${unlock.requiredMissions} misi.`
                                : `Pilih karakter ${avatar.name}, ${avatar.label}`
                            }
                            accessibilityState={{ selected: isSelected, disabled: isSavingAvatar || isLocked }}
                            disabled={isSavingAvatar || isLocked}
                            style={[
                              styles.profileAvatarChoice,
                              styles.profileCharacterPaletteChoice,
                              isSelected && styles.profileAvatarChoiceSelected,
                              isSelected && styles.profileCharacterPaletteChoiceSelected,
                              isLocked && styles.profileAvatarChoiceLocked,
                              isSavingAvatar && styles.disabledButton,
                            ]}
                            onPress={() => {
                              if (isSelected) {
                                setProfileCharacterPicker(null);
                                return;
                              }
                              void saveProfileAvatar(avatar.id);
                            }}
                          >
                            <Image
                              source={avatar.image}
                              resizeMode={avatar.id === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                              style={[
                                styles.profileAvatarChoiceImage,
                                styles.profileCharacterPaletteChoiceImage,
                              ]}
                            />
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.profileAvatarChoiceLabel,
                                styles.profileCharacterPaletteText,
                              ]}
                            >
                              {avatar.name}
                            </Text>
                            {isLocked && unlock ? (
                              <Text
                                style={[
                                  styles.profileAvatarChoiceProgress,
                                  styles.profileCharacterPaletteMuted,
                                ]}
                              >
                                {requiredRole}: {unlock.currentWins}/{unlock.requiredWins} menang · {unlock.currentMissions}/{unlock.requiredMissions} misi
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                    {isSavingAvatar ? (
                      <View style={styles.profileAvatarStatus}>
                        <ActivityIndicator color="#c3f36b" size="small" />
                        <Text
                          style={[
                            styles.profileAvatarStatusText,
                            styles.profileCharacterPaletteAccentText,
                          ]}
                        >
                          Menyimpan karakter...
                        </Text>
                      </View>
                    ) : profileAvatarError ? (
                      <Text accessibilityRole="alert" style={styles.profileAvatarError}>
                        {profileAvatarError}
                      </Text>
                    ) : (
                      <Text
                        style={[
                          styles.profileAvatarHint,
                          styles.profileCharacterPaletteMuted,
                        ]}
                      >
                        Kemenangan dihitung total per akun; misi dihitung khusus role karakter dan dapat dikumpulkan lintas ronde. Badge tidak dikonsumsi. Karakter terpilih digunakan di profil, lobby, leaderboard, dan hasil pertandingan.
                      </Text>
                    )}
                  </>
                ) : null}
              </>
            )}

            {!isCharacterSettingsOpen ? (
              <>
            <View style={styles.profileSectionHeader}>
              <Text style={styles.profileSectionTitle}>AI Companion</Text>
              <Text style={styles.profileSectionMeta}>PRIVASI DATA</Text>
            </View>
            <View style={styles.profileCompanionPrivacyCard}>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Izinkan Companion menggunakan statistik permainan"
                accessibilityState={{
                  checked: account.companionStatsEnabled,
                  disabled: isSavingCompanionPrivacy,
                }}
                disabled={isSavingCompanionPrivacy}
                style={styles.profileCompanionPrivacyToggle}
                onPress={() => void saveCompanionStatsConsent(!account.companionStatsEnabled)}
              >
                <View style={styles.profileCompanionPrivacyCopy}>
                  <Text style={styles.profileCompanionPrivacyTitle}>Statistik permainan</Text>
                  <Text style={styles.profileCompanionPrivacyHint}>
                    Izinkan {selectedProfileCompanion.name} mengakses ringkasan statistik akun ini.
                  </Text>
                </View>
                {isSavingCompanionPrivacy ? (
                  <ActivityIndicator
                    color={isLightTheme ? '#42610f' : '#c3f36b'}
                    size="small"
                  />
                ) : (
                  <Text
                    style={[
                      styles.profileCompanionPrivacyState,
                      account.companionStatsEnabled && styles.profileCompanionPrivacyStateEnabled,
                    ]}
                  >
                    {account.companionStatsEnabled ? 'AKTIF' : 'MATI'}
                  </Text>
                )}
              </Pressable>
              <Text style={styles.profileCompanionPrivacyDisclosure}>
                Jika diizinkan, yang disertakan hanya jumlah permainan, kemenangan, dan misi selesai per role. Lokasi GPS, jejak pergerakan, dan informasi pemain lain tidak disertakan. Izin dapat dicabut kapan saja. Pesan chat dan statistik yang diizinkan diproses backend melalui server Ollama yang dikonfigurasi untuk layanan ini.
              </Text>
              {companionPrivacyError ? (
                <Text accessibilityRole="alert" style={styles.profileCompanionPrivacyError}>
                  {companionPrivacyError}
                </Text>
              ) : null}
              {account.companionStatsEnabled ? (
                <View style={styles.profileCompanionStats}>
                  <Text style={styles.profileCompanionStatsTitle}>Ringkasan yang diizinkan</Text>
                  {isLoadingCompanionStats ? (
                    <ActivityIndicator
                      color={isLightTheme ? '#42610f' : '#c3f36b'}
                      size="small"
                    />
                  ) : companionStatsError ? (
                    <Text accessibilityRole="alert" style={styles.profileCompanionPrivacyError}>
                      {companionStatsError}
                    </Text>
                  ) : companionStats ? (
                    <View style={styles.profileCompanionStatsGrid}>
                      <View style={styles.profileCompanionStatsItem}>
                        <Text style={styles.profileCompanionStatsValue}>{companionStats.games}</Text>
                        <Text style={styles.profileCompanionStatsLabel}>Permainan</Text>
                      </View>
                      <View style={styles.profileCompanionStatsItem}>
                        <Text style={styles.profileCompanionStatsValue}>{companionStats.wins}</Text>
                        <Text style={styles.profileCompanionStatsLabel}>Menang</Text>
                      </View>
                      {([
                        ['hider', 'Hider'],
                        ['seeker', 'Seeker'],
                        ['impostor', 'Impostor'],
                      ] as const).map(([role, label]) => (
                        <View key={role} style={styles.profileCompanionStatsItem}>
                          <Text style={styles.profileCompanionStatsValue}>
                            {companionStats.missionsByRole[role]}
                          </Text>
                          <Text style={styles.profileCompanionStatsLabel}>
                            Misi {label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
            <View style={styles.profileSectionHeader}>
              <Text style={styles.profileSectionTitle}>Tampilan</Text>
              <Text style={styles.profileSectionMeta}>PREFERENSI PERANGKAT</Text>
            </View>
            {renderThemePreferenceControl()}

            <View style={styles.profileSectionHeader}>
              <Text style={styles.profileSectionTitle}>Suara peringatan</Text>
              <Text style={styles.profileSectionMeta}>TEXT-TO-SPEECH</Text>
            </View>
            <Text style={styles.profileSpeechHint}>
              Pilih suara bahasa Indonesia yang tersedia di perangkat. Istilah game berbahasa Inggris memakai suara Inggris bila tersedia; jika tidak, digunakan pelafalan pendekatan. Preferensi suara Indonesia disimpan per akun di perangkat ini.
            </Text>
            {isSpeechVoiceLoading ? (
              <View style={styles.profileSpeechLoading}>
                <ActivityIndicator
                  color={isLightTheme ? '#42610f' : '#c3f36b'}
                  size="small"
                />
                <Text style={styles.profileSpeechHint}>Memuat suara perangkat...</Text>
              </View>
            ) : (
              <View style={styles.profileSpeechOptions}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selectedSpeechVoiceId === null,
                    disabled: isSpeechVoiceSaving,
                  }}
                  disabled={isSpeechVoiceSaving}
                  style={[
                    styles.profileSpeechOption,
                    selectedSpeechVoiceId === null && styles.profileSpeechOptionSelected,
                    isSpeechVoiceSaving && styles.disabledButton,
                  ]}
                  onPress={() => void selectSpeechVoice(null)}
                >
                  <View style={styles.profileSpeechRadio}>
                    {selectedSpeechVoiceId === null ? <View style={styles.profileSpeechRadioSelected} /> : null}
                  </View>
                  <View style={styles.profileSpeechVoiceCopy}>
                    <Text style={styles.profileSpeechVoiceName}>Suara sistem (default)</Text>
                    <Text style={styles.profileSpeechVoiceLanguage}>Mengikuti pilihan perangkat</Text>
                  </View>
                </Pressable>
                {availableSpeechVoices.map((voice) => {
                  const isSelected = selectedSpeechVoiceId === voice.identifier;
                  return (
                    <Pressable
                      key={voice.identifier}
                      accessibilityRole="radio"
                      accessibilityLabel={`${voice.name}, ${voice.language}`}
                      accessibilityState={{ checked: isSelected, disabled: isSpeechVoiceSaving }}
                      disabled={isSpeechVoiceSaving}
                      style={[
                        styles.profileSpeechOption,
                        isSelected && styles.profileSpeechOptionSelected,
                        isSpeechVoiceSaving && styles.disabledButton,
                      ]}
                      onPress={() => void selectSpeechVoice(voice.identifier)}
                    >
                      <View style={styles.profileSpeechRadio}>
                        {isSelected ? <View style={styles.profileSpeechRadioSelected} /> : null}
                      </View>
                      <View style={styles.profileSpeechVoiceCopy}>
                        <Text numberOfLines={1} style={styles.profileSpeechVoiceName}>{voice.name}</Text>
                        <Text style={styles.profileSpeechVoiceLanguage}>{voice.language}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {!isSpeechVoiceLoading && availableSpeechVoices.length === 0 ? (
              <Text style={styles.profileSpeechHint}>
                Tidak ada suara bahasa Indonesia terpisah yang ditemukan. Anda dapat mengunduhnya melalui pengaturan Teks-ke-ucapan perangkat.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSpeechVoiceLoading || isSpeechVoiceSaving || isSpeechVoicePreviewing}
              style={[
                styles.profileSpeechPreviewButton,
                (isSpeechVoiceLoading || isSpeechVoiceSaving || isSpeechVoicePreviewing) &&
                  styles.disabledButton,
              ]}
              onPress={() => void previewSpeechVoice()}
            >
              <Text style={styles.profileSpeechPreviewText}>
                {isSpeechVoicePreviewing ? 'MEMUTAR CONTOH...' : 'DENGARKAN CONTOH'}
              </Text>
            </Pressable>
            {isSpeechVoiceSaving ? (
              <View style={styles.profileSpeechLoading}>
                <ActivityIndicator
                  color={isLightTheme ? '#42610f' : '#c3f36b'}
                  size="small"
                />
                <Text style={styles.profileSpeechHint}>Menyimpan preferensi suara...</Text>
              </View>
            ) : null}
            {speechVoiceError ? (
              <Text accessibilityRole="alert" style={styles.profileSpeechError}>
                {speechVoiceError}
              </Text>
            ) : null}

            <View style={styles.profileSectionHeader}>
              <Text style={styles.profileSectionTitle}>Saldo & hadiah</Text>
              <Text style={styles.profileSectionMeta}>3 ITEM</Text>
            </View>
            <View style={styles.profileBalanceGrid}>
              <View style={styles.profileBalanceCard}>
                <Text style={styles.profileBalanceIcon}>🏅</Text>
                <Text style={[styles.profileBalanceValue, styles.profileBadgeValue]}>
                  {account.badges}
                </Text>
                <Text style={styles.profileBalanceLabel}>Badge</Text>
              </View>
              <View style={styles.profileBalanceCard}>
                <Text style={styles.profileBalanceIcon}>📢</Text>
                <Text style={styles.profileBalanceValue}>{account.broadcastCredits}</Text>
                <Text style={styles.profileBalanceLabel}>Kredit siaran</Text>
              </View>
              <View style={styles.profileBalanceCard}>
                <Text style={styles.profileBalanceIcon}>📡</Text>
                <Text style={styles.profileBalanceValue}>{account.scanCredits}</Text>
                <Text style={styles.profileBalanceLabel}>Kredit scan</Text>
              </View>
            </View>
            <Text style={styles.profileHint}>
              Badge diperoleh dari kemenangan. Gunakan badge untuk menukar kredit siaran atau scan.
            </Text>

            {!room ? (
              <Pressable
                accessibilityRole="button"
                disabled={isLoggingOut}
                style={[styles.profileLogoutButton, isLoggingOut && styles.disabledButton]}
                onPress={() => void logoutAccount()}
              >
                <View style={styles.loadingButtonContent}>
                  {isLoggingOut ? <ActivityIndicator color="#fecdd3" size="small" /> : null}
                  <Text style={styles.profileLogoutText}>
                    {isLoggingOut ? 'Mengeluarkan akun...' : 'Keluar dari akun'}
                  </Text>
                </View>
              </Pressable>
            ) : null}
              </>
            ) : null}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );

  const gameTimelineModal = (
    <Modal
      visible={isGameTimelineOpen}
      animationType="slide"
      onRequestClose={() => setIsGameTimelineOpen(false)}
    >
      <SafeAreaView style={styles.gameTimelinePage}>
        <View style={styles.leaderboardModalHeader}>
          <View style={styles.leaderboardModalHeading}>
            <Text style={styles.leaderboardModalEyebrow}>
              {room ? `ROOM ${room.code} · RIWAYAT` : 'RIWAYAT PERTANDINGAN'}
            </Text>
            <Text style={styles.leaderboardModalTitle}>Linimasa operasi</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kembali ke hasil pertandingan"
            style={styles.leaderboardModalClose}
            onPress={() => setIsGameTimelineOpen(false)}
          >
            <Text style={styles.leaderboardModalCloseText}>×</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.gameTimelinePageContent}>
          <GameTimeline
            eventLog={room?.eventLog ?? []}
            showHeader={false}
            isLightTheme={isLightTheme}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const proximityCaughtModal = (
    <Modal
      visible={isProximityCaughtModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setIsProximityCaughtModalVisible(false)}
    >
      <View style={styles.proximityOutcomeBackdrop}>
        <View style={styles.proximityOutcomeCard}>
          <Animated.Text
            accessibilityLabel="Efek ledakan"
            style={[
              styles.proximityExplosion,
              {
                opacity: proximityExplosionOpacity,
                transform: [{ scale: proximityExplosionScale }],
              },
            ]}
          >
            💥
          </Animated.Text>
          <Text style={styles.proximityOutcomeEyebrow}>
            {activePlayer?.challengeResult ? 'HASIL TANTANGAN' : 'KONTAK TERJAGA'}
          </Text>
          <Text style={styles.proximityOutcomeTitle}>
            {activePlayer?.challengeResult === 'WON'
              ? 'Tantangan dimenangkan'
              : activePlayer?.challengeResult === 'LOST'
                ? 'Tantangan berakhir'
                : 'Anda tertangkap'}
          </Text>
          <Text style={styles.proximityOutcomeText}>
            {activePlayer?.challengeResult === 'WON'
              ? activePlayer.challengeType === 'ESCAPE'
                ? 'Anda berhasil memutus kontak dan mengambil alih role Seeker. Ronde tetap berjalan.'
                : 'Anda menang dan tetap bermain. Lanjutkan misi ronde.'
              : activePlayer?.challengeResult === 'LOST'
                ? 'Anda menjadi penonton sampai ronde selesai. Pemain lain melanjutkan permainan.'
                : 'Anda tertangkap dan menjadi bagian tim Seeker. Lanjutkan permainan.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.proximityOutcomeButton}
            onPress={() => setIsProximityCaughtModalVisible(false)}
          >
            <Text style={styles.proximityOutcomeButtonText}>
              {activePlayer?.isSpectator ? 'TONTON RONDE' : 'LANJUTKAN'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const renderBroadcastControls = (
    liveAbility: {
      label: string;
      disabled: boolean;
      color: string;
      onPress: () => void;
    } | null
  ) => {
    if (!room || !account || room.phase !== 'PLAYING' || activePlayer?.isSpectator) return null;
    const cooldownSeconds = Math.ceil(
      Math.max(0, account.broadcastNextFreeAt - broadcastClock) / 1000
    );
    const hasSendQuota = cooldownSeconds === 0 || account.broadcastCredits > 0;
    const canRecord =
      connectionStatus === 'connected' &&
      hasSendQuota &&
      !isBroadcastSending &&
      !isBroadcastBuying;
    const recordingSeconds = Math.min(
      BROADCAST_MAX_DURATION_SECONDS,
      Math.max(0, (broadcastClock - broadcastStartedAtRef.current) / 1000)
    );
    const activateSkillChoice = () => {
      setIsLiveActionMenuOpen(false);
      setLiveActionGestureSelection(null);
      liveAbility?.onPress();
    };
    const activateBroadcastChoice = () => {
      setIsLiveActionMenuOpen(false);
      setLiveActionGestureSelection(null);
      if (isBroadcastRecording) {
        void finishBroadcastRecording();
      } else if (canRecord) {
        void beginBroadcastRecording();
      } else if (!hasSendQuota && account.badges > 0) {
        purchaseBroadcastCredits();
      }
    };
    const activateExchangeChoice = () => {
      if (activePlayer?.role !== 'SEEKER' || !canExchangeScanCredits) return;
      setIsLiveActionMenuOpen(false);
      setLiveActionGestureSelection(null);
      purchaseSeekerScanCredits();
    };
    liveActionHandlersRef.current = {
      skill: activateSkillChoice,
      broadcast: activateBroadcastChoice,
      exchange: activateExchangeChoice,
    };
    const menuOpensLeft =
      broadcastPositionRef.current.x > viewportWidth / 2 ||
      broadcastPositionRef.current.x + 250 > viewportWidth - 12;
    const pulseOpacity = liveActionPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.52, 0],
    });
    const pulseScale = liveActionPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.38],
    });

    return (
      <Animated.View
        style={[styles.broadcastFloatingCluster, broadcastFloatingPosition.getLayout()]}
        onLayout={({ nativeEvent: { layout } }) => {
          setBroadcastFloatingSize((current) =>
            current.width === layout.width && current.height === layout.height
              ? current
              : { width: layout.width, height: layout.height }
          );
        }}
      >
        {isLiveActionMenuOpen ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.broadcastFloatingRow,
            {
              left: menuOpensLeft ? -190 : 0,
              top: -60,
              width: viewportWidth,
              height: viewportHeight,
            },
          ]}
        >
          <Svg
            pointerEvents="none"
            width={260}
            height={176}
            viewBox="0 0 260 176"
            style={[
              styles.liveActionConnector,
              { left: 0 },
            ]}
          >
            <Path
              d={
                menuOpensLeft
                  ? 'M221 91 150 46M221 91 150 118M221 91 92 82'
                  : 'M31 91 102 46M31 91 102 118M31 91 160 82'
              }
              fill="none"
              stroke="rgba(203, 213, 225, 0.58)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={4}
            />
            {liveActionGestureSelection ? (
              <Path
                d={
                  liveActionGestureSelection === 'skill'
                    ? menuOpensLeft
                      ? 'M221 91 150 46'
                      : 'M31 91 102 46'
                    : liveActionGestureSelection === 'broadcast'
                      ? menuOpensLeft
                        ? 'M221 91 150 118'
                        : 'M31 91 102 118'
                      : menuOpensLeft
                        ? 'M221 91 92 82'
                        : 'M31 91 160 82'
                }
                fill="none"
                stroke={
                  liveActionGestureSelection === 'skill'
                    ? liveAbility?.color ?? '#94a3b8'
                    : liveActionGestureSelection === 'broadcast'
                      ? '#22d3ee'
                      : '#fbbf24'
                }
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={5}
              />
            ) : null}
          </Svg>
          {liveAbility ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={liveAbility.label}
              accessibilityHint="Ketuk untuk memakai skill, atau geser dari tombol inti ke arah pilihan ini."
              accessibilityState={{
                disabled: liveAbility.disabled,
                selected: liveActionGestureSelection === 'skill',
              }}
              disabled={liveAbility.disabled}
              style={[
                styles.liveActionMenuButton,
                {
                  left: menuOpensLeft ? 120 : 72,
                  top: 16,
                  backgroundColor: isLightTheme ? '#ffffff' : '#0f172a',
                  borderColor: liveAbility.color,
                },
                liveActionGestureSelection === 'skill' &&
                  styles.liveActionMenuButtonSelected,
                liveActionGestureSelection === 'skill' && {
                  borderColor: liveAbility.color,
                  shadowColor: liveAbility.color,
                },
                liveAbility.disabled && styles.liveActionDisabled,
              ]}
              onPress={activateSkillChoice}
            >
              <View
                style={[
                  styles.liveActionMenuIconBox,
                  { backgroundColor: liveAbility.color },
                ]}
              >
                <Svg width={25} height={25} viewBox="0 0 24 24">
                  <Path
                    d={
                      activePlayer?.role === 'SEEKER'
                        ? 'M12 12 19 5m-3 0h3v3M5.6 5.6a9 9 0 1 0 12.8 0M12 3v2m-9 7h2m14 0h2'
                        : activePlayer?.role === 'HIDER'
                          ? 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'
                          : 'M13 2 4 14h6l-1 8 11-12h-6l1-8z'
                    }
                    fill={activePlayer?.role === 'HIDER' ? 'none' : '#08202a'}
                    stroke={activePlayer?.role === 'HIDER' ? '#08202a' : 'none'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                  />
                </Svg>
              </View>
              {activePlayer?.role === 'SEEKER' ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.liveSkillScanProgress}
                >
                  {Array.from({ length: 6 }, (_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.liveSkillScanSegment,
                        index < seekerScanCount && styles.liveSkillScanSegmentUsed,
                      ]}
                    />
                  ))}
                </View>
              ) : null}
            </Pressable>
          ) : null}
          {activePlayer?.role === 'SEEKER' && canExchangeScanCredits ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tukar 1 badge menjadi 3 scan"
              accessibilityHint="Tukar satu badge untuk mendapatkan tiga kredit scan."
              accessibilityState={{
                disabled: isBuyingScanCredits,
                selected: liveActionGestureSelection === 'exchange',
              }}
              disabled={isBuyingScanCredits}
              style={[
                styles.liveActionMenuButton,
                {
                  left: menuOpensLeft ? 62 : 130,
                  top: 52,
                  backgroundColor: isLightTheme ? '#fef3c7' : '#422006',
                  borderColor: '#fbbf24',
                },
                liveActionGestureSelection === 'exchange' &&
                  styles.liveActionMenuButtonSelected,
                isBuyingScanCredits && styles.liveActionDisabled,
              ]}
              onPress={activateExchangeChoice}
            >
              {isBuyingScanCredits ? (
                <ActivityIndicator
                  color={isLightTheme ? '#92400e' : '#fbbf24'}
                  size="small"
                />
              ) : (
                <Svg width={25} height={25} viewBox="0 0 24 24">
                  <Path
                    d="M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3"
                    fill="none"
                    stroke={isLightTheme ? '#92400e' : '#fde68a'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </Svg>
              )}
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.liveSkillExchangeBadge}
              >
                <View style={styles.liveSkillExchangeDot} />
                <View style={styles.liveSkillExchangeDot} />
                <View style={styles.liveSkillExchangeDot} />
              </View>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isBroadcastStarting
                ? 'Mengaktifkan mikrofon'
                : isBroadcastRecording
                  ? 'Ketuk untuk berhenti dan mengirim siaran'
                  : isBroadcastSending
                    ? 'Mengirim pesan siaran'
                    : 'Ketuk untuk mulai merekam pesan siaran'
            }
            accessibilityHint={
              isBroadcastRecording
                ? 'Ketuk lagi untuk berhenti dan mengirim. Rekaman berhenti otomatis setelah 7 detik.'
                : cooldownSeconds === 0
                  ? 'Ketuk untuk mulai merekam. Jatah siaran gratis tersedia.'
                  : account.broadcastCredits > 0
                    ? `Ketuk untuk mulai merekam. ${account.broadcastCredits} kredit siaran tersedia.`
                    : 'Jatah gratis sedang cooldown dan tidak ada kredit siaran.'
            }
            accessibilityState={{
              disabled: isBroadcastStarting || (!canRecord && !isBroadcastRecording),
            }}
            disabled={isBroadcastStarting || (!canRecord && !isBroadcastRecording)}
            style={[
              styles.broadcastMicButton,
              styles.liveActionMenuButton,
              {
                left: menuOpensLeft ? 120 : 72,
                top: 88,
                backgroundColor: isLightTheme ? '#ffffff' : '#0f172a',
                borderColor: isBroadcastRecording ? '#f87171' : '#22d3ee',
              },
              isBroadcastRecording && styles.broadcastRecordingButton,
              isBroadcastStarting && styles.broadcastStartingButton,
              (!canRecord && !isBroadcastRecording) && styles.disabledButton,
              liveActionGestureSelection === 'broadcast' &&
                styles.liveActionMenuButtonSelected,
            ]}
            onPressIn={() => {
              broadcastDragOccurredRef.current = false;
            }}
            onPress={() => {
              if (broadcastDragOccurredRef.current) return;
              broadcastDragOccurredRef.current = false;
              setIsLiveActionMenuOpen(false);
              if (isBroadcastRecording) {
                void finishBroadcastRecording();
              } else {
                void beginBroadcastRecording();
              }
            }}
          >
            <View
              style={[
                styles.liveActionMenuIconBox,
                {
                  backgroundColor: isBroadcastRecording
                    ? '#7f1d1d'
                    : isLightTheme
                      ? '#f1f8df'
                      : '#26351d',
                },
              ]}
            >
              <Svg width={25} height={25} viewBox="0 0 24 24">
                <Path
                  fill={
                    isBroadcastRecording
                      ? '#fecaca'
                      : isLightTheme
                        ? '#42610f'
                        : '#c3f36b'
                  }
                  d={
                    isBroadcastRecording
                      ? 'M7 7h10v10H7z'
                      : 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 0 0-2 0 3 3 0 0 1-6 0 1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V19h-2a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-3.1a5 5 0 0 0 4-4.9Z'
                  }
                />
              </Svg>
            </View>
            {isBroadcastStarting ? (
              <View style={styles.broadcastRecordingIndicator}>
                <ActivityIndicator
                  color={isLightTheme ? '#42610f' : '#c3f36b'}
                  size="small"
                />
              </View>
            ) : isBroadcastRecording ? (
              <View style={styles.broadcastRecordingDot} />
            ) : isBroadcastSending ? (
              <View style={styles.broadcastRecordingIndicator}>
                <ActivityIndicator
                  color={isLightTheme ? '#42610f' : '#c3f36b'}
                  size="small"
                />
              </View>
            ) : (
              <>
                {cooldownSeconds === 0 ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.broadcastFreeQuotaIndicator}
                  >
                    <Svg width={12} height={12} viewBox="0 0 24 24">
                      <Path
                        fill="#052e16"
                        d="m9.2 16.2-3.4-3.4-1.4 1.4 4.8 4.8L20 8.2l-1.4-1.4z"
                      />
                    </Svg>
                  </View>
                ) : null}
                {account.broadcastCredits > 0 ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.broadcastCreditIndicator}
                  >
                    <Svg width={11} height={11} viewBox="0 0 24 24">
                      <Path fill="#fef3c7" d="M12 2 2 12l10 10 10-10L12 2Zm0 3.2 6.8 6.8-6.8 6.8L5.2 12 12 5.2Z" />
                    </Svg>
                  </View>
                ) : null}
              </>
            )}
          </Pressable>
          {!hasSendQuota ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tukar satu badge menjadi tujuh siaran"
              accessibilityHint="Ketuk untuk menukar satu badge menjadi tujuh kredit siaran."
              disabled={account.badges < 1 || isBroadcastBuying}
              style={[
                styles.broadcastExchangeButton,
                {
                  position: 'absolute',
                  left: menuOpensLeft ? 19 : 129,
                  top: 88,
                },
                styles.liveActionExchangeButton,
                (account.badges < 1 || isBroadcastBuying) && styles.disabledButton,
              ]}
              onPressIn={() => {
                broadcastDragOccurredRef.current = false;
              }}
              onPress={() => {
                if (!broadcastDragOccurredRef.current) {
                  setIsLiveActionMenuOpen(false);
                  purchaseBroadcastCredits();
                }
              }}
            >
              {isBroadcastBuying ? (
                <ActivityIndicator color="#fde68a" size="small" />
              ) : (
                <Svg width={24} height={24} viewBox="0 0 24 24">
                  <Path
                    fill="none"
                    stroke="#fde68a"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3"
                  />
                </Svg>
              )}
            </Pressable>
          ) : null}
        </View>
        ) : null}
        <Pressable
          {...broadcastPanResponder.panHandlers}
          accessibilityRole="button"
          accessibilityLabel={
            isBroadcastRecording
              ? `Siaran sedang direkam, ${recordingSeconds.toFixed(0)} detik. Ketuk untuk mengirim`
              : 'Buka menu skill dan pesan siaran'
          }
          accessibilityHint={
            isBroadcastRecording
              ? 'Ketuk untuk berhenti dan mengirim. Geser untuk memindahkan tombol.'
              : 'Ketuk untuk membuka skill dan siaran. Geser untuk memindahkan tombol; saat menu terbuka, geser ke pilihan lalu lepaskan.'
          }
          accessibilityState={{ expanded: isLiveActionMenuOpen, busy: isBroadcastRecording }}
          style={[
            styles.broadcastMicButton,
            styles.liveActionHubButton,
            {
              backgroundColor: isBroadcastRecording
                ? '#b91c1c'
                : liveAbility?.color ?? '#c3f36b',
            },
            isLiveActionMenuOpen && styles.liveActionHubButtonOpen,
          ]}
          onPressIn={() => {
            broadcastDragOccurredRef.current = false;
          }}
          onPress={() => {
            if (broadcastDragOccurredRef.current) {
              broadcastDragOccurredRef.current = false;
              return;
            }
            if (isBroadcastRecording) {
              void finishBroadcastRecording();
              return;
            }
            setIsLiveActionMenuOpen((isOpen) => !isOpen);
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.liveActionHubPulse,
              {
                borderColor: isBroadcastRecording
                  ? '#f87171'
                  : liveAbility?.color ?? '#22d3ee',
                opacity: pulseOpacity,
                transform: [{ scale: pulseScale }],
              },
            ]}
          />
          <View pointerEvents="none" style={styles.liveActionHubIconShell}>
            <Svg width={26} height={26} viewBox="0 0 24 24">
              <Path
                d={
                  isLiveActionMenuOpen
                    ? 'm6 6 12 12M18 6 6 18'
                    : isBroadcastRecording
                      ? 'M7 7h10v10H7z'
                      : 'M13 2 4 14h6l-1 8 11-12h-6l1-8z'
                }
                fill={
                  isLiveActionMenuOpen
                    ? 'none'
                    : isBroadcastRecording
                      ? '#fecaca'
                      : '#f8fafc'
                }
                stroke={isLiveActionMenuOpen ? '#f8fafc' : 'none'}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
              />
            </Svg>
            {!isBroadcastRecording && !isLiveActionMenuOpen ? (
              <View style={styles.liveActionHubMicBadge}>
                <Svg width={11} height={11} viewBox="0 0 24 24">
                  <Path
                    fill={isLightTheme ? '#42610f' : '#c3f36b'}
                    d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 0 0-2 0 3 3 0 0 1-6 0 1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V19h-2a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-3.1a5 5 0 0 0 4-4.9Z"
                  />
                </Svg>
              </View>
            ) : null}
          </View>
          {isBroadcastStarting || isBroadcastSending ? (
            <View style={styles.broadcastRecordingIndicator}>
              <ActivityIndicator color="#991b1b" size="small" />
            </View>
          ) : isBroadcastRecording ? (
            <View style={styles.broadcastRecordingDot} />
          ) : account.broadcastCredits > 0 ? (
            <View style={styles.broadcastCreditIndicator}>
              <Svg width={11} height={11} viewBox="0 0 24 24">
                <Path
                  fill="#fef3c7"
                  d="M12 2 2 12l10 10 10-10L12 2Zm0 3.2 6.8 6.8-6.8 6.8L5.2 12 12 5.2Z"
                />
              </Svg>
            </View>
          ) : cooldownSeconds === 0 ? (
            <View style={styles.broadcastFreeQuotaIndicator}>
              <Svg width={12} height={12} viewBox="0 0 24 24">
                <Path
                  fill="#052e16"
                  d="m9.2 16.2-3.4-3.4-1.4 1.4 4.8 4.8L20 8.2l-1.4-1.4z"
                />
              </Svg>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    );
  };

  const renderAuth = () => (
    <View style={styles.card}>
      <Text style={styles.cardEyebrow}>AKSES PEMAIN</Text>
      <Text style={styles.sectionTitle}>{authMode === 'login' ? 'Siap masuk arena?' : 'Buat identitas pemain'}</Text>
      <Text style={styles.mutedText}>
        Masuk untuk membuat room atau bergabung. Badge kemenangan tersimpan di akun Anda.
      </Text>
      <Text style={styles.label}>Username</Text>
      <TextInput
        value={authUsername}
        onChangeText={setAuthUsername}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={30}
        placeholder="contoh.nama_62"
        placeholderTextColor={isLightTheme ? '#64748b' : '#9db0c4'}
      />
      <Text style={styles.usernameHint}>
        3–30 karakter tanpa spasi: huruf, angka, titik, atau garis bawah.
      </Text>
      <Text style={styles.label}>Password</Text>
      <TextInput
        value={authPassword}
        onChangeText={setAuthPassword}
        style={styles.input}
        secureTextEntry
        maxLength={128}
        placeholder="Minimal 8 karakter"
        placeholderTextColor={isLightTheme ? '#64748b' : '#9db0c4'}
      />
      {authError ? <Text style={styles.connectionOffline}>{authError}</Text> : null}
      <Pressable
        disabled={isAuthenticating || !authUsername.trim() || !authPassword}
        accessibilityState={{ busy: isAuthenticating }}
        style={[styles.primaryButton, (isAuthenticating || !authUsername.trim() || !authPassword) && styles.disabledButton]}
        onPress={authenticateAccount}
      >
        <View style={styles.loadingButtonContent}>
          {isAuthenticating ? <ActivityIndicator color="#072131" size="small" /> : null}
          <Text style={styles.primaryText}>
            {isAuthenticating ? 'Memproses...' : authMode === 'login' ? 'Login' : 'Buat akun'}
          </Text>
        </View>
      </Pressable>
      <Pressable
        style={styles.secondaryButton}
        onPress={() => {
          setAuthMode((mode) => mode === 'login' ? 'register' : 'login');
          setAuthError('');
        }}
      >
        <Text style={styles.secondaryText}>
          {authMode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Login'}
        </Text>
      </Pressable>
    </View>
  );

  const lobbyDetailsModal = (
    <Modal
      visible={isLobbyDetailsOpen && room?.phase === 'LOBBY'}
      animationType="slide"
      onRequestClose={() => setIsLobbyDetailsOpen(false)}
    >
      <SafeAreaView style={styles.lobbyDetailsModalContainer}>
        <View style={styles.leaderboardModalHeader}>
          <View style={styles.leaderboardModalHeading}>
            <Text style={styles.leaderboardModalEyebrow}>PENGATURAN</Text>
            <Text style={styles.leaderboardModalTitle}>Detail room</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tutup detail room"
            style={styles.leaderboardModalClose}
            onPress={() => setIsLobbyDetailsOpen(false)}
          >
            <Text style={styles.leaderboardModalCloseText}>×</Text>
          </Pressable>
        </View>
        {room ? (
          <ScrollView contentContainerStyle={styles.lobbyDetailsContent}>
            <View style={styles.lobbySettingsHero}>
              <View pointerEvents="none" style={styles.lobbySettingsHeroGlow} />
              <View style={styles.lobbySettingsHeroHeading}>
                <View style={styles.lobbySettingsHeroCopy}>
                  <Text style={styles.lobbySettingsEyebrow}>RUANG OPERASI · AKTIF</Text>
                  <Text style={styles.lobbySettingsCode}>{room.code}</Text>
                  <Text style={styles.lobbySettingsHint}>
                    Bagikan kode atau QR ini untuk mengundang tim.
                  </Text>
                </View>
                <View style={styles.lobbySettingsStatus}>
                  <View style={styles.lobbySettingsStatusDot} />
                  <Text style={styles.lobbySettingsStatusText}>LOBBY</Text>
                </View>
              </View>
              {activePlayer?.isHost ? (
                <View style={styles.lobbySettingsQrPanel}>
                  <View style={styles.lobbySettingsQrFrame}>
                    <QRCode value={room.code} size={148} backgroundColor="#ffffff" color="#0f172a" />
                  </View>
                  <View style={styles.lobbySettingsQrCopy}>
                    <Text style={styles.lobbySettingsQrTitle}>SCAN UNTUK BERGABUNG</Text>
                    <Text style={styles.lobbySettingsQrDescription}>
                      Minta pemain membuka pemindai QR PETAK dan arahkan kamera ke kode ini.
                    </Text>
                  </View>
                </View>
              ) : null}
              {Platform.OS === 'web' ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  onPress={shareRoomInvite}
                >
                  <Text style={styles.secondaryText}>Bagikan link undangan</Text>
                </Pressable>
              ) : null}
              {__DEV__ && Platform.OS === 'android' ? (
                <View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isCheckingUwbAvailability}
                    style={styles.secondaryButton}
                    onPress={() => void checkUwbSupport()}
                  >
                    <Text style={styles.secondaryText}>
                      {isCheckingUwbAvailability ? 'Memeriksa UWB…' : 'Periksa dukungan UWB (eksperimental)'}
                    </Text>
                  </Pressable>
                  {uwbAvailabilityMessage ? (
                    <Text style={styles.lobbyDetailDescription}>{uwbAvailabilityMessage}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.lobbyDetailSection}>
              <View style={styles.lobbyDetailHeading}>
                <View>
                  <Text style={styles.lobbyDetailEyebrow}>KONFIGURASI</Text>
                  <Text style={styles.lobbyDetailTitle}>Area operasi</Text>
                </View>
                <View style={styles.lobbyDetailValueChip}>
                  <Text style={styles.lobbyDetailValueChipText}>
                    {formatPlayRadius(room.playRadiusMeters)}
                  </Text>
                </View>
              </View>
              {activePlayer?.isHost ? (
                <>
                  <Text style={styles.lobbyDetailDescription}>
                    Pilih radius permainan. Mode Acak mempertimbangkan kepadatan peta dan jumlah peserta.
                  </Text>
                  <View style={styles.radiusOptions}>
                    {PLAY_RADIUS_OPTIONS.map((option) => {
                      const isSelected = option.isRandom
                        ? room.playRadiusMode === 'RANDOM'
                        : room.playRadiusMode === 'FIXED' &&
                          room.playRadiusMeters === option.radiusMeters;
                      return (
                        <Pressable
                          key={option.label}
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: isSelected,
                            disabled: isSelectingRandomRadius || isSelected,
                          }}
                          disabled={isSelectingRandomRadius || isSelected}
                          style={[
                            styles.radiusButton,
                            isSelected && styles.radiusButtonSelected,
                            isSelectingRandomRadius && styles.disabledButton,
                          ]}
                          onPress={() =>
                            option.isRandom
                              ? setPlayRadius(undefined, true)
                              : setPlayRadius(option.radiusMeters)
                          }
                        >
                          {isSelectingRandomRadius && option.isRandom ? (
                            <ActivityIndicator color="#072131" size="small" />
                          ) : (
                            <Text
                              style={[
                                styles.radiusButtonText,
                                isSelected && styles.radiusButtonTextSelected,
                              ]}
                            >
                              {option.label}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.lobbyRangeActive}>
                    <View style={styles.lobbyRangeActiveStatus}>
                      <View style={styles.lobbyRangeActiveDot} />
                      <Text style={styles.lobbyRangeActiveLabel}>RADIUS AKTIF</Text>
                    </View>
                    <Text style={styles.lobbyRangeActiveValue}>
                      {room.playRadiusMode === 'RANDOM' ? 'DIPILIH ACAK' : 'DITETAPKAN HOST'}
                    </Text>
                  </View>
                  <Text style={styles.lobbyDetailFootnote}>
                    Jika data peta tidak tersedia, Acak menggunakan jumlah pemain saja.
                  </Text>
                </>
              ) : (
                <Text style={styles.lobbyDetailDescription}>
                  Radius ditetapkan host
                  {room.playRadiusMode === 'RANDOM' ? ' dan dipilih acak oleh server.' : '.'}
                </Text>
              )}
            </View>
            <View style={styles.lobbyBotInfo}>
              <View style={styles.lobbyBotInfoIcon}>
                <Text style={styles.lobbyBotInfoIconText}>AI</Text>
              </View>
              <View style={styles.lobbyBotInfoCopy}>
                <Text style={styles.lobbyBotInfoTitle}>KOMPOSISI OTOMATIS</Text>
                <Text style={styles.lobbyBotInfoDescription}>
                  Bot melengkapi room hingga minimal tiga peserta agar role Seeker, Hider, dan Impostor selalu tersedia.
                </Text>
              </View>
            </View>
            {lobbyRangeNotice ? (
              <Text accessibilityLiveRegion="polite" style={styles.lobbyRangeNotice}>
                {lobbyRangeNotice}
              </Text>
            ) : null}

            {activePlayer?.isHost ? (
              <Pressable
                accessibilityRole="button"
                style={styles.lobbyEmergencyButton}
                onPress={emergencyStop}
              >
                <Text style={styles.dangerText}>Hentikan sesi darurat</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );

  const renderLobby = () => {
    const players = room?.players ?? [];
    const onlinePlayers = players.filter((player) => player.connected !== false).length;
    const readyPlayers = players.filter(
      (player) => player.isReady && player.connected !== false
    ).length;
    const hasLobbyPermissions =
      lobbyPermissionStatus.location === true && lobbyPermissionStatus.microphone === true;
    const canStart =
      hasLobbyPermissions &&
      players.length >= 3 &&
      players.every((player) => player.connected !== false && player.isReady);

    return (
      <View style={styles.lobbyScreen}>
        <View style={styles.lobbyHero}>
          <View style={styles.lobbyHeroCard}>
            <View pointerEvents="none" style={styles.lobbyHeroGlow} />
            <View style={styles.lobbyHeroMain}>
              <View style={styles.lobbyHeading}>
                <Text style={styles.lobbyEyebrow}>RUANG PERSIAPAN · PETAK</Text>
                <Text style={styles.lobbyTitle}>Satukan tim.</Text>
                <Text style={styles.lobbyHeroDescription}>
                  Bot mengisi slot kosong hingga tiga peserta. Siapkan perangkat lalu mulai operasi.
                </Text>
              </View>
              <View style={styles.lobbyHeroAvatarFrame}>
                <Image
                  accessibilityLabel="Karakter akun"
                  source={getProfileAvatarSource(account?.avatarId)}
                  resizeMode={account?.avatarId === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                  style={styles.lobbyHeroAvatar}
                />
              </View>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Kesiapan tim"
              accessibilityValue={{ min: 0, max: players.length, now: readyPlayers }}
              style={styles.lobbyReadiness}
            >
              <View style={styles.lobbyReadinessHeader}>
                <View style={styles.lobbyReadinessStatus}>
                  <View style={[styles.lobbyStatusDot, canStart ? styles.lobbyStatusReady : styles.lobbyStatusWaiting]} />
                  <Text style={styles.lobbyReadinessText}>
                    {canStart ? 'OPERASI SIAP' : 'MENUNGGU TIM'}
                  </Text>
                </View>
                <Text style={styles.lobbyOnlineCount}>{readyPlayers}/{players.length} SIAP</Text>
              </View>
              <View style={styles.lobbyReadinessTrack}>
                {players.map((player) => (
                  <View
                    key={player.id}
                    style={[
                      styles.lobbyReadinessSegment,
                      player.isReady && player.connected !== false && styles.lobbyReadinessSegmentReady,
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.lobbyOnlineMeta}>{onlinePlayers} PESERTA AKTIF</Text>
            </View>
          </View>
        </View>

        <View accessibilityLiveRegion="polite" style={styles.lobbyPermissionPanel}>
          <View style={styles.lobbyPermissionHeading}>
            <Text style={styles.lobbyPermissionTitle}>CHECK PRA-MISI</Text>
            <Text style={[
              styles.lobbyPermissionSummary,
              hasLobbyPermissions && styles.lobbyPermissionGranted,
            ]}>
              {hasLobbyPermissions ? 'SISTEM SIAP' : 'IZIN DIPERLUKAN'}
            </Text>
          </View>
          <View style={styles.lobbyPermissionChecks}>
            <View style={styles.lobbyPermissionCheck}>
              <Text style={styles.lobbyPermissionCheckLabel}>GPS</Text>
              <Text style={[
                styles.lobbyPermissionCheckValue,
                lobbyPermissionStatus.location === true
                  ? styles.lobbyPermissionGranted
                  : styles.lobbyPermissionNeedsAction,
              ]}>
                {lobbyPermissionStatus.location === true ? '✓ AKTIF' : '! IZIN'}
              </Text>
            </View>
            <View style={styles.lobbyPermissionCheck}>
              <Text style={styles.lobbyPermissionCheckLabel}>MIKROFON</Text>
              <Text style={[
                styles.lobbyPermissionCheckValue,
                lobbyPermissionStatus.microphone === true
                  ? styles.lobbyPermissionGranted
                  : styles.lobbyPermissionNeedsAction,
              ]}>
                {lobbyPermissionStatus.microphone === true ? '✓ AKTIF' : '! IZIN'}
              </Text>
            </View>
          </View>
          {!hasLobbyPermissions ? (
            <Pressable
              accessibilityRole="button"
              disabled={lobbyPermissionStatus.isRequesting}
              onPress={() => void requestLobbyPermissions()}
              style={[
                styles.primaryButton,
                lobbyPermissionStatus.isRequesting && styles.disabledButton,
              ]}
            >
              <Text style={styles.primaryText}>
                {lobbyPermissionStatus.isRequesting
                  ? 'MEMINTA IZIN...'
                  : 'AKTIFKAN IZIN UNTUK SIAP'}
              </Text>
            </Pressable>
          ) : null}
          {!hasLobbyPermissions ? (
            <Text style={styles.lobbyPermissionHelp}>GPS dan mikrofon diperlukan untuk bermain.</Text>
          ) : null}
          {lobbyPermissionStatus.error ? (
            <Text style={styles.dangerText}>{lobbyPermissionStatus.error}</Text>
          ) : null}
        </View>

        <View style={styles.lobbyRoomCodeRow}>
          <View style={styles.lobbyRoomCodeCopy}>
            <Text style={styles.roomCodeLabel}>KODE OPERASI</Text>
            <Text style={styles.lobbyRoomCode}>{room?.code}</Text>
            <Text style={styles.lobbyRoomCodeHint}>Bagikan kode ini untuk mengundang tim.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tampilkan QR dan detail room"
            style={styles.lobbyDetailsButton}
            onPress={() => setIsLobbyDetailsOpen(true)}
          >
            <Text style={styles.lobbyDetailsButtonIcon}>QR</Text>
            <Text style={styles.lobbyDetailsButtonText}>UNDANG</Text>
          </Pressable>
        </View>

        <View style={styles.lobbyListHeader}>
          <View>
            <Text style={styles.lobbyListTitle}>Tim operasi</Text>
            <Text style={styles.lobbyRosterMeta}>ROSTER · {players.length} PESERTA</Text>
          </View>
          <Text style={styles.lobbyRosterOnline}>{onlinePlayers} AKTIF</Text>
        </View>
        <View style={styles.lobbyRosterCard}>
          {players.map((player) => {
            const isSelf = player.id === room?.selfPlayerId;
            const playerName = isSelf && account?.username ? account.username : player.name;
            const playerAvatarId = isSelf
              ? account?.avatarId ?? player.avatarId
              : player.avatarId;
            return (
              <View
                key={player.id}
                style={[
                  styles.playerRow,
                  player.isHost && styles.playerHostRow,
                  isSelf && styles.playerSelfRow,
                ]}
              >
                <View style={styles.playerIdentity}>
                  <View style={[styles.playerAvatarFrame, player.isHost && styles.playerHostAvatar]}>
                    <Image
                      accessibilityLabel={`Karakter ${PROFILE_AVATARS.find((avatar) => avatar.id === playerAvatarId)?.name ?? PROFILE_AVATARS[0].name}`}
                      source={getProfileAvatarSource(playerAvatarId)}
                      resizeMode={playerAvatarId === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                      style={styles.playerAvatar}
                    />
                  </View>
                  <View style={styles.playerDetails}>
                    <Text numberOfLines={1} style={styles.playerName}>@{playerName}</Text>
                    <Text
                      style={[
                        styles.playerConnection,
                        player.connected === false
                          ? styles.playerConnectionOffline
                          : player.isReady
                            ? styles.playerConnectionReady
                            : styles.playerConnectionWaiting,
                      ]}
                    >
                      {isSelf ? 'ANDA · ' : ''}
                      {player.connected === false
                        ? 'TERPUTUS'
                        : player.isReady
                          ? 'SIAP'
                          : 'MENUNGGU'}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.playerBadge, player.isHost && styles.hostBadge]}>
                  {player.isHost ? 'HOST' : 'PEMAIN'}
                </Text>
              </View>
            );
          })}
        </View>

        {room?.phase === 'LOBBY' && activePlayer ? (
          <>
            <View style={styles.lobbyReadyRangeRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: activePlayer.isReady }}
                disabled={!hasLobbyPermissions}
                style={[
                  activePlayer.isReady ? styles.secondaryButton : styles.primaryButton,
                  styles.lobbyReadyButton,
                  !hasLobbyPermissions && styles.disabledButton,
                ]}
                onPress={setPlayerReady}
              >
                <Text style={activePlayer.isReady ? styles.secondaryText : styles.primaryText}>
                  {activePlayer.isReady ? 'BATALKAN SIAP' : 'SAYA SIAP'}
                </Text>
              </Pressable>
              <View style={styles.lobbyRangeSummary}>
                <Text style={styles.lobbyRangeLabel}>
                  {room?.playRadiusMode === 'RANDOM' ? 'RANGE ACAK' : 'RANGE HOST'}
                </Text>
                <Text style={styles.lobbyRangeValue}>
                  {room ? formatPlayRadius(room.playRadiusMeters) : '-'}
                </Text>
              </View>
            </View>
            {lobbyRangeNotice ? (
              <Text accessibilityLiveRegion="polite" style={styles.lobbyRangeNotice}>
                {lobbyRangeNotice}
              </Text>
            ) : null}
          </>
        ) : null}

        {activePlayer?.isHost && room?.phase === 'LOBBY' ? (
          <>
            <Pressable
              disabled={!canStart}
              style={[styles.primaryButton, styles.lobbyStartButton, !canStart && styles.disabledButton]}
              onPress={startGame}
            >
              <Text style={styles.lobbyStartText}>
                {canStart ? 'MULAI OPERASI' : 'MENUNGGU PEMAIN SIAP'}
              </Text>
            </Pressable>
            {!canStart ? (
              <Text style={styles.lobbyHint}>
                {players.length < 3
                  ? 'Menyiapkan peserta otomatis. Room membutuhkan tiga peserta untuk memulai.'
                  : !hasLobbyPermissions
                    ? 'Aktifkan izin GPS dan mikrofon terlebih dahulu.'
                  : `Menunggu: ${players
                      .filter((player) => !player.isReady || player.connected === false)
                      .map((player) => player.name)
                      .join(', ')}`}
              </Text>
            ) : null}
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keluar dari room"
          style={styles.lobbyLeaveButton}
          onPress={leaveRoom}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24">
            <Path
              fill="none"
              stroke="#cbd5e1"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 17l5-5-5-5M15 12H3m9-9h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"
            />
          </Svg>
          <Text style={styles.lobbyLeaveButtonText}>Keluar</Text>
        </Pressable>
      </View>
    );
  };

  const renderGame = () => (
    <View
      style={[
        styles.card,
        isHiderThreatMode && {
          backgroundColor: hiderThreatTheme.card,
          borderColor: hiderThreatTheme.accent,
          borderWidth: 2,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={soundEnabled ? 'Matikan suara' : 'Aktifkan suara'}
        style={styles.soundToggle}
        onPress={() => setSoundEnabled((enabled) => !enabled)}
      >
        <Text style={styles.soundToggleText}>{soundEnabled ? 'Suara: Aktif' : 'Suara: Mati'}</Text>
      </Pressable>

      <View style={styles.topRow}>
        <Text style={styles.sectionTitle}>
          {room?.phase === 'PREPARATION'
            ? 'Persiapan'
            : room?.phase === 'FINISHED'
              ? 'Hasil permainan'
              : room?.phase === 'CANCELLED'
                ? 'Sesi dibatalkan'
                : 'Sesi permainan'}
        </Text>
        {room?.phase !== 'CANCELLED' ? (
          <View
            style={[
              styles.timerBox,
              isHiderThreatMode && {
                backgroundColor: hiderThreatTheme.banner,
                borderColor: hiderThreatTheme.accent,
                borderWidth: 1,
              },
            ]}
          >
            <Text style={styles.timerLabel}>
              {room?.phase === 'PREPARATION'
                ? 'Mulai dalam'
                : room?.phase === 'FINISHED'
                  ? 'Durasi'
                  : 'Waktu'}
            </Text>
            <Text
              style={[
                styles.timerValue,
                isHiderThreatMode && { color: hiderThreatTheme.accent },
              ]}
            >
              {room?.phase === 'PREPARATION'
                ? room.preparationTimeLeft
                : room?.phase === 'FINISHED'
                  ? formatElapsedMinutes(room.gameElapsedSeconds)
                  : room?.timeLeft}
            </Text>
          </View>
        ) : null}
      </View>

      {room?.phase === 'CANCELLED' ? (
        <View style={styles.dangerNotice}>
          <Text style={styles.dangerText}>Sesi dihentikan. Semua aksi permainan dinonaktifkan.</Text>
        </View>
      ) : null}

      {room?.phase === 'PREPARATION' ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>
            Gunakan waktu ini untuk menjauh dari titik kumpul dengan aman. Permainan dimulai setelah hitung mundur.
          </Text>
        </View>
      ) : null}

      {activePlayer?.challengeResult === 'WON' && !activePlayer.isSpectator ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>
            {activePlayer.challengeType === 'ESCAPE'
              ? 'Tantangan dimenangkan. Anda mengambil alih role Seeker dan ronde berlanjut.'
              : 'Tantangan dimenangkan. Anda tetap bermain; misi ronde berlanjut.'}
          </Text>
        </View>
      ) : null}

      {room?.phase === 'PREPARATION' || room?.phase === 'PLAYING' ? (
        <View
          style={
            activePlayer?.isSpectator
              ? styles.noticeBox
              : isLocationInside
                ? styles.locationSuccess
                : styles.locationWarning
          }
        >
          <Text
            style={
              activePlayer?.isSpectator
                ? styles.noticeText
                : isLocationInside
                  ? styles.locationSuccessText
                  : styles.locationWarningText
            }
          >
            {activePlayer?.isSpectator ? 'Mode penonton · GPS dan aksi dinonaktifkan.' : locationStatusMessage}
          </Text>
          {connectionStatus !== 'connected' && !activePlayer?.isSpectator ? (
            <Text style={styles.locationWarningText}>
              {connectionStatus === 'disconnected'
                ? 'Koneksi terputus. Sambungkan kembali untuk memverifikasi lokasi dan melanjutkan aksi.'
                : 'Mencoba menyambungkan ulang ke server permainan.'}
            </Text>
          ) : null}
          {!activePlayer?.isSpectator && room?.proximityState && activePlayer?.role !== 'HIDER' ? (
            <Text style={styles.locationWarningText}>
              Ancaman: {room.proximityState.threatLevel === 'SAFE' ? 'Aman' : room.proximityState.threatLevel === 'GREEN' ? 'Hijau' : room.proximityState.threatLevel === 'YELLOW' ? 'Kuning' : 'Merah'}
              {room.proximityState.nearestDistanceMeters !== null ? ` · ${room.proximityState.nearestDistanceMeters.toFixed(0)} m` : ''}
            </Text>
          ) : null}
          {!activePlayer?.isSpectator && locationNotice ? (
            <Text style={styles.locationWarningText}>{locationNotice}</Text>
          ) : null}
          {!activePlayer?.isSpectator && connectionStatus === 'disconnected' ? (
            <Pressable
              style={styles.locationRetryButton}
              onPress={() => socketRef.current?.connect()}
            >
              <Text style={styles.secondaryText}>Sambung ulang</Text>
            </Pressable>
          ) : !activePlayer?.isSpectator &&
            connectionStatus === 'connected' &&
            !isLocationInside ? (
            <Pressable
              style={styles.locationRetryButton}
              onPress={() => setLocationRetry((count) => count + 1)}
            >
              <Text style={styles.secondaryText}>Coba periksa GPS lagi</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {isHiderThreatMode && hiderThreatLevel !== 'SAFE' ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.proximityBanner,
            { backgroundColor: hiderThreatTheme.banner, borderColor: hiderThreatTheme.accent },
          ]}
        >
          <Text style={[styles.proximityLabel, { color: hiderThreatTheme.accent }]}>
            {hiderThreatLevel === 'GREEN'
              ? 'WASPADA'
              : hiderThreatLevel === 'YELLOW'
                ? 'BAHAYA'
                : 'KRITIS'}
          </Text>
          <Text style={[styles.proximityMessage, { color: hiderThreatTheme.bannerText }]}>
            {UNKNOWN_APPROACH_WARNING}
          </Text>
        </View>
      ) : null}

      {boundaryNotice && activePlayer?.role === 'SEEKER' ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{boundaryNotice}</Text>
        </View>
      ) : null}

      {room?.playArea && (room.phase === 'PREPARATION' || room.phase === 'PLAYING') ? (
        <View style={styles.locationPanel}>
          <Text style={styles.sectionTitle}>
            {activePlayer?.isSpectator
              ? 'Peta penonton'
              : activePlayer?.role === 'SEEKER'
                ? 'Peta seeker'
                : 'Peta zona permainan'}
          </Text>
          <Text style={styles.mutedText}>
            {activePlayer?.isSpectator
              ? 'Ronde masih berjalan. Peta menampilkan posisi dan jejak gerak pemain aktif.'
              : activePlayer?.role === 'SEEKER'
              ? 'Scan menandai lokasi pemain terdeteksi selama 15 detik; petunjuk juga muncul saat pemain melanggar batas.'
              : 'Posisi seeker disembunyikan. Badge membuka reveal singkat.'}
          </Text>
          <MapPanel
            center={room.playArea.center}
            radiusMeters={room.playArea.radiusMeters}
            points={mapPoints}
            paths={mapPaths}
          />
          <Text style={styles.mutedText}>Peta &copy; OpenStreetMap contributors</Text>
        </View>
      ) : null}

      {room?.phase === 'FINISHED' && room.winner ? (
        <View
          style={[
            styles.resultBox,
            resultTheme && {
              backgroundColor: isLightTheme ? '#ffffff' : resultTheme.background,
              borderColor: resultTheme.border,
            },
          ]}
        >
          <View style={styles.resultHeader}>
            <View>
              <Text
                style={[
                  styles.resultLabel,
                  resultTheme && {
                    color: isLightTheme ? '#166534' : resultTheme.accent,
                  },
                ]}
              >
                OPERASI SELESAI
              </Text>
              <Text style={styles.resultRoomCode}>ROOM · {room.code}</Text>
            </View>
            <View style={styles.resultStatusChip}>
              <View style={[styles.resultStatusDot, resultTheme && { backgroundColor: resultTheme.accent }]} />
              <Text style={styles.resultStatusText}>FINAL</Text>
            </View>
          </View>
          <View
            accessibilityLiveRegion="polite"
            style={styles.resultPersonalBanner}
          >
            <View style={[
              styles.resultPersonalIcon,
              activePlayer?.isSpectator
                ? styles.resultPersonalIconSpectator
                : activePlayerWon
                  ? styles.resultPersonalIconWin
                  : styles.resultPersonalIconLoss,
            ]}>
              <Text style={styles.resultPersonalIconText}>
                {activePlayer?.isSpectator ? '◉' : activePlayerWon ? '★' : '×'}
              </Text>
            </View>
            <View style={styles.resultPersonalCopy}>
              <Text style={styles.resultPersonalEyebrow}>HASIL ANDA</Text>
              <Text style={[
                styles.resultPersonalTitle,
                activePlayer?.isSpectator
                  ? styles.resultPersonalTitleSpectator
                  : activePlayerWon
                    ? styles.resultPersonalTitleWin
                    : styles.resultPersonalTitleLoss,
              ]}>
                {activePlayer?.isSpectator ? 'PENONTON' : activePlayerWon ? 'VICTORY' : 'DEFEAT'}
              </Text>
              <Text style={styles.resultPersonalDescription}>
                {activePlayer?.isSpectator
                  ? 'Tantangan Anda berakhir; Anda menyaksikan operasi sampai selesai.'
                  : activePlayerWon
                    ? 'Anda dan tim berhasil menguasai operasi.'
                    : 'Tim lawan berhasil menyelesaikan operasi kali ini.'}
              </Text>
            </View>
          </View>
          <View style={styles.resultWinnerFeature}>
            {resultRole ? (
              <View style={[
                styles.resultWinnerArtFrame,
                { borderColor: resultTheme?.accent },
              ]}>
                <Image
                  accessibilityLabel={`Ilustrasi tim ${roleLabel(resultRole)} pemenang`}
                  source={ROLE_REVEAL_AVATARS[resultRole]}
                  resizeMode="cover"
                  style={styles.resultWinnerImage}
                />
              </View>
            ) : null}
            <View style={styles.resultWinnerCopy}>
              <Text
                style={[
                  styles.resultWinnerCaption,
                  resultTheme && {
                    color: isLightTheme ? '#166534' : resultTheme.accent,
                  },
                ]}
              >
                TIM PEMENANG
              </Text>
              <Text style={styles.resultText}>{roleLabel(resultRole)}</Text>
              <Text style={styles.resultWinnerDescription}>
                Hasil akhir pertandingan telah dikonfirmasi.
              </Text>
            </View>
          </View>
          <View style={styles.resultDurationMetric}>
            <Text style={styles.resultMetricLabel}>DURASI PERTANDINGAN</Text>
            <Text style={styles.resultDurationValue}>
              {formatElapsedMinutes(room.gameElapsedSeconds)}
            </Text>
          </View>
          <View style={styles.resultMetricRow}>
            <View style={styles.resultMetric}>
              <Text style={styles.resultMetricLabel}>PEMAIN</Text>
              <Text style={styles.resultMetricValue}>{room.players.length}</Text>
            </View>
            <View style={styles.resultMetricDivider} />
            <View style={styles.resultMetric}>
              <Text style={styles.resultMetricLabel}>AREA</Text>
              <Text style={styles.resultMetricValue}>{formatPlayRadius(room.playRadiusMeters)}</Text>
            </View>
            <View style={styles.resultMetricDivider} />
            <View style={styles.resultMetric}>
              <Text style={styles.resultMetricLabel}>ROLE ANDA</Text>
              <Text style={styles.resultMetricValue}>{roleLabel(activePlayer?.role ?? null)}</Text>
            </View>
          </View>
          {activePlayer?.challengeResult ? (
            <View style={styles.resultChallengeNotice}>
              <Text style={styles.resultChallengeLabel}>HASIL TANTANGAN ANDA</Text>
              <Text style={styles.resultChallengeValue}>
                {activePlayer.challengeResult === 'WON' ? 'MENANG' : 'KALAH'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {room?.phase === 'FINISHED' ? (
        <View style={styles.resultRecapBox}>
          <View style={styles.resultRecapHeader}>
            <View>
              <Text style={styles.resultRecapEyebrow}>LAPORAN AKHIR</Text>
              <Text style={styles.resultRecapTitle}>Rekap pemain</Text>
            </View>
            <Text style={styles.resultRecapCount}>{room.players.length} PEMAIN</Text>
          </View>
          <View style={styles.resultSearchRow}>
            <TextInput
              accessibilityLabel="Cari pemain dalam rekap"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Cari nama, role, status, atau misi"
              placeholderTextColor={isLightTheme ? '#64748b' : '#7f9bb5'}
              returnKeyType="search"
              style={styles.resultSearchInput}
              value={resultPlayerSearch}
              onChangeText={setResultPlayerSearch}
            />
            {resultPlayerSearch ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hapus pencarian pemain"
                style={styles.resultSearchClear}
                onPress={() => setResultPlayerSearch('')}
              >
                <Text style={styles.resultSearchClearText}>×</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.resultSearchCount}>
            {resultPlayers.length} cocok dari {room.players.length} pemain
          </Text>
          {resultPlayers.length ? resultPlayers.map((player) => {
            const playerTheme = player.role ? ROLE_REVEAL_THEMES[player.role] : null;
            const isSelf = player.id === room.selfPlayerId;
            const isWinner = isWinningPlayer(player, resultRole);
            return (
              <View
                key={player.id}
                style={styles.resultPlayerRow}
              >
                <View style={styles.resultPlayerHeading}>
                  {player.role ? (
                    <Image
                      accessibilityLabel={`Karakter ${PROFILE_AVATARS.find((avatar) => avatar.id === player.avatarId)?.name ?? PROFILE_AVATARS[0].name}`}
                      source={getProfileAvatarSource(player.avatarId)}
                      resizeMode={player.avatarId === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                      style={styles.resultPlayerImage}
                    />
                  ) : null}
                  <View style={styles.resultPlayerIdentity}>
                    <Text numberOfLines={1} style={styles.resultPlayerName}>
                      {isSelf ? 'ANDA · ' : ''}@{player.name}
                    </Text>
                    <Text style={[styles.resultPlayerRole, playerTheme && { color: playerTheme.accent }]}>
                      {roleLabel(player.role)}
                    </Text>
                  </View>
                  <View style={[
                    styles.resultPlayerStatus,
                    player.isSpectator
                      ? styles.resultPlayerStatusFinished
                      : isWinner
                        ? styles.resultPlayerStatusWinner
                        : styles.resultPlayerStatusLoser,
                  ]}>
                    <Text style={[
                      styles.resultPlayerStatusText,
                      isWinner
                        ? styles.resultPlayerStatusWinnerText
                        : !player.isSpectator && styles.resultPlayerStatusLoserText,
                    ]}>
                      {player.isSpectator ? 'PENONTON' : isWinner ? 'MENANG' : 'KALAH'}
                    </Text>
                  </View>
                </View>
                <View style={styles.resultPlayerMeta}>
                  {player.role !== 'SEEKER' ? (
                    <Text style={styles.resultPlayerMetaText}>
                      {player.isFound ? 'DITEMUKAN' : 'TIDAK DITEMUKAN'}
                    </Text>
                  ) : null}
                  {player.challengeResult ? (
                    <Text style={styles.resultPlayerMetaText}>
                      TANTANGAN · {player.challengeResult === 'WON' ? 'MENANG' : 'KALAH'}
                    </Text>
                  ) : null}
                </View>
                {player.missions.length ? (
                  player.missions.map((mission) => (
                    <View key={mission.id} style={styles.resultMission}>
                      <View style={styles.resultMissionHeader}>
                        <Text style={styles.resultMissionLabel}>{mission.label}</Text>
                        <Text style={[
                          styles.resultMissionCount,
                          mission.progress >= mission.goal && styles.resultMissionCountComplete,
                        ]}>
                          {mission.progress}/{mission.goal}
                        </Text>
                      </View>
                      <View
                        accessibilityRole="progressbar"
                        accessibilityLabel={`${mission.label}: ${mission.progress} dari ${mission.goal}`}
                        accessibilityValue={{ min: 0, max: mission.goal, now: mission.progress }}
                        style={styles.resultMissionTrack}
                      >
                        <View
                          style={[
                            styles.resultMissionFill,
                            mission.progress >= mission.goal && styles.resultMissionFillComplete,
                            {
                              width: `${mission.goal > 0
                                ? Math.min(100, (mission.progress / mission.goal) * 100)
                                : 0}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.resultMissionStatus}>
                        {mission.progress >= mission.goal
                          ? 'OBJEKTIF TERCAPAI'
                          : 'OBJEKTIF BELUM TERCAPAI'}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.mutedText}>Tidak ada misi</Text>
                )}
              </View>
            );
          }) : (
            <Text style={styles.resultSearchEmpty}>
              {resultPlayerSearchQuery
                ? `Tidak ada pemain yang cocok dengan "${resultPlayerSearch.trim()}".`
                : 'Belum ada data pemain untuk ditampilkan.'}
            </Text>
          )}
        </View>
      ) : activePlayer?.isSpectator ? (
        <View style={styles.roleBox}>
          <Text style={styles.roleLabel}>PENONTON</Text>
          <Text style={styles.roleName}>
            {activePlayer.challengeResult === 'WON' ? 'Tantangan dimenangkan' : 'Tantangan berakhir'}
          </Text>
          <Text style={styles.roleDescription}>
            {activePlayer.challengeResult === 'LOST'
              ? 'Anda kalah dalam tantangan dan menjadi penonton sampai ronde selesai.'
              : 'Anda sedang menonton ronde yang masih berlangsung.'}
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.roleBox,
            isHiderThreatMode && {
              backgroundColor: hiderThreatTheme.banner,
              borderColor: hiderThreatTheme.accent,
              borderWidth: 1,
            },
          ]}
        >
          <Text style={[styles.roleLabel, isHiderThreatMode && { color: hiderThreatTheme.accent }]}>
            ROLE
          </Text>
          <Text style={styles.roleName}>{activePlayer?.role ?? 'Menunggu'}</Text>
          <Text style={styles.roleDescription}>{roleDescription(activePlayer?.role ?? null)}</Text>
        </View>
      )}

      {room && room.phase !== 'FINISHED' && !activePlayer?.isSpectator ? (
        <View style={styles.missionBox}>
          <Text style={styles.sectionTitle}>Misi</Text>
          {activePlayer?.role === 'IMPOSTOR' ? (
            <Text style={styles.mutedText}>
              Jatah umpan {room.impostorDecoyQuota ?? 1} kali per ronde; hanya satu marker aktif selama 30 detik. Umpan pertama menyelesaikan objektif. Hindari Seeker sejauh 15 m selama 1 menit, lalu dekati titik ungu hingga {room.impostorObjectiveRadiusMeters} m.
              Umpan berjarak minimal {room?.impostorDecoyMinimumDistanceMeters} m dari posisi Anda.
            </Text>
          ) : null}
          {activePlayer?.role === 'HIDER' ? (
            <View style={styles.locationPanel}>
              <Text style={styles.mutedText}>
                {HIDER_MOVEMENT_GUIDANCE}
              </Text>
              <Text style={styles.locationDistance}>
                {activePlayer.distanceToSeeker == null
                  ? 'Menunggu GPS peserta lain'
                  : `Peserta terdekat: sekitar ${activePlayer.distanceToSeeker.toFixed(0)} m`}
              </Text>
              <Text style={styles.sectionTitle}>Landmark untuk disurvei</Text>
              {landmarkTargetError ? (
                <>
                  <Text style={styles.mutedText}>{landmarkTargetError}</Text>
                  <Pressable style={styles.secondaryButton} onPress={requestLandmarkTargets}>
                    <Text style={styles.secondaryText}>Coba muat target lagi</Text>
                  </Pressable>
                </>
              ) : isLoadingLandmarkTargets ? (
                <Text style={styles.mutedText}>Memuat landmark OpenStreetMap...</Text>
              ) : room.landmarkTargets?.length ? (
                room.landmarkTargets.map((target) => {
                  const submission = landmarkSubmissionStatuses[target.id];
                  const isSubmitting = landmarkSubmittingId === target.id;
                  return (
                    <View key={target.id} style={styles.landmarkTargetCard}>
                      <Text style={styles.mutedText}>
                        {target.name || 'Belum bernama'} · {target.fixme}
                      </Text>
                      <TextInput
                        accessibilityLabel={`Usulan nama untuk ${target.name || 'landmark'}`}
                        editable={!submission && !isSubmitting}
                        maxLength={120}
                        onChangeText={(name) =>
                          setLandmarkSubmissionNames((current) => ({
                            ...current,
                            [target.id]: name,
                          }))
                        }
                        placeholder="Nama landmark yang benar"
                        placeholderTextColor={isLightTheme ? '#64748b' : '#9db0c4'}
                        returnKeyType="done"
                        style={styles.input}
                        value={
                          landmarkSubmissionNames[target.id] ??
                          submission?.submittedName ??
                          target.name
                        }
                      />
                      {submission ? (
                        <Text style={styles.mutedText}>
                          {submission.status === 'PENDING'
                            ? 'Usulan menunggu peninjauan komunitas.'
                            : submission.status === 'APPROVED'
                              ? 'Usulan telah disetujui komunitas.'
                              : 'Usulan ditolak komunitas.'}
                        </Text>
                      ) : null}
                      {!submission ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={isSubmitting}
                          onPress={() => submitLandmarkName(target)}
                          style={[
                            styles.secondaryButton,
                            isSubmitting && styles.disabledButton,
                          ]}
                        >
                          <Text style={styles.secondaryText}>
                            {isSubmitting ? 'MENGIRIM...' : 'KIRIM USULAN NAMA'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <Text style={styles.mutedText}>
                  {room.landmarkTargets
                    ? 'Belum ada objek OSM bertanda fixme di area ini.'
                    : 'Target landmark belum dimuat.'}
                </Text>
              )}
              {landmarkSubmissionError ? (
                <Text accessibilityLiveRegion="polite" style={styles.dangerText}>
                  {landmarkSubmissionError}
                </Text>
              ) : null}
              {landmarkSubmissionNotice ? (
                <Text accessibilityLiveRegion="polite" style={styles.mutedText}>
                  {landmarkSubmissionNotice}
                </Text>
              ) : null}
            </View>
          ) : null}
          {activePlayer?.missions.length ? (
            activePlayer.missions.map((mission) => (
              <View key={mission.id} style={styles.missionRow}>
                <Text style={styles.missionText}>{mission.label}</Text>
                <Text style={styles.missionProgress}>
                  {mission.progress}/{mission.goal}{mission.id === 'imp_evade' ? ' dtk' : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.mutedText}>Belum ada misi</Text>
          )}
        </View>
      ) : null}

      {room?.phase === 'PLAYING' && !activePlayer?.isSpectator ? (
        <View style={styles.actionGroup}>
          {!activePlayer?.isSpectator && scanNotice && activePlayer?.role !== 'SEEKER' ? (
            <Text accessibilityLiveRegion="polite" style={styles.seekerScanNotice}>
              {scanNotice}
            </Text>
          ) : null}
          {activePlayer?.role === 'SEEKER' ? (
            renderSeekerScanPanel()
          ) : null}

          {activePlayer?.role === 'HIDER' ? (
            renderSeekerRevealPanel()
          ) : null}

          {activePlayer?.role === 'IMPOSTOR' ? (
            <Pressable
              disabled={!canPlaceImpostorDecoy}
              style={[
                styles.primaryButton,
                !canPlaceImpostorDecoy && styles.disabledButton,
              ]}
              onPress={() => handleAction('impostor-decoy')}
            >
              <Text style={styles.primaryText}>{impostorDecoyButtonLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {room?.phase === 'FINISHED' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Lihat linimasa operasi, ${room.eventLog.length} aktivitas`}
          style={styles.gameTimelineNavigation}
          onPress={() => setIsGameTimelineOpen(true)}
        >
          <View style={styles.gameTimelineNavigationCopy}>
            <Text style={styles.gameTimelineNavigationEyebrow}>RIWAYAT PERTANDINGAN</Text>
            <Text style={styles.gameTimelineNavigationTitle}>Lihat linimasa operasi</Text>
          </View>
          <Text style={styles.gameTimelineNavigationCount}>{room.eventLog.length}</Text>
          <Text style={styles.gameTimelineNavigationArrow}>›</Text>
        </Pressable>
      ) : (
        <GameTimeline eventLog={room?.eventLog ?? []} isLightTheme={isLightTheme} />
      )}

      {(room?.phase === 'PREPARATION' || room?.phase === 'PLAYING') &&
      !activePlayer?.isSpectator &&
      activePlayer?.isHost ? (
        <Pressable style={styles.dangerButton} onPress={emergencyStop}>
          <Text style={styles.dangerText}>Hentikan sesi darurat</Text>
        </Pressable>
      ) : null}
      {room?.phase === 'FINISHED' ? (
        <View style={styles.resultActionRow}>
          {activePlayer?.isHost ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.resultActionButton, styles.resultRematchButton]}
              onPress={rematch}
            >
              <Text style={[styles.resultActionText, styles.resultRematchText]}>Rematch</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Keluar dari room"
            style={[styles.resultActionButton, styles.resultLeaveButton]}
            onPress={leaveRoom}
          >
            <Text style={[styles.resultActionText, styles.resultLeaveText]}>Keluar</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.secondaryButton} onPress={leaveRoom}>
          <Text style={styles.secondaryText}>Keluar dari room</Text>
        </Pressable>
      )}
    </View>
  );

  const renderLiveMapScreen = () => {
    if (!room?.playArea) return null;
    const liveRoleAccent = activePlayer?.role
      ? ROLE_REVEAL_THEMES[activePlayer.role].accent
      : '#c3f36b';
    const liveTopInset = Platform.OS === 'android' ? insets.top : 0;
    const liveBottomInset = Platform.OS === 'android' ? insets.bottom : 0;
    const liveDetailsTop = Math.max(
      liveTopInset + 90,
      Math.min(210, Math.max(190, viewportHeight * 0.28))
    );
    const liveDetailsBottom = Math.min(
      liveBottomDockHeight + liveBottomInset + 18,
      Math.max(12, viewportHeight - liveDetailsTop - 160)
    );
    const showLiveAbility =
      room.phase === 'PLAYING' &&
      !activePlayer?.isSpectator &&
      ['HIDER', 'SEEKER', 'IMPOSTOR'].includes(activePlayer?.role ?? '');
    const liveAbilityLabel =
      activePlayer?.role === 'HIDER'
        ? !isLocationInside
          ? 'GPS BELUM VALID'
          : room.seekerLocation
            ? 'REVEAL AKTIF'
            : room.seekerRevealAvailable
              ? 'REVEAL'
              : room.seekerRevealPurchaseAvailable
                ? 'TUKAR REVEAL'
                : 'REVEAL HABIS'
        : activePlayer?.role === 'SEEKER'
          ? seekerScanCount >= 6
            ? `SCAN HABIS ${seekerScanCount}/6`
            : `SCAN AREA ${seekerScanCount}/6`
          : !isLocationInside
            ? 'GPS BELUM VALID'
            : room.impostorDecoyActive
              ? 'UMPAN AKTIF'
              : impostorDecoysRemaining === 0
                ? 'UMPAN HABIS'
                : room.impostorDecoySelection
                  ? 'PASANG UMPAN'
                  : 'PILIH TITIK';
    const liveAbilityDisabled =
      activePlayer?.role === 'HIDER'
        ? !isLocationInside ||
          Boolean(room.seekerLocation) ||
          (!room.seekerRevealAvailable && !room.seekerRevealPurchaseAvailable)
        : activePlayer?.role === 'SEEKER'
          ? !canUseSeekerScan || isBuyingScanCredits
          : !canPlaceImpostorDecoy;
    const activateLiveAbility = () => {
      if (liveAbilityDisabled) return;
      if (activePlayer?.role === 'HIDER') {
        if (room.seekerRevealAvailable && !room.seekerLocation) {
          activateSeekerReveal();
        } else if (room.seekerRevealPurchaseAvailable) {
          setShowLiveSettings(false);
          setShowLiveDetails(true);
        }
      } else if (activePlayer?.role === 'SEEKER') {
        handleAction('scan');
      } else if (activePlayer?.role === 'IMPOSTOR') {
        handleAction('impostor-decoy');
      }
    };
    const seekerStatusPlayers =
      activePlayer?.role === 'SEEKER' && room.phase === 'PLAYING'
        ? [...room.players].sort(
            (first, second) =>
              Number(first.isSpectator) - Number(second.isSpectator)
          )
        : [];
    const seekerEliminatedCount = seekerStatusPlayers.filter(
      (player) => player.isSpectator
    ).length;
    const seekerActiveCount = seekerStatusPlayers.length - seekerEliminatedCount;

    return (
      <View style={styles.liveMapScreen}>
        <MapPanel
          center={room.playArea.center}
          radiusMeters={room.playArea.radiusMeters}
          points={mapPoints}
          paths={mapPaths}
          canPlacePin={canSelectImpostorDecoyPin}
          dismissPinOnInteraction={
            room.phase === 'PLAYING' &&
            !activePlayer?.isSpectator &&
            activePlayer?.role === 'SEEKER' &&
            Boolean(room.impostorLocationPin)
          }
          onMapPress={({ latitude, longitude }) => {
            if (activePlayer?.isSpectator) return;
            socketRef.current?.emit('impostor:pin:place', { latitude, longitude });
          }}
          onMapInteraction={() => {
            if (activePlayer?.isSpectator || !room.impostorLocationPin) return;
            socketRef.current?.emit('impostor:pin:dismiss', {
              pinId: room.impostorLocationPin.id,
            });
          }}
          fullScreen
        />
        <View pointerEvents="box-none" style={styles.liveMapOverlay}>
          <View
            style={[
              styles.liveTopBar,
              { top: Math.max(12, liveTopInset + 8) },
              { borderColor: isHiderThreatMode ? hiderThreatTheme.accent : `${liveRoleAccent}88` },
            ]}
          >
            <View style={[styles.livePlayerAvatarFrame, { borderColor: liveRoleAccent }]}>
              <Image
                accessibilityLabel="Karakter pemain"
                source={getProfileAvatarSource(activePlayer?.avatarId ?? account?.avatarId)}
                resizeMode={(activePlayer?.avatarId ?? account?.avatarId) === DEFAULT_PROFILE_AVATAR_ID ? 'contain' : 'cover'}
                style={styles.livePlayerAvatar}
              />
            </View>
            <View style={styles.liveRoomInfo}>
              <Text numberOfLines={1} style={styles.liveRoomTitle}>
                {activePlayer?.name || account?.username || 'Pemain'}
              </Text>
              <View style={styles.liveProfileMeta}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.liveRoleText,
                    { color: isLightTheme ? '#42610f' : liveRoleAccent },
                  ]}
                >
                  {activePlayer?.isSpectator
                    ? 'Penonton'
                    : room.phase === 'PREPARATION'
                      ? 'Persiapan'
                      : activePlayer?.role === 'SEEKER'
                        ? 'Seeker'
                        : activePlayer?.role === 'IMPOSTOR'
                          ? 'Impostor'
                          : 'Hider'}
                </Text>
                <Text numberOfLines={1} style={styles.liveRoomCode}>
                  PETAK · {room.code}
                </Text>
              </View>
              <Text
                style={[
                  styles.liveConnectionText,
                  connectionStatus === 'connected'
                    ? styles.liveConnectionOnline
                    : connectionStatus === 'disconnected'
                      ? styles.liveConnectionOffline
                      : styles.liveConnectionConnecting,
                ]}
              >
                {connectionStatus === 'connected'
                  ? '● Realtime tersambung'
                  : connectionStatus === 'disconnected'
                    ? '! Koneksi terputus'
                    : connectionStatus === 'reconnecting'
                      ? '… Mencoba sambung ulang'
                      : '… Menyambungkan'}
              </Text>
            </View>
            <View style={[styles.liveTimer, { borderColor: liveRoleAccent }]}>
              <Text style={styles.liveTimerLabel}>
                {room.phase === 'PREPARATION' ? 'MULAI' : 'SISA'}
              </Text>
              <Text
                accessibilityLabel={
                  room.phase === 'PREPARATION'
                    ? `Permainan dimulai dalam ${room.preparationTimeLeft} detik`
                    : `Sisa waktu permainan ${formatTime(room.timeLeft)}`
                }
                style={[styles.liveTimerValue, isHiderThreatMode && { color: hiderThreatTheme.accent }]}
              >
                {room.phase === 'PREPARATION'
                  ? formatTime(room.preparationTimeLeft)
                  : formatTime(room.timeLeft)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showLiveSettings ? 'Tutup pengaturan permainan' : 'Buka pengaturan permainan'}
              accessibilityState={{ expanded: showLiveSettings }}
              style={styles.liveIconButton}
              onPress={() => {
                setShowLiveDetails(false);
                setShowLiveSettings((visible) => !visible);
              }}
            >
              <Svg width={21} height={21} viewBox="0 0 24 24">
                <Path
                  d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5a8.1 8.1 0 0 0-.1-1.3l1.5-1.2-1.5-2.6-1.8.7a8.2 8.2 0 0 0-2.2-1.3L15.6 4h-3.1l-.4 2.3a8.2 8.2 0 0 0-2.2 1.3l-1.8-.7-1.5 2.6 1.5 1.2a8.1 8.1 0 0 0 0 2.6l-1.5 1.2 1.5 2.6 1.8-.7a8.2 8.2 0 0 0 2.2 1.3l.4 2.3h3.1l.4-2.3a8.2 8.2 0 0 0 2.2-1.3l1.8.7 1.5-2.6-1.5-1.2c.1-.4.1-.8.1-1.3Z"
                  fill="none"
                  stroke={isLightTheme ? '#334155' : '#f8fafc'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.7}
                />
              </Svg>
            </Pressable>
          </View>

          {showLiveSettings ? (
            <ScrollView
              style={[
                styles.liveDetailsPanel,
                {
                  top: liveDetailsTop,
                  bottom: liveDetailsBottom,
                },
              ]}
              contentContainerStyle={styles.liveDetailsContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.liveDetailsHeader}>
                <Text style={styles.liveDetailsTitle}>Pengaturan permainan</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tutup pengaturan permainan"
                  onPress={() => setShowLiveSettings(false)}
                >
                  <Text style={styles.liveDetailsClose}>Tutup</Text>
                </Pressable>
              </View>
              {renderThemePreferenceControl()}
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Suara permainan"
                accessibilityState={{ checked: soundEnabled }}
                style={styles.liveGameLogPreference}
                onPress={() => setSoundEnabled((enabled) => !enabled)}
              >
                <View style={styles.liveGameLogPreferenceCopy}>
                  <Text style={styles.liveStatText}>Suara permainan</Text>
                  <Text style={styles.liveGameLogPreferenceHint}>
                    Efek suara dan peringatan suara
                  </Text>
                </View>
                <Text style={styles.liveGameLogPreferenceAction}>
                  {soundEnabled ? 'Aktif' : 'Mati'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Log permainan"
                accessibilityState={{ checked: showLiveGameLog }}
                style={styles.liveGameLogPreference}
                onPress={() => setShowLiveGameLog((visible) => !visible)}
              >
                <View style={styles.liveGameLogPreferenceCopy}>
                  <Text style={styles.liveStatText}>Log permainan</Text>
                  <Text style={styles.liveGameLogPreferenceHint}>
                    Aktivitas sesi & ability · otomatis hilang dalam 5 detik
                  </Text>
                </View>
                <Text style={styles.liveGameLogPreferenceAction}>
                  {showLiveGameLog ? 'Sembunyikan' : 'Tampilkan'}
                </Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={leaveRoom}>
                <Text style={styles.secondaryText}>Keluar dari room</Text>
              </Pressable>
            </ScrollView>
          ) : null}

          {showLiveDetails ? (
            <ScrollView
              style={[
                styles.liveDetailsPanel,
                {
                  top: liveDetailsTop,
                  bottom: liveDetailsBottom,
                },
              ]}
              contentContainerStyle={styles.liveDetailsContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.liveDetailsHeader}>
                <Text style={styles.liveDetailsTitle}>Status permainan</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tutup statistik"
                  onPress={() => setShowLiveDetails(false)}
                >
                  <Text style={styles.liveDetailsClose}>Tutup</Text>
                </Pressable>
              </View>
              <Text style={styles.liveStatText}>Role: {roleLabel(activePlayer?.role ?? null)}</Text>
              <Text style={styles.liveStatText}>
                Zona bermain: radius {formatPlayRadius(room.playRadiusMeters)}
              </Text>
              {mapLegendItems.length ? (
                <>
                  <Text style={styles.liveDetailsTitle}>Penanda peta</Text>
                  {mapLegendItems.map((item) => (
                    <View key={`${item.color}:${item.label}`} style={styles.liveLegendRow}>
                      <View style={[styles.liveLegendDot, { backgroundColor: item.color }]} />
                      <Text style={styles.liveLegendLabel}>{item.label}</Text>
                    </View>
                  ))}
                </>
              ) : null}
              {activePlayer?.role === 'IMPOSTOR' ? (
                <Text style={styles.liveStatText}>
                  Jatah umpan {room.impostorDecoyQuota ?? 1} kali per ronde; hanya satu marker aktif selama 30 detik. Umpan pertama menyelesaikan objektif. Bertahan sejauh 15 m dari Seeker selama 1 menit, lalu capai titik ungu dalam radius {room.impostorObjectiveRadiusMeters} m.
                </Text>
              ) : null}
              {activePlayer?.role === 'HIDER' &&
              !activePlayer.isSpectator &&
              room.phase === 'PLAYING' ? (
                renderSeekerRevealPanel()
              ) : null}
              <Text style={styles.liveDetailsTitle}>Progres misi</Text>
              {activePlayer?.role === 'HIDER' ? (
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel={`Misi Hider: ${activePlayer.missions.filter((mission) => mission.progress >= mission.goal).length} dari ${activePlayer.missions.length} selesai`}
                  style={styles.liveDetailsMissionSummary}
                >
                  <View style={styles.liveDetailsMissionSummaryCopy}>
                    <Text style={styles.liveDetailsMissionSummaryTitle}>MISI HIDER</Text>
                    <Text style={styles.liveMissionHint}>
                      Objektif GPS terpisah, tidak harus berurutan. Utamakan keselamatan.
                    </Text>
                  </View>
                  <Text style={styles.liveDetailsMissionSummaryCount}>
                    {activePlayer.missions.filter((mission) => mission.progress >= mission.goal).length}
                    /{activePlayer.missions.length}
                  </Text>
                </View>
              ) : null}
              {activePlayer?.missions.map((mission) => (
                <View
                  key={mission.id}
                  style={[
                    styles.liveMissionRow,
                    activePlayer?.role === 'HIDER' && styles.liveHiderMissionRow,
                  ]}
                >
                  <View style={styles.liveMissionCopy}>
                    <Text style={styles.liveStatText}>{mission.label}</Text>
                    {activePlayer?.role === 'HIDER' ? (
                      <View style={styles.liveMissionTrack}>
                        <View
                          style={[
                            styles.liveMissionTrackFill,
                            {
                              width: `${Math.min(
                                100,
                                Math.max(0, (mission.progress / Math.max(1, mission.goal)) * 100)
                              )}%`,
                            },
                            mission.progress >= mission.goal && styles.liveMissionTrackFillComplete,
                          ]}
                        />
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.liveMissionProgress,
                      activePlayer?.role === 'HIDER' &&
                        mission.progress >= mission.goal &&
                        styles.liveMissionProgressComplete,
                    ]}
                  >
                    {mission.progress}/{mission.goal}{mission.id === 'imp_evade' ? ' dtk' : ''}
                  </Text>
                </View>
              ))}
              {room.phase === 'PLAYING' && !activePlayer?.isSpectator && activePlayer?.isHost ? (
                <Pressable style={styles.dangerButton} onPress={emergencyStop}>
                  <Text style={styles.dangerText}>Hentikan sesi darurat</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : null}

          <View
            style={[
              styles.liveBottomDock,
              { bottom: Math.max(12, liveBottomInset + 12) },
            ]}
            onLayout={({ nativeEvent: { layout } }) => {
              setLiveBottomDockHeight((height) => height === layout.height ? height : layout.height);
            }}
          >
            {!activePlayer?.isSpectator && !isLocationInside ? (
              <View style={[styles.liveLocationPill, styles.liveLocationPillWarning]}>
                <Text style={styles.liveLocationText} numberOfLines={2}>
                  {locationStatusMessage}
                </Text>
                {connectionStatus === 'disconnected' ? (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.liveRetryButton}
                    onPress={() => socketRef.current?.connect()}
                  >
                    <Text style={styles.liveRetryText}>Sambung ulang</Text>
                  </Pressable>
                ) : connectionStatus === 'connected' ? (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.liveRetryButton}
                    onPress={() => setLocationRetry((count) => count + 1)}
                  >
                    <Text style={styles.liveRetryText}>Coba lagi</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {!activePlayer?.isSpectator && locationNotice ? (
              <Text accessibilityLiveRegion="polite" style={styles.liveDockNoticeText}>
                {locationNotice}
              </Text>
            ) : null}
            {isHiderThreatMode && hiderThreatLevel !== 'SAFE' ? (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.liveThreatCard,
                  { borderColor: hiderThreatTheme.accent },
                ]}
              >
                <Text style={[styles.proximityLabel, { color: hiderThreatTheme.accent }]}>
                  {hiderThreatLevel === 'GREEN'
                    ? 'WASPADA'
                    : hiderThreatLevel === 'YELLOW'
                      ? 'BAHAYA'
                      : 'KRITIS'}
                </Text>
                <Text
                  style={[
                    styles.proximityMessage,
                    {
                      color: isLightTheme ? '#334155' : hiderThreatTheme.bannerText,
                    },
                  ]}
                >
                  Peserta terdekat bisa Seeker. Menjauh dan tetap di zona.
                </Text>
              </View>
            ) : null}
            {room.phase === 'PLAYING' && activePlayer?.role === 'IMPOSTOR' ? (
              <View style={styles.liveImpostorPinHint}>
                <Text style={styles.liveImpostorPinHintText}>
                  {room.impostorDecoySelection
                    ? 'Pin dipilih · Pasang umpan untuk mengirim'
                    : 'Pilih titik peta untuk memasang umpan'}
                </Text>
              </View>
            ) : null}
            {room.phase === 'PLAYING' &&
            activePlayer?.role === 'SEEKER' &&
            room.impostorLocationPin ? (
              <View style={styles.liveImpostorPinHint}>
                <Text style={styles.liveImpostorPinHintText}>
                  Petunjuk aktif · Geser peta untuk menghapus
                </Text>
              </View>
            ) : null}
            {boundaryNotice && activePlayer?.role === 'SEEKER' ? (
              <Text accessibilityLiveRegion="polite" style={styles.liveDockNoticeText}>
                {boundaryNotice}
              </Text>
            ) : null}
            {broadcastNotice ? (
              <Text accessibilityLiveRegion="polite" style={styles.liveDockNoticeText}>
                {broadcastNotice}
              </Text>
            ) : null}
            {!showLiveDetails && !showLiveSettings && showLiveGameLog && liveGameLogMessages.length > 0 ? (
              <View accessibilityLiveRegion="polite" style={styles.liveGameLog}>
                <View style={styles.liveGameLogHeader}>
                  <View style={styles.liveGameLogPulse} />
                  <Text style={styles.liveGameLogTitle}>AKTIVITAS</Text>
                  <View style={styles.liveGameLogHeaderSpacer} />
                  <Text style={styles.liveGameLogLive}>LIVE</Text>
                  <Text style={styles.liveGameLogCount}>{liveGameLogMessages.length}</Text>
                </View>
                <FlatList
                  inverted
                  data={liveGameLogMessages}
                  style={styles.liveGameLogList}
                  contentContainerStyle={styles.liveGameLogContent}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                  keyExtractor={(message) => message.id}
                  renderItem={({ item: message, index }) => (
                    <View
                      style={[
                        styles.liveGameLogItem,
                        index === 0 && styles.liveGameLogItemLatest,
                      ]}
                    >
                      <View
                        style={[
                          styles.liveGameLogItemDot,
                          index === 0 && styles.liveGameLogItemDotLatest,
                        ]}
                      />
                      <Text style={styles.liveGameLogText}>{message.text}</Text>
                    </View>
                  )}
                />
              </View>
            ) : null}
            {!activePlayer?.isSpectator && scanNotice ? (
              <Text accessibilityLiveRegion="polite" style={[styles.seekerScanNotice, { marginBottom: 8 }]}>
                {scanNotice}
              </Text>
            ) : null}
            {room.phase === 'PLAYING' && !activePlayer?.isSpectator && activePlayer?.role === 'HIDER' ? (
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={`Progres misi: ${activePlayer.missions.filter((mission) => mission.progress >= mission.goal).length} dari ${activePlayer.missions.length} selesai`}
                style={styles.liveHiderMissions}
              >
                <View style={styles.liveHiderProgressHeader}>
                  <Text style={styles.liveHiderMissionsTitle}>PROGRES MISI</Text>
                  <Text style={styles.liveHiderMissionProgress}>
                    {activePlayer.missions.filter((mission) => mission.progress >= mission.goal).length}
                    /{activePlayer.missions.length}
                  </Text>
                </View>
                <View style={styles.liveHiderProgressTrack}>
                  {activePlayer.missions.map((mission) => (
                    <View
                      key={mission.id}
                      style={[
                        styles.liveHiderProgressSegment,
                        mission.progress >= mission.goal && styles.liveHiderProgressSegmentComplete,
                      ]}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            {activePlayer?.isSpectator ? (
              <Text style={styles.livePreparationHint}>
                Anda kalah dalam tantangan. Pantau posisi dan jejak gerak pemain lain di peta sampai ronde selesai.
              </Text>
            ) : room.phase === 'PREPARATION' ? (
              <Text style={styles.livePreparationHint}>
                Bergerak menjauh dari titik kumpul dengan aman. Permainan dimulai setelah hitung mundur.
              </Text>
            ) : activePlayer?.role === 'IMPOSTOR' ? (
              <View style={styles.liveActionRow}>
                <Pressable
                  disabled={!canPlaceImpostorDecoy}
                  style={[
                    styles.liveActionButton,
                    styles.livePrimaryAction,
                    !canPlaceImpostorDecoy && styles.disabledButton,
                  ]}
                  onPress={() => handleAction('impostor-decoy')}
                >
                  <Text style={styles.livePrimaryActionText}>{impostorDecoyButtonLabel}</Text>
                </Pressable>
              </View>
            ) : null}
            {seekerStatusPlayers.length ? (
              <View
                accessibilityLiveRegion="polite"
                style={styles.liveSeekerStatusCard}
              >
                <Text style={[styles.liveSeekerStatusCount, styles.liveSeekerStatusActive]}>
                  Aktif {seekerActiveCount}
                </Text>
                <Text style={[styles.liveSeekerStatusCount, styles.liveSeekerStatusEliminated]}>
                  Gugur {seekerEliminatedCount}
                </Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showLiveDetails
                  ? 'Tutup statistik, misi, dan opsi'
                  : 'Buka statistik, misi, dan opsi'
              }
              accessibilityState={{ expanded: showLiveDetails }}
              style={styles.liveDetailsToggle}
              onPress={() => {
                setShowLiveSettings(false);
                setShowLiveDetails((visible) => !visible);
              }}
            >
              <Text style={styles.liveDetailsToggleText}>
                {showLiveDetails ? 'Tutup statistik' : 'Statistik & misi'}
              </Text>
              <View style={styles.liveDetailsToggleIcon}>
                <Svg width={16} height={16} viewBox="0 0 24 24">
                  <Path
                    d={showLiveDetails ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'}
                    fill="none"
                    stroke={isLightTheme ? '#334155' : '#cbd5e1'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                  />
                </Svg>
              </View>
            </Pressable>
          </View>
          {room.phase === 'PLAYING' &&
          !activePlayer?.isSpectator &&
          activePlayer?.role === 'HIDER' &&
          !showLiveDetails &&
          !showLiveSettings ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.liveHiderNearestFloating,
                {
                  bottom: liveBottomDockHeight + liveBottomInset + 20,
                },
              ]}
            >
              <View
                accessibilityLiveRegion="polite"
                style={styles.liveHiderNearestCard}
              >
                <View style={styles.liveHiderNearestIcon}>
                  <Svg width={18} height={18} viewBox="0 0 24 24">
                    <Path
                      d="M12 3v3m0 12v3M3 12h3m12 0h3m-12 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm-5.5 0a8.5 8.5 0 1 0 17 0 8.5 8.5 0 0 0-17 0Z"
                      fill="none"
                      stroke="#a7f3d0"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.7}
                    />
                  </Svg>
                </View>
                <View style={styles.liveHiderNearestCopy}>
                  <Text style={styles.liveHiderNearestLabel}>PESERTA TERDEKAT</Text>
                  <Text style={styles.liveHiderNearestDistance}>
                    {activePlayer.distanceToSeeker == null
                      ? '—'
                      : `${activePlayer.distanceToSeeker.toFixed(0)} m`}
                  </Text>
                </View>
                <View
                  style={[
                    styles.liveHiderNearestStatus,
                    activePlayer.distanceToSeeker == null &&
                      styles.liveHiderNearestStatusWaiting,
                  ]}
                >
                  <Text style={styles.liveHiderNearestStatusText}>
                    {activePlayer.distanceToSeeker == null ? 'GPS' : 'LIVE'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
          {renderBroadcastControls(
            showLiveAbility && !showLiveDetails && !showLiveSettings
              ? {
                  label: liveAbilityLabel,
                  disabled: liveAbilityDisabled,
                  color: isHiderThreatMode ? hiderThreatTheme.accent : liveRoleAccent,
                  onPress: activateLiveAbility,
                }
              : null
          )}
        </View>
      </View>
    );
  };

  if (isStartupLoading) {
    return (
      <SafeAreaView style={styles.startupLoadingScreen}>
        <StatusBar style={isLightTheme ? 'dark' : 'light'} />
        <View style={styles.startupLoadingContent}>
          <Animated.Image
            accessibilityLabel="Logo PETAK"
            source={require('./assets/logo-splash.png')}
            resizeMode="contain"
            style={[
              styles.startupLoadingLogo,
              {
                opacity: startupLogoOpacity,
                transform: [{ scale: startupLogoScale }],
              },
            ]}
          />
          <Text style={styles.startupLoadingTitle}>PETAK</Text>
          <ActivityIndicator
            color={isLightTheme ? '#42610f' : '#c3f36b'}
            size="small"
          />
          <Text style={styles.startupLoadingMessage}>Memeriksa sesi akun...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        isHiderThreatMode && {
          backgroundColor: isLightTheme ? '#f8fafc' : hiderThreatTheme.background,
        },
      ]}
    >
      <StatusBar style={isLightTheme ? 'dark' : 'light'} />
      {appAlertModal}
      {broadcastIntroModal}
      {gettingStartedModal}
      {roleRevealModal}
      {lobbyDetailsModal}
      {proximityCaughtModal}
      {leaderboardModal}
      {companionVoiceModal}
      {profileModal}
      {gameTimelineModal}
      {isLiveMapScreen ? renderLiveMapScreen() : <ScrollView contentContainerStyle={styles.scrollContent}>
        {isHomeHeroVisible ? (
          <Animated.View
            style={[
              styles.homeHero,
              {
                opacity: homeHeroOpacity,
                transform: [{ translateY: homeHeroOpacity.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
              },
            ]}
          >
            <View style={styles.homeHeroEyebrow}>
              <View style={styles.homeHeroSignal} />
              <Text style={styles.homeHeroEyebrowText}>SESI MULTIPEMAIN · LIVE</Text>
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={
                  connectionStatus === 'connected'
                    ? 'Server permainan terhubung'
                    : connectionStatus === 'reconnecting'
                      ? 'Mencoba menyambungkan ulang ke server permainan'
                      : connectionStatus === 'connecting'
                        ? 'Menghubungkan ke server permainan'
                        : `Server permainan tidak terhubung. Periksa server dan URL: ${SOCKET_URL}`
                }
                style={[
                  styles.homeHeroConnection,
                  connectionStatus === 'connected'
                    ? styles.homeHeroConnectionOnline
                    : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
                      ? styles.homeHeroConnectionConnecting
                      : styles.homeHeroConnectionOffline,
                ]}
              >
                <Text style={styles.homeHeroConnectionIcon}>
                  {connectionStatus === 'connected'
                    ? '✓'
                    : connectionStatus === 'disconnected'
                      ? '!'
                      : '…'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tutup kartu pembuka"
                onPress={hideHomeHero}
                style={styles.homeHeroDismiss}
              >
                <Text style={styles.homeHeroDismissText}>×</Text>
              </Pressable>
            </View>
            <View style={styles.homeHeroBrand}>
              <Image
                accessibilityLabel="Logo PETAK UMPET +62"
                source={require('./assets/logo.png')}
                resizeMode="contain"
                style={styles.homeHeroLogo}
              />
              <View style={styles.homeHeroBrandCopy}>
                <Text style={[styles.title, styles.homeHeroTitle, isHiderThreatMode && { color: hiderThreatTheme.accent }]}>
                  PETAK
                </Text>
                <Text style={styles.homeHeroSubtitle}>Sembunyi. Bergerak. Bertahan.</Text>
                <Text style={styles.homeHeroDescription}>
                  Jaga zona, baca situasi, dan jangan sampai tertangkap.
                </Text>
              </View>
            </View>
          </Animated.View>
        ) : null}
        {account && authError && !room ? (
          <Text accessibilityLiveRegion="polite" style={styles.connectionOffline}>
            {authError}
          </Text>
        ) : null}
        {isScannerOpen && account ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Pindai QR room</Text>
            <View style={styles.cameraFrame}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={hasScanned ? undefined : handleRoomQrScanned}
              />
            </View>
            <Text style={scanError ? styles.connectionOffline : styles.mutedText}>
              {scanError || 'Arahkan kamera ke QR yang ditampilkan host.'}
            </Text>
            {scanError ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setScanError('');
                  setHasScanned(false);
                }}
              >
                <Text style={styles.secondaryText}>Pindai lagi</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={() => setIsScannerOpen(false)}>
              <Text style={styles.secondaryText}>Batal</Text>
            </Pressable>
          </View>
        ) : !room ? !account ? (
          renderAuth()
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Mulai sesi</Text>
            <Text style={styles.mutedText}>
              Lokasi diperlukan untuk menetapkan titik pusat area permainan saat room dibuat.
            </Text>
            <View style={styles.homeWelcome}>
              <Image
                accessibilityLabel="Avatar profil"
                source={getProfileAvatarSource(account.avatarId)}
                resizeMode="cover"
                style={styles.homeWelcomeAvatar}
              />
              <View style={styles.homeWelcomeCopy}>
                <Text style={styles.playerNamePreviewLabel}>SELAMAT DATANG</Text>
                <Text style={styles.playerNamePreviewValue}>@{account.username}</Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              style={styles.homeGuideButton}
              onPress={() => setIsGettingStartedVisible(true)}
            >
              <View style={styles.homeGuideIcon}>
                <Text style={styles.homeGuideIconText}>?</Text>
              </View>
              <View style={styles.homeGuideCopy}>
                <Text style={styles.homeGuideTitle}>Panduan bermain</Text>
                <Text style={styles.homeGuideDescription}>Pelajari alur permainan PETAK</Text>
              </View>
              <Text style={styles.homeGuideArrow}>›</Text>
            </Pressable>

            <Pressable
              disabled={isCreatingRoom}
              style={[styles.primaryButton, isCreatingRoom && styles.disabledButton]}
              onPress={createRoom}
            >
              <View style={styles.loadingButtonContent}>
                {isCreatingRoom ? <ActivityIndicator color="#072131" size="small" /> : null}
                <Text style={styles.primaryText}>
                  {isCreatingRoom ? 'Mengambil titik GPS...' : 'Buat room'}
                </Text>
              </View>
            </Pressable>

            <View style={styles.divider} />

            <Text style={styles.label}>Kode room</Text>
            <View style={styles.joinRoomRow}>
              <TextInput
                value={joinCode}
                onChangeText={setJoinCode}
                style={[styles.input, styles.joinRoomInput]}
                placeholder="ABC123"
                autoCapitalize="characters"
                placeholderTextColor={isLightTheme ? '#64748b' : '#9db0c4'}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pindai QR room"
                style={styles.qrScanButton}
                onPress={openRoomScanner}
              >
                <Svg width={22} height={22} viewBox="0 0 24 24">
                  <Path
                    fill="#f3f7ff"
                    d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3z"
                  />
                  <Path
                    fill="#1f2d3d"
                    d="M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5z"
                  />
                  <Path
                    fill="#f3f7ff"
                    d="M6 6h2v2H6zM16 6h2v2h-2zM6 16h2v2H6zM13 13h2v2h-2zM17 13h2v2h-2zM15 15h2v2h-2zM19 16h2v2h-2zM13 18h2v2h-2zM17 19h2v2h-2zM20 20h1v1h-1z"
                  />
                </Svg>
              </Pressable>
            </View>

            <Pressable style={styles.secondaryButton} onPress={() => joinRoom()}>
              <Text style={styles.secondaryText}>Gabung room</Text>
            </Pressable>

            <View style={styles.divider} />

            <View style={styles.nearbyRoomSection}>
              <Text style={styles.nearbyRoomTitle}>Room sekitar</Text>
              <Text style={styles.nearbyRoomDescription}>
                Cari room lobby terbuka dalam radius 3 km. Lokasi tepat Anda tidak ditampilkan.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: isSearchingNearbyRooms }}
                disabled={isSearchingNearbyRooms}
                style={[
                  styles.nearbyRoomSearchButton,
                  isSearchingNearbyRooms && styles.disabledButton,
                ]}
                onPress={() => void searchNearbyRooms()}
              >
                {isSearchingNearbyRooms ? (
                  <ActivityIndicator color="#ecfeff" size="small" />
                ) : (
                  <Text style={styles.nearbyRoomSearchText}>Cari room sekitar · 3 km</Text>
                )}
              </Pressable>
              {nearbyRoomsError ? (
                <Text accessibilityLiveRegion="polite" style={styles.nearbyRoomError}>
                  {nearbyRoomsError}
                </Text>
              ) : null}
              {!isSearchingNearbyRooms && hasSearchedNearbyRooms && !nearbyRoomsError &&
              nearbyRooms.length === 0 ? (
                <Text style={styles.nearbyRoomEmpty}>
                  Belum ada room lobby terbuka dalam radius 3 km.
                </Text>
              ) : null}
              {nearbyRooms.map((nearbyRoom) => (
                <Pressable
                  key={nearbyRoom.code}
                  accessibilityRole="button"
                  accessibilityLabel={`Gabung room ${nearbyRoom.code}, ${formatNearbyDistance(nearbyRoom.distanceMeters)}, ${nearbyRoom.playerCount} pemain online`}
                  disabled={connectionStatus !== 'connected'}
                  style={[
                    styles.nearbyRoomCard,
                    connectionStatus !== 'connected' && styles.disabledButton,
                  ]}
                  onPress={() => joinRoom(nearbyRoom.code)}
                >
                  <View style={styles.nearbyRoomCardHeading}>
                    <Text style={styles.nearbyRoomCode}>{nearbyRoom.code}</Text>
                    <Text style={styles.nearbyRoomDistance}>
                      {formatNearbyDistance(nearbyRoom.distanceMeters)}
                    </Text>
                  </View>
                  <View style={styles.nearbyRoomCardDetails}>
                    <Text style={styles.nearbyRoomMeta}>
                      {nearbyRoom.playerCount} online · {formatPlayRadius(nearbyRoom.playRadiusMeters)}
                      {nearbyRoom.playRadiusMode === 'RANDOM' ? ' acak' : ''}
                    </Text>
                    <Text style={styles.nearbyRoomJoinText}>GABUNG →</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : room.phase === 'LOBBY' ? (
          renderLobby()
        ) : (
          renderGame()
        )}
      </ScrollView>}
      {account && !isLiveMapScreen && !isScannerOpen ? (
        <View pointerEvents="box-none" style={styles.featureLauncherContainer}>
          {isFeatureLauncherOpen ? (
            <>
              <Pressable
                accessibilityRole="button"
                style={styles.featureLauncherEntry}
                onPress={() => {
                  setIsFeatureLauncherOpen(false);
                  closeCharacterSettings();
                  setIsProfileOpen(true);
                }}
              >
                <Text style={styles.featureLauncherEntryIcon}>👤</Text>
                <Text style={styles.featureLauncherEntryText}>Profil</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.featureLauncherEntry}
                onPress={() => {
                  setIsFeatureLauncherOpen(false);
                  setIsLeaderboardOpen(true);
                }}
              >
                <Text style={styles.featureLauncherEntryIcon}>🏆</Text>
                <Text style={styles.featureLauncherEntryText}>Leaderboard</Text>
              </Pressable>
            </>
          ) : null}
          <Animated.View
            style={{
              opacity: featureLauncherIdle.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.62],
              }),
              transform: [{
                scale: featureLauncherIdle.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0.78],
                }),
              }],
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isFeatureLauncherOpen ? 'Tutup menu fitur' : 'Buka menu fitur'}
              accessibilityHint="Tombol mengecil saat tidak digunakan. Ketuk untuk membuka menu fitur."
              accessibilityState={{ expanded: isFeatureLauncherOpen }}
              hitSlop={12}
              style={styles.featureLauncherButton}
              onPressIn={() => {
                if (featureLauncherIdleTimerRef.current !== null) {
                  clearTimeout(featureLauncherIdleTimerRef.current);
                  featureLauncherIdleTimerRef.current = null;
                }
                featureLauncherIdle.stopAnimation();
                featureLauncherIdle.setValue(0);
              }}
              onPress={() => setIsFeatureLauncherOpen((open) => !open)}
            >
              {isFeatureLauncherOpen ? (
                <Text style={styles.featureLauncherButtonText}>×</Text>
              ) : (
                <Image
                  source={require('./assets/logo-launcher.png')}
                  resizeMode="contain"
                  style={styles.featureLauncherLogo}
                />
              )}
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
      {!isLeaderboardOpen ? companionVoiceControl : null}
    </SafeAreaView>
  );
}

function createStyles(isLightTheme: boolean) {
  const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  startupLoadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1725',
  },
  startupLoadingContent: {
    alignItems: 'center',
    gap: 14,
    padding: 28,
  },
  startupLoadingLogo: {
    width: 210,
    height: 192,
  },
  startupLoadingTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 4,
  },
  startupLoadingMessage: {
    color: '#9db0c4',
    fontSize: 13,
    fontWeight: '600',
  },
  loadingButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  liveMapScreen: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    backgroundColor: '#0f172a',
  },
  liveMapOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    elevation: 20,
  },
  liveTopBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
  },
  livePlayerAvatarFrame: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1725',
    borderWidth: 1.5,
    borderRadius: 13,
  },
  livePlayerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
  },
  liveRoomInfo: {
    flex: 1,
    minWidth: 0,
  },
  liveRoomTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.1,
  },
  liveProfileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 2,
  },
  liveRoleText: {
    color: '#cbd5e1',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  liveRoomCode: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.45,
  },
  liveConnectionText: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 3,
  },
  liveConnectionOnline: {
    color: '#86efac',
  },
  liveConnectionConnecting: {
    color: '#fde68a',
  },
  liveConnectionOffline: {
    color: '#fca5a5',
  },
  liveTimer: {
    minWidth: 62,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveTimerLabel: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  liveTimerValue: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  liveIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
    borderRadius: 12,
  },
  liveLocationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 10,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  liveLocationPillWarning: {
    backgroundColor: 'rgba(127, 29, 29, 0.72)',
  },
  liveLocationText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  liveRetryButton: {
    minHeight: 44,
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  liveRetryText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
  },
  liveThreatCard: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  liveImpostorPinHint: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: 'rgba(253, 164, 175, 0.4)',
    borderRadius: 10,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(76, 5, 25, 0.62)',
  },
  liveImpostorPinHintText: {
    color: '#fff1f2',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  liveGameLog: {
    maxHeight: 112,
    marginBottom: 8,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    backgroundColor: 'rgba(2, 6, 23, 0.58)',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 8,
  },
  liveGameLogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  liveGameLogPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
  },
  liveGameLogTitle: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  liveGameLogHeaderSpacer: {
    flex: 1,
  },
  liveGameLogLive: {
    color: '#6ee7b7',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  liveGameLogCount: {
    minWidth: 22,
    overflow: 'hidden',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(51, 65, 85, 0.68)',
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
  },
  liveGameLogList: {
    maxHeight: 72,
    flexGrow: 0,
  },
  liveGameLogContent: {
    gap: 6,
  },
  liveGameLogItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  liveGameLogItemLatest: {
    borderColor: 'rgba(34, 211, 238, 0.42)',
    backgroundColor: 'rgba(195, 243, 107, 0.16)',
  },
  liveGameLogItemDot: {
    width: 6,
    height: 6,
    marginTop: 5,
    borderRadius: 3,
    backgroundColor: '#64748b',
  },
  liveGameLogItemDotLatest: {
    backgroundColor: '#67e8f9',
  },
  liveGameLogText: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 12,
    lineHeight: 17,
    textShadowColor: 'rgba(2, 6, 23, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  liveDockNoticeText: {
    color: '#fde68a',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
    marginBottom: 6,
    paddingHorizontal: 8,
    textAlign: 'center',
  },
  liveGameLogPreference: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
    padding: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.62)',
  },
  liveGameLogPreferenceCopy: {
    flex: 1,
  },
  liveGameLogPreferenceHint: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  liveGameLogPreferenceAction: {
    color: '#67e8f9',
    fontSize: 11,
    fontWeight: '900',
  },
  liveDetailsPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(203, 213, 225, 0.32)',
    borderRadius: 16,
    zIndex: 30,
    elevation: 30,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  liveDetailsContent: {
    padding: 14,
    paddingBottom: 20,
  },
  liveDetailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  liveDetailsTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 8,
    textShadowColor: 'rgba(2, 6, 23, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  liveDetailsClose: {
    color: '#93c5fd',
    fontWeight: '800',
    padding: 6,
  },
  liveStatText: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 19,
    textShadowColor: 'rgba(2, 6, 23, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  liveSeekerStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.24)',
    backgroundColor: 'rgba(8, 47, 73, 0.48)',
  },
  liveSeekerStatusCount: {
    flex: 1,
    textAlign: 'center',
    overflow: 'hidden',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 11,
    fontWeight: '900',
  },
  liveSeekerStatusActive: {
    color: '#a7f3d0',
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
  },
  liveSeekerStatusEliminated: {
    color: '#fecdd3',
    backgroundColor: 'rgba(244, 63, 94, 0.16)',
  },
  liveMissionHint: {
    color: '#b8cbd8',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 4,
  },
  liveLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 5,
  },
  liveLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(248, 250, 252, 0.8)',
  },
  liveLegendLabel: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 17,
  },
  liveDetailAction: {
    marginTop: 8,
  },
  liveMissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.62)',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
  },
  liveHiderMissionRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.22)',
    paddingVertical: 11,
  },
  liveMissionCopy: {
    flex: 1,
    gap: 8,
  },
  liveMissionTrack: {
    height: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(148, 163, 184, 0.25)',
    borderRadius: 2,
  },
  liveMissionTrackFill: {
    height: '100%',
    backgroundColor: '#34d399',
    borderRadius: 2,
  },
  liveMissionTrackFillComplete: {
    backgroundColor: '#a7f3d0',
  },
  liveMissionProgress: {
    color: '#a7f3d0',
    fontWeight: '900',
  },
  liveMissionProgressComplete: {
    color: '#f0fdf4',
  },
  liveDetailsMissionSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.28)',
    backgroundColor: 'rgba(6, 78, 59, 0.28)',
  },
  liveDetailsMissionSummaryCopy: {
    flex: 1,
  },
  liveDetailsMissionSummaryTitle: {
    color: '#a7f3d0',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  liveDetailsMissionSummaryCount: {
    color: '#ecfdf5',
    fontSize: 16,
    fontWeight: '900',
  },
  liveBottomDock: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(203, 213, 225, 0.25)',
    borderRadius: 18,
    padding: 10,
    zIndex: 20,
    elevation: 20,
  },
  liveActionDisabled: {
    opacity: 0.62,
  },
  liveHiderMissions: {
    backgroundColor: 'rgba(30, 41, 59, 0.78)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
  },
  liveHiderProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  liveHiderMissionsTitle: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  liveHiderMissionProgress: {
    color: '#a7f3d0',
    fontSize: 11,
    fontWeight: '900',
  },
  liveHiderProgressTrack: {
    flexDirection: 'row',
    gap: 5,
  },
  liveHiderProgressSegment: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(148, 163, 184, 0.35)',
  },
  liveHiderProgressSegmentComplete: {
    backgroundColor: '#34d399',
  },
  livePreparationHint: {
    color: '#e2e8f0',
    textAlign: 'center',
    fontWeight: '700',
    paddingVertical: 8,
  },
  liveActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  liveActionButton: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 13,
    paddingHorizontal: 8,
  },
  livePrimaryAction: {
    backgroundColor: '#4dd9b5',
  },
  livePrimaryActionText: {
    color: '#072131',
    fontWeight: '900',
    fontSize: 14,
    textAlign: 'center',
  },
  liveSecondaryAction: {
    backgroundColor: '#334155',
    borderWidth: 1,
    borderColor: '#64748b',
  },
  liveSecondaryActionText: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },
  liveHiderNearestCard: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.32)',
    backgroundColor: 'rgba(6, 78, 59, 0.36)',
  },
  liveHiderNearestFloating: {
    position: 'absolute',
    left: 16,
    maxWidth: 220,
    zIndex: 25,
    elevation: 25,
  },
  liveHiderNearestIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
  },
  liveHiderNearestCopy: {
    gap: 1,
  },
  liveHiderNearestLabel: {
    color: '#a7f3d0',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.65,
  },
  liveHiderNearestDistance: {
    color: '#f0fdf4',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 17,
  },
  liveHiderNearestStatus: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(52, 211, 153, 0.18)',
  },
  liveHiderNearestStatusWaiting: {
    backgroundColor: 'rgba(148, 163, 184, 0.18)',
  },
  liveHiderNearestStatusText: {
    color: '#d1fae5',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  liveDetailsToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    minHeight: 44,
    paddingVertical: 10,
  },
  liveDetailsToggleText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
  },
  liveDetailsToggleIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(203, 213, 225, 0.2)',
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#f3f7ff',
    marginBottom: 4,
  },
  subtitle: {
    color: '#9db0c4',
    marginBottom: 18,
  },
  connectionOnline: {
    color: '#77e0c7',
    marginBottom: 14,
  },
  connectionOffline: {
    color: '#ffb454',
    marginBottom: 14,
  },
  profileModalContainer: {
    flex: 1,
    backgroundColor: '#0b1725',
  },
  profileCharacterPaletteContainer: {
    backgroundColor: isLightTheme ? '#f8fafc' : '#0c111b',
  },
  profileCharacterPaletteContent: {
    backgroundColor: isLightTheme ? '#f8fafc' : '#0c111b',
  },
  profileCharacterPaletteHeader: {
    backgroundColor: isLightTheme ? '#f8fafc' : '#0c111b',
    borderBottomColor: isLightTheme ? '#cbd5e1' : 'rgba(187, 204, 226, 0.11)',
  },
  profileCharacterPaletteEyebrow: {
    color: isLightTheme ? '#42610f' : '#c3f36b',
  },
  profileCharacterPaletteTitle: {
    color: isLightTheme ? '#0f172a' : '#f3f6fb',
  },
  profileCharacterPaletteClose: {
    backgroundColor: isLightTheme ? '#e2e8f0' : '#1b2636',
  },
  profileCharacterPaletteCloseText: {
    color: isLightTheme ? '#0f172a' : '#f3f6fb',
  },
  profileCharacterPaletteBackButton: {
    backgroundColor: 'transparent',
  },
  profileCharacterPaletteAccentText: {
    color: isLightTheme ? '#42610f' : '#c3f36b',
  },
  profileCharacterPaletteText: {
    color: isLightTheme ? '#0f172a' : '#f3f6fb',
  },
  profileCharacterPaletteMuted: {
    color: isLightTheme ? '#475569' : '#9aa8bb',
  },
  profileCharacterPaletteCard: {
    backgroundColor: isLightTheme ? '#ffffff' : '#151d2b',
    borderColor: isLightTheme ? '#cbd5e1' : 'rgba(187, 204, 226, 0.18)',
  },
  profileCharacterPaletteCardOpen: {
    backgroundColor: isLightTheme ? '#f1f8df' : '#26351d',
    borderColor: isLightTheme ? '#547a14' : '#c3f36b',
  },
  profileCharacterPaletteChoice: {
    backgroundColor: isLightTheme ? '#ffffff' : '#151d2b',
    borderColor: isLightTheme ? '#cbd5e1' : 'rgba(187, 204, 226, 0.18)',
  },
  profileCharacterPaletteChoiceSelected: {
    backgroundColor: isLightTheme ? '#f1f8df' : '#26351d',
    borderColor: isLightTheme ? '#547a14' : '#c3f36b',
  },
  profileCharacterPaletteChoiceImage: {
    backgroundColor: isLightTheme ? '#e2e8f0' : '#1b2636',
  },
  profileContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 32,
  },
  profileIdentityShowcase: {
    position: 'relative',
    height: 136,
    marginBottom: 14,
  },
  profileIdentityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 100,
    paddingVertical: 16,
    paddingLeft: 16,
    paddingRight: 96,
    marginTop: 16,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 16,
  },
  profileAvatar: {
    width: 58,
    height: 58,
    backgroundColor: '#0e7490',
    borderWidth: 2,
    borderColor: '#67e8f9',
    borderRadius: 29,
    resizeMode: 'cover',
  },
  profileAvatarTapTarget: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  profileAvatarEditBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e7490',
    borderWidth: 2,
    borderColor: '#122237',
    borderRadius: 10,
  },
  profileAvatarEditBadgeText: {
    color: '#ecfeff',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 12,
  },
  profileIdentityCompanionOverlay: {
    position: 'absolute',
    top: -8,
    right: -10,
    width: 148,
    height: 148,
    zIndex: 2,
    elevation: 3,
  },
  profileIdentityCompanion: {
    width: 148,
    height: 148,
  },
  profileIdentityCompanionTag: {
    position: 'absolute',
    top: 10,
    right: 12,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: '#0e7490',
    borderRadius: 6,
  },
  profileIdentityCompanionTagText: {
    color: '#ecfeff',
    fontSize: 8,
    fontWeight: '900',
  },
  profileIdentityCompanionEditBadge: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e7490',
    borderWidth: 2,
    borderColor: '#0b1725',
    borderRadius: 10,
  },
  profileCharacterSettingsButton: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 22,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 15,
  },
  profileCharacterSettingsCopy: {
    flex: 1,
    gap: 4,
  },
  profileCharacterSettingsTitle: {
    color: '#f3f7ff',
    fontSize: 14,
    fontWeight: '900',
  },
  profileCharacterSettingsHint: {
    color: '#9db0c4',
    fontSize: 10,
  },
  profileCharacterSettingsArrow: {
    color: '#67e8f9',
    fontSize: 28,
    fontWeight: '500',
    lineHeight: 30,
  },
  profileCharacterBackButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingRight: 12,
    marginBottom: 8,
  },
  profileCharacterBackText: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '800',
  },
  profileCharacterSelectionCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  profileCharacterSelectionCard: {
    width: '48%',
    minWidth: 130,
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 14,
  },
  profileCharacterSelectionCardOpen: {
    backgroundColor: '#163b43',
    borderColor: '#77e0c7',
  },
  profileCharacterSelectionAvatar: {
    width: 46,
    height: 46,
    backgroundColor: isLightTheme ? '#e2e8f0' : '#0b1725',
    borderRadius: 23,
    resizeMode: 'cover',
  },
  profileCharacterSelectionCompanion: {
    width: 50,
    height: 58,
  },
  profileCharacterSelectionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  profileCharacterSelectionEyebrow: {
    color: '#67e8f9',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  profileCharacterSelectionName: {
    color: '#f3f7ff',
    fontSize: 10,
    fontWeight: '900',
  },
  profileCharacterSelectionAction: {
    color: '#9db0c4',
    fontSize: 8,
  },
  profileCharacterSelectionArrow: {
    color: '#67e8f9',
    fontSize: 20,
    fontWeight: '500',
  },
  profileCharacterChooserHint: {
    color: '#9db0c4',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  profileAvatarChoiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginBottom: 8,
  },
  profileAvatarChoice: {
    width: '23%',
    minHeight: 108,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 6,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 14,
  },
  profileAvatarChoiceSelected: {
    borderColor: '#77e0c7',
    backgroundColor: '#163b43',
  },
  profileAvatarChoiceLocked: {
    opacity: 0.62,
  },
  profileAvatarChoiceImage: {
    width: 52,
    height: 52,
    backgroundColor: '#0b1725',
    borderRadius: 26,
    resizeMode: 'cover',
  },
  profileAvatarChoiceLabel: {
    color: '#cfe1f7',
    fontSize: 9,
    fontWeight: '800',
  },
  profileAvatarChoiceProgress: {
    color: '#ffcf83',
    fontSize: 7,
    lineHeight: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  profileCompanionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginBottom: 8,
  },
  profileCompanionChoice: {
    width: '31%',
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 14,
  },
  profileCompanionChoiceSelected: {
    borderColor: '#77e0c7',
    backgroundColor: '#163b43',
  },
  profileSystemCompanionChoice: {
    backgroundColor: isLightTheme ? '#fffbeb' : '#211f1a',
    borderColor: isLightTheme ? '#d6a64e' : '#b88a46',
  },
  profileCompanionImage: {
    width: 96,
    height: 96,
  },
  profileCompanionName: {
    color: '#cfe1f7',
    fontSize: 11,
    fontWeight: '800',
  },
  profileSystemCompanionBadge: {
    color: isLightTheme ? '#92400e' : '#ffcf83',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  profileSystemCompanionNotice: {
    gap: 4,
    padding: 12,
    marginBottom: 12,
    backgroundColor: isLightTheme ? '#fffbeb' : '#2b2114',
    borderWidth: 1,
    borderColor: isLightTheme ? '#d6a64e' : '#8c6a37',
    borderRadius: 12,
  },
  profileSystemCompanionNoticeTitle: {
    color: isLightTheme ? '#713f12' : '#ffcf83',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  profileSystemCompanionNoticeText: {
    color: isLightTheme ? '#713f12' : '#f3d9ae',
    fontSize: 10,
    lineHeight: 15,
  },
  profileCompanionHint: {
    color: '#9db0c4',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  profileCompanionPrivacyCard: {
    gap: 10,
    padding: 14,
    marginBottom: 22,
    backgroundColor: isLightTheme ? '#ffffff' : '#151d2b',
    borderWidth: 1,
    borderColor: isLightTheme ? '#cbd5e1' : 'rgba(187, 204, 226, 0.18)',
    borderRadius: 16,
  },
  profileCompanionPrivacyToggle: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  profileCompanionPrivacyCopy: {
    flex: 1,
    gap: 4,
  },
  profileCompanionPrivacyTitle: {
    color: isLightTheme ? '#0f172a' : '#f3f6fb',
    fontSize: 13,
    fontWeight: '900',
  },
  profileCompanionPrivacyHint: {
    color: isLightTheme ? '#475569' : '#9aa8bb',
    fontSize: 10,
    lineHeight: 15,
  },
  profileCompanionPrivacyState: {
    color: isLightTheme ? '#475569' : '#9aa8bb',
    minWidth: 44,
    textAlign: 'right',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  profileCompanionPrivacyStateEnabled: {
    color: isLightTheme ? '#42610f' : '#c3f36b',
  },
  profileCompanionPrivacyDisclosure: {
    color: isLightTheme ? '#475569' : '#9aa8bb',
    fontSize: 10,
    lineHeight: 15,
  },
  profileCompanionPrivacyError: {
    color: '#b45309',
    fontSize: 10,
    lineHeight: 15,
  },
  profileCompanionStats: {
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: isLightTheme ? '#cbd5e1' : 'rgba(187, 204, 226, 0.18)',
  },
  profileCompanionStatsTitle: {
    color: isLightTheme ? '#42610f' : '#c3f36b',
    fontSize: 10,
    fontWeight: '900',
  },
  profileCompanionStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  profileCompanionStatsItem: {
    flexGrow: 1,
    minWidth: '28%',
    gap: 3,
    padding: 8,
    backgroundColor: isLightTheme ? '#f1f8df' : '#1d2615',
    borderRadius: 10,
  },
  profileCompanionStatsValue: {
    color: isLightTheme ? '#15200a' : '#c3f36b',
    fontSize: 15,
    fontWeight: '900',
  },
  profileCompanionStatsLabel: {
    color: isLightTheme ? '#475569' : '#9aa8bb',
    fontSize: 8,
  },
  companionVoiceOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 22,
    zIndex: 10000,
    elevation: 10000,
  },
  companionVoiceModalContainer: {
    flex: 1,
  },
  companionVoiceDraggable: {
    position: 'absolute',
    zIndex: 10001,
    elevation: 10001,
  },
  companionVoicePanel: {
    position: 'absolute',
    width: 330,
    maxWidth: '100%',
    maxHeight: 420,
    overflow: 'hidden',
    backgroundColor: isLightTheme
      ? 'rgba(255, 255, 255, 0.82)'
      : 'rgba(17, 26, 39, 0.82)',
    borderWidth: 1,
    borderColor: isLightTheme ? '#cbd5e1' : 'rgba(187, 204, 226, 0.22)',
    borderRadius: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  companionVoicePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: isLightTheme ? '#e2e8f0' : 'rgba(187, 204, 226, 0.14)',
  },
  companionVoicePanelHeading: {
    flex: 1,
    gap: 2,
  },
  companionVoicePanelEyebrow: {
    color: isLightTheme ? '#64748b' : '#9aa8bb',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  companionVoicePanelTitle: {
    color: isLightTheme ? '#0f172a' : '#f3f6fb',
    fontSize: 15,
    fontWeight: '900',
  },
  companionVoicePanelClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isLightTheme ? '#f1f5f9' : '#202c3b',
    borderRadius: 10,
  },
  companionVoicePanelCloseText: {
    color: isLightTheme ? '#334155' : '#dbe6f5',
    fontSize: 20,
    lineHeight: 22,
  },
  companionVoicePanelBody: {
    flexShrink: 1,
  },
  companionVoicePanelContent: {
    gap: 9,
    padding: 12,
  },
  companionVoicePanelMessage: {
    gap: 4,
    padding: 10,
    backgroundColor: isLightTheme
      ? 'rgba(241, 245, 249, 0.76)'
      : 'rgba(26, 38, 53, 0.76)',
    borderRadius: 11,
  },
  companionVoicePanelMessageHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  companionVoiceSoundBars: {
    height: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  companionVoiceSoundBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: isLightTheme ? '#547a14' : '#c3f36b',
  },
  companionVoicePanelReply: {
    gap: 4,
    padding: 10,
    backgroundColor: isLightTheme
      ? 'rgba(241, 248, 223, 0.8)'
      : 'rgba(29, 38, 21, 0.8)',
    borderLeftWidth: 3,
    borderLeftColor: isLightTheme ? '#547a14' : '#c3f36b',
    borderRadius: 11,
  },
  companionVoicePanelLabel: {
    color: isLightTheme ? '#42610f' : '#c3f36b',
    fontSize: 9,
    fontWeight: '900',
  },
  companionVoicePanelText: {
    color: isLightTheme ? '#0f172a' : '#f3f6fb',
    fontSize: 11,
    lineHeight: 16,
  },
  companionVoicePanelQueue: {
    color: isLightTheme ? '#475569' : '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
  },
  companionVoicePanelError: {
    color: isLightTheme ? '#b45309' : '#ffb454',
    fontSize: 10,
    lineHeight: 15,
  },
  companionVoicePanelHint: {
    color: isLightTheme ? '#64748b' : '#9aa8bb',
    fontSize: 9,
    lineHeight: 14,
  },
  companionVoicePanelMicControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: isLightTheme ? '#e2e8f0' : 'rgba(187, 204, 226, 0.14)',
  },
  companionVoicePanelMicCopy: {
    flex: 1,
    gap: 2,
  },
  companionVoicePanelMicTitle: {
    color: isLightTheme ? '#0f172a' : '#f3f6fb',
    fontSize: 11,
    fontWeight: '900',
  },
  companionVoicePanelMicStatus: {
    color: isLightTheme ? '#64748b' : '#9aa8bb',
    fontSize: 9,
    fontWeight: '800',
  },
  companionVoicePanelMicStatusActive: {
    color: isLightTheme ? '#42610f' : '#c3f36b',
  },
  companionVoiceMicSwitch: {
    width: 48,
    height: 28,
    justifyContent: 'center',
    padding: 3,
    backgroundColor: isLightTheme ? '#cbd5e1' : '#45566b',
    borderRadius: 14,
  },
  companionVoiceMicSwitchEnabled: {
    backgroundColor: isLightTheme ? '#547a14' : '#759f37',
  },
  companionVoiceMicSwitchKnob: {
    width: 22,
    height: 22,
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 11,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  companionVoiceMicSwitchKnobEnabled: {
    alignSelf: 'flex-end',
  },
  companionVoicePanelLauncher: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#c3f36b',
    borderWidth: 1,
    borderColor: isLightTheme ? '#a3cf4f' : '#d9f99d',
    borderRadius: 28,
    shadowColor: '#000000',
    shadowOpacity: 0.26,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 14,
  },
  companionVoiceLauncherIcon: {
    color: '#263719',
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '900',
  },
  profileCompanionError: {
    color: '#ffb454',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  profileSpeechHint: {
    color: '#9db0c4',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  profileSpeechLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  profileSpeechOptions: {
    gap: 7,
    marginBottom: 10,
  },
  profileSpeechOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 12,
  },
  profileSpeechOptionSelected: {
    backgroundColor: '#163b43',
    borderColor: '#77e0c7',
  },
  profileSpeechRadio: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#7f9bb5',
    borderRadius: 9,
  },
  profileSpeechRadioSelected: {
    width: 10,
    height: 10,
    backgroundColor: '#77e0c7',
    borderRadius: 5,
  },
  profileSpeechVoiceCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileSpeechVoiceName: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '800',
  },
  profileSpeechVoiceLanguage: {
    color: '#7f9bb5',
    fontSize: 9,
    marginTop: 2,
  },
  profileSpeechPreviewButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginBottom: 8,
    backgroundColor: '#0e7490',
    borderRadius: 11,
  },
  profileSpeechPreviewText: {
    color: '#ecfeff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  profileSpeechError: {
    color: '#ffb454',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 14,
  },
  profileAvatarHint: {
    color: '#9db0c4',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 18,
  },
  profileAvatarStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  profileAvatarStatusText: {
    color: '#77e0c7',
    fontSize: 11,
    fontWeight: '700',
  },
  profileAvatarError: {
    color: '#ffb454',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 18,
  },
  profileIdentityDetails: {
    flex: 1,
    gap: 5,
  },
  profileUsername: {
    color: '#f3f7ff',
    fontSize: 19,
    fontWeight: '900',
  },
  profileCaption: {
    color: '#67e8f9',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  profileSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  profileSectionTitle: {
    color: '#f3f7ff',
    fontSize: 15,
    fontWeight: '900',
  },
  profileSectionMeta: {
    color: '#7f9bb5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  profileBalanceGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  profileBalanceCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 108,
    paddingHorizontal: 6,
    paddingVertical: 12,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 14,
  },
  profileBalanceIcon: {
    fontSize: 17,
    marginBottom: 4,
  },
  profileBalanceValue: {
    color: '#77e0c7',
    fontSize: 20,
    fontWeight: '900',
  },
  profileBadgeValue: {
    color: '#fde68a',
  },
  profileBalanceLabel: {
    color: '#cfe1f7',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
  profileHint: {
    color: '#9db0c4',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 14,
  },
  profileLogoutButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    backgroundColor: '#3b1b24',
    borderWidth: 1,
    borderColor: '#9f3044',
    borderRadius: 14,
  },
  profileLogoutText: {
    color: '#fecdd3',
    fontSize: 14,
    fontWeight: '900',
  },
  leaderboardModalContainer: {
    flex: 1,
    backgroundColor: '#0b1725',
  },
  leaderboardModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#294057',
  },
  leaderboardModalHeading: {
    gap: 3,
  },
  leaderboardModalEyebrow: {
    color: '#67e8f9',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  leaderboardModalTitle: {
    color: '#f3f7ff',
    fontSize: 24,
    fontWeight: '900',
  },
  gameTimelinePage: {
    flex: 1,
    backgroundColor: '#0b1725',
  },
  gameTimelinePageContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 32,
  },
  leaderboardModalClose: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#1e293b',
  },
  leaderboardModalCloseText: {
    color: '#f8fafc',
    fontSize: 28,
    lineHeight: 32,
  },
  leaderboardModalList: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  featureLauncherContainer: {
    position: 'absolute',
    right: 16,
    bottom: 22,
    alignItems: 'flex-end',
    gap: 10,
    zIndex: 20,
  },
  featureLauncherButton: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    backgroundColor: '#0e7490',
    borderWidth: 1,
    borderColor: '#67e8f9',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  featureLauncherButtonText: {
    color: '#ecfeff',
    fontSize: 25,
    fontWeight: '900',
  },
  featureLauncherLogo: {
    width: 44,
    height: 42,
  },
  featureLauncherEntry: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#3b647e',
    borderRadius: 16,
    backgroundColor: '#122237',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  featureLauncherEntryIcon: {
    fontSize: 20,
  },
  featureLauncherEntryText: {
    color: '#f3f7ff',
    fontSize: 14,
    fontWeight: '800',
  },
  leaderboardPeriodRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  leaderboardSummary: {
    padding: 14,
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 16,
  },
  leaderboardSummaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 9,
  },
  leaderboardSummaryLabel: {
    color: '#67e8f9',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  leaderboardSummaryValue: {
    color: '#f3f7ff',
    fontSize: 12,
    fontWeight: '800',
  },
  leaderboardCriteria: {
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: '#294057',
  },
  leaderboardCriteriaText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 4,
  },
  leaderboardPeriodButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#31506a',
    borderRadius: 10,
    paddingVertical: 9,
  },
  leaderboardPeriodButtonSelected: {
    backgroundColor: '#164e63',
    borderColor: '#67e8f9',
  },
  leaderboardPeriodText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '800',
  },
  leaderboardPeriodTextSelected: {
    color: '#ecfeff',
  },
  leaderboardLoading: {
    paddingVertical: 16,
  },
  leaderboardEmpty: {
    color: '#9db0c4',
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 12,
    textAlign: 'center',
  },
  leaderboardEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    marginBottom: 8,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 14,
  },
  leaderboardEntryTop: {
    backgroundColor: '#16283b',
    borderColor: '#3b5268',
  },
  leaderboardEntryFirst: {
    borderColor: '#b28b42',
  },
  leaderboardRank: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#243a50',
    borderRadius: 11,
  },
  leaderboardRankFirst: {
    backgroundColor: '#854d0e',
  },
  leaderboardRankSecond: {
    backgroundColor: '#475569',
  },
  leaderboardRankThird: {
    backgroundColor: '#78350f',
  },
  leaderboardRankText: {
    color: '#fde68a',
    fontSize: 13,
    fontWeight: '900',
  },
  leaderboardAvatar: {
    width: 42,
    height: 42,
    backgroundColor: '#0b1725',
    borderWidth: 1,
    borderColor: '#3b5268',
    borderRadius: 21,
    resizeMode: 'cover',
  },
  leaderboardPlayer: {
    flex: 1,
    gap: 2,
  },
  leaderboardUsername: {
    color: '#f3f7ff',
    fontSize: 13,
    fontWeight: '800',
  },
  leaderboardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  leaderboardRecord: {
    color: '#9db0c4',
    fontSize: 11,
    fontWeight: '600',
  },
  leaderboardBadgePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#3b321f',
    borderRadius: 8,
  },
  leaderboardBadges: {
    color: '#fde68a',
    fontSize: 10,
    fontWeight: '800',
  },
  leaderboardRateColumn: {
    minWidth: 58,
    alignItems: 'flex-end',
  },
  leaderboardWinRate: {
    color: '#77e0c7',
    fontSize: 15,
    fontWeight: '900',
  },
  leaderboardWinRateLabel: {
    color: '#7f9bb5',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: '#16263b',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    marginBottom: 16,
  },
  lobbyScreen: {
    width: '100%',
    paddingBottom: 12,
  },
  lobbyDetailsModalContainer: {
    flex: 1,
    backgroundColor: '#0b1725',
  },
  lobbyDetailsContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  lobbySettingsHero: {
    position: 'relative',
    overflow: 'hidden',
    padding: 14,
    marginBottom: 14,
    backgroundColor: '#112438',
    borderWidth: 1,
    borderColor: '#2b5966',
    borderRadius: 22,
  },
  lobbySettingsHeroGlow: {
    position: 'absolute',
    top: -60,
    right: -25,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(45, 212, 191, 0.08)',
  },
  lobbySettingsHeroHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  lobbySettingsHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  lobbySettingsEyebrow: {
    color: '#67e8f9',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  lobbySettingsCode: {
    color: '#f3f7ff',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 4,
    marginTop: 5,
  },
  lobbySettingsHint: {
    color: '#9db7c7',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  lobbySettingsStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: 'rgba(4, 17, 29, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(71, 108, 126, 0.45)',
    borderRadius: 999,
  },
  lobbySettingsStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34d399',
  },
  lobbySettingsStatusText: {
    color: '#a7f3d0',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  lobbySettingsQrPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    marginTop: 14,
    backgroundColor: 'rgba(4, 17, 29, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(71, 108, 126, 0.45)',
    borderRadius: 16,
  },
  lobbySettingsQrFrame: {
    padding: 7,
    backgroundColor: '#ffffff',
    borderRadius: 11,
  },
  lobbySettingsQrCopy: {
    flex: 1,
  },
  lobbySettingsQrTitle: {
    color: '#dff9f1',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  lobbySettingsQrDescription: {
    color: '#9db0c4',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  lobbyDetailSection: {
    padding: 14,
    marginBottom: 14,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 18,
  },
  lobbyDetailHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  lobbyDetailEyebrow: {
    color: '#7f9bb5',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  lobbyDetailTitle: {
    color: '#f3f7ff',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 2,
  },
  lobbyDetailValueChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#0b2a34',
    borderWidth: 1,
    borderColor: '#1c6471',
    borderRadius: 10,
  },
  lobbyDetailValueChipText: {
    color: '#67e8f9',
    fontSize: 11,
    fontWeight: '900',
  },
  lobbyDetailDescription: {
    color: '#9db0c4',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  lobbyRangeActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 11,
    backgroundColor: '#0b1725',
    borderRadius: 11,
  },
  lobbyRangeActiveStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  lobbyRangeActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34d399',
  },
  lobbyRangeActiveLabel: {
    color: '#aabdd7',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  lobbyRangeActiveValue: {
    color: '#86efac',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  lobbyDetailFootnote: {
    color: '#7f9bb5',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 9,
  },
  lobbyBotInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    marginBottom: 14,
    backgroundColor: '#102d3a',
    borderWidth: 1,
    borderColor: '#1c6471',
    borderRadius: 15,
  },
  lobbyBotInfoIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#164e63',
    borderRadius: 11,
  },
  lobbyBotInfoIconText: {
    color: '#cffafe',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  lobbyBotInfoCopy: {
    flex: 1,
  },
  lobbyBotInfoTitle: {
    color: '#a5f3fc',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  lobbyBotInfoDescription: {
    color: '#a5c9d6',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  lobbyEmergencyButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
    paddingHorizontal: 12,
    backgroundColor: '#351a24',
    borderWidth: 1,
    borderColor: '#7f344b',
    borderRadius: 13,
  },
  lobbyRoomCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    marginBottom: 18,
    backgroundColor: '#112438',
    borderWidth: 1,
    borderColor: '#29465a',
    borderRadius: 18,
  },
  lobbyRoomCodeCopy: {
    flex: 1,
    minWidth: 0,
  },
  lobbyDetailsButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#164e63',
    borderWidth: 1,
    borderColor: '#2dd4bf',
  },
  lobbyDetailsButtonIcon: {
    color: '#cffafe',
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 5,
    paddingVertical: 3,
    backgroundColor: '#0e3c4b',
    borderRadius: 5,
  },
  lobbyDetailsButtonText: {
    color: '#ecfeff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  sectionTitle: {
    color: '#f3f7ff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  cardEyebrow: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  homeHero: {
    backgroundColor: '#142438',
    borderColor: '#29465a',
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
  },
  homeHeroBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
  },
  homeHeroLogo: {
    width: 76,
    height: 76,
    borderRadius: 18,
  },
  homeHeroBrandCopy: {
    flex: 1,
  },
  homeHeroEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
  homeHeroSignal: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  homeHeroEyebrowText: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  homeHeroConnection: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  homeHeroConnectionOnline: {
    backgroundColor: '#14532d',
  },
  homeHeroConnectionConnecting: {
    backgroundColor: '#713f12',
  },
  homeHeroConnectionOffline: {
    backgroundColor: '#7f1d1d',
  },
  homeHeroConnectionIcon: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 18,
  },
  homeHeroDismiss: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#26384b',
  },
  homeHeroDismissText: {
    color: '#cbd5e1',
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 22,
  },
  homeHeroTitle: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 0,
  },
  homeHeroSubtitle: {
    color: '#b8f5df',
    fontSize: 14,
    fontWeight: '800',
  },
  homeHeroDescription: {
    color: '#aabdd7',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  lobbyHero: {
    marginBottom: 18,
  },
  lobbyHeroCard: {
    position: 'relative',
    overflow: 'hidden',
    padding: 14,
    backgroundColor: '#112438',
    borderWidth: 1,
    borderColor: '#2b5966',
    borderRadius: 22,
  },
  lobbyHeroGlow: {
    position: 'absolute',
    top: -50,
    right: -24,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(45, 212, 191, 0.08)',
  },
  lobbyHeroMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  lobbyHeading: {
    flex: 1,
    minWidth: 0,
  },
  lobbyTitle: {
    color: '#f3f7ff',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  lobbyHeroDescription: {
    color: '#9db7c7',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  lobbyHeroAvatarFrame: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(195, 243, 107, 0.5)',
    borderRadius: 22,
    transform: [{ rotate: '4deg' }],
  },
  lobbyHeroAvatar: {
    width: 66,
    height: 66,
    borderRadius: 18,
  },
  lobbyReadyRangeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    marginTop: 14,
  },
  lobbyReadyButton: {
    flex: 1,
    justifyContent: 'center',
    marginTop: 0,
  },
  lobbyLeaveButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a5067',
  },
  lobbyLeaveButtonText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
  },
  lobbyRangeSummary: {
    minWidth: 100,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#1f2d3d',
  },
  lobbyRangeLabel: {
    color: '#9db0c4',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  lobbyRangeValue: {
    color: '#77e0c7',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  lobbyRangeNotice: {
    color: '#fde68a',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  lobbyEyebrow: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  lobbyReadiness: {
    padding: 11,
    backgroundColor: 'rgba(4, 17, 29, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(71, 108, 126, 0.45)',
    borderRadius: 14,
  },
  lobbyReadinessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lobbyReadinessStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lobbyReadinessTrack: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 9,
  },
  lobbyReadinessSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
  },
  lobbyReadinessSegmentReady: {
    backgroundColor: '#34d399',
  },
  lobbyOnlineMeta: {
    color: '#7f9bb5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
    marginTop: 7,
  },
  lobbyStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 7,
  },
  lobbyStatusReady: {
    backgroundColor: '#4ade80',
  },
  lobbyStatusWaiting: {
    backgroundColor: '#fbbf24',
  },
  lobbyReadinessText: {
    color: '#dceaf7',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  lobbyOnlineCount: {
    color: '#a7f3d0',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  lobbyPermissionPanel: {
    padding: 13,
    marginBottom: 18,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 16,
  },
  lobbyPermissionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  lobbyPermissionTitle: {
    color: '#dceaf7',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  lobbyPermissionSummary: {
    color: '#fde68a',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  lobbyPermissionChecks: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 3,
  },
  lobbyPermissionCheck: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: '#0b1725',
    borderRadius: 10,
  },
  lobbyPermissionCheckLabel: {
    color: '#8fa9bf',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  lobbyPermissionCheckValue: {
    fontSize: 9,
    fontWeight: '900',
  },
  lobbyPermissionNeedsAction: {
    color: '#fde68a',
  },
  lobbyPermissionGranted: {
    color: '#4ade80',
  },
  lobbyPermissionHelp: {
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 18,
  },
  roomCodeLabel: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  lobbyRoomCode: {
    color: '#dff9f1',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 4,
    marginTop: 2,
  },
  lobbyRoomCodeHint: {
    color: '#7f9bb5',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  lobbyListTitle: {
    color: '#f3f7ff',
    fontSize: 17,
    fontWeight: '900',
  },
  lobbyRosterMeta: {
    color: '#7f9bb5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
    marginTop: 3,
  },
  lobbyRosterOnline: {
    color: '#a7f3d0',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  lobbyHint: {
    color: '#9db0c4',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  homeWelcome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1f2d3d',
    borderRadius: 14,
    padding: 12,
    marginTop: 14,
    marginBottom: 8,
  },
  homeWelcomeAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  homeWelcomeCopy: {
    flex: 1,
  },
  homeGuideButton: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#102d3a',
    borderWidth: 1,
    borderColor: '#1c6471',
    borderRadius: 14,
  },
  homeGuideIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#164e63',
    borderRadius: 17,
  },
  homeGuideIconText: {
    color: '#cffafe',
    fontSize: 20,
    fontWeight: '900',
  },
  homeGuideCopy: {
    flex: 1,
  },
  homeGuideTitle: {
    color: '#e0f2fe',
    fontSize: 13,
    fontWeight: '900',
  },
  homeGuideDescription: {
    color: '#a5c9d6',
    fontSize: 11,
    marginTop: 3,
  },
  homeGuideArrow: {
    color: '#67e8f9',
    fontSize: 26,
    fontWeight: '500',
  },
  playerNamePreviewLabel: {
    color: '#9db0c4',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  playerNamePreviewValue: {
    color: '#dff9f1',
    fontSize: 17,
    fontWeight: '800',
  },
  label: {
    color: '#aabdd7',
    marginBottom: 8,
    marginTop: 8,
  },
  usernameHint: {
    color: '#7f9bb5',
    fontSize: 11,
    lineHeight: 16,
    marginTop: -4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1d3044',
    borderWidth: 1,
    borderColor: '#2b3e53',
    borderRadius: 12,
    color: '#edf3ff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  joinRoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  joinRoomInput: {
    flex: 1,
    marginBottom: 0,
  },
  nearbyRoomSection: {
    gap: 8,
  },
  nearbyRoomTitle: {
    color: '#f3f7ff',
    fontSize: 15,
    fontWeight: '900',
  },
  nearbyRoomDescription: {
    color: '#9db0c4',
    fontSize: 12,
    lineHeight: 18,
  },
  nearbyRoomSearchButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#164e63',
    borderWidth: 1,
    borderColor: '#67e8f9',
    borderRadius: 12,
  },
  nearbyRoomSearchText: {
    color: '#ecfeff',
    fontSize: 13,
    fontWeight: '900',
  },
  nearbyRoomError: {
    color: '#ffb454',
    fontSize: 12,
    lineHeight: 18,
  },
  nearbyRoomEmpty: {
    color: '#9db0c4',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 8,
  },
  nearbyRoomCard: {
    padding: 12,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 14,
  },
  nearbyRoomCardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nearbyRoomCode: {
    color: '#f3f7ff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },
  nearbyRoomDistance: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '800',
  },
  nearbyRoomCardDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 7,
  },
  nearbyRoomMeta: {
    flex: 1,
    color: '#9db0c4',
    fontSize: 11,
    fontWeight: '600',
  },
  nearbyRoomJoinText: {
    color: '#fde68a',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  qrScanButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2d3d',
    borderWidth: 1,
    borderColor: '#3b536b',
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: '#4dd9b5',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: {
    color: '#072131',
    fontWeight: '800',
    fontSize: 16,
  },
  lobbyStartButton: {
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingVertical: 15,
  },
  lobbyStartText: {
    color: '#072131',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  secondaryButton: {
    backgroundColor: '#1f2d3d',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryText: {
    color: '#f3f7ff',
    fontWeight: '700',
    fontSize: 16,
  },
  resultActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14,
  },
  resultActionButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  resultRematchButton: {
    flex: 1,
    backgroundColor: '#4dd9b5',
  },
  resultRematchText: {
    color: '#072131',
  },
  resultLeaveButton: {
    minWidth: 118,
    backgroundColor: '#1f2d3d',
    borderWidth: 1,
    borderColor: '#3b536b',
  },
  resultLeaveText: {
    color: '#cbd5e1',
  },
  resultActionText: {
    fontSize: 12,
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.45,
  },
  radiusOptions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  radiusButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#26384b',
    borderRadius: 10,
    paddingVertical: 10,
  },
  radiusButtonSelected: {
    backgroundColor: '#4dd9b5',
  },
  radiusButtonText: {
    color: '#dceaf7',
    fontWeight: '700',
  },
  radiusButtonTextSelected: {
    color: '#072131',
  },
  lobbyListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  lobbyRosterCard: {
    overflow: 'hidden',
    backgroundColor: '#101f30',
    borderWidth: 1,
    borderColor: '#263d52',
    borderRadius: 16,
    marginBottom: 10,
  },
  dangerButton: {
    backgroundColor: '#7f1d1d',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  dangerText: {
    color: '#fee2e2',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  dangerNotice: {
    backgroundColor: '#451a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#2b3e53',
    marginVertical: 16,
  },
  cameraFrame: {
    height: 320,
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: '#000000',
    marginBottom: 14,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#26384b',
  },
  playerHostRow: {
    borderBottomColor: '#2d655d',
  },
  playerSelfRow: {
    backgroundColor: 'rgba(27, 83, 85, 0.24)',
    borderLeftWidth: 2,
    borderLeftColor: '#4dd9b5',
  },
  playerIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0b1725',
  },
  playerAvatarFrame: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2d3d',
    borderWidth: 1,
    borderColor: '#3a566e',
    borderRadius: 22,
  },
  playerHostAvatar: {
    borderColor: '#4dd9b5',
    borderWidth: 2,
  },
  playerDetails: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    color: '#edf3ff',
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  playerConnection: {
    color: '#9db0c4',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  playerConnectionReady: {
    color: '#86efac',
  },
  playerConnectionWaiting: {
    color: '#fde68a',
  },
  playerConnectionOffline: {
    color: '#fca5a5',
  },
  playerBadge: {
    backgroundColor: '#2f5b6f',
    color: '#dff9f1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginLeft: 8,
  },
  hostBadge: {
    backgroundColor: '#1c3b39',
    color: '#b8f5df',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  soundToggle: {
    alignSelf: 'flex-end',
    backgroundColor: '#1e3047',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 10,
  },
  soundToggleText: {
    color: '#cfe1f7',
    fontSize: 12,
    fontWeight: '700',
  },
  timerBox: {
    minWidth: 86,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#1e3047',
    alignItems: 'center',
  },
  timerLabel: {
    color: '#9db0c4',
    fontSize: 11,
    textAlign: 'center',
  },
  timerValue: {
    color: '#f3f7ff',
    fontSize: 28,
    fontWeight: '800',
  },
  roleBox: {
    backgroundColor: '#1c3242',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  proximityBanner: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  proximityLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  proximityMessage: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  noticeBox: {
    backgroundColor: '#3b321f',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  noticeText: {
    color: '#ffe1a6',
    textAlign: 'center',
  },
  locationSuccess: {
    backgroundColor: '#1c3b39',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  locationSuccessText: {
    color: '#77e0c7',
    textAlign: 'center',
    fontWeight: '700',
  },
  locationWarning: {
    backgroundColor: '#3b321f',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  locationWarningText: {
    color: '#ffe1a6',
    textAlign: 'center',
  },
  locationRetryButton: {
    backgroundColor: '#1f2d3d',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  resultBox: {
    backgroundColor: '#1c3b39',
    borderColor: '#4dd9b5',
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  resultRoomCode: {
    color: '#b8cbd8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  resultStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: 'rgba(2, 6, 23, 0.35)',
    borderRadius: 999,
  },
  resultStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4dd9b5',
  },
  resultStatusText: {
    color: '#e2e8f0',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  resultPersonalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingVertical: 4,
  },
  resultPersonalIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  resultPersonalIconWin: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
  },
  resultPersonalIconLoss: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
  },
  resultPersonalIconSpectator: {
    backgroundColor: 'rgba(148, 163, 184, 0.16)',
  },
  resultPersonalIconText: {
    color: '#f8fafc',
    fontSize: 23,
    fontWeight: '900',
  },
  resultPersonalCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultPersonalEyebrow: {
    color: '#aabdd7',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  resultPersonalTitle: {
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginTop: 1,
  },
  resultPersonalTitleWin: {
    color: '#86efac',
  },
  resultPersonalTitleLoss: {
    color: '#fca5a5',
  },
  resultPersonalTitleSpectator: {
    color: '#cbd5e1',
  },
  resultPersonalDescription: {
    color: '#c0d0dc',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  resultWinnerFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 18,
    marginBottom: 16,
  },
  resultWinnerArtFrame: {
    width: 94,
    height: 94,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 23,
    padding: 5,
    backgroundColor: 'rgba(2, 6, 23, 0.28)',
  },
  resultWinnerImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
  },
  resultWinnerCopy: {
    flex: 1,
  },
  resultWinnerDescription: {
    color: '#b8cbd8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  resultWinnerCaption: {
    color: '#77e0c7',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  resultLabel: {
    color: '#77e0c7',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  resultText: {
    color: '#f3f7ff',
    fontSize: 26,
    fontWeight: '900',
    marginTop: 2,
  },
  resultMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 7,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.16)',
  },
  resultDurationMetric: {
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 2,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  resultDurationValue: {
    color: '#f3f7ff',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  resultMetric: {
    flex: 1,
    minWidth: 0,
  },
  resultMetricLabel: {
    color: '#9db0c4',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  resultMetricValue: {
    color: '#f3f7ff',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 4,
  },
  resultMetricDivider: {
    width: 1,
    height: 27,
    backgroundColor: 'rgba(226, 232, 240, 0.16)',
  },
  resultChallengeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.16)',
  },
  resultChallengeLabel: {
    color: '#b8cbd8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  resultChallengeValue: {
    color: '#fef3c7',
    fontSize: 10,
    fontWeight: '900',
  },
  resultRecapBox: {
    marginBottom: 20,
  },
  gameTimelineNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 62,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#31506a',
    borderRadius: 14,
  },
  gameTimelineNavigationCopy: {
    flex: 1,
  },
  gameTimelineNavigationEyebrow: {
    color: '#67e8f9',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  gameTimelineNavigationTitle: {
    color: '#f3f7ff',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  gameTimelineNavigationCount: {
    minWidth: 24,
    color: '#9db0c4',
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
  },
  gameTimelineNavigationArrow: {
    color: '#67e8f9',
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '700',
  },
  resultRecapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  resultRecapEyebrow: {
    color: '#67e8f9',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  resultRecapTitle: {
    color: '#f3f7ff',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  resultRecapCount: {
    color: '#a5b8ca',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: '#1f2d3d',
    borderRadius: 999,
  },
  resultSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    backgroundColor: '#122237',
    borderWidth: 1,
    borderColor: '#294057',
    borderRadius: 12,
  },
  resultSearchInput: {
    flex: 1,
    minHeight: 44,
    color: '#f3f7ff',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resultSearchClear: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  resultSearchClearText: {
    color: '#9db0c4',
    fontSize: 22,
    lineHeight: 24,
  },
  resultSearchCount: {
    color: '#9db0c4',
    fontSize: 10,
    marginBottom: 4,
  },
  resultSearchEmpty: {
    color: '#9db0c4',
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 18,
    textAlign: 'center',
  },
  resultPlayerRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.2)',
  },
  resultPlayerHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resultPlayerImage: {
    width: 48,
    height: 48,
    borderRadius: 13,
  },
  resultPlayerIdentity: {
    flex: 1,
    minWidth: 0,
  },
  resultPlayerName: {
    color: '#f3f7ff',
    fontSize: 13,
    fontWeight: '900',
  },
  resultPlayerRole: {
    color: '#cfe1f7',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginTop: 3,
  },
  resultPlayerStatus: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  resultPlayerStatusWinner: {
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
  },
  resultPlayerStatusFinished: {
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
  },
  resultPlayerStatusLoser: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  resultPlayerStatusText: {
    color: '#a5b4c3',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  resultPlayerStatusWinnerText: {
    color: '#86efac',
  },
  resultPlayerStatusLoserText: {
    color: '#fca5a5',
  },
  resultPlayerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  resultPlayerMetaText: {
    color: '#b8cbd8',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
    paddingRight: 8,
  },
  resultMission: {
    paddingTop: 8,
  },
  resultMissionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  resultMissionLabel: {
    flex: 1,
    color: '#dceaf7',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  resultMissionCount: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  resultMissionCountComplete: {
    color: '#86efac',
  },
  resultMissionTrack: {
    height: 5,
    overflow: 'hidden',
    marginTop: 7,
    backgroundColor: 'rgba(148, 163, 184, 0.22)',
    borderRadius: 3,
  },
  resultMissionFill: {
    height: '100%',
    backgroundColor: '#fbbf24',
    borderRadius: 3,
  },
  resultMissionFillComplete: {
    backgroundColor: '#34d399',
  },
  resultMissionStatus: {
    color: '#7f9bb5',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginTop: 5,
  },
  roleLabel: {
    color: '#77e0c7',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  roleName: {
    color: '#edf3ff',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 6,
  },
  roleDescription: {
    color: '#dceaf7',
    fontSize: 14,
    lineHeight: 20,
  },
  missionBox: {
    marginTop: 8,
    marginBottom: 12,
  },
  locationPanel: {
    backgroundColor: '#1f2d3d',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 5,
  },
  landmarkTargetCard: {
    backgroundColor: '#172638',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    gap: 6,
  },
  badgePanel: {
    backgroundColor: '#1f2d3d',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  badgeText: {
    color: '#ffe1a6',
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 6,
  },
  locationDistance: {
    color: '#77e0c7',
    fontSize: 16,
    fontWeight: '800',
  },
  missionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1f2d3d',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  missionText: {
    color: '#edf3ff',
    fontWeight: '600',
    flex: 1,
  },
  missionProgress: {
    color: '#9db0c4',
    fontWeight: '700',
  },
  actionGroup: {
    marginTop: 8,
    marginBottom: 14,
  },
  seekerScanPanel: {
    backgroundColor: '#142438',
    borderColor: '#31506a',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    marginBottom: 10,
  },
  seekerScanStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  seekerScanStatus: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
  },
  seekerScanRange: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '900',
  },
  seekerScanNotice: {
    color: '#fef3c7',
    backgroundColor: 'rgba(120, 53, 15, 0.55)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '700',
  },
  seekerScanActions: {
    flexDirection: 'row',
    gap: 8,
  },
  seekerScanButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  seekerScanPrimaryButton: {
    backgroundColor: '#4dd9b5',
  },
  seekerScanButtonText: {
    color: '#072131',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
  },
  seekerScanExchangeButton: {
    backgroundColor: '#3a2f1e',
    borderColor: '#fcd34d',
    borderWidth: 1,
  },
  seekerScanExchangeText: {
    color: '#fde68a',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '900',
  },
  broadcastFloatingCluster: {
    position: 'absolute',
    zIndex: 30,
    elevation: 30,
  },
  broadcastFloatingRow: {
    position: 'absolute',
  },
  liveActionMenuButton: {
    position: 'absolute',
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(248, 250, 252, 0.58)',
    zIndex: 2,
    elevation: 8,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 7,
  },
  liveActionMenuButtonSelected: {
    borderColor: '#ffffff',
    borderWidth: 3,
    transform: [{ scale: 1.06 }],
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },
  liveActionMenuIconBox: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  liveSkillScanProgress: {
    position: 'absolute',
    left: 13,
    right: 13,
    bottom: 7,
    flexDirection: 'row',
    gap: 3,
  },
  liveSkillScanSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
  },
  liveSkillScanSegmentUsed: {
    backgroundColor: '#38bdf8',
  },
  liveSkillExchangeBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    width: 23,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#422006',
    backgroundColor: '#fef3c7',
  },
  liveSkillExchangeDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#92400e',
  },
  liveActionConnector: {
    position: 'absolute',
    top: 0,
    zIndex: 1,
  },
  liveActionHubButton: {
    overflow: 'visible',
    zIndex: 3,
    elevation: 10,
  },
  liveActionHubButtonOpen: {
    backgroundColor: '#334155',
    borderColor: '#cbd5e1',
  },
  liveActionHubPulse: {
    position: 'absolute',
    left: -7,
    top: -7,
    width: 76,
    height: 76,
    borderWidth: 2,
    borderRadius: 38,
  },
  liveActionHubIconShell: {
    position: 'relative',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(248, 250, 252, 0.65)',
    borderRadius: 22,
  },
  liveActionHubMicBadge: {
    position: 'absolute',
    right: -4,
    bottom: -3,
    width: 19,
    height: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#155e75',
    borderWidth: 1.5,
    borderColor: '#cffafe',
    borderRadius: 10,
  },
  broadcastMicButton: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e7490',
    borderColor: '#a5f3fc',
    borderWidth: 2,
    borderRadius: 31,
    shadowColor: '#020617',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  broadcastRecordingButton: {
    backgroundColor: '#b91c1c',
    borderColor: '#fecaca',
  },
  broadcastStartingButton: {
    backgroundColor: '#155e75',
    borderColor: '#67e8f9',
  },
  broadcastRecordingIndicator: {
    position: 'absolute',
    right: -3,
    top: -3,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: '#f8fafc',
    borderRadius: 11,
  },
  broadcastRecordingDot: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 14,
    height: 14,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#fee2e2',
    borderRadius: 7,
  },
  broadcastFreeQuotaIndicator: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 19,
    height: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#86efac',
    borderColor: '#052e16',
    borderWidth: 2,
    borderRadius: 10,
  },
  broadcastCreditIndicator: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#92400e',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 10,
  },
  broadcastExchangeButton: {
    width: 52,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3a2f1e',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 6,
    elevation: 5,
  },
  liveActionExchangeButton: {
    width: 60,
    height: 60,
    minHeight: 60,
    paddingVertical: 0,
    borderRadius: 30,
    zIndex: 2,
    elevation: 8,
  },
  gettingStartedBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    backgroundColor: 'rgba(2, 6, 23, 0.88)',
  },
  gettingStartedScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    width: '100%',
  },
  gettingStartedCard: {
    width: '100%',
    maxWidth: 430,
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#122237',
    borderColor: '#2b6473',
    borderWidth: 1,
    borderRadius: 24,
  },
  gettingStartedLogo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 10,
  },
  gettingStartedEyebrow: {
    color: '#67e8f9',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 7,
  },
  gettingStartedTitle: {
    color: '#f3f7ff',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  gettingStartedDescription: {
    color: '#aabdd7',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  gettingStartedStep: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    marginTop: 7,
    backgroundColor: '#1a2d42',
    borderRadius: 14,
  },
  gettingStartedStepNumber: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '900',
    paddingTop: 1,
  },
  gettingStartedStepCopy: {
    flex: 1,
  },
  gettingStartedStepTitle: {
    color: '#f3f7ff',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 3,
  },
  gettingStartedStepText: {
    color: '#b7c8db',
    fontSize: 11,
    lineHeight: 16,
  },
  gettingStartedButton: {
    minHeight: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    backgroundColor: '#0e7490',
    borderRadius: 14,
  },
  gettingStartedButtonText: {
    color: '#ecfeff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  roleRevealBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(2, 6, 23, 0.9)',
  },
  roleRevealCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    padding: 22,
    borderWidth: 2,
    borderRadius: 26,
  },
  roleRevealEyebrow: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: 16,
  },
  roleRevealImage: {
    borderWidth: 3,
    borderRadius: 26,
    marginBottom: 16,
  },
  roleRevealTitle: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0.6,
    textAlign: 'center',
    marginBottom: 8,
  },
  roleRevealDescription: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  roleRevealHint: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
  },
  roleRevealButton: {
    minHeight: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    borderRadius: 14,
  },
  roleRevealButtonText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  broadcastModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
  },
  broadcastModalCard: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    backgroundColor: '#122237',
    borderColor: '#3b647e',
    borderWidth: 1,
    borderRadius: 22,
  },
  appAlertBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
  },
  appAlertCard: {
    width: '100%',
    maxWidth: 390,
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#122237',
    borderColor: '#3b647e',
    borderWidth: 1,
    borderRadius: 22,
  },
  appAlertIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    backgroundColor: '#3b321f',
    borderColor: '#facc15',
    borderWidth: 1,
    borderRadius: 22,
  },
  appAlertIconText: {
    color: '#fde68a',
    fontSize: 24,
    fontWeight: '900',
  },
  appAlertEyebrow: {
    color: '#67e8f9',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  appAlertMessage: {
    alignSelf: 'stretch',
    color: '#f3f7ff',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  appAlertButton: {
    minHeight: 46,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e7490',
    borderRadius: 13,
  },
  appAlertButtonText: {
    color: '#ecfeff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  proximityOutcomeBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(2, 6, 23, 0.84)',
  },
  proximityOutcomeCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#29171c',
    borderColor: '#fb7185',
    borderWidth: 2,
    borderRadius: 24,
  },
  proximityExplosion: {
    fontSize: 74,
    marginBottom: 8,
  },
  proximityOutcomeEyebrow: {
    color: '#fda4af',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
    marginBottom: 8,
  },
  proximityOutcomeTitle: {
    color: '#fff1f2',
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 10,
  },
  proximityOutcomeText: {
    color: '#ffe4e6',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 18,
  },
  proximityOutcomeButton: {
    minHeight: 46,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#be123c',
    borderRadius: 13,
  },
  proximityOutcomeButtonText: {
    color: '#fff1f2',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  broadcastModalEyebrow: {
    color: '#67e8f9',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  broadcastModalTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 12,
  },
  broadcastModalText: {
    color: '#d1dce8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  broadcastModalButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e7490',
    borderRadius: 13,
    marginTop: 6,
  },
  broadcastModalButtonText: {
    color: '#ecfeff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  mutedText: {
    color: '#9db0c4',
  },
  themePreferenceSection: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#142438',
    borderWidth: 1,
    borderColor: '#31506a',
  },
  themePreferenceTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
  },
  themePreferenceHint: {
    color: '#9db0c4',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  themePreferenceOptions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  themePreferenceOption: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#1e293b',
  },
  themePreferenceOptionSelected: {
    borderColor: '#4dd9b5',
    backgroundColor: '#164e63',
  },
  themePreferenceOptionText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  themePreferenceOptionTextSelected: {
    color: '#ecfeff',
  },
  });
  const lightThemeOverrides = StyleSheet.create({
        container: { backgroundColor: '#f8fafc' },
        startupLoadingScreen: { backgroundColor: '#f8fafc' },
        startupLoadingTitle: { color: '#0f172a' },
        startupLoadingMessage: { color: '#475569' },
        title: { color: '#0f172a' },
        subtitle: { color: '#475569' },
        sectionTitle: { color: '#0f172a' },
        cardEyebrow: { color: '#92400e' },
        mutedText: { color: '#475569' },
        label: { color: '#334155' },
        usernameHint: { color: '#475569' },
        connectionOnline: { color: '#047857' },
        connectionOffline: { color: '#b45309' },
        card: {
          backgroundColor: '#ffffff',
          shadowColor: '#64748b',
          shadowOpacity: 0.12,
        },
        homeHero: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        homeHeroEyebrowText: { color: '#92400e' },
        homeHeroDismiss: { backgroundColor: '#e2e8f0' },
        homeHeroDismissText: { color: '#334155' },
        homeHeroSubtitle: { color: '#166534' },
        homeHeroDescription: { color: '#475569' },
        homeGuideButton: { backgroundColor: '#f0f9ff', borderColor: '#bae6fd' },
        homeGuideIcon: { backgroundColor: '#e0f2fe' },
        homeGuideIconText: { color: '#075985' },
        homeGuideTitle: { color: '#0f172a' },
        homeGuideDescription: { color: '#475569' },
        homeGuideArrow: { color: '#0369a1' },
        homeWelcome: { backgroundColor: '#e2e8f0' },
        playerNamePreviewLabel: { color: '#475569' },
        playerNamePreviewValue: { color: '#0f172a' },
        input: {
          backgroundColor: '#ffffff',
          borderColor: '#94a3b8',
          color: '#0f172a',
        },
        nearbyRoomTitle: { color: '#0f172a' },
        nearbyRoomDescription: { color: '#475569' },
        nearbyRoomSearchButton: {
          backgroundColor: '#e0f2fe',
          borderColor: '#7dd3fc',
        },
        nearbyRoomSearchText: { color: '#075985' },
        nearbyRoomError: { color: '#b45309' },
        nearbyRoomCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        nearbyRoomCode: { color: '#0f172a' },
        nearbyRoomDistance: { color: '#0369a1' },
        nearbyRoomMeta: { color: '#475569' },
        nearbyRoomJoinText: { color: '#92400e' },
        nearbyRoomEmpty: { color: '#475569' },
        qrScanButton: { backgroundColor: '#e2e8f0', borderColor: '#94a3b8' },
        secondaryButton: { backgroundColor: '#e2e8f0' },
        secondaryText: { color: '#0f172a' },
        primaryButton: { backgroundColor: '#4dd9b5' },
        primaryText: { color: '#072131' },
        dangerButton: { backgroundColor: '#fee2e2', borderColor: '#fecaca' },
        dangerText: { color: '#991b1b' },
        dangerNotice: { backgroundColor: '#fee2e2' },
        divider: { backgroundColor: '#cbd5e1' },
        resultLeaveButton: { backgroundColor: '#e2e8f0', borderColor: '#cbd5e1' },
        resultLeaveText: { color: '#334155' },
        radiusButton: { backgroundColor: '#e2e8f0' },
        radiusButtonText: { color: '#334155' },
        lobbyRosterCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        playerRow: { borderColor: '#cbd5e1' },
        playerSelfRow: { backgroundColor: '#ecfdf5' },
        playerAvatar: { backgroundColor: '#e2e8f0' },
        playerAvatarFrame: { backgroundColor: '#e2e8f0', borderColor: '#94a3b8' },
        playerName: { color: '#0f172a' },
        playerConnection: { color: '#475569' },
        playerConnectionReady: { color: '#047857' },
        playerConnectionWaiting: { color: '#a16207' },
        playerConnectionOffline: { color: '#b91c1c' },
        playerBadge: { backgroundColor: '#e0f2fe', color: '#075985' },
        hostBadge: { backgroundColor: '#dcfce7', color: '#166534' },
        soundToggle: { backgroundColor: '#e2e8f0' },
        soundToggleText: { color: '#334155' },
        timerBox: { backgroundColor: '#e2e8f0' },
        timerLabel: { color: '#475569' },
        timerValue: { color: '#0f172a' },
        roleBox: { backgroundColor: '#e0f2fe' },
        noticeBox: { backgroundColor: '#fef3c7' },
        noticeText: { color: '#713f12' },
        locationSuccess: { backgroundColor: '#dcfce7' },
        locationSuccessText: { color: '#166534' },
        locationWarning: { backgroundColor: '#fef3c7' },
        locationWarningText: { color: '#713f12' },
        locationRetryButton: { backgroundColor: '#e2e8f0' },
        resultRoomCode: { color: '#475569' },
        resultLabel: { color: '#0e7490' },
        resultMetricRow: { borderTopColor: '#cbd5e1' },
        resultMetricDivider: { backgroundColor: '#cbd5e1' },
        resultChallengeNotice: { borderTopColor: '#cbd5e1' },
        resultStatusChip: { backgroundColor: 'rgba(255, 255, 255, 0.7)' },
        resultStatusText: { color: '#334155' },
        resultPersonalIconText: { color: '#334155' },
        resultPersonalEyebrow: { color: '#475569' },
        resultPersonalDescription: { color: '#475569' },
        resultWinnerDescription: { color: '#475569' },
        resultDurationMetric: { backgroundColor: 'rgba(255, 255, 255, 0.7)' },
        resultText: { color: '#0f172a' },
        resultDurationValue: { color: '#0f172a' },
        resultMetricLabel: { color: '#475569' },
        resultMetricValue: { color: '#0f172a' },
        resultChallengeLabel: { color: '#475569' },
        resultChallengeValue: { color: '#713f12' },
        resultRecapEyebrow: { color: '#0369a1' },
        resultRecapTitle: { color: '#0f172a' },
        resultRecapCount: { color: '#334155', backgroundColor: '#e2e8f0' },
        resultSearchRow: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        resultSearchInput: { color: '#0f172a' },
        resultSearchClearText: { color: '#475569' },
        resultSearchCount: { color: '#475569' },
        resultSearchEmpty: { color: '#475569' },
        resultPlayerRow: { borderBottomColor: '#cbd5e1' },
        resultPlayerName: { color: '#0f172a' },
        resultPlayerRole: { color: '#334155' },
        resultPlayerStatusText: { color: '#475569' },
        resultPlayerStatusWinnerText: { color: '#166534' },
        resultPlayerStatusLoserText: { color: '#b91c1c' },
        resultPlayerMetaText: { color: '#475569' },
        resultMissionLabel: { color: '#334155' },
        resultMissionCount: { color: '#334155' },
        resultMissionCountComplete: { color: '#166534' },
        resultMissionStatus: { color: '#475569' },
        roleLabel: { color: '#047857' },
        roleName: { color: '#0f172a' },
        roleDescription: { color: '#334155' },
        locationPanel: { backgroundColor: '#e2e8f0' },
        landmarkTargetCard: { backgroundColor: '#f1f5f9' },
        badgePanel: { backgroundColor: '#e2e8f0' },
        badgeText: { color: '#713f12' },
        locationDistance: { color: '#047857' },
        missionRow: { backgroundColor: '#e2e8f0' },
        missionText: { color: '#0f172a' },
        missionProgress: { color: '#475569' },
        seekerScanRange: { color: '#0369a1' },
        seekerScanExchangeButton: { backgroundColor: '#fef3c7' },
        seekerScanExchangeText: { color: '#713f12' },
        gameTimelineNavigation: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        gameTimelineNavigationEyebrow: { color: '#0369a1' },
        gameTimelineNavigationTitle: { color: '#0f172a' },
        gameTimelineNavigationCount: { color: '#475569' },
        gameTimelineNavigationArrow: { color: '#0369a1' },
        featureLauncherEntry: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        featureLauncherEntryText: { color: '#0f172a' },
        featureLauncherButton: {
          backgroundColor: '#0e7490',
          borderColor: '#0891b2',
          shadowColor: '#64748b',
        },
        featureLauncherButtonText: { color: '#ffffff' },
        profileModalContainer: { backgroundColor: '#f8fafc' },
        profileIdentityCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        profileAvatar: { backgroundColor: '#e0f2fe', borderColor: '#0891b2' },
        profileIdentityCompanionTag: { backgroundColor: '#0e7490' },
        profileCharacterSettingsButton: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        profileCharacterSettingsTitle: { color: '#0f172a' },
        profileCharacterSettingsHint: { color: '#475569' },
        profileCharacterSettingsArrow: { color: '#0369a1' },
        profileCharacterBackText: { color: '#0369a1' },
        profileAvatarChoice: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        profileAvatarChoiceSelected: { backgroundColor: '#ecfdf5' },
        profileAvatarChoiceImage: { backgroundColor: '#e2e8f0' },
        profileAvatarChoiceLabel: { color: '#0f172a' },
        profileAvatarChoiceProgress: { color: '#92400e' },
        profileCompanionChoice: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        profileCompanionChoiceSelected: { backgroundColor: '#ecfdf5' },
        profileCompanionName: { color: '#0f172a' },
        profileCompanionHint: { color: '#475569' },
        profileCompanionError: { color: '#b45309' },
        profileSpeechHint: { color: '#475569' },
        profileSpeechRadio: { borderColor: '#64748b' },
        profileSpeechRadioSelected: { backgroundColor: '#0e7490' },
        profileSpeechOption: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        profileSpeechOptionSelected: { backgroundColor: '#ecfdf5' },
        profileSpeechPreviewButton: { backgroundColor: '#0e7490' },
        profileSpeechPreviewText: { color: '#ffffff' },
        profileSpeechVoiceName: { color: '#0f172a' },
        profileSpeechVoiceLanguage: { color: '#475569' },
        profileSpeechError: { color: '#b45309' },
        profileAvatarHint: { color: '#475569' },
        profileAvatarStatusText: { color: '#047857' },
        profileAvatarError: { color: '#b45309' },
        profileUsername: { color: '#0f172a' },
        profileCaption: { color: '#0369a1' },
        profileSectionTitle: { color: '#0f172a' },
        profileSectionMeta: { color: '#475569' },
        profileBalanceCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        profileBalanceValue: { color: '#047857' },
        profileBadgeValue: { color: '#92400e' },
        profileBalanceLabel: { color: '#334155' },
        profileHint: {
          color: '#475569',
          backgroundColor: '#ffffff',
          borderColor: '#cbd5e1',
        },
        profileLogoutButton: {
          backgroundColor: '#fee2e2',
          borderColor: '#fecaca',
        },
        profileLogoutText: { color: '#991b1b' },
        leaderboardModalContainer: { backgroundColor: '#f8fafc' },
        leaderboardModalHeader: { borderBottomColor: '#cbd5e1' },
        leaderboardModalTitle: { color: '#0f172a' },
        leaderboardModalClose: { backgroundColor: '#e2e8f0' },
        leaderboardModalCloseText: { color: '#0f172a' },
        leaderboardSummary: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        leaderboardSummaryLabel: { color: '#0369a1' },
        leaderboardSummaryValue: { color: '#0f172a' },
        leaderboardCriteria: { borderTopColor: '#cbd5e1' },
        leaderboardCriteriaText: { color: '#334155' },
        leaderboardPeriodButton: { borderColor: '#cbd5e1' },
        leaderboardPeriodButtonSelected: { backgroundColor: '#cffafe', borderColor: '#0891b2' },
        leaderboardPeriodText: { color: '#334155' },
        leaderboardPeriodTextSelected: { color: '#164e63' },
        leaderboardEmpty: { color: '#475569' },
        leaderboardEntry: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        leaderboardEntryTop: { backgroundColor: '#f1f5f9', borderColor: '#cbd5e1' },
        leaderboardEntryFirst: { borderColor: '#b28b42' },
        leaderboardRank: { backgroundColor: '#e2e8f0' },
        leaderboardRankFirst: { backgroundColor: '#fef3c7' },
        leaderboardRankSecond: { backgroundColor: '#e2e8f0' },
        leaderboardRankThird: { backgroundColor: '#ffedd5' },
        leaderboardRankText: { color: '#334155' },
        leaderboardAvatar: { backgroundColor: '#e2e8f0', borderColor: '#cbd5e1' },
        leaderboardUsername: { color: '#0f172a' },
        leaderboardRecord: { color: '#475569' },
        leaderboardBadgePill: { backgroundColor: '#fef3c7' },
        leaderboardBadges: { color: '#713f12' },
        leaderboardWinRate: { color: '#047857' },
        leaderboardWinRateLabel: { color: '#475569' },
        gameTimelinePage: { backgroundColor: '#f8fafc' },
        lobbyDetailsModalContainer: { backgroundColor: '#f8fafc' },
        lobbySettingsHero: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        lobbySettingsHeroGlow: { backgroundColor: 'rgba(168, 223, 72, 0.08)' },
        lobbySettingsEyebrow: { color: '#0369a1' },
        lobbySettingsCode: { color: '#0f172a' },
        lobbySettingsHint: { color: '#475569' },
        lobbySettingsStatus: { backgroundColor: '#f1f5f9', borderColor: '#cbd5e1' },
        lobbySettingsStatusText: { color: '#166534' },
        lobbySettingsQrPanel: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1' },
        lobbySettingsQrTitle: { color: '#0f172a' },
        lobbySettingsQrDescription: { color: '#475569' },
        lobbyDetailSection: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        lobbyDetailEyebrow: { color: '#475569' },
        lobbyDetailTitle: { color: '#0f172a' },
        lobbyDetailValueChip: { backgroundColor: '#ecfeff', borderColor: '#67e8f9' },
        lobbyDetailValueChipText: { color: '#0369a1' },
        lobbyDetailDescription: { color: '#475569' },
        lobbyRangeActive: { backgroundColor: '#f1f5f9' },
        lobbyRangeActiveLabel: { color: '#475569' },
        lobbyRangeActiveValue: { color: '#166534' },
        lobbyDetailFootnote: { color: '#475569' },
        lobbyBotInfo: { backgroundColor: '#f0f9ff', borderColor: '#bae6fd' },
        lobbyBotInfoIcon: { backgroundColor: '#e0f2fe' },
        lobbyBotInfoIconText: { color: '#075985' },
        lobbyBotInfoTitle: { color: '#075985' },
        lobbyBotInfoDescription: { color: '#475569' },
        lobbyEmergencyButton: {
          backgroundColor: '#fee2e2',
          borderColor: '#fecaca',
        },
        lobbyRoomCodeRow: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        lobbyDetailsButton: { backgroundColor: '#cffafe', borderColor: '#0891b2' },
        lobbyDetailsButtonIcon: { color: '#075985', backgroundColor: '#e0f2fe' },
        lobbyDetailsButtonText: { color: '#164e63' },
        lobbyHeroCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        lobbyHeroGlow: { backgroundColor: 'rgba(168, 223, 72, 0.08)' },
        lobbyTitle: { color: '#0f172a' },
        lobbyHeroDescription: { color: '#475569' },
        lobbyHeroAvatarFrame: { backgroundColor: 'rgba(226, 232, 240, 0.85)' },
        lobbyLeaveButton: { borderColor: '#cbd5e1' },
        lobbyLeaveButtonText: { color: '#334155' },
        lobbyRangeSummary: { backgroundColor: '#e2e8f0' },
        lobbyRangeLabel: { color: '#475569' },
        lobbyRangeValue: { color: '#047857' },
        lobbyRangeNotice: { color: '#713f12' },
        lobbyEyebrow: { color: '#92400e' },
        lobbyReadiness: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1' },
        lobbyReadinessSegment: { backgroundColor: '#cbd5e1' },
        lobbyOnlineMeta: { color: '#475569' },
        lobbyReadinessText: { color: '#334155' },
        lobbyOnlineCount: { color: '#166534' },
        lobbyPermissionPanel: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        lobbyPermissionTitle: { color: '#334155' },
        lobbyPermissionSummary: { color: '#92400e' },
        lobbyPermissionCheck: { backgroundColor: '#f1f5f9' },
        lobbyPermissionCheckLabel: { color: '#475569' },
        lobbyPermissionNeedsAction: { color: '#a16207' },
        lobbyPermissionGranted: { color: '#166534' },
        lobbyPermissionHelp: { color: '#92400e' },
        roomCodeLabel: { color: '#92400e' },
        lobbyRoomCode: { color: '#0f172a' },
        lobbyRoomCodeHint: { color: '#475569' },
        lobbyListTitle: { color: '#0f172a' },
        lobbyRosterMeta: { color: '#475569' },
        lobbyRosterOnline: { color: '#166534' },
        lobbyHint: { color: '#475569' },
        leaderboardModalEyebrow: { color: '#0369a1' },
        liveMapScreen: { backgroundColor: '#f8fafc' },
        liveTopBar: {
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          borderColor: '#cbd5e1',
        },
        livePlayerAvatarFrame: { backgroundColor: '#e2e8f0' },
        liveRoomTitle: { color: '#0f172a' },
        liveRoleText: { color: '#334155' },
        liveRoomCode: { color: '#475569' },
        liveConnectionOnline: { color: '#166534' },
        liveConnectionConnecting: { color: '#92400e' },
        liveConnectionOffline: { color: '#991b1b' },
        liveTimer: { backgroundColor: '#e2e8f0' },
        liveTimerLabel: { color: '#475569' },
        liveTimerValue: { color: '#0f172a' },
        liveIconButton: { backgroundColor: '#e2e8f0' },
        liveSecondaryAction: {
          backgroundColor: '#ffffff',
          borderColor: '#cbd5e1',
        },
        liveSecondaryActionText: { color: '#334155' },
        liveLocationPillWarning: {
          backgroundColor: 'rgba(254, 226, 226, 0.96)',
        },
        liveLocationText: { color: '#7f1d1d' },
        liveRetryButton: { backgroundColor: '#e2e8f0' },
        liveRetryText: { color: '#0f172a' },
        liveThreatCard: { backgroundColor: 'rgba(255, 255, 255, 0.96)' },
        liveImpostorPinHint: { backgroundColor: 'rgba(255, 241, 242, 0.96)' },
        liveImpostorPinHintText: { color: '#881337' },
        liveGameLog: {
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          borderColor: '#cbd5e1',
          shadowColor: '#64748b',
        },
        liveGameLogTitle: { color: '#0f172a' },
        liveGameLogLive: { color: '#166534' },
        liveGameLogCount: {
          color: '#0f172a',
          backgroundColor: '#e2e8f0',
        },
        liveGameLogItem: {
          borderColor: '#cbd5e1',
          backgroundColor: '#f8fafc',
        },
        liveGameLogItemLatest: {
          borderColor: '#67e8f9',
          backgroundColor: '#ecfeff',
        },
        liveGameLogText: {
          color: '#1e293b',
          textShadowColor: 'transparent',
          textShadowRadius: 0,
        },
        liveDockNoticeText: { color: '#713f12' },
        liveGameLogPreference: { backgroundColor: '#f1f5f9' },
        liveGameLogPreferenceHint: { color: '#475569' },
        liveGameLogPreferenceAction: { color: '#0e7490' },
        liveActionHubButtonOpen: {
          backgroundColor: '#ffffff',
          borderColor: '#94a3b8',
        },
        liveActionMenuButtonSelected: { borderColor: '#0e7490' },
        liveDetailsPanel: {
          backgroundColor: 'rgba(255, 255, 255, 0.97)',
          borderColor: '#cbd5e1',
          shadowColor: '#64748b',
        },
        liveDetailsTitle: {
          color: '#0f172a',
          textShadowColor: 'transparent',
          textShadowRadius: 0,
        },
        liveDetailsClose: { color: '#0369a1' },
        liveStatText: {
          color: '#1e293b',
          textShadowColor: 'transparent',
          textShadowRadius: 0,
        },
        liveLegendLabel: { color: '#334155' },
        liveMissionHint: { color: '#475569' },
        liveMissionRow: { backgroundColor: '#f1f5f9' },
        liveMissionProgress: { color: '#166534' },
        liveMissionProgressComplete: { color: '#14532d' },
        liveMissionTrackFillComplete: { backgroundColor: '#86efac' },
        liveHiderMissionRow: {
          backgroundColor: '#f0fdf4',
          borderColor: '#86efac',
        },
        liveDetailsMissionSummary: {
          backgroundColor: '#f0fdf4',
          borderColor: '#86efac',
        },
        liveDetailsMissionSummaryTitle: { color: '#166534' },
        liveDetailsMissionSummaryCount: { color: '#14532d' },
        liveBottomDock: {
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          borderColor: '#cbd5e1',
          shadowColor: '#64748b',
        },
        liveHiderMissions: { backgroundColor: 'rgba(241, 245, 249, 0.97)' },
        liveHiderMissionsTitle: { color: '#0f172a' },
        liveHiderMissionProgress: { color: '#166534' },
        liveHiderProgressSegment: { backgroundColor: '#cbd5e1' },
        liveHiderProgressSegmentComplete: { backgroundColor: '#16a34a' },
        livePreparationHint: { color: '#1e293b' },
        liveDetailsToggle: {
          backgroundColor: '#e2e8f0',
          borderColor: '#cbd5e1',
        },
        liveDetailsToggleText: { color: '#0f172a' },
        liveHiderNearestCard: {
          backgroundColor: 'rgba(240, 253, 244, 0.97)',
          borderColor: '#86efac',
        },
        liveHiderNearestIcon: { backgroundColor: '#dcfce7' },
        liveHiderNearestLabel: { color: '#166534' },
        liveHiderNearestDistance: { color: '#14532d' },
        liveHiderNearestStatus: { backgroundColor: '#dcfce7' },
        liveHiderNearestStatusWaiting: { backgroundColor: '#e2e8f0' },
        liveHiderNearestStatusText: { color: '#14532d' },
        gettingStartedBackdrop: { backgroundColor: 'rgba(15, 23, 42, 0.45)' },
        gettingStartedCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        gettingStartedEyebrow: { color: '#0369a1' },
        gettingStartedTitle: { color: '#0f172a' },
        gettingStartedDescription: { color: '#475569' },
        gettingStartedStep: { backgroundColor: '#f1f5f9' },
        gettingStartedStepNumber: { color: '#0369a1' },
        gettingStartedStepTitle: { color: '#0f172a' },
        gettingStartedStepText: { color: '#334155' },
        broadcastModalBackdrop: { backgroundColor: 'rgba(15, 23, 42, 0.45)' },
        broadcastModalCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        broadcastModalEyebrow: { color: '#0369a1' },
        broadcastModalTitle: { color: '#0f172a' },
        broadcastModalText: { color: '#334155' },
        appAlertBackdrop: { backgroundColor: 'rgba(15, 23, 42, 0.45)' },
        appAlertCard: { backgroundColor: '#ffffff', borderColor: '#cbd5e1' },
        appAlertEyebrow: { color: '#0369a1' },
        appAlertMessage: { color: '#1e293b' },
        proximityOutcomeBackdrop: { backgroundColor: 'rgba(15, 23, 42, 0.45)' },
        proximityOutcomeCard: {
          backgroundColor: '#fff1f2',
          borderColor: '#fb7185',
        },
        proximityOutcomeEyebrow: { color: '#9f1239' },
        proximityOutcomeTitle: { color: '#881337' },
        proximityOutcomeText: { color: '#881337' },
        liveSeekerStatusCard: {
          backgroundColor: '#f0f9ff',
          borderColor: '#bae6fd',
        },
        liveSeekerStatusActive: {
          color: '#166534',
          backgroundColor: '#dcfce7',
        },
        liveSeekerStatusEliminated: {
          color: '#991b1b',
          backgroundColor: '#fee2e2',
        },
        resultPersonalTitleWin: { color: '#166534' },
        resultPersonalTitleLoss: { color: '#b91c1c' },
        resultPersonalTitleSpectator: { color: '#475569' },
        resultWinnerCaption: { color: '#047857' },
        seekerScanPanel: { backgroundColor: '#f1f5f9', borderColor: '#cbd5e1' },
        seekerScanStatus: { color: '#334155' },
        seekerScanNotice: {
          color: '#713f12',
          backgroundColor: '#fef3c7',
        },
        seekerScanPrimaryButton: { backgroundColor: '#4dd9b5' },
        seekerScanButtonText: { color: '#072131' },
        liveDetailsToggleIcon: {
          backgroundColor: '#f1f5f9',
          borderColor: '#cbd5e1',
        },
        themePreferenceSection: {
          backgroundColor: '#ffffff',
          borderColor: '#cbd5e1',
        },
        themePreferenceTitle: { color: '#0f172a' },
        themePreferenceHint: { color: '#475569' },
        themePreferenceOption: {
          backgroundColor: '#f1f5f9',
          borderColor: '#cbd5e1',
        },
        themePreferenceOptionSelected: {
          backgroundColor: '#cffafe',
          borderColor: '#0891b2',
        },
        themePreferenceOptionText: { color: '#334155' },
        themePreferenceOptionTextSelected: { color: '#164e63' },
        resultBox: { backgroundColor: '#ffffff' },
  });

  const accentColorMap: Record<string, Record<string, string>> = isLightTheme
    ? {
        color: {
          '#67e8f9': '#42610f',
          '#77e0c7': '#42610f',
          '#4dd9b5': '#42610f',
          '#0e7490': '#42610f',
          '#0369a1': '#42610f',
          '#0891b2': '#42610f',
          '#075985': '#42610f',
          '#164e63': '#15200a',
          '#cffafe': '#42610f',
          '#a5f3fc': '#42610f',
          '#7dd3fc': '#42610f',
        },
        backgroundColor: {
          '#4dd9b5': '#a8df48',
          '#77e0c7': '#a8df48',
          '#0e7490': '#42610f',
          '#164e63': '#c3f36b',
          '#cffafe': '#f1f8df',
          '#ecfeff': '#f1f8df',
          '#e0f2fe': '#f1f8df',
          '#f0f9ff': '#f1f8df',
          '#ecfdf5': '#f1f8df',
        },
        borderColor: {
          '#67e8f9': '#547a14',
          '#77e0c7': '#547a14',
          '#4dd9b5': '#547a14',
          '#0e7490': '#547a14',
          '#0891b2': '#547a14',
          '#7dd3fc': '#547a14',
          '#bae6fd': '#a7c477',
          '#cffafe': '#547a14',
        },
        borderTopColor: {
          '#4dd9b5': '#547a14',
        },
        borderLeftColor: {
          '#4dd9b5': '#547a14',
        },
      }
    : {
        color: {
          '#67e8f9': '#c3f36b',
          '#77e0c7': '#c3f36b',
          '#4dd9b5': '#c3f36b',
          '#0e7490': '#c3f36b',
          '#cffafe': '#c3f36b',
          '#a5f3fc': '#c3f36b',
          '#7dd3fc': '#c3f36b',
        },
        backgroundColor: {
          '#4dd9b5': '#c3f36b',
          '#77e0c7': '#c3f36b',
          '#0e7490': '#42610f',
          '#164e63': '#42610f',
          '#163b43': '#26351d',
          '#102d3a': '#1d2615',
        },
        borderColor: {
          '#67e8f9': '#a8df48',
          '#77e0c7': '#a8df48',
          '#4dd9b5': '#a8df48',
          '#0e7490': '#a8df48',
          '#a7f3d0': '#a8df48',
          '#1c6471': '#a8df48',
          '#2dd4bf': '#a8df48',
          '#cffafe': '#a8df48',
          '#a5f3fc': '#a8df48',
        },
        borderLeftColor: {
          '#4dd9b5': '#a8df48',
        },
      };

  const applyAccentPalette = (style: object) => Object.fromEntries(
    Object.entries(style).map(([property, value]) => {
      if (typeof value !== 'string') return [property, value];
      return [property, accentColorMap[property]?.[value] ?? value];
    })
  );

  const mergedStyles = new Map<string, object>();
  for (const [styleName, baseStyle] of Object.entries(baseStyles)) {
    const override = isLightTheme
      ? lightThemeOverrides[styleName as keyof typeof lightThemeOverrides]
      : undefined;
    const paletteBaseStyle = applyAccentPalette(baseStyle);
    mergedStyles.set(
      styleName,
      override
        ? { ...paletteBaseStyle, ...applyAccentPalette(override) }
        : paletteBaseStyle
    );
  }
  for (const [styleName, override] of Object.entries(lightThemeOverrides)) {
    if (!(styleName in baseStyles)) {
      mergedStyles.set(styleName, isLightTheme ? applyAccentPalette(override) : {});
    }
  }

  return StyleSheet.create(
    Object.fromEntries(mergedStyles) as typeof baseStyles & typeof lightThemeOverrides
  );
}
