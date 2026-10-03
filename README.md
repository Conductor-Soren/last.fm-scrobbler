# Last.fm Scrobbler for YouTube™

A lightweight Opera/Chromium browser extension that detects music played on YouTube and YouTube Music and scrobbles it to Last.fm.

## Features

- 🎵 Detects artist, track, and duration from YouTube videos.
- 🎶 Supports YouTube Music, including tracks that change without a full page reload.
- 🔴 Sends **Now Playing** updates to Last.fm after a track is validated.
- ⏱️ Scrobbles after the configured minimum play time (30 seconds by default).
- 🔐 Uses Last.fm's official API authentication flow.
- 💾 Remembers your Last.fm session after the first authorization.
- 🚀 Automatically reconnects to Last.fm on future YouTube Music sessions without asking for authorization again.
- 🧹 Can clean common extra text from YouTube titles before checking Last.fm.
- 🚫 Supports channel blacklisting and category filtering.
- ⚙️ Provides an options page for Last.fm credentials and scrobbling preferences.
- 🛠️ Shows useful detection and connection status in the YouTube/YouTube Music panel.

## Last.fm Setup

You only need to authorize the extension once.

### 1. Create a Last.fm API account

If you do not already have a Last.fm API key and shared secret, create them here:

**https://www.last.fm/api/account/create**

### 2. Open the extension settings

Open the extension's **Options/Settings** page and enter:

- **Last.fm API key**
- **Last.fm API secret**

The credentials are stored locally in the extension and are only used for communication with Last.fm.

### 3. Connect Last.fm

Open YouTube or YouTube Music and press **Connect Last.fm** in the extension panel.

The extension will open Last.fm in a normal browser tab. Approve the authorization request there.

Once approved, the extension stores the Last.fm session and can use it for future scrobbles.

### 4. Future sessions

After the first successful connection, you do **not** need to authorize Last.fm again every time.

The extension restores the saved session automatically and validates it in the background. If the session has been revoked or is no longer valid, the extension will ask you to connect again.

## How Scrobbling Works

1. A song starts playing on YouTube or YouTube Music.
2. The extension detects the current artist, title, and duration.
3. The track is cleaned and checked against Last.fm.
4. Last.fm receives a **Now Playing** update.
5. The extension starts its scrobble countdown.
6. Once the minimum play time is reached, the track is submitted to Last.fm.

The default minimum play time is **30 seconds** and can be changed in the extension settings.

## Options

### Last.fm Connection

- API key
- API secret
- Save Last.fm credentials

### Song Filtering

The extension can clean common extra text from YouTube titles before sending them to Last.fm. This can help with titles containing things such as brackets, versions, or other YouTube-specific text.

### Minimum Scrobble Time

Controls how long a track must play before it can be scrobbled.

Default: **30 seconds**

### Category Filtering

By default, the extension looks for music-related YouTube categories such as:

- Música
- Music
- Entertainment

You can change the category list or disable category checking.

### Channel Blacklist

Add channel names to a comma-separated blacklist to prevent their videos from being scrobbled.

## YouTube Music Support

YouTube Music is a single-page application, so tracks can change while the same player remains active. The extension watches for those changes and updates the detected track accordingly.

The Last.fm panel is positioned separately from the YouTube Music player controls so it remains visible without collapsing into the player bar.

## Troubleshooting

### Last.fm says the credentials are missing

Open the extension settings and enter both your API key and API secret.

If you do not have them yet, use:

**https://www.last.fm/api/account/create**

### Last.fm authorization opens again

This normally means the saved Last.fm session is no longer valid or was revoked. Authorize the extension again to create a new session.

### A song is detected but is not scrobbled

Check:

- The track is longer than the configured minimum time.
- The YouTube category is allowed.
- The channel is not on the blacklist.
- Last.fm can find the detected artist and track.
- Your Last.fm connection is still valid.

### The wrong artist or title is detected

The extension uses YouTube's player metadata and title information to determine the artist and track. You can edit the detected artist/title in the panel before submitting a scrobble.

## Permissions

The extension requests only the permissions needed for its current functionality:

- `storage` — stores extension settings and the Last.fm session locally.
- `scripting` — supports the extension's injected YouTube/YouTube Music functionality.
- YouTube host access — detects playback and track changes.
- Last.fm API access — authenticates and submits scrobbles.

## Development

This extension uses **Manifest V3** and a background service worker.

Main components:

```text
worker.js                 Background/service-worker logic
├── Last.fm API messaging
├── authentication tab handling
└── stored session handling

data/core/
├── inject.js              Injects the Last.fm panel into YouTube
├── watch.js               Watches YouTube/YouTube Music playback
├── index.mjs              Panel UI and scrobbling logic
└── plug-ins/parse.js      Title/metadata parsing helpers

data/lastfm/
├── lastfm.mjs             Last.fm API integration
└── md5.min.js             API signature support

data/options/
├── index.html              Extension settings page
├── index.js                Settings storage
└── index.css               Settings styling
```

## Third-Party Code

The extension uses the JavaScript MD5 implementation from **blueimp/JavaScript-MD5** for Last.fm API signatures.

Original project:

https://github.com/blueimp/JavaScript-MD5

## License

This project is distributed under the **Mozilla Public License 2.0 (MPL-2.0)**. See [`LICENSE`](LICENSE) for the full license text.
