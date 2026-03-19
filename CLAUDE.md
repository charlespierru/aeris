# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Single-file vanilla HTML/CSS/JS educational app for wind and brass musicians. No build tools, no package manager. External dependencies loaded via CDN:
- Google Fonts (Playfair Display, DM Mono, Crimson Pro)
- [soundfont-player](https://github.com/danigb/soundfont-player) — plays FluidR3_GM woodwind samples via Web Audio API

**To run:** Open `scales_arpeggios.html` directly in any browser. Requires internet for fonts + soundfont samples.

## File structure

| File | Contents |
|------|----------|
| `scales_arpeggios.html` | HTML structure + CDN links |
| `styles.css` | All CSS |
| `script.js` | All JS — data, audio engine, rendering, event wiring |

## Architecture

### Data flow

```
User selects root / scale / transposition / instrument
  → render() reads all four controls
  → looks up definition in SCALE_DEFS
  → calls buildScaleNotes(rootIdx, intervals)
  → computes baseMidi for audio (concert-pitch root in octave 4)
  → updates DOM via innerHTML / createElement
  → stamps data-midi on every .note-pill and .arp-circle

User clicks a note pill or arp circle
  → handleNoteClick(midi, el)
  → ensureInstrumentLoaded() — lazy AudioContext + Soundfont.instrument()
  → playNote(midi) — normalises octave, calls instrument.play()
  → flashNote(el) — CSS pulse animation via .playing class
```

### Key JS data structures

- **`SCALE_DEFS`** — keyed by scale type (e.g. `"major"`, `"dorian"`). Each entry: `label`, `badgeClass`, `intervals` (semitone steps), `formula`, `use`, `degrees`, `practice` (5 tips), `technique`, `patterns`.
- **`NOTES_SHARP` / `NOTES_FLAT`** — chromatic note arrays.
- **`DISPLAY_NOTES`** — enharmonic display names used in the UI (`"C#/Db"` etc.).
- **`KEY_SIGS`**, **`RELATIVE_MINORS`**, **`RELATIVE_MAJORS`** — lookup tables for the info cards.

### Audio system (`script.js` top section)

| Symbol | Purpose |
|--------|---------|
| `audioCtx` | Singleton `AudioContext` — created lazily on first user gesture |
| `instrumentCache` | `{name → SoundfontInstrument}` — avoids re-downloading |
| `currentInstrument` | The active `SoundfontInstrument` |
| `getAudioCtx()` | Creates/resumes `AudioContext` |
| `ensureInstrumentLoaded()` | Async — checks cache, calls `Soundfont.instrument()` |
| `playNote(midi)` | Normalises to C3–C6 range, calls `instrument.play()` |
| `flashNote(el)` | Forces reflow then toggles `.playing` CSS class |
| `midiToName(midi)` | `60 → 'C4'`, uses flat spellings for FluidR3_GM compatibility |

### Transposition → concert pitch (audio)

The displayed notes are **written pitch** (as read by the instrumentalist). The `transposeSelect` offset converts to sounding concert pitch for audio:

```js
concertRootIdx = ((rootIdx + transposeOffset) % 12 + 12) % 12
baseMidi       = 60 + concertRootIdx   // root anchored to octave 4
noteMidi       = baseMidi + cumulativeOffset
```

`getCumulativeOffsets(intervals)` returns `[0, step₁, step₁+step₂, …, 12]`.

### Core rendering functions

- `render()` — rebuilds the entire display panel. Computes `baseMidi` + `offsets`, sets `data-midi` and `title` on each note pill.
- `buildScaleNotes(rootIdx, intervals)` — returns array of display note names.
- `getRootIndex(root)` — chromatic index 0–11.
- `renderArp(id, rootIdx, semitones, classes, labels, baseMidi)` — renders arpeggio note circles with `data-midi` stamped.
- `getArpSemitones(scaleType, type)` — returns semitone arrays for triads/sevenths.

### Supported scales (11)

Major, Natural Minor, Harmonic Minor, Melodic Minor, Dorian, Mixolydian, Lydian, Phrygian, Whole Tone, Diminished (Half-Whole), Chromatic.

### Supported instrument sounds (FluidR3_GM)

`flute`, `recorder`, `oboe`, `clarinet`, `soprano_sax`, `alto_sax`, `tenor_sax`, `baritone_sax`

## CSS design system

Custom properties in `:root`: `--bg`, `--surface`, `--surface2`, `--gold`, `--gold-light`, `--gold-dim`, `--cream`, `--muted`, `--accent-blue`, `--accent-red`, `--accent-green`.

Badge/note-block colouring uses `badgeClass` from each scale definition. Note pills: root (gold), fifth (teal), third (coral), regular (surface2). Arp circles: `root-c`, `third-c`, `fifth-c`, `seventh-c`, `octave-c`.

The `.playing` CSS class triggers a `@keyframes notePlaying` pulse animation used on both `.note-pill` and `.arp-circle`.

Controls grid is 4 columns on desktop (`1fr 1fr 1fr 1fr`), 2 columns ≤ 900 px, 1 column ≤ 480 px.
