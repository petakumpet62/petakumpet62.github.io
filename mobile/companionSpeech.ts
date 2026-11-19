export type CompanionSpeechSegment = {
  text: string;
  fallbackText?: string;
  language: 'id-ID' | 'en';
};

export type CompanionId = 'kanca' | 'tara' | 'komo' | 'cendi' | 'bako';

export type CompanionSpeechStyle = {
  rate: number;
  pitch: number;
};

const companionSpeechStyles: Record<CompanionId, CompanionSpeechStyle> = {
  kanca: { rate: 0.92, pitch: 1 },
  tara: { rate: 0.86, pitch: 0.94 },
  komo: { rate: 1.02, pitch: 1.1 },
  cendi: { rate: 0.9, pitch: 0.97 },
  bako: { rate: 1.08, pitch: 1.06 },
};

const englishSpeechTerms = [
  { term: 'AI Companion', fallback: 'ei-ai kompenyen' },
  { term: 'leaderboard', fallback: 'li-der-bord' },
  { term: 'profile', fallback: 'pro-fail' },
  { term: 'reveal', fallback: 'ri-vil' },
  { term: 'mission', fallback: 'mi-syen' },
  { term: 'lobby', fallback: 'lo-bi' },
  { term: 'timer', fallback: 'tai-mer' },
  { term: 'bonus', fallback: 'bonus' },
  { term: 'impostor', fallback: 'im-pos-tor' },
  { term: 'scan', fallback: 'skan' },
  { term: 'room', fallback: 'rum' },
  { term: 'role', fallback: 'roul' },
  { term: 'game', fallback: 'geim' },
];

const englishSpeechTermsByName = new Map(
  englishSpeechTerms.map((entry) => [entry.term.toLowerCase(), entry])
);

export function getCompanionSpeechStyle(companionId: CompanionId) {
  return companionSpeechStyles[companionId];
}

function appendSegment(
  segments: CompanionSpeechSegment[],
  segment: CompanionSpeechSegment
) {
  if (!segment.text.trim()) return;
  segments.push({ ...segment, text: segment.text.trim() });
}

export function toIndonesianSpeech(message: string) {
  return message.replace(/\bSeeker\b/gi, 'pencari').replace(/\bHider\b/gi, 'penyembunyi');
}

export function createCompanionSpeechSegments(message: string): CompanionSpeechSegment[] {
  const speechText = toIndonesianSpeech(message);
  const terms = englishSpeechTerms
    .map(({ term }) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((first, second) => second.length - first.length);
  const matcher = new RegExp(`\\b(${terms.join('|')})\\b`, 'gi');
  const segments: CompanionSpeechSegment[] = [];
  let cursor = 0;

  for (const match of speechText.matchAll(matcher)) {
    const matchedTerm = match[0];
    const start = match.index ?? 0;
    const entry = englishSpeechTermsByName.get(matchedTerm.toLowerCase());
    if (!entry) continue;

    appendSegment(segments, {
      text: speechText.slice(cursor, start),
      language: 'id-ID',
    });
    appendSegment(segments, {
      text: matchedTerm,
      fallbackText: entry.fallback,
      language: 'en',
    });
    cursor = start + matchedTerm.length;
  }

  appendSegment(segments, {
    text: speechText.slice(cursor),
    language: 'id-ID',
  });
  return segments;
}

export function findEnglishSpeechVoice<T extends { language: string; quality?: string }>(
  voices: T[]
): T | null {
  const englishVoices = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.language));
  englishVoices.sort((first, second) => {
    const firstLanguage = first.language.toLowerCase().replace('_', '-');
    const secondLanguage = second.language.toLowerCase().replace('_', '-');
    const languageRank = (language: string) =>
      language === 'en-us' ? 0 : language === 'en-gb' ? 1 : language === 'en' ? 2 : 3;
    const languageDifference = languageRank(firstLanguage) - languageRank(secondLanguage);
    if (languageDifference !== 0) return languageDifference;
    return Number(second.quality === 'Enhanced') - Number(first.quality === 'Enhanced');
  });
  return englishVoices[0] ?? null;
}
