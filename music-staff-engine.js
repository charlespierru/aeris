/**
 * MusicStaffEngine — v1.0
 * Notation musicale pour Aeris (Scales & Arpeggios)
 *
 * Architecture :
 *   AppStateReader    — snapshot du state courant (DOM → objet)
 *   MusicXMLBuilder   — génération MusicXML 3.1 valide
 *   MusicStaffRenderer— wrapper OSMD (OpenSheetMusicDisplay)
 *   MusicStaffPlayer  — lecture audio séquentielle avec tempo
 *   MusicStaffExporter— téléchargement .musicxml
 *   MusicStaffModal   — contrôleur UI de la modale
 *
 * Dépendances globales (depuis script.js) :
 *   SCALE_DEFS, getRootIndex, buildScaleNotes, getCumulativeOffsets,
 *   getArpSemitones, renderArp (pour la notation), spellNote,
 *   ROOT_LETTER_IDX, DIATONIC_SCALES, LETTER_CHROMATIC, LETTER_NAMES,
 *   playNote, ensureInstrumentLoaded
 *
 * Dépendance CDN :
 *   opensheetmusicdisplay (OSMD) chargé avant ce fichier
 */

(function (global) {
  'use strict';

  // ── 1. Constantes ────────────────────────────────────────────────────────────

  /** Clef MusicXML par type */
  const CLEF_CONFIG = {
    treble:  { sign: 'G', line: 2 },
    bass:    { sign: 'F', line: 4 },
    alto:    { sign: 'C', line: 3 },
    tenor:   { sign: 'C', line: 4 },
    soprano: { sign: 'C', line: 1 },
    mezzo:   { sign: 'C', line: 2 },
    baritonefa: { sign: 'F', line: 3 },
  };

  /** Transposition (offset app) → clef automatique */
  const CLEF_FROM_TRANSPOSE = {
    '0':  'treble',   // instruments en Ut
    '-2': 'treble',   // instruments en Sib (clarinette, sax ténor, trompette)
    '-9': 'treble',   // instruments en Mib (sax alto, sax baryton)
    '-7': 'treble',   // instruments en Fa (cor)
    // futur : bass pour trombone/tuba/basson, alto pour altiste, tenor pour ténor
  };

  /** Indice chromatique (0=C … 11=B) → nombre de quintes (cercle des quintes) */
  const IDX_TO_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

  /**
   * Décalage en demi-tons entre la tonique du mode et la tonique majeure parente.
   * Ex : D dorien → C majeur (décalage +2) → parent = D - 2 = C
   */
  const MODE_SEMITONE_ABOVE_MAJOR = {
    major: 0, lydian: 5, mixolydian: 7,
    natural_minor: 9, harmonic_minor: 9, melodic_minor: 9,
    dorian: 2, phrygian: 4,
    whole_tone: null, diminished: null, chromatic: null,
  };

  /** Type de gamme → nom de mode MusicXML */
  const SCALE_TO_MODE = {
    major: 'major', natural_minor: 'minor', harmonic_minor: 'minor',
    melodic_minor: 'minor', dorian: 'dorian', phrygian: 'phrygian',
    lydian: 'lydian', mixolydian: 'mixolydian',
    whole_tone: 'none', diminished: 'none', chromatic: 'none',
  };

  /** Type d'accord → label lisible */
  const CHORD_LABELS = {
    triad: 'Triad', seventh: '7th Chord', ninth: '9th Chord',
    eleventh: '11th Chord', thirteenth: '13th Chord',
  };


  // ── 2. AppStateReader ────────────────────────────────────────────────────────

  const AppStateReader = {
    /**
     * Retourne un snapshot du state courant de l'application.
     * Lit directement les éléments DOM et les structures de données de script.js.
     */
    snapshot() {
      const root          = document.getElementById('rootSelect').value;
      const scaleType     = document.getElementById('scaleTypeSelect').value;
      const transposeOffset = parseInt(document.getElementById('transposeSelect').value);
      const rootOctaveEl  = document.getElementById('octaveSelect');
      const rootOctave    = rootOctaveEl ? parseInt(rootOctaveEl.value) : 4;

      const def       = SCALE_DEFS[scaleType];
      const rootIdx   = getRootIndex(root);
      const offsets   = getCumulativeOffsets(def.intervals);

      // Spelling diatonique (identique à render() dans script.js)
      const rootLetterIdx = DIATONIC_SCALES.has(scaleType)
        ? ROOT_LETTER_IDX[root]
        : undefined;
      const scaleNotes = buildScaleNotes(rootIdx, def.intervals, rootLetterIdx);

      // Armure (hauteur écrite — pas de correction par transposeOffset)
      const keyFifths = _computeKeyFifths(rootIdx, scaleType);
      const keyMode   = SCALE_TO_MODE[scaleType] || 'major';

      // Clef automatique depuis la transposition
      const clef = CLEF_FROM_TRANSPOSE[String(transposeOffset)] || 'treble';

      // Label instrument
      const transposeEl = document.getElementById('transposeSelect');
      const instrumentLabel = transposeEl
        ? transposeEl.options[transposeEl.selectedIndex].text.replace(/\s*\(.*\)/, '').trim()
        : 'Wind Instrument';

      return {
        root, scaleType, transposeOffset, rootOctave,
        def, rootIdx, offsets, scaleNotes, rootLetterIdx,
        keyFifths, keyMode, clef, instrumentLabel,
      };
    },
  };

  /** Calcule le nombre de quintes pour l'armure (hauteur écrite) */
  function _computeKeyFifths(rootIdx, scaleType) {
    const semitone = MODE_SEMITONE_ABOVE_MAJOR[scaleType];
    if (semitone === null || semitone === undefined) return 0;
    const parentIdx = ((rootIdx - semitone) % 12 + 12) % 12;
    return IDX_TO_FIFTHS[parentIdx] ?? 0;
  }


  // ── 3. MusicXMLBuilder ───────────────────────────────────────────────────────

  const MusicXMLBuilder = {

    /**
     * Construit le MusicXML pour une gamme.
     * @param {object} state   — snapshot AppStateReader
     * @param {object} options — { octaves: 1|2, direction: 'ascending'|'descending'|'both', tempo: number }
     */
    buildScale(state, options = {}) {
      const { octaves = 1, direction = 'ascending', tempo = 80 } = options;
      const { root, scaleType, rootIdx, rootOctave, offsets, scaleNotes,
              keyFifths, keyMode, clef, def, instrumentLabel } = state;

      const title    = `${root} ${def.label}`;
      const partName = instrumentLabel;

      // Séquence de notes en hauteur écrite — une seule mesure, pas de barres
      const noteSeq = _buildScaleNoteSeq(state, octaves, direction);

      return _buildXML(title, partName, keyFifths, keyMode, clef, [noteSeq], tempo);
    },

    /**
     * Construit le MusicXML pour un accord (arpège).
     * @param {object} state     — snapshot AppStateReader
     * @param {string} chordType — 'triad'|'seventh'|'ninth'|'eleventh'|'thirteenth'
     * @param {object} options   — { octaves: 1|2, direction, tempo }
     */
    buildChord(state, chordType = 'triad', options = {}) {
      const { octaves = 1, direction = 'ascending', tempo = 80 } = options;
      const { root, def, rootIdx, rootOctave, keyFifths, keyMode, clef,
              scaleType, rootLetterIdx, instrumentLabel } = state;

      const title    = `${root} ${def.label} — ${CHORD_LABELS[chordType] || chordType}`;
      const partName = instrumentLabel;

      const semitones = getArpSemitones(scaleType, chordType);
      const noteSeq   = _buildChordNoteSeq(state, semitones, octaves, direction);

      return _buildXML(title, partName, keyFifths, keyMode, clef, [noteSeq], tempo);
    },
  };

  // ── Helpers MusicXML ────────────────────────────────────────────────────────

  /** Parse une note orthographiée ("Eb", "F#", "C×", "B♭♭", "C") → { letter, alter } */
  function _parseSpelling(noteName) {
    const clean = noteName.replace("'", '').trim();
    const spelt = clean.includes('/') ? clean.split('/')[0] : clean;
    const letter = spelt[0].toUpperCase();
    const acc    = spelt.slice(1);
    const alter  = acc === '#'                       ?  1
                 : acc === 'b'                       ? -1
                 : acc === '\u00D7' || acc === '×'   ?  2   // double dièse
                 : acc.includes('\u266D\u266D')       ? -2   // double bémol
                 : 0;
    return { letter, alter };
  }

  /**
   * Construit la séquence de notes écrites pour une gamme.
   * Retourne [{ letter, alter, octave, writtenMidi, concertMidi }]
   */
  /** Intervals for the melodic minor descending form (= natural minor) */
  const MELODIC_MINOR_DESC_INTERVALS = [2, 1, 2, 2, 1, 2, 2];

  function _buildScaleNoteSeq(state, octaves, direction) {
    const { rootIdx, rootOctave, offsets, scaleNotes, transposeOffset, scaleType, rootLetterIdx } = state;
    const writtenBase = 12 * (rootOctave + 1) + rootIdx;
    const isMelodicMinor = (scaleType === 'melodic_minor');

    // ── Build ascending sequence ──
    function _buildAsc(theOffsets, theNotes) {
      const seq = [];
      for (let oct = 0; oct < octaves; oct++) {
        const degreeCount = theNotes.length - 1;
        for (let i = 0; i < degreeCount; i++) {
          const wMidi = writtenBase + oct * 12 + theOffsets[i];
          const { letter, alter } = _parseSpelling(theNotes[i]);
          seq.push({
            letter, alter,
            octave:      Math.floor((wMidi - alter) / 12) - 1,
            writtenMidi: wMidi,
            concertMidi: wMidi + transposeOffset,
          });
        }
      }
      // Root at the top
      const topWMidi = writtenBase + octaves * 12;
      const { letter: rL, alter: rA } = _parseSpelling(theNotes[0]);
      seq.push({ letter: rL, alter: rA,
        octave: Math.floor((topWMidi - rA) / 12) - 1,
        writtenMidi: topWMidi, concertMidi: topWMidi + transposeOffset });
      return seq;
    }

    const ascending = _buildAsc(offsets, scaleNotes);

    if (direction === 'ascending') return ascending;

    if (isMelodicMinor) {
      // Descending uses natural minor intervals and spelling
      const descOffsets = getCumulativeOffsets(MELODIC_MINOR_DESC_INTERVALS);
      const descNotes   = buildScaleNotes(rootIdx, MELODIC_MINOR_DESC_INTERVALS, rootLetterIdx);
      const descAsc     = _buildAsc(descOffsets, descNotes);
      const descSeq     = [...descAsc].reverse();

      if (direction === 'descending') return descSeq;
      // both: ascending (melodic) + descending (natural minor, top note not repeated)
      return [...ascending, ...descSeq.slice(1)];
    }

    if (direction === 'descending') return [...ascending].reverse();
    // both : montée + descente (note du sommet non répétée)
    const desc = [...ascending].reverse().slice(1);
    return [...ascending, ...desc];
  }

  /**
   * Construit la séquence de notes pour un accord arpégé.
   * Les demi-tons (semitones) sont les intervalles depuis la fondamentale.
   */
  function _buildChordNoteSeq(state, semitones, octaves, direction) {
    const { rootIdx, rootOctave, transposeOffset, rootLetterIdx, scaleType } = state;
    const writtenBase = 12 * (rootOctave + 1) + rootIdx;
    const useDiatonic = DIATONIC_SCALES.has(scaleType) && rootLetterIdx !== undefined;

    const ascending = [];

    for (let oct = 0; oct < octaves; oct++) {
      semitones.forEach((s, i) => {
        const wMidi  = writtenBase + oct * 12 + s;
        const chrPc  = (rootIdx + s) % 12;
        let letter, alter;

        if (useDiatonic) {
          // Spelling diatonique (même logique que renderArp dans script.js)
          const arpLetterOff = i * 2;
          const liIdx = (rootLetterIdx + oct * 7 + arpLetterOff) % 7;
          const nat   = LETTER_CHROMATIC[liIdx];
          let acc     = ((chrPc - nat) % 12 + 12) % 12;
          if (acc > 6) acc -= 12;
          letter = LETTER_NAMES[liIdx];
          alter  = acc; // -2,-1,0,1,2
        } else {
          // Spelling chromatique par défaut (bémols)
          const FLAT_STEPS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
          const FLAT_ALTERS = [0,-1,0,-1,0,0,-1,0,-1,0,-1,0];
          const FLAT_LETTERS = ['C','D','D','E','E','F','G','G','A','A','B','B'];
          letter = FLAT_LETTERS[chrPc];
          alter  = FLAT_ALTERS[chrPc];
        }

        ascending.push({
          letter, alter,
          octave:      Math.floor((wMidi - alter) / 12) - 1,
          writtenMidi: wMidi,
          concertMidi: wMidi + transposeOffset,
        });
      });
    }

    // No extra closing root — only the actual chord tones
    if (direction === 'ascending')  return ascending;
    if (direction === 'descending') return [...ascending].reverse();
    // both: up then down, top note not repeated
    const desc = [...ascending].reverse().slice(1);
    return [...ascending, ...desc];
  }

  /**
   * Build a map from pitch class (0–11) to scale degree index (0–6) for a diatonic scale.
   */
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

  /**
   * Build a note sequence from raw concert-pitch MIDI values (for custom/progression chords).
   * Uses diatonic spelling via pc→degree map when available, otherwise flat spelling.
   */
  function _buildCustomChordSeq(concertMidiNotes, state, direction) {
    const { transposeOffset, rootIdx, rootLetterIdx, scaleType } = state;
    const useDiatonic = DIATONIC_SCALES.has(scaleType) && rootLetterIdx !== undefined;
    const pcToDegree  = useDiatonic ? _buildPcToDegreeMap(rootIdx, scaleType) : null;

    const FLAT_LETTERS = ['C','D','D','E','E','F','G','G','A','A','B','B'];
    const FLAT_ALTERS  = [0,-1,0,-1,0,0,-1,0,-1,0,-1,0];

    const ascending = concertMidiNotes.map(cMidi => {
      let m = cMidi;
      while (m < 45) m += 12;
      while (m > 96) m -= 12;
      const wMidi = m - transposeOffset;
      const chrPc = ((wMidi % 12) + 12) % 12;

      let letter, alter;
      if (pcToDegree && pcToDegree[chrPc] !== undefined) {
        const degree = pcToDegree[chrPc];
        const spelled = spellNote(chrPc, rootLetterIdx + degree);
        ({ letter, alter } = _parseSpelling(spelled));
      } else {
        letter = FLAT_LETTERS[chrPc];
        alter  = FLAT_ALTERS[chrPc];
      }

      return {
        letter, alter,
        octave: Math.floor((wMidi - alter) / 12) - 1,
        writtenMidi: wMidi,
        concertMidi: m,
      };
    });

    if (direction === 'ascending')  return ascending;
    if (direction === 'descending') return [...ascending].reverse();
    const desc = [...ascending].reverse().slice(1);
    return [...ascending, ...desc];
  }

  /** Découpe un tableau de notes en mesures de beatsPerMeasure notes (complétées avec des silences) */
  function _splitMeasures(notes, beatsPerMeasure) {
    const measures = [];
    for (let i = 0; i < notes.length; i += beatsPerMeasure) {
      const m = notes.slice(i, i + beatsPerMeasure);
      while (m.length < beatsPerMeasure) m.push({ rest: true });
      measures.push(m);
    }
    if (!measures.length) measures.push([{ rest: true }, { rest: true }, { rest: true }, { rest: true }]);
    return measures;
  }

  /** Échappe les caractères XML spéciaux dans une chaîne de texte */
  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Assemble le document MusicXML 3.1 complet — une seule mesure, pas de barres */
  function _buildXML(title, partName, keyFifths, keyMode, clef, measures, tempo) {
    const { sign, line } = CLEF_CONFIG[clef] || CLEF_CONFIG.treble;
    const modeTag = keyMode === 'none' ? '' : `<mode>${keyMode}</mode>`;
    const allNotes = measures[0] || [];
    const noteCount = allNotes.filter(n => !n.rest).length || 1;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${_esc(title)}</work-title></work>
  <identification>
    <encoding>
      <software>MusicStaffEngine 1.0 — Aeris</software>
      <encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>${_esc(partName)}</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>${keyFifths}</fifths>${modeTag}</key>
        <time symbol="none"><beats>${noteCount}</beats><beat-type>4</beat-type></time>
        <clef><sign>${sign}</sign><line>${line}</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome>
        </direction-type>
        <sound tempo="${tempo}"/>
      </direction>`;

    allNotes.forEach(note => {
      if (note.rest) {
        xml += `
      <note><rest/><duration>1</duration><type>quarter</type></note>`;
      } else {
        const alterTag = note.alter !== 0 ? `\n          <alter>${note.alter}</alter>` : '';
        xml += `
      <note>
        <pitch>
          <step>${note.letter}</step>${alterTag}
          <octave>${note.octave}</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>`;
      }
    });

    xml += `
    </measure>
  </part>
</score-partwise>`;

    return xml;
  }


  // ── 4. MusicStaffRenderer (OSMD) ─────────────────────────────────────────────

  class MusicStaffRenderer {
    constructor(divId) {
      this._divId   = divId;
      this._osmd    = null;
      this._ready   = false;
    }

    /** Initialise OSMD sur le div (appelé une fois que le div est dans le DOM) */
    _init() {
      if (this._osmd) return;
      const OSMD = global.opensheetmusicdisplay?.OpenSheetMusicDisplay;
      if (!OSMD) {
        console.error('MusicStaffEngine: OSMD non disponible — vérifier le CDN');
        return;
      }
      this._osmd = new OSMD(this._divId, {
        backend:           'svg',
        autoResize:        false,
        drawTitle:         true,
        drawSubtitle:      false,
        drawComposer:      false,
        drawingParameters: 'compact',
        defaultColorNotehead: '#1a1a1a',
        defaultColorStem:     '#1a1a1a',
        defaultColorRest:     '#333333',
      });
    }

    /**
     * Charge et affiche un document MusicXML.
     * @param {string} xmlString
     * @returns {Promise<void>}
     */
    async render(xmlString) {
      this._init();
      if (!this._osmd) return;
      const container = document.getElementById(this._divId);
      if (container) container.innerHTML = '';
      try {
        await this._osmd.load(xmlString);
        this._osmd.render();
        this._ready = true;
        this._noteheadEls = null; // invalidate cache
      } catch (err) {
        console.error('MusicStaffEngine: erreur OSMD render', err);
        if (container) {
          container.innerHTML = '<div class="staff-error">Erreur de rendu — MusicXML invalide</div>';
        }
      }
    }

    /**
     * Highlight the note at the given index (0-based) in the rendered score.
     * Pass -1 to clear all highlights.
     * Uses OSMD cursor (primary) with GraphicSheet fallback.
     */
    /**
     * Cache les éléments SVG notehead au premier appel pour un accès O(1).
     */
    _cacheNoteheads() {
      const container = document.getElementById(this._divId);
      if (!container) { this._noteheadEls = []; return; }
      // OSMD renders noteheads as SVG elements with class 'vf-notehead'
      // Fallback: find all <ellipse> or notehead <path> elements in the SVG
      let heads = Array.from(container.querySelectorAll('.vf-notehead'));
      if (!heads.length) {
        // Alternative: look for note group elements
        heads = Array.from(container.querySelectorAll('.vf-stavenote'));
      }
      this._noteheadEls = heads;
    }

    highlightNote(idx) {
      if (!this._osmd || !this._ready) return;
      const container = document.getElementById(this._divId);
      if (!container) return;

      // Remove previous highlights
      container.querySelectorAll('.staff-note-highlight').forEach(el => el.remove());

      if (idx < 0) return;

      // Build cache on first call after render
      if (!this._noteheadEls) this._cacheNoteheads();

      const el = this._noteheadEls[idx];
      if (!el) return;

      const elRect = el.getBoundingClientRect();
      const pRect  = container.getBoundingClientRect();

      const dot = document.createElement('div');
      dot.className = 'staff-note-highlight';
      dot.style.left = (elRect.left - pRect.left + elRect.width / 2 + container.scrollLeft) + 'px';
      dot.style.top  = (elRect.top - pRect.top + elRect.height / 2 + container.scrollTop) + 'px';
      container.appendChild(dot);

      // Auto-scroll to keep the note visible
      const noteLeft = elRect.left - pRect.left + container.scrollLeft;
      if (noteLeft < container.scrollLeft + 30 || noteLeft > container.scrollLeft + container.clientWidth - 40) {
        container.scrollLeft = Math.max(0, noteLeft - 60);
      }
    }

    /** Force un recalcul de la largeur (après redimensionnement de la modale) */
    resize() {
      if (this._osmd && this._ready) {
        try { this._osmd.render(); } catch (_) {}
      }
    }

    /** Vide le conteneur et reset OSMD */
    clear() {
      const container = document.getElementById(this._divId);
      if (container) container.innerHTML = '';
      this._ready = false;
      // On réinitialise l'instance pour le prochain render
      this._osmd = null;
    }
  }


  // ── 5. MusicStaffPlayer ──────────────────────────────────────────────────────

  class MusicStaffPlayer {
    constructor() {
      this._timeouts    = [];
      this._playing     = false;
      this._activeNode  = null;
      this._currentIdx  = -1;
      this._noteSeq     = [];
      this._onNote      = null;
      this._tempo       = 80;
      this._loop        = false;
    }

    get isPlaying()  { return this._playing; }
    get currentIdx() { return this._currentIdx; }

    /**
     * Joue une séquence de notes au tempo donné via le moteur audio de script.js.
     * @param {Array}    noteSeq  — [{concertMidi, ...}] (null.concertMidi = silence)
     * @param {number}   tempo    — BPM
     * @param {Function} onNote   — callback(index | -1 quand terminé)
     */
    async play(noteSeq, tempo, onNote) {
      this.stop();
      await ensureInstrumentLoaded();
      this._noteSeq = noteSeq;
      this._onNote  = onNote;
      this._tempo   = tempo;
      this._scheduleFrom(0);
    }

    /** Enable/disable looping. Takes effect seamlessly at next cycle boundary. */
    set loop(v) { this._loop = !!v; }
    get loop()  { return this._loop; }

    /**
     * Re-schedule remaining notes from current position at a new tempo.
     * Does NOT stop the note currently sounding — only reschedules the rest.
     */
    changeTempo(newTempo) {
      if (!this._playing || this._currentIdx < 0) return;
      this._tempo = newTempo;
      this._timeouts.forEach(clearTimeout);
      this._timeouts = [];
      this._scheduleFrom(this._currentIdx + 1);
    }

    /** Internal: schedule notes[startIdx..end] using this._tempo */
    _scheduleFrom(startIdx) {
      this._playing = true;
      const beatMs  = 60000 / this._tempo;
      const seq     = this._noteSeq;
      const onNote  = this._onNote;

      for (let i = startIdx; i < seq.length; i++) {
        const delay = (i - startIdx) * beatMs;
        this._timeouts.push(setTimeout(() => {
          if (!this._playing) return;
          this._stopActiveNode();
          this._currentIdx = i;
          const note = seq[i];
          if (!note.rest && note.concertMidi != null) {
            this._activeNode = this._playNoteGetNode(note.concertMidi);
          }
          if (onNote) onNote(i);
        }, delay));
      }

      // End of sequence — loop seamlessly or signal completion
      const remaining = seq.length - startIdx;
      this._timeouts.push(setTimeout(() => {
        if (this._loop && this._playing) {
          this._scheduleFrom(0);
        } else {
          this._stopActiveNode();
          this._playing    = false;
          this._currentIdx = -1;
          if (onNote) onNote(-1);
        }
      }, remaining * beatMs));
    }

    /** Play a note and return the audio node for later stopping */
    _playNoteGetNode(midi) {
      if (!currentInstrument) return null;
      while (midi < 45) midi += 12;
      while (midi > 96) midi -= 12;
      const ac = getAudioCtx();
      return currentInstrument.play(midiToName(midi), ac.currentTime, { duration: 4, gain: 2 });
    }

    /** Stop the currently sounding note immediately */
    _stopActiveNode() {
      if (this._activeNode) {
        try { this._activeNode.stop(); } catch (_) {}
        this._activeNode = null;
      }
    }

    stop() {
      this._playing    = false;
      this._currentIdx = -1;
      this._stopActiveNode();
      this._timeouts.forEach(clearTimeout);
      this._timeouts = [];
    }
  }


  // ── 6. MusicStaffExporter ────────────────────────────────────────────────────

  const MusicStaffExporter = {
    /**
     * Télécharge le MusicXML courant en fichier .musicxml.
     * @param {string} xmlString
     * @param {string} filename  — sans extension
     */
    downloadMusicXML(xmlString, filename = 'score') {
      const blob = new Blob([xmlString], { type: 'application/vnd.recordare.musicxml+xml' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename.replace(/[^a-zA-Z0-9_\-\s]/g, '_') + '.musicxml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };


  // ── 7. MusicStaffModal ───────────────────────────────────────────────────────

  class MusicStaffModal {
    constructor() {
      this._renderer = null;
      this._player   = new MusicStaffPlayer();
      this._state    = null;   // AppStateReader snapshot
      this._context  = null;   // { type: 'scale'|'chord', chordType? }
      this._opts     = { octaves: 1, direction: 'ascending', tempo: 80 };  // octaves fixed at 1
      this._currentXml   = '';
      this._currentSeq   = [];
      this._loop     = false;
      this._dirty    = false;
      this._injected = false;
    }

    // ── Injection HTML ─────────────────────────────────────────────────────────

    _inject() {
      if (this._injected) return;
      this._injected = true;

      const overlay = document.createElement('div');
      overlay.id        = 'staffModal';
      overlay.className = 'staff-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <div class="staff-modal-box" id="staffModalBox">
          <div class="staff-modal-header">
            <span class="staff-modal-title" id="staffModalTitle">Staff Notation</span>
            <button class="staff-modal-close" id="staffModalClose" title="Close (Esc)">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
              </svg>
            </button>
          </div>

          <div class="staff-osmd-wrap">
            <div class="staff-osmd-container" id="staffOsmdContainer">
              <div class="staff-loading" id="staffLoading">
                <div class="staff-loading-dot"></div>
                <div class="staff-loading-dot"></div>
                <div class="staff-loading-dot"></div>
              </div>
            </div>
            <input type="range" id="staffBgSlider" class="staff-bg-slider" min="0" max="100" value="72" orient="vertical" title="Background shade">
          </div>

          <div class="staff-modal-controls">
            <div class="staff-ctrl-row">

              <div class="staff-ctrl-group">
                <span class="staff-ctrl-label">Instrument</span>
                <select class="staff-select" id="staffTransposeSelect">
                  <option value="0">Concert Pitch (C)</option>
                  <option value="-2">B♭ (Trumpet, Clarinet, Tenor Sax)</option>
                  <option value="-9">E♭ (Alto Sax, E♭ Clarinet)</option>
                  <option value="-7">F (French Horn)</option>
                </select>
              </div>

              <div class="staff-ctrl-group">
                <span class="staff-ctrl-label">Octave</span>
                <select class="staff-select" id="staffOctaveSelect"></select>
              </div>

              <div class="staff-ctrl-group">
                <span class="staff-ctrl-label">Direction</span>
                <div class="staff-seg-group" id="staffDirGroup">
                  <button class="staff-seg-btn active" data-dir="ascending" title="Ascending">↑</button>
                  <button class="staff-seg-btn" data-dir="descending" title="Descending">↓</button>
                  <button class="staff-seg-btn" data-dir="both" title="Ascending & Descending">↑↓</button>
                </div>
              </div>

              <div class="staff-ctrl-group staff-tempo-group">
                <span class="staff-ctrl-label">Tempo — <span id="staffTempoVal">80</span> BPM</span>
                <input type="range" id="staffTempoSlider" class="staff-range" min="40" max="300" value="80">
              </div>

            </div>

            <div class="staff-ctrl-row staff-actions-row">
              <button class="staff-play-btn" id="staffPlayBtn" title="Play">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              </button>
              <button class="staff-chord-btn" id="staffChordBtn" title="Play chord" style="display:none">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="4" x2="6" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/></svg>
              </button>
              <button class="staff-loop-btn" id="staffLoopBtn" title="Loop">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              </button>
              <button class="staff-export-btn" id="staffExportBtn">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export .musicxml
              </button>
            </div>
          </div>
        </div>`;

      document.body.appendChild(overlay);
      this._renderer = new MusicStaffRenderer('staffOsmdContainer');
      this._bindEvents();
    }

    // ── Événements internes de la modale ───────────────────────────────────────

    _bindEvents() {
      // Fermeture
      document.getElementById('staffModalClose')
        .addEventListener('click', () => this.close());
      document.getElementById('staffModal')
        .addEventListener('click', e => { if (e.target.id === 'staffModal') this.close(); });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this._isOpen()) this.close();
      });

      // Background shade slider
      document.getElementById('staffBgSlider')
        .addEventListener('input', (e) => {
          const pct = parseInt(e.target.value);
          const l = Math.round(pct * 2.55); // 0=black, 255=white
          document.getElementById('staffOsmdContainer').style.background =
            `rgb(${l},${l},${l})`;
        });

      // Instrument / Transposition
      document.getElementById('staffTransposeSelect')
        .addEventListener('change', () => this._onTransposeChange());

      // Octave select
      document.getElementById('staffOctaveSelect')
        .addEventListener('change', () => this._onOctaveChange());

      // Direction
      document.getElementById('staffDirGroup')
        .addEventListener('click', e => {
          const btn = e.target.closest('[data-dir]');
          if (!btn) return;
          this._setSegActive('staffDirGroup', btn);
          this._opts.direction = btn.dataset.dir;
          this._refresh();
        });

      // Tempo — live update display on drag, apply new tempo on release
      const slider = document.getElementById('staffTempoSlider');
      const tempoVal = document.getElementById('staffTempoVal');
      slider.addEventListener('input', () => {
        this._opts.tempo = parseInt(slider.value);
        tempoVal.textContent = slider.value;
      });
      slider.addEventListener('change', () => {
        this._opts.tempo = parseInt(slider.value);
        if (this._player.isPlaying) {
          this._player.changeTempo(this._opts.tempo);
        }
      });

      // Play / Stop
      document.getElementById('staffPlayBtn')
        .addEventListener('click', () => this._togglePlay());

      // Play chord (plaqué)
      document.getElementById('staffChordBtn')
        .addEventListener('click', () => this._playChord());

      // Loop toggle
      document.getElementById('staffLoopBtn')
        .addEventListener('click', () => this._toggleLoop());

      // Export
      document.getElementById('staffExportBtn')
        .addEventListener('click', () => {
          if (!this._currentXml) return;
          const title = document.getElementById('staffModalTitle').textContent;
          MusicStaffExporter.downloadMusicXML(this._currentXml, title);
        });
    }

    _isOpen() {
      const el = document.getElementById('staffModal');
      return el && el.classList.contains('open');
    }

    _setSegActive(groupId, activeBtn) {
      document.getElementById(groupId)
        .querySelectorAll('.staff-seg-btn')
        .forEach(b => b.classList.toggle('active', b === activeBtn));
    }

    // ── Ouverture publique ─────────────────────────────────────────────────────

    /**
     * Ouvre la modale pour une gamme.
     * Lit automatiquement le state courant de l'app.
     */
    openForScale() {
      this._inject();
      this._state   = AppStateReader.snapshot();
      this._context = { type: 'scale' };
      this._open(`${this._state.root} ${this._state.def.label}`);
    }

    /**
     * Ouvre la modale pour un accord arpégé.
     * @param {string} chordType — 'triad'|'seventh'|'ninth'|'eleventh'|'thirteenth'
     */
    openForChord(chordType) {
      this._inject();
      this._state   = AppStateReader.snapshot();
      this._context = { type: 'chord', chordType };
      const lbl = CHORD_LABELS[chordType] || chordType;
      this._open(`${this._state.root} ${this._state.def.label} — ${lbl}`);
    }

    /**
     * Opens the modal for a custom chord (e.g. from the Progressions tab).
     * @param {object} opts
     * @param {string}   opts.title     — display title (e.g. "Dm7 — ii")
     * @param {number[]} opts.midiNotes — concert-pitch MIDI values of chord tones
     * @param {string}   opts.chordName — chord name for export filename
     */
    openForCustomChord(opts) {
      this._inject();
      this._state   = AppStateReader.snapshot();
      this._context = { type: 'custom', customMidi: opts.midiNotes, chordName: opts.chordName || opts.title };
      this._open(opts.title);
    }

    _open(title) {
      this._player.stop();
      this._resetPlayBtn();

      // Sync the modal's selects with the main app
      const staffTr = document.getElementById('staffTransposeSelect');
      const mainTr  = document.getElementById('transposeSelect');
      if (staffTr && mainTr) staffTr.value = mainTr.value;
      this._syncOctaveSelect();

      // Show/hide chord button based on context
      const chordBtn = document.getElementById('staffChordBtn');
      if (chordBtn) {
        const isChord = this._context && this._context.type !== 'scale';
        chordBtn.style.display = isChord ? '' : 'none';
      }

      document.getElementById('staffModalTitle').textContent = title;
      document.getElementById('staffModal').classList.add('open');
      document.body.style.overflow = 'hidden';

      this._refresh();
    }

    close() {
      this._player.stop();
      this._resetPlayBtn();
      const el = document.getElementById('staffModal');
      if (el) el.classList.remove('open');
      document.body.style.overflow = '';
      if (this._dirty) {
        this._dirty = false;
        render();
        buildModesTab();
      }
    }

    /** Populate the modal octave select from main app's valid octaves */
    _syncOctaveSelect() {
      const staffOctSel = document.getElementById('staffOctaveSelect');
      const mainOctSel  = document.getElementById('octaveSelect');
      if (!staffOctSel || !mainOctSel) return;
      staffOctSel.innerHTML = mainOctSel.innerHTML;
      staffOctSel.value     = mainOctSel.value;
    }

    /** Called when the user changes octave inside the modal */
    async _onOctaveChange() {
      const staffOctSel = document.getElementById('staffOctaveSelect');
      const mainOctSel  = document.getElementById('octaveSelect');
      if (staffOctSel && mainOctSel) {
        mainOctSel.value = staffOctSel.value;
        rootOctave = parseInt(staffOctSel.value);
      }
      this._dirty = true; // main app needs re-render on close

      const wasPlaying = this._player.isPlaying;
      const wasLooping = this._loop;

      this._state = AppStateReader.snapshot();
      await this._refresh();

      if (wasPlaying) {
        await ensureInstrumentLoaded();
        this._setPlayingBtn();
        await this._player.play(
          this._currentSeq,
          this._opts.tempo,
          (idx) => { this._renderer.highlightNote(idx); if (idx === -1) this._resetPlayBtn(); }
        );
        this._player.loop = wasLooping;
      }
    }

    /**
     * Called when the user changes transposition/instrument inside the modal.
     * Syncs the main app select, loads the new instrument, re-snapshots, re-renders.
     * If playback was active, restarts it seamlessly.
     */
    async _onTransposeChange() {
      const staffTr = document.getElementById('staffTransposeSelect');
      const mainTr  = document.getElementById('transposeSelect');
      if (staffTr && mainTr) {
        mainTr.value = staffTr.value;
        // Reload instrument sound without full re-render of main app
        currentInstrument = null;
        await ensureInstrumentLoaded();
      }
      this._dirty = true; // main app needs re-render on close

      const wasPlaying = this._player.isPlaying;
      const wasLooping = this._loop;

      // Re-snapshot with new transposition, re-render staff
      this._state = AppStateReader.snapshot();
      this._syncOctaveSelect(); // valid octaves may change with transposition

      // Update title
      const { type, chordType } = this._context || {};
      if (type === 'chord') {
        const lbl = CHORD_LABELS[chordType] || chordType;
        document.getElementById('staffModalTitle').textContent =
          `${this._state.root} ${this._state.def.label} — ${lbl}`;
      } else {
        document.getElementById('staffModalTitle').textContent =
          `${this._state.root} ${this._state.def.label}`;
      }

      await this._refresh();

      // Restart playback if it was active
      if (wasPlaying) {
        await ensureInstrumentLoaded();
        this._setPlayingBtn();
        await this._player.play(
          this._currentSeq,
          this._opts.tempo,
          (idx) => { this._renderer.highlightNote(idx); if (idx === -1) this._resetPlayBtn(); }
        );
        this._player.loop = wasLooping;
      }
    }

    // ── Génération + rendu ─────────────────────────────────────────────────────

    async _refresh() {
      this._player.stop();
      this._resetPlayBtn();

      const { type, chordType } = this._context || {};
      const state = this._state;
      const opts  = this._opts;

      // Générer le MusicXML
      let xml, seq;
      if (type === 'custom') {
        seq = _buildCustomChordSeq(this._context.customMidi, state, opts.direction);
        xml = _buildXML(
          this._context.chordName || 'Chord', state.instrumentLabel,
          0, 'none', state.clef, [seq], opts.tempo
        );
      } else if (type === 'chord') {
        xml = MusicXMLBuilder.buildChord(state, chordType, opts);
        seq = _buildChordNoteSeq(state, getArpSemitones(state.scaleType, chordType), opts.octaves, opts.direction);
      } else {
        xml = MusicXMLBuilder.buildScale(state, opts);
        seq = _buildScaleNoteSeq(state, opts.octaves, opts.direction);
      }

      this._currentXml = xml;
      this._currentSeq = seq;

      // Afficher le loader puis rendre
      this._showLoading(true);
      await this._renderer.render(xml);
      this._showLoading(false);
    }

    _showLoading(show) {
      const el = document.getElementById('staffLoading');
      if (el) el.style.display = show ? 'flex' : 'none';
    }

    // ── Lecture audio ──────────────────────────────────────────────────────────

    async _togglePlay() {
      if (this._player.isPlaying) {
        this._player.stop();
        this._renderer.highlightNote(-1);
        this._resetPlayBtn();
        return;
      }
      this._setPlayingBtn();
      await this._player.play(
        this._currentSeq,
        this._opts.tempo,
        (idx) => {
          this._renderer.highlightNote(idx);
          if (idx === -1) this._resetPlayBtn();
        }
      );
      // Set loop after play() so it's not overwritten
      this._player.loop = this._loop;
    }

    /** Play all chord notes simultaneously (plaqué) */
    async _playChord() {
      if (!this._currentSeq || !this._currentSeq.length) return;
      await ensureInstrumentLoaded();
      if (!currentInstrument) return;
      const ac = getAudioCtx();
      // Get unique MIDI notes (no duplicates from direction)
      const seen = new Set();
      const midiNotes = [];
      for (const note of this._currentSeq) {
        if (note.rest || note.concertMidi == null) continue;
        let m = note.concertMidi;
        while (m < 45) m += 12;
        while (m > 96) m -= 12;
        if (!seen.has(m)) {
          seen.add(m);
          midiNotes.push(m);
        }
      }
      midiNotes.forEach(m => {
        currentInstrument.play(midiToName(m), ac.currentTime, { duration: 1.8, gain: 1.4 });
      });
    }

    _toggleLoop() {
      this._loop = !this._loop;
      this._player.loop = this._loop;
      const btn = document.getElementById('staffLoopBtn');
      if (btn) btn.classList.toggle('active', this._loop);
    }

    _setPlayingBtn() {
      const btn = document.getElementById('staffPlayBtn');
      if (!btn) return;
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>`;
      btn.classList.add('playing');
    }

    _resetPlayBtn() {
      const btn = document.getElementById('staffPlayBtn');
      if (!btn) return;
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21"/>
        </svg>`;
      btn.classList.remove('playing');
    }
  }


  // ── 8. API publique ──────────────────────────────────────────────────────────

  const _modal = new MusicStaffModal();

  global.MusicStaffEngine = {
    /** Ouvre la modale portée pour la gamme courante */
    openForScale() { _modal.openForScale(); },

    /** Ouvre la modale portée pour un accord arpégé */
    openForChord(chordType) { _modal.openForChord(chordType); },

    /** Ouvre la modale portée pour un accord custom (progressions) */
    openForCustomChord(opts) { _modal.openForCustomChord(opts); },

    /** Futur : exercices depuis le tab Practice */
    openForExercise(config) {
      console.warn('MusicStaffEngine.openForExercise — Phase 5 non encore implémentée', config);
    },
  };

})(window);
