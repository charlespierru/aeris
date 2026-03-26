// ─── Audio ───────────────────────────────────────────────────────────────────

// Maps each transposition value to its natural woodwind instrument sound
const TRANSPOSE_INSTRUMENT = {
  '0':  { sf: 'flute',        label: 'Flute'        },
  '-2': { sf: 'clarinet',     label: 'Clarinet'     },
  '-9': { sf: 'alto_sax',     label: 'Alto Sax'     },
  '-7': { sf: 'oboe',         label: 'Oboe'         },
};

let audioCtx = null;
let currentInstrument = null;
const instrumentCache = {};
let rootOctave = 4;     // octave écrit de la note fondamentale (2, 3 ou 4)

// ─── Dictée musicale — state ──────────────────────────────────────────────────
let currentDicteePool = [];
let currentDicteeSeq  = [];   // séquence tirée, gardée en mémoire jusqu'au prochain tirage
let dicteeTimeouts    = [];
let dicteeIsPlaying   = false;
let dicteeReveal      = false;
let currentDicteeNode = null;  // nœud audio en cours — pour le couper net

function getInstrument() {
  const val = document.getElementById('transposeSelect').value;
  return TRANSPOSE_INSTRUMENT[val] || TRANSPOSE_INSTRUMENT['0'];
}

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // resume() is near-instant once the context exists; call it on every
  // user-gesture path so we're never blocked by the autoplay policy
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function setAudioStatus(msg, cls) {
  const el = document.getElementById('audioStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'audio-status' + (cls ? ' ' + cls : '');
}

function midiToName(midi) {
  // Flat spellings match FluidR3_GM sample filenames
  const names = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

// Loads the instrument that corresponds to the current transposition.
// Creates the AudioContext if not yet created (decodeAudioData works even
// while the context is suspended, so we can start well before the first click).
async function ensureInstrumentLoaded() {
  const { sf, label } = getInstrument();
  const ac = getAudioCtx();
  if (instrumentCache[sf]) {
    currentInstrument = instrumentCache[sf];
    setAudioStatus('♪ ' + label, 'ready');
    return;
  }
  setAudioStatus('Loading ' + label + '…', 'loading');
  try {
    const inst = await Soundfont.instrument(ac, sf, {
      soundfont: 'FluidR3_GM',
      format: 'mp3',
    });
    instrumentCache[sf] = inst;
    currentInstrument = inst;
    setAudioStatus('♪ ' + label, 'ready');
  } catch (e) {
    setAudioStatus('⚠ Could not load — check connection', 'error');
  }
}

function playNote(midi) {
  if (!currentInstrument) return;
  while (midi < 45) midi += 12;   // plancher : A2
  while (midi > 96) midi -= 12;   // plafond : C7
  const ac = getAudioCtx();
  currentInstrument.play(midiToName(midi), ac.currentTime, { duration: 1.4, gain: 2 });
}

function flashNote(el) {
  el.classList.remove('playing');
  void el.offsetWidth;            // force reflow so animation re-triggers
  el.classList.add('playing');
  el.addEventListener('animationend', () => el.classList.remove('playing'), { once: true });
}

async function handleNoteClick(midi, el) {
  await ensureInstrumentLoaded();
  playNote(midi);   // baseMidi intègre déjà rootOctave
  flashNote(el);
}

// Pre-load the default instrument immediately on page load.
// AudioContext.decodeAudioData works even in suspended state, so this
// eliminates the first-note latency without violating autoplay policy.
window.addEventListener('load', () => { ensureInstrumentLoaded(); });

// ─── Data ────────────────────────────────────────────────────────────────────

const NOTES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTES_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const DISPLAY_NOTES = ['C','C#/Db','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B'];

// ─── Diatonic spelling ────────────────────────────────────────────────────────
// Letter names and their natural (no accidental) semitone values
const LETTER_NAMES     = ['C','D','E','F','G','A','B'];
const LETTER_CHROMATIC = [0, 2, 4, 5, 7, 9, 11];

// Preferred root-letter index (0–6 → C…B) for each display-note name.
// Ambiguous enharmonics: C#/Db → Db (5 flats, simpler); F#/Gb → F# (conventional).
const ROOT_LETTER_IDX = {
  'C':0, 'C#':0, 'Db':1,
  'D':1, 'D#':1, 'Eb':2,
  'E':2, 'F':3,
  'F#':3, 'Gb':4,
  'G':4, 'G#':4, 'Ab':5,
  'A':5, 'A#':5, 'Bb':6,
  'B':6
};

// Scale types that obey the 7-letter diatonic rule (one letter per degree).
// Symmetric scales (chromatic, whole_tone, diminished) keep DISPLAY_NOTES notation.
const DIATONIC_SCALES = new Set([
  'major','natural_minor','harmonic_minor','melodic_minor',
  'dorian','mixolydian','lydian','phrygian'
]);

// Convert a chromatic pitch class (0–11) to a note name given a letter index.
// letterIdx wraps mod 7; accidental is computed as the chromatic distance from
// the natural pitch of that letter.
function spellNote(chromatic, letterIdx) {
  const li  = ((letterIdx % 7) + 7) % 7;
  const nat = LETTER_CHROMATIC[li];
  let acc   = ((chromatic - nat) % 12 + 12) % 12;
  if (acc > 6) acc -= 12;   // prefer ♭ (-1) over the equivalent +11 reading
  const base = LETTER_NAMES[li];
  if (acc ===  0) return base;
  if (acc ===  1) return base + '#';
  if (acc === -1) return base + 'b';
  if (acc ===  2) return base + '\u00D7';     // × double sharp
  if (acc === -2) return base + '\u266D\u266D'; // ♭♭ double flat
  return base; // shouldn't occur in standard scale intervals
}

const SCALE_DEFS = {
  major: {
    label: 'Major', badgeClass: 'badge-major',
    intervals: [2,2,1,2,2,2,1],
    formula: 'W – W – H – W – W – W – H',
    use: 'Bright, triumphant; classical & jazz solos',
    degrees: ['1','2','3','4','5','6','7','8'],
    practice: [
      'Practice in all 12 keys daily; use Circle of 5ths order for efficiency.',
      'Slur 4, tongue 4 to build even airstream across register breaks.',
      'Practice contrary motion: two octaves ascending while descending simultaneously.',
      'Use a metronome at ♩=60, then push to ♩=120 with 16ths. Record and review tone quality.',
      'Play in thirds, fourths, and sixths to internalize harmonic intervals.'
    ],
    technique: `<strong>Breath Support:</strong> Scales expose every weakness — ensure a steady air column with consistent pressure across all registers. For brass players, the upper register demands increased air speed, not just more embouchure pressure.\n\n<strong>Register Breaks (Woodwinds):</strong> Isolate the break point (e.g. Bb/B for clarinet). Practice slow slurs through the break with a tuner; any pitch dip reveals embouchure collapse.\n\n<strong>Evenness:</strong> Record yourself and listen back. The common fault is rushing on ascending passages and dragging on descent. Use a drone tone on the root to check intonation throughout.`,
    patterns: [
      { name: 'Thirds', desc: 'Scale in diatonic thirds: 1-3, 2-4, 3-5, 4-6, 5-7, 6-8…' },
      { name: 'Sequence of 4', desc: '1-2-3-4, 2-3-4-5, 3-4-5-6… (Hindemith pattern)' },
      { name: 'Broken Chords', desc: '1-3-5-3, 2-4-6-4, 3-5-7-5… ascending and descending' },
      { name: 'Inversion Challenge', desc: 'Start on each degree of the scale (modes) and ascend one octave' }
    ]
  },
  natural_minor: {
    label: 'Natural Minor', badgeClass: 'badge-minor',
    intervals: [2,1,2,2,1,2,2],
    formula: 'W – H – W – W – H – W – W',
    use: 'Lyrical, melancholic; folk and classical',
    degrees: ['1','2','♭3','4','5','♭6','♭7','8'],
    practice: [
      'Pair every natural minor scale with its relative major. Navigate between them fluidly.',
      'Focus on accurate intonation of the ♭6 and ♭7 — these are tonally defining.',
      'Practice the scale legato first, then with varied articulations (staccato, accented).',
      'Improvise a short 4-bar melody using only scale tones. Ear training + technique together.',
      'Long-tone exercise: hold each degree for 4 beats, listening for pitch drift.'
    ],
    technique: `<strong>Flat Degrees:</strong> The ♭3, ♭6, and ♭7 must be truly flat — not just "slightly lower." Use a tuner and drone to calibrate your ear. Many players habitually sharp these out of major-scale muscle memory.\n\n<strong>Brass embouchure:</strong> The subtle relaxation for flatted degrees should come from air support and oral cavity shape, not embouchure slackening, which destroys tone quality.\n\n<strong>Expressive shaping:</strong> Natural minor is inherently vocal. Practice with phrase marks — swell through the middle of phrases and arrive at the 5th with direction.`,
    patterns: [
      { name: 'Aeolian Mode Sequence', desc: 'The natural minor IS the Aeolian mode. Practice overlapping both names.' },
      { name: 'Modal Shift', desc: 'Play natural minor then switch mid-phrase to harmonic minor — a critical skill.' },
      { name: 'Neighbor-Tone Ornaments', desc: 'Add upper/lower neighbor tones to each degree for baroque ornamentation.' },
      { name: '3rds in Minor', desc: 'Minor 3rds are rich and dark — practice scale-in-thirds for characteristic color.' }
    ]
  },
  harmonic_minor: {
    label: 'Harmonic Minor', badgeClass: 'badge-minor',
    intervals: [2,1,2,2,1,3,1],
    formula: 'W – H – W – W – H – A2 – H',
    use: 'Classical harmony, exotic flavour; V7→i cadences',
    degrees: ['1','2','♭3','4','5','♭6','7','8'],
    practice: [
      'The augmented 2nd (♭6→7) is the defining interval. Isolate and tune it carefully.',
      'Practice slowly with a drone on 5. The leading tone (7) should pull strongly upward.',
      'Play the scale in double-octave slurs, focusing on the upper register augmented 2nd.',
      'Pair with the dominant 7th chord (V7) to hear the resolution. Theory and ear training united.',
      'Practice the harmonic minor V7 arpeggio (5-7-♭2-4) as a separate exercise.'
    ],
    technique: `<strong>The Augmented 2nd:</strong> This interval (e.g. Ab to B in C harmonic minor) is the diagnostic challenge. It must sound deliberate and in tune — not like a missed note or a clumsy half-step.\n\n<strong>Finger/Valve Technique:</strong> The large skip means your fingers/valves must "pre-set" for the 7th before leaving the ♭6. Practice this single leap in isolation.\n\n<strong>Historical Context:</strong> The harmonic minor was developed to provide a strong leading tone in minor keys. Understanding its harmonic purpose helps musical shaping — crescendo through the augmented 2nd.`,
    patterns: [
      { name: 'Augmented 2nd Isolation', desc: 'Play ♭6–7–♭6 repeatedly at various tempos to master the characteristic skip.' },
      { name: 'Harmonic Minor Modes', desc: '7 modes exist: Phrygian Dominant (5th mode) is essential for jazz/flamenco.' },
      { name: 'i – V7 – i Cadence', desc: 'Practice the tonic arpeggio, then V7 arpeggio, then resolve. Repeat.' },
      { name: 'Chromatic Neighbour', desc: 'Add a chromatic passing tone between ♭6 and 7 for baroque vocabulary.' }
    ]
  },
  melodic_minor: {
    label: 'Melodic Minor', badgeClass: 'badge-minor',
    intervals: [2,1,2,2,2,2,1],
    formula: 'W – H – W – W – W – W – H (ascending)',
    use: 'Jazz (ascending only used), classical voice-leading',
    degrees: ['1','2','♭3','4','5','6','7','8'],
    practice: [
      'Classical melodic minor: ascending = raised ♭6 & ♭7; descending = natural minor. Practice both directions without pausing.',
      'Jazz melodic minor: same ascending AND descending (a.k.a. "jazz minor"). Master both traditions.',
      'Focus transitions: the shift between raised and natural 6th/7th mid-scale demands fluid air and fingers.',
      'Layer articulation: first tongued, then slurred, then mixed (tongue odd notes, slur pairs).',
      'Practice this scale over a ii–V–i progression to hear its context immediately.'
    ],
    technique: `<strong>Two Traditions:</strong> Classical melodic minor has different ascending and descending forms — this is NOT optional, it is a core classical technique. Jazz musicians typically use only the ascending form in both directions.\n\n<strong>Intonation Focus:</strong> The ♭3 (minor third) must remain flat even as the 6th and 7th are raised. Players often accidentally raise the 3rd too, creating a major-sounding scale.\n\n<strong>Practical Application:</strong> The melodic minor is the basis of many jazz scales (Lydian Dominant, Super Locrian/Altered scale) — understanding it unlocks an entire harmonic vocabulary.`,
    patterns: [
      { name: 'Ascending/Descending Toggle', desc: 'Ascend with raised 6&7, descend with natural 6&7 — drill the switch point.' },
      { name: 'Jazz Minor Modes', desc: 'Mode 4 = Lydian Dominant; Mode 7 = Altered/Super Locrian. Both essential for jazz.' },
      { name: 'Arpeggio Derivation', desc: 'The tonic arpeggio is a minor-major 7th chord: 1–♭3–5–7. Practice it.' },
      { name: 'Two-octave Legato', desc: 'Ascending with raised 6&7, descending with natural form, all in one breath.' }
    ]
  },
  dorian: {
    label: 'Dorian Mode', badgeClass: 'badge-mode',
    intervals: [2,1,2,2,2,1,2],
    formula: 'W – H – W – W – W – H – W',
    use: 'Jazz, blues, folk; characteristic "cool" minor sound',
    degrees: ['1','2','♭3','4','5','6','♭7','8'],
    practice: [
      'Compare Dorian to natural minor: only the 6th is different (raised). Internalize this distinction.',
      'Practice over a static minor chord vamp. Dorian sits "brighter" than natural minor — hear the difference.',
      'Learn "So What" (Miles Davis) as a musical reference for Dorian harmony.',
      'Use scale-tone patterns: 1-2-3-2, 2-3-4-3, 3-4-5-4… to build jazz vocabulary.',
      'Play Dorian on the ii chord of a ii–V–I (e.g., D Dorian over Dm7 in C major).'
    ],
    technique: `<strong>The Raised 6th:</strong> This is what makes Dorian unique among minor modes. It creates a characteristic major 6th above the root, giving Dorian its characteristic brightness relative to natural minor. Tune this note carefully — it must be a true major 6th.\n\n<strong>Jazz Context:</strong> Dorian is the primary mode for improvising over minor 7th chords in jazz. Practice starting phrases from different chord tones (♭3, 5, ♭7) rather than always from the root.\n\n<strong>Stylistic Nuance:</strong> Dorian is idiomatic in modal jazz (Miles Davis, John Coltrane) and also in Celtic folk music. Adjust your articulation style accordingly — jazz leans on swing rhythm; Celtic uses ornamental grace notes.`,
    patterns: [
      { name: 'ii–V Pairing', desc: 'D Dorian over Dm7 → G Mixolydian over G7 → resolve to C Major. Classic.' },
      { name: 'Pentatonic Subset', desc: 'The minor pentatonic is embedded in Dorian — extract it and notice which notes are added.' },
      { name: 'Motif Development', desc: 'Create a 3-note motif using the ♭3 and 6. Develop it sequentially up the scale.' },
      { name: 'Chord Tones First', desc: '1–♭3–5–♭7 arpeggio, then add scale-tone passing notes around each chord tone.' }
    ]
  },
  mixolydian: {
    label: 'Mixolydian Mode', badgeClass: 'badge-mode',
    intervals: [2,2,1,2,2,1,2],
    formula: 'W – W – H – W – W – H – W',
    use: 'Dominant 7th chords, blues, rock, jazz',
    degrees: ['1','2','3','4','5','6','♭7','8'],
    practice: [
      'Mixolydian = major scale with a ♭7. Play major scale, then lower only the 7th. Hear the shift.',
      'Practice over a dominant 7th chord. Mixolydian is the "home" sound of the V7 chord.',
      'Learn a blues head (e.g., "Autumn Leaves" A section) in Mixolydian context.',
      'Practice bebop vocabulary: add chromatic passing tones between ♭7 and octave.',
      'Use Mixolydian over blues changes — it works over all three dominant chords.'
    ],
    technique: `<strong>The ♭7 in Context:</strong> Mixolydian's flat seventh creates an unresolved dominant feel. In jazz, this is not a problem — it IS the sound. Lean into it over V7 chords and resist the urge to raise it.\n\n<strong>Bebop Dominant Scale:</strong> Add a chromatic note between the ♭7 and octave (so: 1-2-3-4-5-6-♭7-7-8). This keeps the chord tones on the beat in swing rhythm — a crucial jazz technique.\n\n<strong>Blues Context:</strong> In blues, Mixolydian freely mixes with the minor pentatonic. Practice moving between them fluidly. The ♭3 and natural 3rd can coexist as a stylistic choice (the "blue note").`,
    patterns: [
      { name: 'Bebop Dominant', desc: 'Add chromatic 7 between ♭7 and octave: 1-2-3-4-5-6-b7-♮7-8' },
      { name: 'V7 Arpeggio', desc: '1-3-5-♭7. Practice resolving each note to tonic by step.' },
      { name: 'Blues Fusion', desc: 'Alternate Mixolydian phrases with minor pentatonic. Aim for seamless transition.' },
      { name: 'Tritone Substitution', desc: 'Practice Mixolydian of the tritone substitute (e.g., Db Mixolydian over G7).' }
    ]
  },
  lydian: {
    label: 'Lydian Mode', badgeClass: 'badge-mode',
    intervals: [2,2,2,1,2,2,1],
    formula: 'W – W – W – H – W – W – H',
    use: 'Dreamy, floating; film scores, modern jazz',
    degrees: ['1','2','3','#4','5','6','7','8'],
    practice: [
      'Lydian = major with a raised 4th. The ♯4 gives a dreamy, unstable quality. Tune it precisely.',
      'Compare to major scale: isolate the ♯4 and play a phrase that highlights it.',
      'Practice Lydian over a major 7th chord — particularly IMaj7 in jazz context.',
      'Explore Joe Satriani and John Williams (film) for musical Lydian reference points.',
      'Practice the tritone (1–♯4) as a melodic leap — it defines the mode.'
    ],
    technique: `<strong>The Raised 4th (Tritone):</strong> The interval from the root to the ♯4 is a tritone (augmented 4th). This is the most dissonant interval in tonal music. Used melodically in Lydian, it creates an otherworldly, floating quality.\n\n<strong>Intonation Challenge:</strong> A ♯4 that isn't raised enough sounds like a badly in-tune natural 4 rather than a genuinely sharp 4th. Use a tuner to verify it's exactly 6 semitones above the root.\n\n<strong>Musical Application:</strong> Lydian is used extensively in film scoring (John Williams' "flying" themes). For jazz, it's the mode for IMaj7 and IVMaj7 chords. Practice overlapping it with the major scale in the same key.`,
    patterns: [
      { name: 'Tritone Highlight', desc: 'Play 1–2–3–#4–3–2–1 repeatedly until the raised 4th feels natural.' },
      { name: 'IMaj7 Arpeggio', desc: '1–3–5–7–#4 arpeggio with an added ♯4 color tone.' },
      { name: 'Lydian vs Major', desc: 'Alternate Lydian and major phrases. Hear the "opening up" effect of the raised 4.' },
      { name: 'Long Tone on ♯4', desc: '4-beat long tone on the ♯4 over a major chord drone. Resolve to 5.' }
    ]
  },
  phrygian: {
    label: 'Phrygian Mode', badgeClass: 'badge-mode',
    intervals: [1,2,2,2,1,2,2],
    formula: 'H – W – W – W – H – W – W',
    use: 'Dark, Spanish/flamenco, metal; ♭II chord',
    degrees: ['1','♭2','♭3','4','5','♭6','♭7','8'],
    practice: [
      'The ♭2 is Phrygian\'s signature. It creates an immediately Spanish/dark sound. Exaggerate it early to internalize.',
      'Play the ♭II chord (Neapolitan) in root position — this is Phrygian\'s harmonic home.',
      'Practice Phrygian Dominant (♯3 in Phrygian) for the flamenco sound — essential for classical brass.',
      'Listen to flamenco and Spanish classical music. The mode is idiomatic; listening is part of learning.',
      'Use Phrygian over the iii chord in jazz (iii–VI–II–V progression).'
    ],
    technique: `<strong>The ♭2:</strong> A half-step above the root creates immediate exotic tension. This note has gravitational pull downward back to the root (it's like a chromatic upper neighbor). Use it expressively.\n\n<strong>Phrygian Dominant:</strong> Add a major 3rd (raised ♭3 to 3) for the "Spanish" sound. This is actually a separate mode (5th mode of harmonic minor) but shares Phrygian's half-step above root.\n\n<strong>Register Control:</strong> The many flatted tones in Phrygian can cause intonation drift, especially in lower registers of brass instruments. Use a drone and tune each flatted degree individually.`,
    patterns: [
      { name: '♭2 Resolution', desc: 'Repeatedly play ♭2–1 (half-step resolution downward). Control this landing.' },
      { name: 'Neapolitan Harmony', desc: 'Arpeggio of ♭II major chord (e.g., Db major in C Phrygian). Practice root position and inversions.' },
      { name: 'Spanish Cadence', desc: 'i–♭VII–♭VI–♭VII–i. Play each chord as arpeggio then connect melodically.' },
      { name: 'Phrygian Dominant', desc: 'Raise the ♭3 to 3. Now play flamenco-style runs from ♭2 down to 1 with ornaments.' }
    ]
  },
  whole_tone: {
    label: 'Whole Tone Scale', badgeClass: 'badge-mode',
    intervals: [2,2,2,2,2,2],
    formula: 'W – W – W – W – W – W',
    use: 'Impressionist, Debussy; augmented/altered harmony',
    degrees: ['1','2','3','#4','#5','♭7','8'],
    practice: [
      'Only 2 whole-tone scales exist (all others are rotations). Learn C whole tone and C# whole tone.',
      'Practice the scale slurred in one breath for 2+ octaves. Breath efficiency is paramount.',
      'Use over augmented chords (1-3-#5) or dominant ♭5/♯5 chords.',
      'Improvise freely — the symmetrical structure means any pattern repeats a major 2nd higher.',
      'Practice patterns of 3: 1-2-3, 2-3-#4, 3-#4-#5… because there are no "wrong" notes.'
    ],
    technique: `<strong>Symmetry:</strong> The whole-tone scale is completely symmetrical — there are no perfect 4ths, 5ths, or half-steps. Every interval is the same. This removes traditional landmarks, so your ear must work harder.\n\n<strong>Augmented Sonority:</strong> The ♯4 and ♯5 give this scale an "augmented" quality — floating, unmoored, without a clear tonal center. Embrace this instability rather than fighting it.\n\n<strong>Practical Tip:</strong> Because the scale only has 6 distinct tones (vs 7 in diatonic scales), any 8va passage will repeat tones. Plan your octave-crossing carefully to avoid awkward repeated notes.`,
    patterns: [
      { name: 'Two-Scale System', desc: 'Only C whole tone and C# whole tone. Practice mapping all 12 roots to one of two scales.' },
      { name: 'Arpeggiated Augmented', desc: '1–3–#5 arpeggio is embedded in whole tone. Practice all 3 inversions.' },
      { name: 'Sequences of 3', desc: '1-2-3, 2-3-#4, 3-#4-#5… glissando-like passages in Debussy style.' },
      { name: 'Chromatic Coupling', desc: 'Alternate whole-tone phrases with chromatic runs for contrast effects.' }
    ]
  },
  diminished: {
    label: 'Diminished (Half-Whole)', badgeClass: 'badge-mode',
    intervals: [1,2,1,2,1,2,1,2],
    formula: 'H – W – H – W – H – W – H – W',
    use: 'Over dominant 7♭9 chords; jazz tension/release',
    degrees: ['1','♭2','♭3','3','♯4/♭5','5','6','♭7','8'],
    practice: [
      'The diminished scale is symmetrical by minor 3rds. Only 3 transpositions exist — learn them all.',
      'Play the scale slowly with a tuner: every other note forms a diminished 7th arpeggio.',
      'Practice over a dominant 7♭9 chord. The scale perfectly fits this chord quality.',
      'Alternate half-whole with whole-half diminished for full symmetrical vocabulary.',
      'Extract 4-note diminished arpeggio patterns and sequence them through the scale.'
    ],
    technique: `<strong>Symmetry by Minor 3rds:</strong> The half-whole diminished scale repeats its pattern every 3 semitones. This means C, Eb, F#, and A all use the same scale (a huge jazz economy).\n\n<strong>Dominant ♭9 Application:</strong> Play this scale over G7♭9 in jazz. The scale tones perfectly outline the chord tensions (♭9, ♯9, ♯11, ♭13). This is advanced jazz vocabulary.\n\n<strong>Technical Challenge:</strong> 8 notes per octave (vs 7 diatonic) creates fingering challenges. The half-step patterns require clean, fast valve/key action. Practice the scale in dotted rhythms to address rhythmic evenness.`,
    patterns: [
      { name: 'Diminished 7th Arpeggios', desc: 'Extract 1-♭3-♭5-♭♭7. Only 3 unique dim7 arpeggios exist. Learn all.' },
      { name: '3-Transposition System', desc: 'C, Db, D diminished = 3 unique scales. Map all 12 roots.' },
      { name: 'Dominant Resolution', desc: 'Play dim scale over V7♭9 then resolve to I. Tension and release drill.' },
      { name: 'Rhythmic Displacement', desc: 'Practice 8-note scale with accents on beats 2 and 4 for jazz feel.' }
    ]
  },
  chromatic: {
    label: 'Chromatic Scale', badgeClass: 'badge-mode',
    intervals: [1,1,1,1,1,1,1,1,1,1,1,1],
    formula: 'H – H – H – H – H – H – H – H – H – H – H – H',
    use: 'Technique building, connecting tones, full range',
    degrees: ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7','8'],
    practice: [
      'Two-octave chromatic is a core technique requirement for all advanced wind/brass.',
      'Practice with 4 rhythmic articulations per note: all tongued, slurred, tongue-2-slur-2, and tongue-1-slur-3.',
      'Use the chromatic scale to warm up across the full range every practice session.',
      'Practice with a metronome in subdivisions: quarter, 8th, 16th, and triplet feels.',
      'Chromatic scale at ♩=132 with 16ths is an advanced benchmark — record and track progress.'
    ],
    technique: `<strong>The Benchmark Test:</strong> Two octave chromatic scale, all tongued, at ♩=132 (16th notes) with even tone throughout = advanced-level proficiency. Time yourself weekly.\n\n<strong>Enharmonics:</strong> Ascending, use sharps (C-C#-D-D#…); descending, use flats (C-B-Bb-A-Ab…). This is the standard notation convention.\n\n<strong>Register Consistency:</strong> The chromatic scale is the ultimate test of register-crossing evenness. The tone quality at the top of your range must match the bottom. Long-tone chromatic (whole notes, one pitch per breath) is the supreme exercise for this.`,
    patterns: [
      { name: 'Full Range Long Tones', desc: 'One note per breath, chromatic from lowest to highest. Focus on tone quality.' },
      { name: 'Articulation Rotation', desc: 'Tongue all → Slur all → T-T-S-S → T-S-T-S. One octave each articulation.' },
      { name: 'Rhythmic Augmentation', desc: 'Play chromatic scale as: quarter, dotted-8th/16th, triplet, 16th. Same pitches, varied rhythm.' },
      { name: 'Register Extremes', desc: 'Upper octave chromatic slurred (tone quality) then lower octave chromatic tongued (clarity).' }
    ]
  }
};

const KEY_SIGS = {
  'C':'0 sharps/flats',
  'C#':'7 sharps', 'Db':'5 flats',
  'D':'2 sharps',
  'D#':'9 sharps', 'Eb':'3 flats',
  'E':'4 sharps', 'F':'1 flat',
  'F#':'6 sharps', 'Gb':'6 flats',
  'G':'1 sharp',
  'G#':'8 sharps', 'Ab':'4 flats',
  'A':'3 sharps',
  'A#':'10 sharps', 'Bb':'2 flats',
  'B':'5 sharps'
};

const RELATIVE_MINORS = {
  'C':'A',  'C#':'A#', 'Db':'Bb',
  'D':'B',  'D#':'B#', 'Eb':'C',
  'E':'C#', 'F':'D',
  'F#':'D#', 'Gb':'Eb',
  'G':'E',  'G#':'E#', 'Ab':'F',
  'A':'F#', 'A#':'F\u00D7', 'Bb':'G',
  'B':'G#'
};

const RELATIVE_MAJORS = {
  'A':'C',  'A#':'C#', 'Bb':'Db',
  'B':'D',  'B#':'D#', 'C':'Eb',
  'C#':'E', 'D':'F',
  'D#':'F#', 'Eb':'Gb',
  'E':'G',  'E#':'G#', 'F':'Ab',
  'F#':'A', 'G':'Bb',
  'G#':'B'
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function getRootIndex(root) {
  const map = {
    'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,
    'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11
  };
  return map[root] ?? 0;
}

// Returns an array of semitone offsets from root, one per scale note, ending with 12 (octave).
// e.g. major [2,2,1,2,2,2,1] → [0, 2, 4, 5, 7, 9, 11, 12]
function getCumulativeOffsets(intervals) {
  const out = [0];
  let sum = 0;
  for (let i = 0; i < intervals.length - 1; i++) {
    sum += intervals[i];
    out.push(sum);
  }
  out.push(12); // octave
  return out;
}

function buildScaleNotes(rootIdx, intervals, rootLetterIdx) {
  const notes = [];
  if (rootLetterIdx !== undefined) {
    // Diatonic path — each degree gets the correct letter + accidental
    let chromOffset = 0;
    notes.push(spellNote(rootIdx, rootLetterIdx));
    for (let i = 0; i < intervals.length - 1; i++) {
      chromOffset += intervals[i];
      notes.push(spellNote((rootIdx + chromOffset) % 12, rootLetterIdx + i + 1));
    }
    notes.push(spellNote(rootIdx, rootLetterIdx) + '\'');
  } else {
    // Non-diatonic path — keep existing DISPLAY_NOTES behaviour
    let idx = rootIdx;
    notes.push(DISPLAY_NOTES[idx % 12]);
    for (let i = 0; i < intervals.length - 1; i++) {
      idx += intervals[i];
      notes.push(DISPLAY_NOTES[idx % 12]);
    }
    notes.push(DISPLAY_NOTES[rootIdx % 12] + '\'');
  }
  return notes;
}

function getNoteAt(rootIdx, semitones) {
  return DISPLAY_NOTES[(rootIdx + semitones) % 12];
}

// ─── Rendering ────────────────────────────────────────────────────────────────

// Retourne les octaves ÉCRITS valides pour la root donnée.
// Ambitus : A2 (MIDI 45) – Eb5 (MIDI 75) pour le concert de la root,
// afin que la 13e (max +21 st) reste dans l'ambitus C7 (MIDI 96).
function getValidOctaves(rootIdx, transposeOffset) {
  const MIN = 45, MAX = 75;   // A2 – Eb5 (root max = C7 − 21 st)
  const result = [];
  for (let oct = 2; oct <= 5; oct++) {
    const m = 12 * (oct + 1) + rootIdx + transposeOffset;
    if (m >= MIN && m <= MAX) result.push(oct);
  }
  return result;
}

function render() {
  const root = document.getElementById('rootSelect').value;
  const scaleType = document.getElementById('scaleTypeSelect').value;
  const def = SCALE_DEFS[scaleType];
  const rootIdx = getRootIndex(root);

  // Concert-pitch base MIDI for audio playback.
  // Ambitus : A2 (MIDI 45) – C7 (MIDI 96). Root max = Eb5 (MIDI 75).
  const transposeOffset = parseInt(document.getElementById('transposeSelect').value);
  const validOctaves    = getValidOctaves(rootIdx, transposeOffset);
  if (validOctaves.length && !validOctaves.includes(rootOctave)) {
    rootOctave = validOctaves[validOctaves.length - 1]; // snapper au plus haut valide
  }
  const baseMidi = 12 * (rootOctave + 1) + rootIdx + transposeOffset;
  const offsets  = getCumulativeOffsets(def.intervals);

  // Reconstruire le sélecteur d'octave
  const octSel = document.getElementById('octaveSelect');
  octSel.innerHTML = '';
  validOctaves.forEach(oct => {
    const opt = document.createElement('option');
    opt.value = oct;
    opt.textContent = root + oct;   // ex : "C4", "Eb3", "A2"
    opt.selected = (oct === rootOctave);
    octSel.appendChild(opt);
  });

  // Name and badge
  document.getElementById('scaleNameText').textContent = root + ' ' + def.label;
  const badge = document.getElementById('scaleBadge');
  badge.textContent = def.label;
  badge.className = 'scale-type-badge ' + def.badgeClass;

  // Formula
  document.getElementById('intervalFormula').textContent = def.formula;

  // Info cards
  const isMajor = ['major','lydian','mixolydian'].includes(scaleType);
  const isMinor = ['natural_minor','harmonic_minor','melodic_minor','dorian','phrygian'].includes(scaleType);
  document.getElementById('keySignature').textContent = KEY_SIGS[root] || '—';
  if (isMajor) {
    document.getElementById('relativeKey').textContent = (RELATIVE_MINORS[root] || '—') + ' minor';
  } else if (isMinor) {
    document.getElementById('relativeKey').textContent = (RELATIVE_MAJORS[root] || '—') + ' major';
  } else {
    document.getElementById('relativeKey').textContent = 'N/A (Symmetric)';
  }

  // Diatonic scales get correct letter-per-degree spelling; symmetric scales keep DISPLAY_NOTES
  const rootLetterIdx = DIATONIC_SCALES.has(scaleType) ? ROOT_LETTER_IDX[root] : undefined;

  // Build notes
  const scaleNotes = buildScaleNotes(rootIdx, def.intervals, rootLetterIdx);
  const degrees = def.degrees;

  // Notes row
  const notesRow = document.getElementById('notesRow');
  notesRow.innerHTML = '';
  scaleNotes.forEach((note, i) => {
    const block = document.createElement('div');
    block.className = 'note-block';
    const pill = document.createElement('div');
    const deg = degrees[i] || '8';
    if (i === 0 || i === scaleNotes.length - 1) pill.className = 'note-pill root';
    else if (deg.includes('5')) pill.className = 'note-pill fifth';
    else if (deg.includes('3')) pill.className = 'note-pill third';
    else pill.className = 'note-pill regular';
    pill.textContent = note.replace("'", '');
    pill.dataset.midi = baseMidi + offsets[i];
    pill.title = midiToName(baseMidi + offsets[i]); // tooltip shows concert pitch
    const label = document.createElement('span');
    label.className = 'interval-label';
    label.textContent = deg;
    block.appendChild(pill);
    block.appendChild(label);
    notesRow.appendChild(block);
    if (i < scaleNotes.length - 1) {
      const sep = document.createElement('div');
      sep.className = 'arrow-sep';
      sep.style.marginTop = '-1rem';
      sep.textContent = '›';
      notesRow.appendChild(sep);
    }
  });

  // Staff button — opens notation modal for the current scale (before ear btn)
  const staffSep = document.createElement('div');
  staffSep.className = 'arrow-sep';
  staffSep.style.marginTop = '-1rem';
  staffSep.textContent = '›';
  notesRow.appendChild(staffSep);

  const staffBlock = document.createElement('div');
  staffBlock.className = 'note-block';
  const staffBtn = document.createElement('div');
  staffBtn.className = 'note-pill staff-btn';
  staffBtn.title = 'View on staff';
  staffBtn.setAttribute('role', 'button');
  staffBtn.setAttribute('tabindex', '0');
  staffBtn.innerHTML = `<span class="staff-btn-clef">𝄞</span>`;
  staffBtn.addEventListener('click', () => { if (window.MusicStaffEngine) MusicStaffEngine.openForScale(); });
  staffBtn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && window.MusicStaffEngine) MusicStaffEngine.openForScale(); });
  const staffLabel = document.createElement('span');
  staffLabel.className = 'interval-label';
  staffLabel.textContent = '\u00A0';
  staffBlock.appendChild(staffBtn);
  staffBlock.appendChild(staffLabel);
  notesRow.appendChild(staffBlock);

  // Ear button — opens listen modal
  const earSep = document.createElement('div');
  earSep.className = 'arrow-sep';
  earSep.style.marginTop = '-1rem';
  earSep.textContent = '›';
  notesRow.appendChild(earSep);

  const earBlock = document.createElement('div');
  earBlock.className = 'note-block';
  const earBtn = document.createElement('div');
  earBtn.className = 'note-pill ear-btn';
  earBtn.title = 'Play what you hear';
  earBtn.setAttribute('role', 'button');
  earBtn.setAttribute('tabindex', '0');
  earBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 0 1-7 0"/><path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 0 4 0"/></svg>`;
  const _scalePool  = offsets.map(o => baseMidi + o);
  const _scaleLabel = `${root} ${def.label} — Scale`;
  earBtn.addEventListener('click', () => openListenModal(_scalePool, _scaleLabel));
  earBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openListenModal(_scalePool, _scaleLabel); });
  const earLabel = document.createElement('span');
  earLabel.className = 'interval-label';
  earLabel.textContent = '\u00A0';
  earBlock.appendChild(earBtn);
  earBlock.appendChild(earLabel);
  notesRow.appendChild(earBlock);

  // Arpeggio — triad
  const triadSemitones = getArpSemitones(scaleType, 'triad');
  const seventhSemitones = getArpSemitones(scaleType, 'seventh');
  const ninthSemitones     = getArpSemitones(scaleType, 'ninth');
  const eleventhSemitones  = getArpSemitones(scaleType, 'eleventh');
  const thirteenthSemitones = getArpSemitones(scaleType, 'thirteenth');
  renderArp('triadArp',      rootIdx, triadSemitones,      ['root-c','third-c','fifth-c'],                                       ['R','3rd','5th'],                baseMidi, rootLetterIdx); appendArpStaffBtn('triadArp',      'triad');      appendArpEarBtn('triadArp',      triadSemitones.map(s => baseMidi+s),      `${root} ${def.label} — Triad`);
  renderArp('seventhArp',    rootIdx, seventhSemitones,    ['root-c','third-c','fifth-c','seventh-c'],                           ['R','3rd','5th','7th'],          baseMidi, rootLetterIdx); appendArpStaffBtn('seventhArp',    'seventh');    appendArpEarBtn('seventhArp',    seventhSemitones.map(s => baseMidi+s),    `${root} ${def.label} — 7th`);
  renderArp('ninthArp',      rootIdx, ninthSemitones,      ['root-c','third-c','fifth-c','seventh-c','ninth-c'],                 ['R','3rd','5th','7th','9th'],    baseMidi, rootLetterIdx); appendArpStaffBtn('ninthArp',      'ninth');      appendArpEarBtn('ninthArp',      ninthSemitones.map(s => baseMidi+s),      `${root} ${def.label} — 9th`);
  renderArp('eleventhArp',   rootIdx, eleventhSemitones,   ['root-c','third-c','fifth-c','seventh-c','ninth-c','eleventh-c'],    ['R','3rd','5th','7th','9th','11th'],  baseMidi, rootLetterIdx); appendArpStaffBtn('eleventhArp',   'eleventh');  appendArpEarBtn('eleventhArp',   eleventhSemitones.map(s => baseMidi+s),   `${root} ${def.label} — 11th`);
  renderArp('thirteenthArp', rootIdx, thirteenthSemitones, ['root-c','third-c','fifth-c','seventh-c','ninth-c','eleventh-c','thirteenth-c'], ['R','3rd','5th','7th','9th','11th','13th'], baseMidi, rootLetterIdx); appendArpStaffBtn('thirteenthArp', 'thirteenth'); appendArpEarBtn('thirteenthArp', thirteenthSemitones.map(s => baseMidi+s), `${root} ${def.label} — 13th`);

  // Practice tips
  const tipsList = document.getElementById('practiceTips');
  tipsList.innerHTML = '';
  def.practice.forEach((tip, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="tip-num">${i+1}</span><span>${tip}</span>`;
    tipsList.appendChild(li);
  });

  // Technique
  document.getElementById('techniqueNotes').innerHTML = def.technique.replace(/\n\n/g,'<br><br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');

  // Patterns
  const patternsDiv = document.getElementById('patternsContent');
  patternsDiv.innerHTML = '';
  def.patterns.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pattern-card';
    card.innerHTML = `<div class="pattern-name">${p.name}</div><div class="pattern-desc">${p.desc}</div>`;
    patternsDiv.appendChild(card);
  });

  // Progressions diatoniques
  renderProgressions(root, scaleType, rootIdx, baseMidi, scaleNotes);

  // Circle of Fifths highlight
  updateCofHighlight();
}

function getArpSemitones(scaleType, type) {
  const maps = {
    //                triad       seventh          ninth              eleventh               thirteenth
    major:          { triad:[0,4,7],   seventh:[0,4,7,11],   ninth:[0,4,7,11,14],   eleventh:[0,4,7,11,14,17],   thirteenth:[0,4,7,11,14,17,21] },
    natural_minor:  { triad:[0,3,7],   seventh:[0,3,7,10],   ninth:[0,3,7,10,14],   eleventh:[0,3,7,10,14,17],   thirteenth:[0,3,7,10,14,17,20] },
    harmonic_minor: { triad:[0,3,7],   seventh:[0,3,7,11],   ninth:[0,3,7,11,14],   eleventh:[0,3,7,11,14,17],   thirteenth:[0,3,7,11,14,17,20] },
    melodic_minor:  { triad:[0,3,7],   seventh:[0,3,7,11],   ninth:[0,3,7,11,14],   eleventh:[0,3,7,11,14,17],   thirteenth:[0,3,7,11,14,17,21] },
    dorian:         { triad:[0,3,7],   seventh:[0,3,7,10],   ninth:[0,3,7,10,14],   eleventh:[0,3,7,10,14,17],   thirteenth:[0,3,7,10,14,17,21] },
    mixolydian:     { triad:[0,4,7],   seventh:[0,4,7,10],   ninth:[0,4,7,10,14],   eleventh:[0,4,7,10,14,17],   thirteenth:[0,4,7,10,14,17,21] },
    lydian:         { triad:[0,4,7],   seventh:[0,4,7,11],   ninth:[0,4,7,11,14],   eleventh:[0,4,7,11,14,18],   thirteenth:[0,4,7,11,14,18,21] },
    phrygian:       { triad:[0,3,7],   seventh:[0,3,7,10],   ninth:[0,3,7,10,13],   eleventh:[0,3,7,10,13,17],   thirteenth:[0,3,7,10,13,17,20] },
    whole_tone:     { triad:[0,4,8],   seventh:[0,4,8,10],   ninth:[0,4,8,10,14],   eleventh:[0,4,8,10,14,18],   thirteenth:[0,4,8,10,14,18,22] },
    diminished:     { triad:[0,3,6],   seventh:[0,3,6,9],    ninth:[0,3,6,9,13],    eleventh:[0,3,6,9,13,17],    thirteenth:[0,3,6,9,13,17,21]  },
    chromatic:      { triad:[0,4,7],   seventh:[0,4,7,11],   ninth:[0,4,7,11,14],   eleventh:[0,4,7,11,14,17],   thirteenth:[0,4,7,11,14,17,21] },
  };
  return (maps[scaleType] || maps.major)[type];
}

function appendArpEarBtn(id, pool, label) {
  const container = document.getElementById(id);
  const arrow = document.createElement('div');
  arrow.className = 'arp-arrow';
  arrow.style.marginTop = '1.2rem';
  arrow.textContent = '→';
  const note = document.createElement('div');
  note.className = 'arp-note';
  const deg = document.createElement('div');
  deg.className = 'arp-degree';
  deg.textContent = '\u00A0';
  const circle = document.createElement('div');
  circle.className = 'arp-circle ear-btn';
  circle.setAttribute('role', 'button');
  circle.setAttribute('tabindex', '0');
  circle.title = 'Play what you hear';
  circle.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 0 1-7 0"/><path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 0 4 0"/></svg>`;
  circle.addEventListener('click', () => openListenModal(pool, label));
  circle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openListenModal(pool, label); });
  note.appendChild(deg);
  note.appendChild(circle);
  container.appendChild(arrow);
  container.appendChild(note);
}

function appendArpStaffBtn(id, chordType) {
  const container = document.getElementById(id);
  const arrow = document.createElement('div');
  arrow.className = 'arp-arrow';
  arrow.style.marginTop = '1.2rem';
  arrow.textContent = '→';
  const note = document.createElement('div');
  note.className = 'arp-note';
  const deg = document.createElement('div');
  deg.className = 'arp-degree';
  deg.textContent = '\u00A0';
  const circle = document.createElement('div');
  circle.className = 'arp-circle staff-btn';
  circle.setAttribute('role', 'button');
  circle.setAttribute('tabindex', '0');
  circle.title = 'View on staff';
  circle.innerHTML = `<span class="staff-btn-clef">𝄞</span>`;
  circle.addEventListener('click', () => { if (window.MusicStaffEngine) MusicStaffEngine.openForChord(chordType); });
  circle.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && window.MusicStaffEngine) MusicStaffEngine.openForChord(chordType); });
  note.appendChild(deg);
  note.appendChild(circle);
  container.appendChild(arrow);
  container.appendChild(note);
}

function renderArp(id, rootIdx, semitones, classes, labels, baseMidi, rootLetterIdx) {
  // Arpeggio letter offsets: root=+0, 3rd=+2, 5th=+4, 7th=+6, octave=+7(=root)
  // These are fixed regardless of chord quality — accidentals handle alterations.
  const ARP_LETTER_OFF = semitones.map((_, i) => i * 2);
  const container = document.getElementById(id);
  container.innerHTML = '';
  semitones.forEach((s, i) => {
    let noteName;
    if (rootLetterIdx !== undefined) {
      const chr = (rootIdx + s) % 12;
      noteName  = spellNote(chr, rootLetterIdx + ARP_LETTER_OFF[i]);
    } else {
      noteName = DISPLAY_NOTES[(rootIdx + s) % 12];
    }
    const block = document.createElement('div');
    block.className = 'arp-note';
    const deg = document.createElement('div');
    deg.className = 'arp-degree';
    deg.textContent = labels[i];
    const circle = document.createElement('div');
    circle.className = 'arp-circle ' + classes[i];
    circle.textContent = noteName.replace("'", '');
    circle.dataset.midi = baseMidi + s;
    circle.title = midiToName(baseMidi + s); // tooltip shows concert pitch
    block.appendChild(deg);
    block.appendChild(circle);
    container.appendChild(block);
    if (i < semitones.length - 1) {
      const arrow = document.createElement('div');
      arrow.className = 'arp-arrow';
      arrow.style.marginTop = '1.2rem';
      arrow.textContent = '→';
      container.appendChild(arrow);
    }
  });
}

// ─── Progressions diatoniques ─────────────────────────────────────────────────

let progTimeouts  = [];
let progIsPlaying = false;

function stopProgression() {
  progTimeouts.forEach(t => clearTimeout(t));
  progTimeouts  = [];
  progIsPlaying = false;
  document.querySelectorAll('.cadence-card.playing').forEach(el => el.classList.remove('playing'));
}

function scheduleChord(midiNotes, startMs, duration) {
  midiNotes.forEach((midi, idx) => {
    progTimeouts.push(setTimeout(() => {
      if (!progIsPlaying) return;
      let m = midi;
      while (m < 45) m += 12;
      while (m > 96) m -= 12;
      currentInstrument.play(midiToName(m), getAudioCtx().currentTime, { duration, gain: 1.5 });
    }, startMs + idx * 45));
  });
}

async function playSingleChord(midiNotes) {
  stopProgression();
  await ensureInstrumentLoaded();
  progIsPlaying = true;

  // 1. Accord plaqué (toutes les notes simultanément)
  midiNotes.forEach(midi => {
    let m = midi;
    while (m < 45) m += 12;
    while (m > 96) m -= 12;
    currentInstrument.play(midiToName(m), getAudioCtx().currentTime, { duration: 0.9, gain: 1.4 });
  });

  // 2. Pause de 550 ms puis arpège
  const PAUSE = 1500;
  const ARP_STEP = 500; // noire à 120 BPM
  midiNotes.forEach((midi, idx) => {
    progTimeouts.push(setTimeout(() => {
      if (!progIsPlaying) return;
      let m = midi;
      while (m < 45) m += 12;
      while (m > 96) m -= 12;
      currentInstrument.play(midiToName(m), getAudioCtx().currentTime, { duration: 0.9, gain: 1.4 });
    }, PAUSE + idx * ARP_STEP));
  });

  // 3. Pause 500 ms après l'arpège puis accord plaqué final
  const arpEnd = PAUSE + midiNotes.length * ARP_STEP;
  midiNotes.forEach(midi => {
    progTimeouts.push(setTimeout(() => {
      if (!progIsPlaying) return;
      let m = midi;
      while (m < 45) m += 12;
      while (m > 96) m -= 12;
      currentInstrument.play(midiToName(m), getAudioCtx().currentTime, { duration: 1.2, gain: 1.4 });
    }, arpEnd + 500));
  });

  const total = arpEnd + 500 + 1400;
  progTimeouts.push(setTimeout(() => { progIsPlaying = false; }, total));
}

async function playProgSequence(chordMidiList, durationEach, card) {
  stopProgression();
  await ensureInstrumentLoaded();
  progIsPlaying = true;
  if (card) card.classList.add('playing');
  const gapMs = Math.round(durationEach * 1000);
  chordMidiList.forEach((notes, i) => scheduleChord(notes, i * gapMs, durationEach * 0.88));
  progTimeouts.push(setTimeout(() => {
    if (card) card.classList.remove('playing');
    progIsPlaying = false;
  }, chordMidiList.length * gapMs + 700));
}

function renderProgressions(root, scaleType, rootIdx, baseMidi, scaleNotes) {
  const container = document.getElementById('progContent');
  if (!container) return;
  container.innerHTML = '';

  if (!DIATONIC_SCALES.has(scaleType)) {
    const msg = document.createElement('p');
    msg.className = 'prog-na';
    msg.textContent = 'Diatonic progressions do not apply to symmetric scales (whole tone, diminished, chromatic).';
    container.appendChild(msg);
    return;
  }

  const def = SCALE_DEFS[scaleType];

  // Build extended offset array — off[n+7] = off[n]+12, extend to off[18] for 13ths
  const off = [0];
  for (const s of def.intervals) off.push(off[off.length - 1] + s); // indices 0–7
  while (off.length <= 18) off.push(off[off.length - 7] + 12);      // indices 8–18

  const ROMAN_UP = ['I','II','III','IV','V','VI','VII'];

  const chords = [];
  for (let i = 0; i < 7; i++) {
    const rOff  = off[i];
    const third = off[i + 2] - rOff;
    const fifth = off[i + 4] - rOff;
    const sev   = off[i + 6] - rOff;

    let quality, qClass;
    if      (third === 4 && fifth === 7) { quality = 'Major';  qClass = 'major'; }
    else if (third === 3 && fifth === 7) { quality = 'Minor';  qClass = 'minor'; }
    else if (third === 3 && fifth === 6) { quality = 'Dim.';   qClass = 'dim';   }
    else if (third === 4 && fifth === 8) { quality = 'Aug.';   qClass = 'aug';   }
    else                                 { quality = '—';      qClass = 'other'; }

    let roman = ROMAN_UP[i];
    if (qClass === 'minor') roman = roman.toLowerCase();
    if (qClass === 'dim')   roman = roman.toLowerCase() + '°';
    if (qClass === 'aug')   roman += '+';

    let sevSuffix;
    if      (sev === 11)                       sevSuffix = 'maj7';
    else if (sev === 10 && qClass === 'major') sevSuffix = '7';
    else if (sev === 10)                       sevSuffix = 'm7';
    else if (sev === 9  && qClass === 'dim')   sevSuffix = '°7';
    else                                       sevSuffix = 'ø7';

    const noteName = (scaleNotes[i] || '').replace("'", '');

    let triadName = noteName;
    if (qClass === 'minor') triadName += 'm';
    if (qClass === 'dim')   triadName += '°';
    if (qClass === 'aug')   triadName += '+';

    let chord7Name;
    if      (sevSuffix === 'maj7') chord7Name = noteName + 'maj7';
    else if (sevSuffix === '7')    chord7Name = noteName + '7';
    else if (sevSuffix === 'm7')   chord7Name = noteName + 'm7';
    else if (sevSuffix === 'ø7')   chord7Name = noteName + 'ø7';
    else                           chord7Name = noteName + '°7';

    const ninth      = off[i + 8]  - rOff;
    const eleventh   = off[i + 10] - rOff;
    const thirteenth = off[i + 12] - rOff;

    const ninthLbl = ninth      === 14 ? '9'   : ninth      === 13 ? 'b9'  : '#9';
    const elevLbl  = eleventh   === 17 ? '11'  : eleventh   === 18 ? '#11' : 'b11';
    const thirLbl  = thirteenth === 21 ? '13'  : thirteenth === 20 ? 'b13' : '#13';

    const chord9Name  = chord7Name.replace(/7$/, ninthLbl);
    const chord11Name = chord7Name.replace(/7$/, elevLbl);
    const chord13Name = chord7Name.replace(/7$/, thirLbl);

    const triadMidi  = [baseMidi + rOff, baseMidi + rOff + third, baseMidi + rOff + fifth];
    const chord7Midi  = [...triadMidi,  baseMidi + rOff + sev];
    const chord9Midi  = [...chord7Midi,  baseMidi + rOff + ninth];
    const chord11Midi = [...chord9Midi,  baseMidi + rOff + eleventh];
    const chord13Midi = [...chord11Midi, baseMidi + rOff + thirteenth];

    chords.push({ roman, noteName, quality, qClass, triadName, chord7Name, chord9Name, chord11Name, chord13Name, triadMidi, chord7Midi, chord9Midi, chord11Midi, chord13Midi });
  }

  // ── Titre ──────────────────────────────────────────────────────────────────
  const title = document.createElement('div');
  title.className = 'prog-title';
  title.textContent = `Diatonic Chords — ${root} ${def.label}`;
  container.appendChild(title);

  // ── Tableau I–VII ──────────────────────────────────────────────────────────
  const tableWrap = document.createElement('div');
  tableWrap.className = 'prog-table-wrap';
  const table = document.createElement('table');
  table.className = 'prog-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Degree</th><th>Note</th><th>Quality</th><th>Triad</th><th>7th</th><th>9th</th><th>11th</th><th>13th</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  chords.forEach(ch => {
    const tr = document.createElement('tr');
    tr.className = `prog-row prog-row-${ch.qClass}`;
    tr.innerHTML = `
      <td class="prog-roman prog-roman-${ch.qClass}">${ch.roman}</td>
      <td class="prog-note">${ch.noteName}</td>
      <td class="prog-quality prog-quality-${ch.qClass}">${ch.quality}</td>
      <td class="prog-chord-name">${ch.triadName}</td>
      <td class="prog-chord-name prog-seventh">${ch.chord7Name}</td>
      <td class="prog-chord-name prog-ext">${ch.chord9Name}</td>
      <td class="prog-chord-name prog-ext">${ch.chord11Name}</td>
      <td class="prog-chord-name prog-ext">${ch.chord13Name}</td>
    `;
    // Rendre chaque cellule d'accord cliquable — ouvre la modale staff
    const chordCells = tr.querySelectorAll('.prog-chord-name');
    const chordMidis  = [ch.triadMidi, ch.chord7Midi, ch.chord9Midi, ch.chord11Midi, ch.chord13Midi];
    const chordTitles = [ch.triadName, ch.chord7Name, ch.chord9Name, ch.chord11Name, ch.chord13Name];
    chordCells.forEach((cell, idx) => {
      cell.title = `View ${chordTitles[idx]} on staff`;
      cell.addEventListener('click', () => {
        if (window.MusicStaffEngine) {
          MusicStaffEngine.openForCustomChord({
            title: `${chordTitles[idx]} — ${ch.roman}`,
            midiNotes: chordMidis[idx],
            chordName: chordTitles[idx],
          });
        }
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);

  // ── Progressions classiques ────────────────────────────────────────────────
  const PROGRESSIONS = [
    { name: 'Perfect Cadence',    degrees: [4, 0],       display: 'V → I'            },
    { name: 'Plagal Cadence',     degrees: [3, 0],       display: 'IV → I'           },
    { name: 'Jazz Turnaround',    degrees: [1, 4, 0],    display: 'ii → V → I'       },
    { name: 'Three Chords',       degrees: [0, 3, 4],    display: 'I → IV → V'       },
    { name: 'Universal Pop',      degrees: [0, 4, 5, 3], display: 'I → V → vi → IV'  },
    { name: 'Doo-wop / 50s',      degrees: [0, 5, 3, 4], display: 'I → vi → IV → V'  },
  ];

  const cadSection = document.createElement('div');
  cadSection.className = 'cadences-section';
  const cadLabel = document.createElement('div');
  cadLabel.className = 'section-label';
  cadLabel.style.marginBottom = '0.75rem';
  cadLabel.textContent = 'Cadences & Classic Progressions';
  cadSection.appendChild(cadLabel);

  const grid = document.createElement('div');
  grid.className = 'cadences-grid';

  PROGRESSIONS.forEach(prog => {
    const chordMidiList = prog.degrees.map(d => chords[d].triadMidi);
    const chordNames    = prog.degrees.map(d => chords[d].triadName).join(' → ');
    const romanNames    = prog.degrees.map(d => chords[d].roman).join(' → ');

    const card = document.createElement('div');
    card.className = 'cadence-card';
    card.innerHTML = `
      <div class="cadence-name">${prog.name}</div>
      <div class="cadence-degrees">${romanNames}</div>
      <div class="cadence-chords">${chordNames}</div>
    `;
    const playBtn = document.createElement('button');
    playBtn.className = 'cadence-play-btn';
    playBtn.textContent = '▶  Play';
    playBtn.addEventListener('click', e => { e.stopPropagation(); playProgSequence(chordMidiList, 1.4, card); });
    card.addEventListener('click', () => playProgSequence(chordMidiList, 1.4, card));
    card.appendChild(playBtn);
    grid.appendChild(card);
  });

  cadSection.appendChild(grid);
  container.appendChild(cadSection);
}

// ─── Circle of Fifths ─────────────────────────────────────────────────────────

const COF_DATA = [
  { major: 'C',  minor: 'Am',  sig: '0',   mRoot: 'C',  minRoot: 'A'  },
  { major: 'G',  minor: 'Em',  sig: '1♯',  mRoot: 'G',  minRoot: 'E'  },
  { major: 'D',  minor: 'Bm',  sig: '2♯',  mRoot: 'D',  minRoot: 'B'  },
  { major: 'A',  minor: 'F♯m', sig: '3♯',  mRoot: 'A',  minRoot: 'F#' },
  { major: 'E',  minor: 'C♯m', sig: '4♯',  mRoot: 'E',  minRoot: 'C#' },
  { major: 'B',  minor: 'G♯m', sig: '5♯',  mRoot: 'B',  minRoot: 'G#' },
  { major: 'F♯', minor: 'D♯m', sig: '6♯',  mRoot: 'F#', minRoot: 'D#' },
  { major: 'D♭', minor: 'B♭m', sig: '5♭',  mRoot: 'Db', minRoot: 'Bb' },
  { major: 'A♭', minor: 'Fm',  sig: '4♭',  mRoot: 'Ab', minRoot: 'F'  },
  { major: 'E♭', minor: 'Cm',  sig: '3♭',  mRoot: 'Eb', minRoot: 'C'  },
  { major: 'B♭', minor: 'Gm',  sig: '2♭',  mRoot: 'Bb', minRoot: 'G'  },
  { major: 'F',  minor: 'Dm',  sig: '1♭',  mRoot: 'F',  minRoot: 'D'  },
];

function cofPolar(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function cofArc(cx, cy, r1, r2, a1, a2) {
  const s = cofPolar(cx, cy, r2, a1), e = cofPolar(cx, cy, r2, a2);
  const s2 = cofPolar(cx, cy, r1, a2), e2 = cofPolar(cx, cy, r1, a1);
  const lg = a2 - a1 > 180 ? 1 : 0;
  const f = v => v.toFixed(2);
  return `M${f(s.x)} ${f(s.y)} A${r2} ${r2} 0 ${lg} 1 ${f(e.x)} ${f(e.y)} L${f(s2.x)} ${f(s2.y)} A${r1} ${r1} 0 ${lg} 0 ${f(e2.x)} ${f(e2.y)}Z`;
}

function buildCof() {
  const container = document.getElementById('cofContainer');
  if (!container) return;
  container.innerHTML = '';

  const CX = 250, CY = 250;
  const R_OUT = 242, R_MID = 163, R_IN = 92, R_CORE = 44;
  const GAP = 1;
  const NS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 500 500');
  svg.setAttribute('class', 'cof-svg');

  COF_DATA.forEach((entry, i) => {
    const a1 = i * 30 + GAP, a2 = (i + 1) * 30 - GAP, mid = i * 30 + 15;

    // Major segment
    const pMaj = document.createElementNS(NS, 'path');
    pMaj.setAttribute('d', cofArc(CX, CY, R_MID, R_OUT, a1, a2));
    pMaj.setAttribute('class', 'cof-seg cof-seg-major');
    pMaj.dataset.index = i; pMaj.dataset.type = 'major';
    pMaj.addEventListener('click', () => {
      document.getElementById('rootSelect').value = entry.mRoot;
      document.getElementById('scaleTypeSelect').value = 'major';
      render();
    });
    svg.appendChild(pMaj);

    // Minor segment
    const pMin = document.createElementNS(NS, 'path');
    pMin.setAttribute('d', cofArc(CX, CY, R_IN, R_MID, a1, a2));
    pMin.setAttribute('class', 'cof-seg cof-seg-minor');
    pMin.dataset.index = i; pMin.dataset.type = 'minor';
    pMin.addEventListener('click', () => {
      document.getElementById('rootSelect').value = entry.minRoot;
      document.getElementById('scaleTypeSelect').value = 'natural_minor';
      render();
    });
    svg.appendChild(pMin);

    // Key sig segment (no pointer events)
    const pSig = document.createElementNS(NS, 'path');
    pSig.setAttribute('d', cofArc(CX, CY, R_CORE, R_IN, a1, a2));
    pSig.setAttribute('class', 'cof-seg-sig');
    svg.appendChild(pSig);

    // Major label
    const mpMaj = cofPolar(CX, CY, (R_MID + R_OUT) / 2, mid);
    const tMaj = document.createElementNS(NS, 'text');
    tMaj.setAttribute('x', mpMaj.x.toFixed(2)); tMaj.setAttribute('y', mpMaj.y.toFixed(2));
    tMaj.setAttribute('class', 'cof-label-major');
    tMaj.dataset.index = i; tMaj.dataset.type = 'major';
    tMaj.textContent = entry.major;
    svg.appendChild(tMaj);

    // Minor label
    const mpMin = cofPolar(CX, CY, (R_IN + R_MID) / 2, mid);
    const tMin = document.createElementNS(NS, 'text');
    tMin.setAttribute('x', mpMin.x.toFixed(2)); tMin.setAttribute('y', mpMin.y.toFixed(2));
    tMin.setAttribute('class', 'cof-label-minor');
    tMin.dataset.index = i; tMin.dataset.type = 'minor';
    tMin.textContent = entry.minor;
    svg.appendChild(tMin);

    // Key sig label
    const mpSig = cofPolar(CX, CY, (R_CORE + R_IN) / 2, mid);
    const tSig = document.createElementNS(NS, 'text');
    tSig.setAttribute('x', mpSig.x.toFixed(2)); tSig.setAttribute('y', mpSig.y.toFixed(2));
    tSig.setAttribute('class', 'cof-label-sig');
    tSig.textContent = entry.sig;
    svg.appendChild(tSig);
  });

  // Center
  const circ = document.createElementNS(NS, 'circle');
  circ.setAttribute('cx', CX); circ.setAttribute('cy', CY); circ.setAttribute('r', R_CORE);
  circ.setAttribute('fill', 'var(--surface)'); circ.setAttribute('stroke', 'rgba(55,65,81,0.6)'); circ.setAttribute('stroke-width', '1');
  svg.appendChild(circ);

  [['CIRCLE', -9], ['OF', 0], ['FIFTHS', 9]].forEach(([txt, dy]) => {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', CX); t.setAttribute('y', CY + dy);
    t.setAttribute('class', 'cof-center-text');
    t.textContent = txt;
    svg.appendChild(t);
  });

  container.appendChild(svg);
  updateCofHighlight();
}

function updateCofHighlight() {
  const svg = document.querySelector('.cof-svg');
  if (!svg) return;
  const root = document.getElementById('rootSelect').value;
  const scaleType = document.getElementById('scaleTypeSelect').value;
  const isMajor = scaleType === 'major';
  const isMinor = ['natural_minor', 'harmonic_minor', 'melodic_minor'].includes(scaleType);

  svg.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
  if (!isMajor && !isMinor) return;

  COF_DATA.forEach((entry, i) => {
    if (isMajor && entry.mRoot === root) {
      svg.querySelectorAll(`[data-index="${i}"]`).forEach(el => {
        if (el.dataset.type === 'major') el.classList.add('active');
      });
    }
    if (isMinor && entry.minRoot === root) {
      svg.querySelectorAll(`[data-index="${i}"]`).forEach(el => {
        if (el.dataset.type === 'minor') el.classList.add('active');
      });
    }
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ─── Note click → play ────────────────────────────────────────────────────────

// Delegated listeners on persistent containers (survive innerHTML rebuilds)
document.getElementById('notesRow').addEventListener('click', e => {
  const pill = e.target.closest('[data-midi]');
  if (pill) handleNoteClick(+pill.dataset.midi, pill);
});

['triadArp', 'seventhArp', 'ninthArp', 'eleventhArp', 'thirteenthArp'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    const circle = e.target.closest('[data-midi]');
    if (circle) handleNoteClick(+circle.dataset.midi, circle);
  });
});

// ─── Dictée musicale — fonctions ──────────────────────────────────────────────

function generateDicteeSeq() {
  if (!currentDicteePool.length) return;
  const count = parseInt(document.getElementById('noteCountSlider').value);
  currentDicteeSeq = Array.from({ length: count }, () =>
    currentDicteePool[Math.floor(Math.random() * currentDicteePool.length)]
  );
}

function openListenModal(pool, label) {
  currentDicteePool = pool || [];
  stopDictee();
  document.getElementById('dicteeSource').textContent = label || '';
  document.getElementById('listenModal').classList.add('open');
  // Réinitialise toujours à 4 notes par défaut
  const slider = document.getElementById('noteCountSlider');
  slider.value = 4;
  document.getElementById('noteCountVal').textContent = 4;
  generateDicteeSeq();
}

function closeListenModal() {
  stopDictee();
  dicteeReveal = false;
  const revBtn = document.getElementById('dicteeRevealBtn');
  if (revBtn) { revBtn.textContent = 'Show notes'; revBtn.classList.remove('active'); }
  document.getElementById('listenModal').classList.remove('open');
}

function stopDicteeNote() {
  if (currentDicteeNode) {
    try { currentDicteeNode.stop(); } catch(e) {}
    currentDicteeNode = null;
  }
}

function stopDictee() {
  dicteeTimeouts.forEach(t => clearTimeout(t));
  dicteeTimeouts = [];
  dicteeIsPlaying = false;
  stopDicteeNote();
  const btn = document.getElementById('dicteePlayBtn');
  if (btn) { btn.textContent = '▶  Play'; btn.classList.remove('playing'); }
  const circle = document.getElementById('dicteeCircle');
  if (circle) { circle.textContent = '♪'; circle.classList.remove('playing'); }
}

async function startDictee() {
  if (!currentDicteeSeq.length) return;
  await ensureInstrumentLoaded();
  const bpm = parseInt(document.getElementById('tempoSlider').value);
  const ms  = Math.round(60000 / bpm);
  const seq = currentDicteeSeq;
  dicteeIsPlaying = true;
  const btn = document.getElementById('dicteePlayBtn');
  btn.textContent = '■  Stop';
  btn.classList.add('playing');
  seq.forEach((midi, i) => {
    const t = setTimeout(() => {
      if (!dicteeIsPlaying) return;
      stopDicteeNote();
      while (midi < 45) midi += 12;
      while (midi > 96) midi -= 12;
      currentDicteeNode = currentInstrument.play(midiToName(midi), getAudioCtx().currentTime, { duration: 1.4, gain: 2 });
      const circle = document.getElementById('dicteeCircle');
      if (circle) {
        circle.classList.remove('playing');
        void circle.offsetWidth;
        circle.textContent = dicteeReveal ? midiToName(midi).replace(/\d/g, '') : '♪';
        circle.classList.add('playing');
        circle.addEventListener('animationend', () => circle.classList.remove('playing'), { once: true });
      }
      if (i === seq.length - 1) dicteeTimeouts.push(setTimeout(stopDictee, ms + 400));
    }, i * ms);
    dicteeTimeouts.push(t);
  });
}

// ─── Listen modal — handlers ───────────────────────────────────────────────────

const listenModal = document.getElementById('listenModal');
document.getElementById('modalClose').addEventListener('click', closeListenModal);
listenModal.addEventListener('click', e => { if (e.target === listenModal) closeListenModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeListenModal(); });

// ─── Controls ─────────────────────────────────────────────────────────────────

document.getElementById('rootSelect').addEventListener('change', render);
document.getElementById('scaleTypeSelect').addEventListener('change', render);
document.getElementById('transposeSelect').addEventListener('change', () => {
  const offset = parseInt(document.getElementById('transposeSelect').value);
  const enharmonic = document.getElementById('enharmonicNote');
  if (offset !== 0) {
    const text = document.getElementById('transposeSelect').options[document.getElementById('transposeSelect').selectedIndex].text;
    enharmonic.textContent = `Written pitch for: ${text}`;
  } else {
    enharmonic.textContent = '';
  }
  // Switch to the instrument that matches the new transposition and pre-load it
  currentInstrument = null;
  ensureInstrumentLoaded();
  render();
});

// Sélecteur d'octave
document.getElementById('octaveSelect').addEventListener('change', e => {
  rootOctave = parseInt(e.target.value);
  render();
});

// ─── Dictée — câblage des contrôles ───────────────────────────────────────────

document.getElementById('noteCountSlider').addEventListener('input', function () {
  document.getElementById('noteCountVal').textContent = this.value;
  stopDictee();
  generateDicteeSeq();
});

document.getElementById('tempoSlider').addEventListener('input', function () {
  document.getElementById('tempoVal').textContent = this.value + ' BPM';
});

document.getElementById('dicteePlayBtn').addEventListener('click', () => {
  if (dicteeIsPlaying) stopDictee();
  else startDictee();
});

document.getElementById('dicteeNewBtn').addEventListener('click', () => {
  stopDictee();
  generateDicteeSeq();
});

document.getElementById('dicteeRevealBtn').addEventListener('click', function () {
  dicteeReveal = !dicteeReveal;
  this.classList.toggle('active', dicteeReveal);
  this.textContent = dicteeReveal ? 'Hide notes' : 'Show notes';
});

// Init
render();
buildCof();;
