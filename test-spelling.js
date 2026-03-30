/**
 * Standalone spelling tests — run with: node test-spelling.js
 * Extracts only the pure data/functions needed from script.js + music-staff-engine.js
 */

// ─── Data from script.js ──────────────────────────────────────────────────────

const LETTER_NAMES     = ['C','D','E','F','G','A','B'];
const LETTER_CHROMATIC = [0, 2, 4, 5, 7, 9, 11];

const ROOT_LETTER_IDX = {
  'C':0, 'C#':0, 'Db':1,
  'D':1, 'D#':1, 'Eb':2,
  'E':2, 'F':3,
  'F#':3, 'Gb':4,
  'G':4, 'G#':4, 'Ab':5,
  'A':5, 'A#':5, 'Bb':6,
  'B':6
};

const DIATONIC_SCALES = new Set([
  'major','natural_minor','harmonic_minor','melodic_minor',
  'dorian','mixolydian','lydian','phrygian','locrian'
]);

function getRootIndex(root) {
  const map = {
    'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,
    'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11
  };
  return map[root] ?? 0;
}

function spellNote(chromatic, letterIdx) {
  const li  = ((letterIdx % 7) + 7) % 7;
  const nat = LETTER_CHROMATIC[li];
  let acc   = ((chromatic - nat) % 12 + 12) % 12;
  if (acc > 6) acc -= 12;
  const base = LETTER_NAMES[li];
  if (acc ===  0) return base;
  if (acc ===  1) return base + '#';
  if (acc === -1) return base + 'b';
  if (acc ===  2) return base + '\u00D7';     // × double sharp
  if (acc === -2) return base + '\u266D\u266D'; // ♭♭ double flat
  return base;
}

function getCumulativeOffsets(intervals) {
  const out = [0];
  let sum = 0;
  for (let i = 0; i < intervals.length - 1; i++) {
    sum += intervals[i];
    out.push(sum);
  }
  out.push(12);
  return out;
}

function buildScaleNotes(rootIdx, intervals, rootLetterIdx) {
  const notes = [];
  if (rootLetterIdx !== undefined) {
    let chromOffset = 0;
    notes.push(spellNote(rootIdx, rootLetterIdx));
    for (let i = 0; i < intervals.length - 1; i++) {
      chromOffset += intervals[i];
      notes.push(spellNote((rootIdx + chromOffset) % 12, rootLetterIdx + i + 1));
    }
    notes.push(spellNote(rootIdx, rootLetterIdx) + "'");
  }
  return notes;
}

// Scale definitions (intervals only — all we need for tests)
const SCALE_DEFS = {
  major:          { intervals: [2,2,1,2,2,2,1] },
  natural_minor:  { intervals: [2,1,2,2,1,2,2] },
  harmonic_minor: { intervals: [2,1,2,2,1,3,1] },
  melodic_minor:  { intervals: [2,1,2,2,2,2,1] },
  dorian:         { intervals: [2,1,2,2,2,1,2] },
  mixolydian:     { intervals: [2,2,1,2,2,1,2] },
  lydian:         { intervals: [2,2,2,1,2,2,1] },
  phrygian:       { intervals: [1,2,2,2,1,2,2] },
  locrian:        { intervals: [1,2,2,1,2,2,2] },
};

// ─── Function under test: _buildCustomChordSeq spelling logic ─────────────────

function _buildPcToDegreeMap(rootIdx, scaleType) {
  const intervals = SCALE_DEFS[scaleType].intervals;
  const map = {};
  let cumul = 0;
  for (let d = 0; d < intervals.length; d++) {
    map[(rootIdx + cumul) % 12] = d;
    cumul += intervals[d];
  }
  return map;
}

function _parseSpelling(noteName) {
  const clean = noteName.replace("'", '').trim();
  const spelt = clean.includes('/') ? clean.split('/')[0] : clean;
  const letter = spelt[0].toUpperCase();
  const acc    = spelt.slice(1);
  const alter  = acc === '#'                       ?  1
               : acc === 'b'                       ? -1
               : acc === '\u00D7' || acc === '×'   ?  2
               : acc.includes('\u266D\u266D')       ? -2
               : 0;
  return { letter, alter };
}

function spellCustomChord(midiNotes, rootIdx, rootLetterIdx, scaleType, transposeOffset) {
  const useDiatonic = DIATONIC_SCALES.has(scaleType) && rootLetterIdx !== undefined;
  const pcToDegree  = useDiatonic ? _buildPcToDegreeMap(rootIdx, scaleType) : null;

  const FLAT_LETTERS = ['C','D','D','E','E','F','G','G','A','A','B','B'];
  const FLAT_ALTERS  = [0,-1,0,-1,0,0,-1,0,-1,0,-1,0];

  return midiNotes.map(cMidi => {
    let m = cMidi;
    while (m < 45) m += 12;
    while (m > 96) m -= 12;
    const wMidi = m - transposeOffset;
    const chrPc = ((wMidi % 12) + 12) % 12;

    if (pcToDegree && pcToDegree[chrPc] !== undefined) {
      const degree = pcToDegree[chrPc];
      return spellNote(chrPc, rootLetterIdx + degree);
    } else {
      const letter = FLAT_LETTERS[chrPc];
      const alter  = FLAT_ALTERS[chrPc];
      return letter + (alter === -1 ? 'b' : alter === 1 ? '#' : '');
    }
  });
}

// Build progression chords (same logic as renderProgressions in script.js)
function buildProgressionChords(rootIdx, scaleType, baseMidi) {
  const def = SCALE_DEFS[scaleType];
  const off = [0];
  for (const s of def.intervals) off.push(off[off.length - 1] + s);
  while (off.length <= 18) off.push(off[off.length - 7] + 12);

  const chords = [];
  for (let i = 0; i < 7; i++) {
    const rOff  = off[i];
    const third = off[i + 2] - rOff;
    const fifth = off[i + 4] - rOff;
    const sev   = off[i + 6] - rOff;
    const ninth      = off[i + 8]  - rOff;
    const eleventh   = off[i + 10] - rOff;
    const thirteenth = off[i + 12] - rOff;

    const triadMidi   = [baseMidi + rOff, baseMidi + rOff + third, baseMidi + rOff + fifth];
    const chord7Midi  = [...triadMidi,  baseMidi + rOff + sev];
    const chord9Midi  = [...chord7Midi,  baseMidi + rOff + ninth];
    const chord11Midi = [...chord9Midi,  baseMidi + rOff + eleventh];
    const chord13Midi = [...chord11Midi, baseMidi + rOff + thirteenth];

    chords.push({ degree: i, triadMidi, chord7Midi, chord9Midi, chord11Midi, chord13Midi });
  }
  return chords;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

function assert(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push({ name, expected, actual });
  }
}

// ─── Test 1: Every diatonic scale × every root uses 7 distinct letters ────────

console.log('\n=== Test 1: Scale spelling — 7 distinct letters ===');

const ROOTS = ['C','C#','Db','D','D#','Eb','E','F','F#','Gb','G','G#','Ab','A','A#','Bb','B'];

ROOTS.forEach(root => {
  const rootIdx = getRootIndex(root);
  const rootLetterIdx = ROOT_LETTER_IDX[root];
  if (rootLetterIdx === undefined) return;

  Object.keys(SCALE_DEFS).forEach(scaleType => {
    if (!DIATONIC_SCALES.has(scaleType)) return;
    const notes = buildScaleNotes(rootIdx, SCALE_DEFS[scaleType].intervals, rootLetterIdx);
    const letters = notes.slice(0, 7).map(n => n[0]);
    const unique = new Set(letters);
    assert(`${root} ${scaleType}: 7 letters`, unique.size, 7);
  });
});

// ─── Test 2: All progression chords — note letters match scale degrees ────────

console.log('=== Test 2: Progression chord spelling — letters match scale ===');

const ROMAN = ['I','II','III','IV','V','VI','VII'];
const CHORD_TYPES = ['triad','7th','9th','11th','13th'];
const CHORD_DEGREES = { triad: [0,2,4], '7th': [0,2,4,6], '9th': [0,2,4,6,8], '11th': [0,2,4,6,8,10], '13th': [0,2,4,6,8,10,12] };
const CHORD_MIDI_KEY = { triad: 'triadMidi', '7th': 'chord7Midi', '9th': 'chord9Midi', '11th': 'chord11Midi', '13th': 'chord13Midi' };

ROOTS.forEach(root => {
  const rootIdx = getRootIndex(root);
  const rootLetterIdx = ROOT_LETTER_IDX[root];
  if (rootLetterIdx === undefined) return;

  Object.keys(SCALE_DEFS).forEach(scaleType => {
    if (!DIATONIC_SCALES.has(scaleType)) return;

    const scaleNotes = buildScaleNotes(rootIdx, SCALE_DEFS[scaleType].intervals, rootLetterIdx);
    const scaleLetters = scaleNotes.slice(0, 7).map(n => n[0]);
    const baseMidi = 60 + rootIdx;
    const chords = buildProgressionChords(rootIdx, scaleType, baseMidi);

    chords.forEach(ch => {
      CHORD_TYPES.forEach(ct => {
        const midi = ch[CHORD_MIDI_KEY[ct]];
        const spelled = spellCustomChord(midi, rootIdx, rootLetterIdx, scaleType, 0);
        const spelledLetters = spelled.map(n => n[0]);
        const expectedLetters = CHORD_DEGREES[ct].map(off => scaleLetters[(ch.degree + off) % 7]);

        assert(
          `${root} ${scaleType} ${ROMAN[ch.degree]} ${ct}`,
          spelledLetters.join(','),
          expectedLetters.join(',')
        );
      });
    });
  });
});

// ─── Test 3: Specific known spellings ─────────────────────────────────────────

console.log('=== Test 3: Specific known cases ===');

// B melodic minor — I chord (Bmaj9): B D F# A# C#
{
  const s = spellCustomChord([71,74,78,82,85], 11, 6, 'melodic_minor', 0);
  assert('B mel.min I Bmaj9', s.join(', '), 'B, D, F#, A#, C#');
}

// B melodic minor — II chord (C#m11): C# E G# B D F#
{
  const off = [0]; const iv = [2,1,2,2,2,2,1];
  for (const s of iv) off.push(off[off.length-1]+s);
  while (off.length <= 18) off.push(off[off.length-7]+12);
  const i = 1, baseMidi = 71, rOff = off[i];
  const midi = [baseMidi+rOff, baseMidi+rOff+(off[i+2]-rOff), baseMidi+rOff+(off[i+4]-rOff),
                baseMidi+rOff+(off[i+6]-rOff), baseMidi+rOff+(off[i+8]-rOff), baseMidi+rOff+(off[i+10]-rOff)];
  const s = spellCustomChord(midi, 11, 6, 'melodic_minor', 0);
  assert('B mel.min II C#m11', s.join(', '), 'C#, E, G#, B, D, F#');
}

// Eb Locrian scale
{
  const notes = buildScaleNotes(3, SCALE_DEFS.locrian.intervals, 2);
  assert('Eb Locrian scale', notes.slice(0,7).join(', '), 'Eb, Fb, Gb, Ab, B\u266D\u266D, Cb, Db');
}

// Gb Major — 4th degree Cb
{
  const notes = buildScaleNotes(6, SCALE_DEFS.major.intervals, 4);
  assert('Gb Major 4th = Cb', notes[3], 'Cb');
}

// C# Major — 7th degree B#
{
  const notes = buildScaleNotes(1, SCALE_DEFS.major.intervals, 0);
  assert('C# Major 7th = B#', notes[6], 'B#');
}

// C major — I triad: C E G
{
  const s = spellCustomChord([60, 64, 67], 0, 0, 'major', 0);
  assert('C major I triad', s.join(', '), 'C, E, G');
}

// C major — ii 7th: D F A C
{
  const s = spellCustomChord([62, 65, 69, 72], 0, 0, 'major', 0);
  assert('C major ii 7th', s.join(', '), 'D, F, A, C');
}

// F# major — VII dim triad: E# G# B
{
  const off = [0]; const iv = [2,2,1,2,2,2,1];
  for (const st of iv) off.push(off[off.length-1]+st);
  while (off.length <= 18) off.push(off[off.length-7]+12);
  const baseMidi = 60 + 6; // F#4
  const i = 6, rOff = off[i];
  const midi = [baseMidi+rOff, baseMidi+rOff+(off[i+2]-rOff), baseMidi+rOff+(off[i+4]-rOff)];
  const s = spellCustomChord(midi, 6, 3, 'major', 0);
  assert('F# major VII dim', s.join(', '), 'E#, G#, B');
}

// ─── Test 4: Octave boundary ──────────────────────────────────────────────────

console.log('=== Test 4: Octave boundary (Cb / B#) ===');

assert('Cb MIDI 71 → oct 5', Math.floor((71 - (-1)) / 12) - 1, 5);
assert('B# MIDI 60 → oct 3', Math.floor((60 - 1) / 12) - 1, 3);
assert('B  MIDI 71 → oct 4', Math.floor((71 - 0) / 12) - 1, 4);
assert('C  MIDI 72 → oct 5', Math.floor((72 - 0) / 12) - 1, 5);

// ─── Test 5: Scale octave — every note ascending must be ≥ previous ───────────

console.log('=== Test 5: Scale note octaves ascending (all roots × scales × octaves 2–5) ===');

function buildScaleSeqWithOctaves(rootIdx, rootOctave, scaleType, rootLetterIdx) {
  const def = SCALE_DEFS[scaleType];
  const offsets = getCumulativeOffsets(def.intervals);
  const scaleNotes = buildScaleNotes(rootIdx, def.intervals, rootLetterIdx);
  const writtenBase = 12 * (rootOctave + 1) + rootIdx;

  const seq = [];
  for (let i = 0; i < scaleNotes.length - 1; i++) {
    const wMidi = writtenBase + offsets[i];
    const parsed = _parseSpelling(scaleNotes[i]);
    const oct = Math.floor((wMidi - parsed.alter) / 12) - 1;
    seq.push({ name: scaleNotes[i], letter: parsed.letter, alter: parsed.alter, octave: oct, wMidi });
  }
  // top note (octave repeat)
  const topWMidi = writtenBase + 12;
  const parsedRoot = _parseSpelling(scaleNotes[0]);
  seq.push({ name: scaleNotes[0] + "'", letter: parsedRoot.letter, alter: parsedRoot.alter,
    octave: Math.floor((topWMidi - parsedRoot.alter) / 12) - 1, wMidi: topWMidi });
  return seq;
}

ROOTS.forEach(root => {
  const rootIdx = getRootIndex(root);
  const rootLetterIdx = ROOT_LETTER_IDX[root];
  if (rootLetterIdx === undefined) return;

  Object.keys(SCALE_DEFS).forEach(scaleType => {
    if (!DIATONIC_SCALES.has(scaleType)) return;

    [2, 3, 4, 5].forEach(rootOctave => {
      const seq = buildScaleSeqWithOctaves(rootIdx, rootOctave, scaleType, rootLetterIdx);

      // Every note's MusicXML pitch (letter+oct) must be strictly ascending
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1];
        const curr = seq[i];
        // Convert to a comparable value: octave * 7 + letter index
        const letterOrder = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
        const prevVal = prev.octave * 7 + letterOrder[prev.letter];
        const currVal = curr.octave * 7 + letterOrder[curr.letter];

        if (currVal <= prevVal) {
          failed++;
          failures.push({
            name: `${root} ${scaleType} oct${rootOctave} note ${i}: ${prev.name}${prev.octave} → ${curr.name}${curr.octave}`,
            expected: `${curr.name} should be higher than ${prev.name}${prev.octave}`,
            actual: `${curr.name}${curr.octave} (prevVal=${prevVal}, currVal=${currVal})`
          });
        } else {
          passed++;
        }
      }
    });
  });
});

// ─── Test 6: Chord octave — every chord note ascending must be ≥ previous ────

console.log('=== Test 6: Chord note octaves ascending (all roots × scales × chord types) ===');

function buildChordSeqWithOctaves(rootIdx, rootOctave, scaleType, rootLetterIdx, semitones) {
  const writtenBase = 12 * (rootOctave + 1) + rootIdx;
  const useDiatonic = DIATONIC_SCALES.has(scaleType) && rootLetterIdx !== undefined;

  return semitones.map((s, i) => {
    const wMidi = writtenBase + s;
    const chrPc = (rootIdx + s) % 12;
    let letter, alter;

    if (useDiatonic) {
      const arpLetterOff = i * 2;
      const liIdx = (rootLetterIdx + arpLetterOff) % 7;
      const nat = LETTER_CHROMATIC[liIdx];
      let acc = ((chrPc - nat) % 12 + 12) % 12;
      if (acc > 6) acc -= 12;
      letter = LETTER_NAMES[liIdx];
      alter = acc;
    } else {
      const FLAT_LETTERS = ['C','D','D','E','E','F','G','G','A','A','B','B'];
      const FLAT_ALTERS = [0,-1,0,-1,0,0,-1,0,-1,0,-1,0];
      letter = FLAT_LETTERS[chrPc];
      alter = FLAT_ALTERS[chrPc];
    }

    return {
      letter, alter,
      octave: Math.floor((wMidi - alter) / 12) - 1,
      wMidi,
      display: letter + (alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '×' : alter === -2 ? '♭♭' : '')
    };
  });
}

// Chord semitone definitions (same as getArpSemitones in script.js)
const CHORD_SEMITONES = {
  major:          { triad:[0,4,7],   seventh:[0,4,7,11] },
  natural_minor:  { triad:[0,3,7],   seventh:[0,3,7,10] },
  harmonic_minor: { triad:[0,3,7],   seventh:[0,3,7,11] },
  melodic_minor:  { triad:[0,3,7],   seventh:[0,3,7,11] },
  dorian:         { triad:[0,3,7],   seventh:[0,3,7,10] },
  mixolydian:     { triad:[0,4,7],   seventh:[0,4,7,10] },
  lydian:         { triad:[0,4,7],   seventh:[0,4,7,11] },
  phrygian:       { triad:[0,3,7],   seventh:[0,3,7,10] },
  locrian:        { triad:[0,3,6],   seventh:[0,3,6,10] },
};

ROOTS.forEach(root => {
  const rootIdx = getRootIndex(root);
  const rootLetterIdx = ROOT_LETTER_IDX[root];
  if (rootLetterIdx === undefined) return;

  Object.keys(CHORD_SEMITONES).forEach(scaleType => {
    ['triad', 'seventh'].forEach(chordType => {
      const semitones = CHORD_SEMITONES[scaleType][chordType];

      [3, 4, 5].forEach(rootOctave => {
        const seq = buildChordSeqWithOctaves(rootIdx, rootOctave, scaleType, rootLetterIdx, semitones);
        const letterOrder = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

        for (let i = 1; i < seq.length; i++) {
          const prev = seq[i - 1];
          const curr = seq[i];
          const prevVal = prev.octave * 7 + letterOrder[prev.letter];
          const currVal = curr.octave * 7 + letterOrder[curr.letter];

          if (currVal <= prevVal) {
            failed++;
            failures.push({
              name: `${root} ${scaleType} ${chordType} oct${rootOctave}: ${prev.display}${prev.octave} → ${curr.display}${curr.octave}`,
              expected: `ascending`,
              actual: `${curr.display}${curr.octave} not above ${prev.display}${prev.octave} (MIDI ${prev.wMidi}→${curr.wMidi})`
            });
          } else {
            passed++;
          }
        }
      });
    });
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
if (failures.length > 0) {
  console.log(`\x1b[31m${failures.length} FAILED\x1b[0m out of ${passed + failed}:\n`);
  failures.forEach(f => {
    console.log(`  \x1b[31mFAIL\x1b[0m: ${f.name}`);
    console.log(`    expected: ${f.expected}`);
    console.log(`    got:      ${f.actual}`);
  });
} else {
  console.log(`\x1b[32m${passed}/${passed + failed} ALL PASSED\x1b[0m`);
}
console.log('='.repeat(60));

process.exit(failures.length > 0 ? 1 : 0);
