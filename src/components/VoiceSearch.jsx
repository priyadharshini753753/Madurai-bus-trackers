import { useEffect, useRef, useState } from 'react'
import { parseVoiceQuery } from '../lib/voiceParse'
import { Icon } from './Icons'

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

const ERRORS = {
  'not-allowed': 'Microphone permission was blocked. Allow it in your browser settings, or type your question instead.',
  'service-not-allowed': 'Speech recognition is blocked on this device. Type your question instead.',
  'no-speech': 'I did not hear anything. Tap the mic and try again, or type below.',
  'audio-capture': 'No microphone was found. Type your question instead.',
  network: 'Speech recognition needs an internet connection. Type your question instead.',
  'language-not-supported': 'This browser does not support that language for voice. Try English, or type in Tamil/Tanglish.',
}

// Voice or text → { fromCandidates, toCandidates, type }. Voice is optional; typing always works.
export default function VoiceSearch({ stops, onResult }) {
  const [text, setText] = useState('')
  const [lang, setLang] = useState('ta-IN')
  const [listening, setListening] = useState(false)
  const [mic, setMic] = useState(Recognition ? 'unknown' : 'unsupported')
  const [msg, setMsg] = useState(null)
  const rec = useRef(null)

  useEffect(() => {
    if (!Recognition || !navigator.permissions?.query) return
    navigator.permissions.query({ name: 'microphone' }).then(p => {
      const sync = () => setMic(p.state)           // granted | denied | prompt
      sync(); p.onchange = sync
    }).catch(() => {})
  }, [])
  useEffect(() => () => rec.current?.abort?.(), [])

  function apply(t) {
    if (!t.trim()) { setMsg({ kind: 'bad', text: 'Say or type something first, like "Madurai lendhu Melur".' }); return }
    const r = parseVoiceQuery(t, stops)
    onResult(r)
    setMsg(r.matched
      ? { kind: 'ok', text: 'Understood. Check the stops below and correct them if needed.' }
      : { kind: 'bad', text: 'I could not find a stop name in that. Edit the words above (for example "Madurai lendhu Melur") or pick the stops below.' })
  }

  function start() {
    if (!Recognition) return
    setMsg(null)
    const r = new Recognition()
    rec.current = r
    r.lang = lang; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false
    let finalText = ''
    r.onresult = e => {
      const t = Array.from(e.results).map(x => x[0].transcript).join(' ')
      finalText = t; setText(t)
    }
    r.onerror = e => { setListening(false); setMsg({ kind: 'bad', text: ERRORS[e.error] || `Voice input failed (${e.error}). Type your question instead.` }) }
    r.onend = () => { setListening(false); if (finalText) apply(finalText) }
    try { r.start(); setListening(true) } catch { setMsg({ kind: 'bad', text: 'Could not start the microphone. Type your question instead.' }) }
  }
  const stop = () => rec.current?.stop()

  const micLabel = { unsupported: 'Voice input is not supported in this browser. Typing works everywhere.',
    granted: 'Microphone: allowed', denied: 'Microphone: blocked', prompt: 'Microphone: will ask when you tap the mic', unknown: 'Microphone: not asked yet' }[mic]

  return (
    <section className="card voice" aria-label="Voice or text search">
      <div className="card-title">Ask in Tamil or English · தமிழில் கேளுங்கள்</div>
      <div className="voice-row">
        <input type="text" value={text} onChange={e => setText(e.target.value)} lang="ta"
          aria-label="Your question"
          onKeyDown={e => e.key === 'Enter' && apply(text)}
          placeholder="Madurai lendhu Melur bus timing sollu" />
        {Recognition && (
          <button className={`mic ${listening ? 'on' : ''}`} onClick={listening ? stop : start}
            aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Start voice search'}>
            {listening ? '■' : <Icon name="mic" size={20} />}
          </button>
        )}
        <button className="btn" onClick={() => apply(text)}>Use this</button>
      </div>
      <div className="voice-meta">
        <span className={`mic-state mic-${mic}`}>{micLabel}</span>
        {Recognition && (
          <label className="inline">Voice language
            <select value={lang} onChange={e => setLang(e.target.value)}>
              <option value="ta-IN">தமிழ் (ta-IN)</option><option value="en-IN">English (en-IN)</option>
            </select>
          </label>
        )}
      </div>
      {listening && <div className="field-hint" role="status">Listening… பேசுங்கள்</div>}
      {msg && <div className={`field-hint ${msg.kind}`} role="status">{msg.text}</div>}
    </section>
  )
}
