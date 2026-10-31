import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVoiceQuery } from '../src/lib/voiceParse.js'

const stops = [
  { id: 1, nameEn: 'Periyar Bus Stand', nameTa: 'பெரியார் பேருந்து நிலையம்', aliases: ['periyar', 'madurai', 'மதுரை'] },
  { id: 2, nameEn: 'Mattuthavani', nameTa: 'மாட்டுத்தாவணி', aliases: ['mattuthavani', 'madurai', 'மதுரை'] },
  { id: 8, nameEn: 'Melur', nameTa: 'மேலூர்', aliases: ['meloor'] },
  { id: 11, nameEn: 'Thirumangalam', nameTa: 'திருமங்கலம்', aliases: ['tirumangalam'] },
  { id: 9, nameEn: 'Bypass Road', nameTa: 'புறவழிச்சாலை', aliases: ['bypass'] },
]
const p = t => parseVoiceQuery(t, stops)

test('"Periyar bus stand-ku bus irukka?" → destination only', () => {
  const r = p('Periyar bus stand-ku bus irukka?')
  assert.deepEqual(r.toCandidates, [1]); assert.deepEqual(r.fromCandidates, [])
})
test('"Madurai lendhu Melur bus timing sollu" → ambiguous from, Melur to', () => {
  const r = p('Madurai lendhu Melur bus timing sollu')
  assert.deepEqual(r.fromCandidates.sort(), [1, 2]); assert.deepEqual(r.toCandidates, [8])
})
test('"Thirumangalam-ku private bus irukka?" → private filter', () => {
  const r = p('Thirumangalam-ku private bus irukka?')
  assert.deepEqual(r.toCandidates, [11]); assert.equal(r.type, 'private')
})
test('English "from X to Y" and spelling variants', () => {
  const r = p('bus from mattuthavani to meloor')
  assert.deepEqual(r.fromCandidates, [2]); assert.deepEqual(r.toCandidates, [8])
})
test('Tamil script with inflected endings', () => {
  const r = p('மாட்டுத்தாவணி இருந்து திருமங்கலத்துக்கு தனியார் பேருந்து')
  assert.deepEqual(r.fromCandidates, [2]); assert.deepEqual(r.toCandidates, [11]); assert.equal(r.type, 'private')
})
test('Tamil "மேலூருக்கு பஸ் இருக்கா"', () => {
  assert.deepEqual(p('மேலூருக்கு பஸ் இருக்கா').toCandidates, [8])
})
test('two stops without markers → first is from, second is to', () => {
  const r = p('mattuthavani melur')
  assert.deepEqual(r.fromCandidates, [2]); assert.deepEqual(r.toCandidates, [8])
})
test('longest name wins (bypass road vs bypass)', () => {
  assert.deepEqual(p('bypass road lendhu melur').fromCandidates, [9])
})
test('no stop recognised', () => {
  const r = p('hello how are you'); assert.equal(r.matched, false); assert.deepEqual(r.toCandidates, [])
})
