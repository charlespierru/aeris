# Aeris — Scales & Arpeggios

> Wind & Brass advanced scale reference — interactive, audio-playback, zero dependencies.

**[→ Live demo](https://scales-arpeggios.vercel.app)**

![Dark neon UI with violet accents](https://img.shields.io/badge/design-dark%20neon-7c3aed?style=flat-square) ![Vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS-f3f4f6?style=flat-square) ![No build tools](https://img.shields.io/badge/build-none-22d3ee?style=flat-square)

## Overview

Aeris is a single-file educational web app for wind and brass musicians. Select a root note, scale type, and instrument transposition to instantly see:

- **Scale degrees** with colour-coded note pills (root, 3rd, 5th)
- **Interval formula** (e.g. W – W – H – W – W – W – H)
- **Key signature** and relative key
- **Arpeggios** from triad up to 13th chord, all playable
- **Practice tips**, technique notes, and pattern exercises

Click any note or arpeggio circle to hear it played back through a high-quality FluidR3_GM soundfont.

## Getting started

No install, no build step.

```bash
git clone https://github.com/<your-username>/aeris.git
cd aeris
# open in browser
open scales_arpeggios.html   # macOS
start scales_arpeggios.html  # Windows
xdg-open scales_arpeggios.html  # Linux
```

Requires an internet connection on first load (Google Fonts + soundfont samples via CDN).

## Features

| Feature | Details |
|---|---|
| 11 scale types | Major, Natural/Harmonic/Melodic Minor, Dorian, Mixolydian, Lydian, Phrygian, Whole Tone, Diminished, Chromatic |
| Arpeggios | Triad, 7th, 9th, 11th, 13th — diatonic spelling |
| Audio playback | FluidR3_GM soundfonts: Flute, Clarinet, Oboe, Alto Sax |
| Transpositions | Concert pitch (C), B♭, E♭, F instruments |
| Octave selector | Written pitch in octave 2, 3, or 4 |
| Enharmonic roots | Correct diatonic spelling per key (e.g. A♭ vs G#) |
| Extended arpeggios | 9th / 11th / 13th with proper interval colours |
| Staff notation modal | OSMD-rendered sheet music for any scale or arpeggio |
| Playback controls | Play, stop, loop, live tempo slider, note highlight |
| Melodic minor rules | Ascending raised 6th/7th, descending natural minor |
| MusicXML export | Download `.musicxml` for MuseScore, Dorico, Sibelius |
| Ear training | "Play what you hear" dictée musicale with reveal |
| Diatonic progressions | Playable cadences (Authentic, Plagal, Deceptive, Half) |
| Circle of Fifths | Interactive SVG with key highlighting |

## File structure

```
aeris/
├── scales_arpeggios.html   # HTML structure + CDN links
├── styles.css              # All CSS (dark neon design system)
├── script.js               # All JS — data, audio, rendering
└── music-staff-engine.js   # Staff notation module (OSMD + MusicXML)
```

## Design system

Dark neon aesthetic with violet as primary accent, inspired by modern music app design.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#07070b` | Page background |
| `--surface` | `#0f1117` | Card background |
| `--violet` | `#a78bfa` | Primary accent, root notes |
| `--cyan` | `#22d3ee` | 5th degree |
| `--green` | `#4ade80` | 3rd degree |
| `--amber` | `#fbbf24` | 7th degree |
| `--orange` | `#fb923c` | 9th degree |
| `--purple` | `#c084fc` | 11th degree |
| `--teal` | `#2dd4bf` | 13th degree |

## Architecture

```
User selects root / scale / transposition / octave
  → render() computes concert-pitch MIDI + diatonic spelling
  → updates DOM (note pills, arp circles, info cards)
  → stamps data-midi on every clickable element

User clicks a note pill or arp circle
  → ensureInstrumentLoaded() — lazy AudioContext + Soundfont
  → playNote(midi) — normalises octave, plays sample
  → flashNote(el) — violet glow pulse animation

User clicks staff button (𝄞)
  → MusicStaffEngine.openForScale() / openForChord(type)
  → AppStateReader.snapshot() — reads current DOM state
  → MusicXMLBuilder — generates MusicXML 3.1 (single measure, no barlines)
  → MusicStaffRenderer — OSMD renders to SVG
  → MusicStaffPlayer — sequenced playback with cut-previous-note
  → Note highlight + auto-scroll during playback
```

## External dependencies (CDN only)

| Library | Purpose |
|---|---|
| [Tailwind CSS](https://tailwindcss.com) | Utility classes |
| [soundfont-player](https://github.com/danigb/soundfont-player) | FluidR3_GM audio playback |
| [OSMD](https://opensheetmusicdisplay.org) | MusicXML → SVG staff rendering |
| Google Fonts — DM Mono | Monospace typography |

## License

MIT
