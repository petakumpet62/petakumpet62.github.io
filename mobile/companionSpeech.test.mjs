import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCompanionSpeechSegments,
  findEnglishSpeechVoice,
  getCompanionSpeechStyle,
  toIndonesianSpeech,
} from './companionSpeech.ts';

test('keeps chat terms in English speech segments and translates role names', () => {
  assert.deepEqual(createCompanionSpeechSegments('Reveal aktif untuk Seeker dan Hider.'), [
    { text: 'Reveal', fallbackText: 'ri-vil', language: 'en' },
    { text: 'aktif untuk pencari dan penyembunyi.', language: 'id-ID' },
  ]);
});

test('matches English terms regardless of casing and preserves surrounding text', () => {
  assert.deepEqual(createCompanionSpeechSegments('Gunakan REVEAL, lalu lanjutkan.'), [
    { text: 'Gunakan', language: 'id-ID' },
    { text: 'REVEAL', fallbackText: 'ri-vil', language: 'en' },
    { text: ', lalu lanjutkan.', language: 'id-ID' },
  ]);
});

test('selects a preferred available English voice or returns no voice', () => {
  const voices = [
    { identifier: 'english-uk', language: 'en-GB', quality: 'Enhanced' },
    { identifier: 'english-us', language: 'en_US', quality: 'Default' },
    { identifier: 'indonesian', language: 'id-ID', quality: 'Enhanced' },
  ];

  assert.equal(findEnglishSpeechVoice(voices)?.identifier, 'english-us');
  assert.equal(findEnglishSpeechVoice([{ identifier: 'indonesian', language: 'id-ID' }]), null);
});

test('retains existing Indonesian role pronunciation mapping', () => {
  assert.equal(toIndonesianSpeech('Seeker mencari Hider.'), 'pencari mencari penyembunyi.');
});

test('gives each Companion a distinct, restrained speech style', () => {
  const companionIds = ['kanca', 'tara', 'komo', 'cendi', 'bako'];
  const styles = companionIds.map((id) => getCompanionSpeechStyle(id));
  const uniqueStyles = new Set(styles.map(({ rate, pitch }) => `${rate}:${pitch}`));

  assert.equal(uniqueStyles.size, companionIds.length);
  for (const style of styles) {
    assert.ok(style.rate >= 0.85 && style.rate <= 1.1);
    assert.ok(style.pitch >= 0.9 && style.pitch <= 1.12);
  }
});
