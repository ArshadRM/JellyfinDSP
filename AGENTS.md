# JellyfinDSP — Agent Guide

## What this is

A browser-based music player that connects to a Jellyfin server, streams audio with real-time DSP effects (speed, low-pass filter, phaser), and renders live visualizations (waveform + ASCII Milkdrop). Built as a single-page React app served via nginx in Docker.

## Tech stack

- **React 19** + **TypeScript** (strict) + **Vite 8**
- **framer-motion** for UI animations (expand/collapse panels, track card hovers)
- **butterchurn** + **butterchurn-presets** for WebGL Milkdrop visualizations (npm packages, CJS/UMD — see Gotchas)
- No state management library — all state lives in `App.tsx` via `useState`/`useRef`. `zustand` is installed but unused.
- Deployed via **Docker** (node:22-alpine + nginx)

## Project structure

```
src/
  main.tsx                  Entry point, renders <App />
  App.tsx                   ~2800 lines, contains ALL app state, all UI, all effects
  index.css                 All styles (~1300 lines), CSS custom properties, responsive breakpoints
  App.css                   Unused (empty or minimal)

  lib/
    audioEngine.ts          Web Audio API graph: source → mono sum → low-pass → phaser → analyser → master gain → destination
                            Uses AudioWorklet for the phaser (inline code string, no external files)
                            Exposes getWaveformData/getFrequencyData/getAnalyserNode/getAudioContext for the visualizer
    jellyfin.ts             Jellyfin API client: auth, library fetch, stream/image URL builders
    visualizer.ts           Visualizer class managing both waveform canvas and ASCII Milkdrop rendering

  components/
    Knob.tsx                Virtual rotary knob (pointer/touch drag, SVG ring indicator)
    RangeSlider.tsx         Dual-thumb range slider for min/max values (phaser freq range)
    Transport.tsx           Play/pause/skip/seek buttons
    FullscreenButton.tsx    Toggle fullscreen icon button

  types/
    butterchurn.d.ts        Type declarations for butterchurn/butterchurn-presets (UMD packages lack ESM types)
```

## Key architectural decisions

### AudioEngine (`lib/audioEngine.ts`)

The engine builds a Web Audio graph: `HTMLAudioElement → MediaElementSource → MonoSum (ChannelSplitter+Merger) → [LowPass BiquadFilterNode] → [Phaser AudioWorkletNode] → AnalyserNode → MasterGainNode → destination`.

- The phaser is implemented as an inline AudioWorklet processor (string blob, no external file).
- The graph is rebuilt on many parameter changes (low-pass frequency, Q, phaser toggle).
- `setupForElement(audio, options)` wires the graph for a given `<audio>` element.
- Exposes `getAnalyserNode()` and `getAudioContext()` — these are consumed by the Visualizer for butterchurn.

### Visualizer (`lib/visualizer.ts`)

A single `Visualizer` class manages both waveform and milkdrop rendering via one `requestAnimationFrame` loop.

- **Waveform mode**: draws to a 2D `<canvas>` (line, bars, or mirror style).
- **Milkdrop mode**: butterchurn renders to an offscreen canvas at **half viewport resolution**, then a custom WebGL shader converts to ASCII characters (or raw pixels) with palette coloring. Uses a font texture atlas and cell-based downsampling.
- Butterchurn is lazy-loaded via `import('butterchurn')` only when milkdrop mode is first selected.
- **Audio feeding**: does NOT use butterchurn's `connectAudio()` (which creates 5 extra Web Audio nodes and causes main-thread↔audio-thread sync contention). Instead, we read from the AudioEngine's single analyser via `getWaveformData()` and pass the data to `butterchurn.render({ audioLevels })` manually each frame.
- The offscreen canvas renders at half resolution (`innerWidth/2 × innerHeight/2`). The scene texture is uploaded via `texImage2D` (not `texSubImage2D`) so it resizes to match the smaller source, and the shader's UV coordinates stretch it to fill the viewport.
- WebGL uniform locations are cached in a `Map` (cleared on program rebuild). Palette texture data is cached per theme ID.
- Auto-cycles presets every 60s. Auto-blacklists presets that run below 15 FPS for 3+ seconds.
- The render loop skips work when `document.hidden` is true.

### State and persistence (`App.tsx`)

All application state lives in `App.tsx` via `useState` hooks. There is no global store.

- **Session data** (token, userId, serverUrl): persisted in `localStorage` under `jellyfindsp.session`.
- **User settings** (all DSP params, viz mode, viz params, expanded states): persisted under `jellyfindsp.settings`.
- **Queue**: persisted under `jellyfindsp.queue` + `jellyfindsp.queueServerUrl` (invalidated on server change).
- **Lifetime stats** (bytes streamed, songs played): persisted under `jellyfindsp.stats`.

The settings persistence effect saves ALL settings on ANY change — be mindful when adding new `useState` hooks that should or shouldn't be persisted.

### Fullscreen mode

A custom fullscreen toggle (not the browser Fullscreen API). Sets `body.is-fullscreen` class which darkens the background. The `.shell` (left+right panels) fades out via `fullscreen-hidden` class. A separate fullscreen waveform canvas fills the viewport.

### Caching system

Tracks can be pre-fetched as blobs and stored as Object URLs. Four cache modes control what gets pre-buffered (queue-only, queue+nearby, queue+nearby+random, none). Cache is pruned against a configurable MB limit using an LRU-like strategy with protected tracks.

## Gotchas and things to watch out for

### butterchurn CJS interop

The `butterchurn` npm package is a UMD module that wraps itself with `})(window, ...)`. Vite pre-bundles it via esbuild into an ESM wrapper, but the default export shape can vary:

- Direct ESM: `import('butterchurn').default` is the API object with `createVisualizer`
- Webpack UMD interop: `import('butterchurn').default.default` (double-wrapped — the inner webpack module has `__esModule: true`)

The current code in `visualizer.ts` handles both via `bcMod.default?.default ?? bcMod.default`. If you change the import path or bundler config, test that `createVisualizer` is still reachable.

### AudioEngine must be ready before butterchurn

`ensureMilkdropReady()` requires both `getAudioContext()` and `getAnalyserNode()` to return non-null. These are only available after `AudioEngine.setupForElement()` has been called (which happens when a track is first selected). If you call `ensureMilkdropReady()` too early (before any track has played), it silently returns without initializing.

### Butterchurn does NOT use connectAudio

Butterchurn's `connectAudio()` creates 5 internal Web Audio nodes (gain, splitter, 3 analysers) that fight for audio-thread time with the main render thread. We avoid this entirely by reading from the AudioEngine's single analyser via `getWaveformData()` and passing 1024-sample `Uint8Array`s to `butterchurn.render({ audioLevels: { timeByteArray, timeByteArrayL, timeByteArrayR } })`. Both L and R receive the same mono downmix data — acceptable for visualization.

### `dist/` directory permissions

The `dist/` directory is sometimes owned by root (from Docker builds). This causes `npm run build` to fail with EACCES. Fix with `sudo rm -rf dist/` before rebuilding locally.

### App.tsx is monolithic

Nearly all app state and logic lives in `App.tsx` (~2800 lines). This is intentional for now — the team prefers keeping everything in one place for a music player with tightly coupled state. If you split files, be careful about the circular dependency between state setters and effects.

### CSS body classes

Body classes are used to toggle visual states:
- `body.is-fullscreen` — darkened background for fullscreen mode
- `body.viz-milkdrop` — removes gradient background, shows milkdrop canvas at z-index 0, hides waveform canvas

These are managed by `useEffect` hooks in `App.tsx` keyed on the relevant state variables.

### Settings save ALL state

The localStorage settings effect (the big `useEffect` near the end of App.tsx) serializes ~35 state variables. When adding new persisted settings:
1. Add the `useState` hook
2. Add the variable to the `settings` object inside the effect
3. Add the variable to the dependency array
4. Add it to the `initialSettings` loader at the top

### No hot module replacement safety for audio nodes

The `AudioEngine` is created once via `useRef(new AudioEngine())`. If HMR fires, the old engine's nodes are orphaned. This is fine in dev since the page reloads cleanly, but be aware if you see stale audio graph errors during development.

## Common tasks

### Adding a new DSP effect

1. Add Web Audio node(s) in `AudioEngine` and wire them into the graph in `reconnectGraph()`
2. Add setter methods on `AudioEngine` (like `setLowPassFrequency`)
3. Add `useState` + `useEffect` in `App.tsx` to call the setter
4. Add UI controls in the left panel following the existing control card pattern
5. Add the state to the settings persistence effect

### Adding a new visualization mode

1. Add the mode to the `VizMode` type in `visualizer.ts`
2. Add a render method in the `Visualizer` class
3. Add a branch in `renderLoop()`
4. Add the option to the Mode `<select>` in the Visualization control card
5. Add any new settings to the milkdrop settings block

### Adding a new left-panel control card

Follow the existing pattern in `App.tsx`:
```tsx
<div className="control-card">
  <div className={`menu-head ${isExpanded ? 'expanded' : ''}`}>
    <h2 onClick={() => setIsExpanded(p => !p)}>Title</h2>
    <div className="menu-actions">
      <button type="button" className="reset-btn" onClick={handleReset}>Reset</button>
      <button type="button" className={isEnabled ? '' : 'off-btn'} onClick={toggle}>{isEnabled ? 'On' : 'Off'}</button>
    </div>
  </div>
  <AnimatePresence>
    {isExpanded && (
      <motion.div className="menu-content" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
        {/* controls here */}
      </motion.div>
    )}
  </AnimatePresence>
</div>
```

## Build and run

```bash
# Development
npm install
npm run dev

# Type check (no emit)
npx tsc -b

# Lint
npm run lint

# Build
npm run build

# Docker
docker compose up --build
```

`npm run build` runs `tsc -b && vite build`. The type check must pass for the build to succeed.
