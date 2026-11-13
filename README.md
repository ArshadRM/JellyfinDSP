# JellyfinDSP

Web app prototype for Jellyfin music playback with an osu!-inspired browser and realtime DSP controls.

## Implemented so far

- Jellyfin login flow from the app UI (password and Quick Connect)
- Session restore in local storage, verified against the server on load
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

## Jellyfin authentication

The app targets the current (Jellyfin 10.9+/12.x) authorization scheme, so it works against servers
that keep the legacy `X-Emby-*` authorization disabled, which is the default on new installs:

- API calls send `Authorization: MediaBrowser Client="...", Device="...", DeviceId="...", Version="...", Token="..."`.
  Legacy-only sources (`X-Emby-Authorization`, `X-Emby-Token`, `X-MediaBrowser-Token`, `?api_key=`) are not used.
- Media and image URLs, and the `<audio>`/`fetch` stream URLs, authenticate with the `?ApiKey=` query parameter,
  which stays supported because it is also needed by players that cannot set headers.
- Device identity (`DeviceId`) is generated once per browser and kept in local storage
  (`jellyfindsp.deviceId`), so Jellyfin sees one stable device instead of a new one per reload.
- Library reads use `GET /Items?userId=...` and `GET /Search/Hints`; the deprecated
  `/emby/**`, `/mediabrowser/**` and `/API/**` prefixes are not used since they now return `404`.
- The saved token is checked with `GET /Users/Me` on startup and dropped on `401`, and logout calls
  `POST /Sessions/Logout` so the token is revoked server side.

### Quick Connect

Accounts backed by SSO or without a password cannot use `POST /Users/AuthenticateByName` (it returns
`401` with "User passwords must be non-empty to authenticate"). Use the Quick Connect section in
*Jellyfin + Data Settings*: press **Get code**, then enter the six digit code in a Jellyfin session
that is already signed in — either the link to `<server>/web/#/quickconnect` or any other Jellyfin
client. The app polls for approval and signs in automatically. Quick Connect has to be enabled in the
server settings; the UI checks `GET /QuickConnect/Enabled` and hides the button when it is off.

## Notes

- Default server field is prefilled with https://watch.prnt.ink
- No CORS proxy is needed: Jellyfin answers preflight requests with `Access-Control-Allow-Origin: *`
  and allows the `Authorization` header, so the app talks to the server directly from the browser
- Current preserve-pitch is browser-native behavior; higher quality WASM time-stretch is planned next
