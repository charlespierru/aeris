/**
 * TransposeEngine — v1.0
 * Module de transposition à vue pour Aeris (Scales & Arpeggios)
 *
 * Charge un fichier .musicxml ou .mxl, détecte l'instrument source,
 * transpose pour un instrument cible, affiche original + transposé via OSMD.
 *
 * Dépendances globales :
 *   opensheetmusicdisplay (OSMD), JSZip,
 *   spellNote, LETTER_NAMES, LETTER_CHROMATIC (depuis script.js),
 *   ensureInstrumentLoaded, playNote, getAudioCtx, midiToName,
 *   currentInstrument (depuis script.js)
 */

(function (global) {
  'use strict';

  // ── Instrument definitions ──────────────────────────────────────────────────

  // readingClef: the clef substitution for sight-transposition exercises
  // When reading a treble-clef concert pitch part for a transposing instrument,
  // the musician reads in this clef to mentally produce the transposition.
  const INSTRUMENTS = [
    { offset:  0, label: 'Concert Pitch (C)',      clef: 'treble', readingClef: null,    sf: 'flute',        group: 'C'  },
    { offset:  0, label: 'Flute',                  clef: 'treble', readingClef: null,    sf: 'flute',        group: 'C'  },
    { offset:  0, label: 'Oboe',                   clef: 'treble', readingClef: null,    sf: 'oboe',         group: 'C'  },
    { offset:  0, label: 'Bassoon',                clef: 'bass',   readingClef: null,    sf: 'bassoon',      group: 'C'  },
    { offset:  0, label: 'Tuba (C)',               clef: 'bass',   readingClef: null,    sf: 'tuba',         group: 'C'  },
    { offset: -2, label: 'Clarinet (B\u266D)',     clef: 'treble', readingClef: 'tenor', sf: 'clarinet',     group: 'Bb' },
    { offset: -2, label: 'Trumpet (B\u266D)',      clef: 'treble', readingClef: 'tenor', sf: 'trumpet',      group: 'Bb' },
    { offset: -2, label: 'Tenor Sax (B\u266D)',    clef: 'treble', readingClef: 'tenor', sf: 'tenor_sax',    group: 'Bb' },
    { offset: -2, label: 'Trombone (B\u266D)',     clef: 'bass',   readingClef: 'tenor', sf: 'trombone',     group: 'Bb' },
    { offset: -9, label: 'Alto Sax (E\u266D)',     clef: 'treble', readingClef: 'alto',  sf: 'alto_sax',     group: 'Eb' },
    { offset: -9, label: 'Baritone Sax (E\u266D)', clef: 'treble', readingClef: 'alto',  sf: 'baritone_sax', group: 'Eb' },
    { offset: -7, label: 'French Horn (F)',        clef: 'treble', readingClef: 'mezzo', sf: 'french_horn',  group: 'F'  },
  ];

  const CLEF_CONFIG = {
    treble: { sign: 'G', line: 2 },
    bass:   { sign: 'F', line: 4 },
    alto:   { sign: 'C', line: 3 },
    tenor:  { sign: 'C', line: 4 },
    mezzo:  { sign: 'C', line: 2 },
  };

  const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const STEP_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const IDX_STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

  // Circle-of-fifths shift per semitone: semitone n → fifths shift
  // +1 semi = +7 fifths (mod 12), wrapped to [-5,6]
  const SEMI_TO_FIFTHS_SHIFT = [0, 7, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

  // Pitch at line 1 for each clef (used for visual compensation)
  const CLEF_LINE1 = {
    treble: { stepIdx: 2, octave: 4 },  // E4
    bass:   { stepIdx: 4, octave: 2 },  // G2
    alto:   { stepIdx: 3, octave: 3 },  // F3
    tenor:  { stepIdx: 1, octave: 3 },  // D3
    mezzo:  { stepIdx: 5, octave: 3 },  // A3
  };

  // ── File loading ────────────────────────────────────────────────────────────

  /**
   * Read an uploaded file. Supports .musicxml/.xml (plain) and .mxl (ZIP).
   * Returns the MusicXML string.
   */
  async function loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'mxl') {
      if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded — cannot open .mxl files');
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);

      // Find the root .xml file via META-INF/container.xml or fallback
      let xmlFileName = null;
      const containerFile = zip.file('META-INF/container.xml');
      if (containerFile) {
        const containerXml = await containerFile.async('string');
        const match = containerXml.match(/full-path="([^"]+\.xml)"/i);
        if (match) xmlFileName = match[1];
      }
      if (!xmlFileName) {
        // Fallback: find the first .xml file that isn't in META-INF
        for (const name of Object.keys(zip.files)) {
          if (name.endsWith('.xml') && !name.startsWith('META-INF')) {
            xmlFileName = name;
            break;
          }
        }
      }
      if (!xmlFileName) throw new Error('No MusicXML file found inside .mxl archive');
      return await zip.file(xmlFileName).async('string');
    }

    // Plain .musicxml / .xml
    return await file.text();
  }

  // ── Source detection ─────────────────────────────────────────────────────────

  /**
   * Detect source instrument offset from MusicXML <transpose> element.
   * Returns { offset, detected } or { offset: 0, detected: false }.
   */
  function detectSourceOffset(xmlDoc) {
    const transposeEl = xmlDoc.querySelector('part > measure > attributes > transpose');
    if (transposeEl) {
      const chromatic = transposeEl.querySelector('chromatic');
      if (chromatic) {
        return { offset: -parseInt(chromatic.textContent), detected: true };
      }
    }
    return { offset: 0, detected: false };
  }

  // ── Sight-transposition clef mapping ──────────────────────────────────────
  //
  // For sight-reading transposition exercises: notes stay in place on the staff,
  // only the CLEF and KEY SIGNATURE change. The musician reads the same note
  // positions but in a different clef, which produces the transposition mentally.
  //
  // Mapping: sourceClef + interval → reading clef
  // From treble clef concert pitch:
  //   Bb (up M2):  read in tenor clef (C4)    + 2 sharps
  //   Eb (up M6):  read in alto clef (C3)     + 3 flats  (actually: -9 → +3 on fifths = -3)
  //   F  (up P5):  read in mezzo-soprano (C2) + 1 flat
  //
  // The key signature adjustment = fifths shift for the transposition interval.

  /**
   * Detect the source clef name from a MusicXML DOM.
   * Returns 'treble', 'bass', 'alto', 'tenor', 'mezzo', or 'treble' as fallback.
   */
  function _detectSourceClef(xmlDoc) {
    const clefEl = xmlDoc.querySelector('part > measure > attributes > clef');
    if (!clefEl) return 'treble';
    const sign = (clefEl.querySelector('sign')?.textContent || 'G').trim();
    const line = parseInt(clefEl.querySelector('line')?.textContent || '2');
    if (sign === 'G') return 'treble';
    if (sign === 'F') return 'bass';
    if (sign === 'C' && line === 3) return 'alto';
    if (sign === 'C' && line === 4) return 'tenor';
    if (sign === 'C' && line === 2) return 'mezzo';
    return 'treble';
  }

  /**
   * Sight-transpose a MusicXML DOM in-place.
   * The CLEF and KEY SIGNATURE change, and pitches are compensated so that
   * every note stays at the exact same visual position on the staff.
   * The musician reads the same visual pattern but in a new clef context.
   *
   * @param {Document} xmlDoc         — parsed MusicXML DOM
   * @param {number}   semitoneShift  — semitones for key sig (sourceOffset - targetOffset)
   * @param {string}   readingClef    — the clef to substitute ('tenor','alto','mezzo', etc.)
   */
  function sightTranspose(xmlDoc, semitoneShift, readingClef) {
    if (!readingClef) return; // no clef change needed (e.g. concert → concert)

    // 1. Detect source clef and compute diatonic compensation
    const sourceClef = _detectSourceClef(xmlDoc);
    const src = CLEF_LINE1[sourceClef];
    const tgt = CLEF_LINE1[readingClef];
    if (!src || !tgt) return;

    const stepShift = tgt.stepIdx - src.stepIdx;
    const octShift  = tgt.octave  - src.octave;

    // 2. Compensate all <pitch> elements so notes stay visually in place
    const pitchEls = xmlDoc.querySelectorAll('pitch');
    pitchEls.forEach(pitchEl => {
      const stepEl   = pitchEl.querySelector('step');
      const octaveEl = pitchEl.querySelector('octave');
      // alter stays untouched — the accidental remains visually the same

      const origStepIdx = STEP_IDX[stepEl.textContent.trim()];
      const origOctave  = parseInt(octaveEl.textContent);

      const newStepIdxRaw = origStepIdx + stepShift;
      const newStepIdx    = ((newStepIdxRaw % 7) + 7) % 7;
      const carry         = Math.floor(newStepIdxRaw / 7);

      stepEl.textContent   = IDX_STEP[newStepIdx];
      octaveEl.textContent = origOctave + octShift + carry;
    });

    // 3. Update key signature
    const fifthsShift = SEMI_TO_FIFTHS_SHIFT[((semitoneShift % 12) + 12) % 12];
    const keyEls = xmlDoc.querySelectorAll('fifths');
    keyEls.forEach(el => {
      const old = parseInt(el.textContent);
      let nf = old + fifthsShift;
      while (nf > 6)  nf -= 12;
      while (nf < -6) nf += 12;
      el.textContent = nf;
    });

    // 4. Change clef
    const clefCfg = CLEF_CONFIG[readingClef];
    if (!clefCfg) return; // unknown target clef — abort safely
    const clefEls = xmlDoc.querySelectorAll('clef');
    clefEls.forEach(clefEl => {
      const signEl = clefEl.querySelector('sign');
      const lineEl = clefEl.querySelector('line');
      if (signEl) signEl.textContent = clefCfg.sign;
      if (lineEl) lineEl.textContent = clefCfg.line;
    });

    // 5. Remove <accidental> — OSMD recalculates from new key + alter
    const accidentals = xmlDoc.querySelectorAll('accidental');
    accidentals.forEach(el => el.remove());

    // 6. Remove <transpose>
    const transposeEls = xmlDoc.querySelectorAll('transpose');
    transposeEls.forEach(el => el.remove());
  }

  // ── MusicXML validation ──────────────────────────────────────────────────────

  /**
   * Parse and validate a MusicXML string.
   * Throws a descriptive error if the file is not valid MusicXML.
   * @param {string} xmlString
   * @returns {Document} parsed XML DOM
   */
  function _validateMusicXML(xmlString) {
    // 1. Must be non-empty
    if (!xmlString || !xmlString.trim()) {
      throw new Error('File is empty');
    }

    // 2. Must parse as XML
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Not a valid XML file');
    }

    // 3. Must be MusicXML (score-partwise or score-timewise root)
    const root = doc.documentElement.tagName;
    if (root !== 'score-partwise' && root !== 'score-timewise') {
      throw new Error('Not a MusicXML file (expected <score-partwise> or <score-timewise>, got <' + root + '>)');
    }

    // 4. Must have at least one part
    if (!doc.querySelector('part')) {
      throw new Error('MusicXML has no <part> element');
    }

    // 5. Must have at least one measure with notes or rests
    if (!doc.querySelector('part > measure')) {
      throw new Error('MusicXML has no measures');
    }

    // 6. Must have attributes (key, clef) in the first measure
    const firstMeasure = doc.querySelector('part > measure');
    if (!firstMeasure.querySelector('attributes')) {
      throw new Error('First measure has no <attributes> (missing clef/key/time)');
    }

    return doc;
  }

  // ── UI Controller ───────────────────────────────────────────────────────────

  class TransposeUI {
    constructor() {
      this._originalXml  = null;  // string
      this._originalDoc  = null;  // DOM
      this._transposedXml = null;
      this._sourceOffset = 0;
      this._osmdOriginal = null;
      this._osmdTransposed = null;
      this._injected = false;
    }

    init() {
      const container = document.getElementById('transposeContent');
      if (!container) return;
      this._buildUI(container);
      this._bindEvents();
    }

    _buildUI(container) {
      container.innerHTML = `
        <div class="transpose-controls">
          <div class="transpose-upload-row">
            <label class="transpose-upload-btn" for="transposeFileInput">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Load .musicxml / .mxl
            </label>
            <input type="file" id="transposeFileInput" accept=".musicxml,.xml,.mxl" style="display:none">
            <span class="transpose-filename" id="transposeFilename">No file loaded</span>
          </div>

          <div class="transpose-selects-row">
            <div class="transpose-select-group">
              <span class="transpose-label">Source</span>
              <select class="transpose-select" id="transposeSourceSelect">
                ${INSTRUMENTS.map((inst, i) => `<option value="${i}">${inst.label}</option>`).join('')}
              </select>
            </div>
            <div class="transpose-arrow">→</div>
            <div class="transpose-select-group">
              <span class="transpose-label">Target</span>
              <select class="transpose-select" id="transposeTargetSelect">
                ${INSTRUMENTS.map((inst, i) => `<option value="${i}"${i === 5 ? ' selected' : ''}>${inst.label}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="transpose-scores" id="transposeScores" style="display:none">
          <div class="transpose-section">
            <div class="transpose-section-header" id="transposeOriginalHeader">
              <span class="transpose-section-chevron">▼</span>
              <span>Original</span>
            </div>
            <div class="transpose-osmd-wrap" id="transposeOriginalWrap">
              <div id="transposeOriginalOsmd"></div>
            </div>
          </div>

          <div class="transpose-section transpose-section-main">
            <div class="transpose-section-header">
              <span id="transposeTargetTitle">Transposed</span>
            </div>
            <div class="transpose-osmd-wrap">
              <div id="transposeTransposedOsmd"></div>
            </div>
          </div>

          <div class="transpose-actions" id="transposeActions">
            <button class="transpose-action-btn" id="transposeExportBtn" title="Download transposed .musicxml">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          </div>
        </div>

        <div class="transpose-empty" id="transposeEmpty">
          <p>Load a MusicXML file to get started.</p>
          <p class="transpose-hint">Supports .musicxml, .xml, and .mxl (compressed) formats.</p>
        </div>
      `;
    }

    _bindEvents() {
      document.getElementById('transposeFileInput')
        .addEventListener('change', e => this._onFileSelected(e));

      document.getElementById('transposeSourceSelect')
        .addEventListener('change', () => this._onSettingsChange());

      document.getElementById('transposeTargetSelect')
        .addEventListener('change', () => this._onSettingsChange());

      document.getElementById('transposeOriginalHeader')
        .addEventListener('click', () => this._toggleOriginal());

      document.getElementById('transposeExportBtn')
        .addEventListener('click', () => this._export());

      // Drag & drop on the whole tab
      const container = document.getElementById('transposeContent');
      container.addEventListener('dragover', e => { e.preventDefault(); container.classList.add('drag-over'); });
      container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
      container.addEventListener('drop', e => {
        e.preventDefault();
        container.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) this._handleFile(file);
      });
    }

    async _onFileSelected(e) {
      const file = e.target.files[0];
      if (!file) return;
      await this._handleFile(file);
    }

    async _handleFile(file) {
      document.getElementById('transposeFilename').textContent = file.name;

      try {
        const xmlString = await loadFile(file);
        const doc = _validateMusicXML(xmlString);

        this._originalXml = xmlString;
        this._originalDoc = doc;

        // Detect source
        const { offset, detected } = detectSourceOffset(doc);
        this._sourceOffset = offset;

        // Auto-select source instrument
        if (detected) {
          const matchIdx = INSTRUMENTS.findIndex(inst => inst.offset === offset);
          if (matchIdx >= 0) {
            document.getElementById('transposeSourceSelect').value = matchIdx;
          }
        }

        // Show scores area
        document.getElementById('transposeScores').style.display = '';
        document.getElementById('transposeEmpty').style.display = 'none';

        // Render original
        await this._renderOriginal(xmlString);

        // Transpose & render
        await this._transposeAndRender();

      } catch (err) {
        console.error('TransposeEngine: load error', err);
        // Reset to clean state
        this._originalXml = null;
        this._originalDoc = null;
        this._transposedXml = null;
        document.getElementById('transposeScores').style.display = 'none';
        document.getElementById('transposeEmpty').style.display = '';
        document.getElementById('transposeFilename').textContent = file.name;
        this._showError(err.message);
      }
    }

    async _renderOriginal(xmlString) {
      if (!this._osmdOriginal) {
        const OSMD = global.opensheetmusicdisplay?.OpenSheetMusicDisplay;
        if (!OSMD) return;
        this._osmdOriginal = new OSMD('transposeOriginalOsmd', {
          backend: 'svg',
          autoResize: false,
          drawTitle: true,
          drawSubtitle: false,
          drawComposer: true,
          drawPartNames: false,
          drawPartAbbreviations: false,
          drawingParameters: 'default',
          defaultColorNotehead: '#333',
          defaultColorStem: '#333',
          defaultColorRest: '#555',
        });
      }
      const container = document.getElementById('transposeOriginalOsmd');
      if (container) container.innerHTML = '';
      await this._osmdOriginal.load(xmlString);
      this._osmdOriginal.render();
    }

    async _renderTransposed(xmlString) {
      if (!this._osmdTransposed) {
        const OSMD = global.opensheetmusicdisplay?.OpenSheetMusicDisplay;
        if (!OSMD) return;
        this._osmdTransposed = new OSMD('transposeTransposedOsmd', {
          backend: 'svg',
          autoResize: false,
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawPartNames: false,
          drawPartAbbreviations: false,
          drawingParameters: 'default',
          defaultColorNotehead: '#1a1a1a',
          defaultColorStem: '#1a1a1a',
          defaultColorRest: '#333',
        });
      }
      const container = document.getElementById('transposeTransposedOsmd');
      if (container) container.innerHTML = '';
      await this._osmdTransposed.load(xmlString);
      this._osmdTransposed.render();
    }

    async _transposeAndRender() {
      if (!this._originalXml) return;

      try {
        const sourceIdx = parseInt(document.getElementById('transposeSourceSelect').value);
        const targetIdx = parseInt(document.getElementById('transposeTargetSelect').value);
        const source = INSTRUMENTS[sourceIdx];
        const target = INSTRUMENTS[targetIdx];

        const semitoneShift = source.offset - target.offset;

        // Clone the original DOM
        const parser = new DOMParser();
        const doc = parser.parseFromString(this._originalXml, 'application/xml');

        // Sight-transposition: change clef + key only, notes stay in place
        const readingClef = target.readingClef; // null if same pitch (concert)
        sightTranspose(doc, semitoneShift, readingClef);

        // Serialize
        const serializer = new XMLSerializer();
        this._transposedXml = serializer.serializeToString(doc);

        // Update title
        const clefLabel = readingClef
          ? ` — read in ${readingClef} clef`
          : '';
        document.getElementById('transposeTargetTitle').textContent =
          `Sight-read for ${target.label}${clefLabel}`;

        // Render
        this._hideError();
        await this._renderTransposed(this._transposedXml);
      } catch (err) {
        console.error('TransposeEngine: transpose error', err);
        this._showError('Transposition failed — the file may be incompatible. (' + err.message + ')');
      }
    }

    async _onSettingsChange() {
      if (!this._originalXml) return;
      await this._transposeAndRender();
    }

    _toggleOriginal() {
      const wrap = document.getElementById('transposeOriginalWrap');
      const chevron = document.querySelector('#transposeOriginalHeader .transpose-section-chevron');
      const collapsed = wrap.style.display === 'none';
      wrap.style.display = collapsed ? '' : 'none';
      chevron.textContent = collapsed ? '▼' : '▶';
      // Re-render OSMD if expanding (fixes stale width)
      if (collapsed && this._osmdOriginal) {
        try { this._osmdOriginal.render(); } catch (_) {}
      }
    }

    _showError(msg) {
      let box = document.getElementById('transposeErrorBox');
      if (!box) {
        box = document.createElement('div');
        box.id = 'transposeErrorBox';
        box.className = 'transpose-error-box';
        const container = document.getElementById('transposeContent');
        if (container) container.appendChild(box);
      }
      box.textContent = msg;
      box.style.display = '';
      const actions = document.getElementById('transposeActions');
      if (actions) actions.style.display = 'none';
    }

    _hideError() {
      const box = document.getElementById('transposeErrorBox');
      if (box) box.style.display = 'none';
      const actions = document.getElementById('transposeActions');
      if (actions) actions.style.display = '';
    }

    _export() {
      if (!this._transposedXml) return;
      const targetIdx = parseInt(document.getElementById('transposeTargetSelect').value);
      const target = INSTRUMENTS[targetIdx];
      const filename = (document.getElementById('transposeFilename').textContent || 'score')
        .replace(/\.[^.]+$/, '') + '_' + target.label.replace(/[^a-zA-Z0-9]/g, '_');

      const blob = new Blob([this._transposedXml], { type: 'application/vnd.recordare.musicxml+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename + '.musicxml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

  }

  // ── Init ────────────────────────────────────────────────────────────────────

  const _ui = new TransposeUI();

  // Init when DOM ready (tab may not exist yet if script loads early)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _ui.init());
  } else {
    _ui.init();
  }

  global.TransposeEngine = {
    INSTRUMENTS,
    sightTranspose,
    loadFile,
    detectSourceOffset,
  };

})(window);
