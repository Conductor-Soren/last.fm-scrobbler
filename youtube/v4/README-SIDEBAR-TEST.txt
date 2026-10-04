v4.0.1 Opera Sidebar Test

This test build adds an Opera sidebar panel that loads YouTube Music.

The Last.fm scrobbler is injected into the embedded YouTube Music page and
its visibility is controlled through the parent page, because the extension
UI itself does not have a browser tab ID when running inside Opera's sidebar.

This is an experimental build and is not yet intended for Opera submission.


v4.0.1 test additions:
- Maintains a Now Playing heartbeat while the current track is playing.
- Exposes normalized Now Playing data (artist, track, duration, playback state, video ID, album art URL) through the page message bridge.
- Exposes the same feed to companion extensions through the extension external connection API.
- Refreshes Last.fm track.updateNowPlaying every 25 seconds while active.


Persistent panel behavior: in the Opera YouTube Music sidebar build, the scrobbling panel remains visible after detection/scrobbling until the user explicitly clicks Close. Normal YouTube pages retain the existing auto-hide behavior.
