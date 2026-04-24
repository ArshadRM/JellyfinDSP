# JellyfinOSU

Web app prototype for Jellyfin music playback with an osu!-inspired browser and realtime DSP controls.

## Implemented so far

- Jellyfin login flow from the app UI
- Session restore in local storage
- Audio library fetch with search
- Track carousel with slanted osu-style cards
- Playback controls with selectable track
- Speed control from 0.60x to 0.99x
- Preserve-pitch toggle using browser media pitch preservation flags
- JamesDSP-like low-pass filter controls (cutoff + Q) through Web Audio API

## Run locally

1. Install dependencies:

   npm install

2. Start dev server:

   npm run dev

3. Build production bundle:

   npm run build

## Notes

- Default server field is prefilled with https://watch.prnt.ink
- If your Jellyfin instance enforces CORS restrictions, next step is adding a minimal local proxy
- Current preserve-pitch is browser-native behavior; higher quality WASM time-stretch is planned next
