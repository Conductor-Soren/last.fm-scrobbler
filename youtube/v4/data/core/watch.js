// Injected into the YouTube page's MAIN world.
// Sends player information to the Last.fm iframe.

const core = () => document.getElementById('last-fm-core');

// Publish a lightweight, browser-page-level Now Playing feed. This is
// intentionally independent of the Last.fm UI so other extensions (such as
// the user's Discord plugin) can listen without needing access to our iframe.
const broadcast = data => {
  try {
    window.postMessage({
      source: 'lastfm-scrobbler',
      method: 'now-playing',
      version: 1,
      data
    }, '*');
  } catch (_) {}
};

const bestThumbnail = (...sources) => {
  for (const source of sources) {
    const list = source?.thumbnails;
    if (Array.isArray(list) && list.length) {
      const item = list[list.length - 1];
      if (item?.url) return item.url;
    }
    if (typeof source?.url === 'string' && source.url) return source.url;
  }
  return '';
};

const getAlbumArt = (data, response) => {
  const barImage = document.querySelector('ytmusic-player-bar img');
  const domUrl = barImage?.currentSrc || barImage?.src || '';
  return domUrl ||
    bestThumbnail(data?.thumbnail, response?.videoDetails?.thumbnail, response?.microformat?.playerMicroformatRenderer?.thumbnail) ||
    '';
};

const send = message => {
  const iframe = core();
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage(message, '*');
  }
};

// monitor pause and resume
const state = player => {
  if (!player) return;
  try {
    player.removeEventListener('onStateChange', state.watch);
    player.addEventListener('onStateChange', state.watch);
  }
  catch (e) {
    console.warn('[Last.fm] Could not attach player state listener', e);
  }
};
state.watch = value => {
  send({
    method: 'state',
    state: value
  });
  broadcast({
    state: value,
    playing: value === 1,
    timestamp: Date.now()
  });

  // A real player transition to PLAYING is the authoritative startup trigger.
  // The initial player state is deliberately ignored by watch(), so reloads
  // cannot start Discord/Last.fm detection for an already-loaded song.
  if (value === 1) {
    try { watch('', 0, true); } catch (_) {}
  }
};

const chapter = c => {
  const e = document.querySelector('.ytp-chapter-title-content');
  if (!e) return;

  try {
    chapter.observer?.disconnect();
  }
  catch (error) {}

  const observer = chapter.observer = new MutationObserver(() => {
    const newTrack = e.textContent?.trim() || '';
    if (newTrack && newTrack !== lastTrack) {
      lastTrack = newTrack;
      c(newTrack);
    }
  });

  observer.observe(e, {
    characterData: true,
    attributes: true,
    childList: true,
    subtree: true
  });
};

// When moving from the homepage to a video page, there can be multiple players.
const get = () => [...document.querySelectorAll('.html5-video-player')]
  .sort((a, b) => b.offsetHeight - a.offsetHeight)
  .shift();

{
  let timeout;
  let lastVideoId = '';
  let lastSentTitle = '';
  let lastDetectedKey = '';
  let discordStoppedKey = '';
  let initialized = false;
  let lastPlayerState = -1;
  let lastTrackKey = '';
  let playGeneration = 0;

  const isMusic = () => location.hostname === 'music.youtube.com';
  const isVideoPage = () => isMusic() || location.pathname.startsWith('/watch');

  // YouTube Music keeps the same player alive while changing tracks.  Its
  // DOM is also updated asynchronously, so use the player API as the primary
  // source and the player-bar as a fallback for artist/title information.
  const getMusicBar = () => {
    const bar = document.querySelector('ytmusic-player-bar');
    if (!bar) return null;

    const title = bar.querySelector('.title, yt-formatted-string.title')?.textContent?.trim() || '';
    const links = [...bar.querySelectorAll('.byline a, .byline yt-formatted-string a')]
      .map(e => e.textContent.trim())
      .filter(Boolean);

    const bylineText = bar.querySelector('.byline')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    let album = '';

    // YouTube Music normally renders the player metadata as:
    //   Artist • Album • Year
    // Keep the artist links for reliable artist detection, but parse the
    // album from the displayed byline so Last.fm receives the same album
    // YouTube Music is actually playing.
    if (bylineText) {
      const parts = bylineText.split(/\s*[•·]\s*/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const artistText = links.join(', ');
        const artistPart = artistText || parts[0];
        const artistIndex = parts.findIndex(part => part === artistPart);
        const candidateIndex = artistIndex >= 0 ? artistIndex + 1 : 1;
        if (parts[candidateIndex] && !/^\d{4}$/.test(parts[candidateIndex])) {
          album = parts[candidateIndex];
        }
      }
    }

    return {
      title,
      author: links.join(', '),
      album
    };
  };

  const watch = (suggestedTitle = '', count = 0, triggerPlay = false) => {
    if (!isVideoPage()) return;

    const iframe = core();
    if (!iframe) return;

    const player = get();
    if (!player) {
      if (count < 30) {
        setTimeout(watch, 500, suggestedTitle, count + 1, triggerPlay);
      }
      else {
        console.warn('[Last.fm] Cannot detect YouTube player');
        send({method: 'detection', status: 'error', reason: 'YouTube player not found'});
      }
      return;
    }

    let data;
    try {
      data = player.getVideoData?.();
    }
    catch (e) {
      console.warn('[Last.fm] getVideoData() failed', e);
      data = null;
    }

    const bar = isMusic() ? getMusicBar() : null;
    const videoId = data?.video_id || '';
    const rawTitle = suggestedTitle || bar?.title || data?.title || '';
    const rawAuthor = bar?.author || data?.author || '';
    const album = bar?.album || '';

    if (!videoId || !rawTitle) {
      // No song is selected. Keep the Last.fm panel hidden instead of showing
      // a waiting state for an empty player. Retry because YouTube Music may
      // still be initializing its player metadata.
      send({method: 'waiting', hasSong: false});
      if (count < 30) {
        setTimeout(watch, 500, suggestedTitle, count + 1, triggerPlay);
      }
      else {
        console.info('[Last.fm] Player is ready, but no song is selected');
      }
      return;
    }

    const title = rawTitle;
    const duration = Number(player.getDuration?.() || 0);
    const currentTime = Number(player.getCurrentTime?.() || 0);
    const playerState = player.getPlayerState?.();
    const author = rawAuthor.replace(/\s+-\s+Topic$/i, '').trim();

    let response = null;
    try {
      response = player.getPlayerResponse?.() || null;
    } catch (_) {}
    const albumArt = getAlbumArt(data, response);

    state(player);
    if (!isMusic()) chapter(track => watch(track, 0, true));

    const detectionKey = `${videoId}|${title}|${author}`;
    const trackChanged = detectionKey !== lastTrackKey;
    const firstObservation = !initialized;
    if (trackChanged) lastTrackKey = detectionKey;

    // During extension/sidebar startup, seeing an already-loaded track is not
    // the same thing as the user starting playback. Remember the current track
    // and player state, but do not begin Last.fm detection/countdown until an
    // actual play transition occurs. This prevents reloads (especially while
    // paused) from resurrecting a song that was already loaded.
    if (firstObservation) {
      initialized = true;
      lastPlayerState = playerState;
      lastVideoId = videoId;
      lastSentTitle = title;

      // The first observation only establishes the current track. If it is
      // paused, show a lightweight waiting panel; if it is already playing,
      // do not start detection from initialization. A real PLAYING transition
      // will start detection later.
      send({method: 'waiting', hasSong: true});

      broadcast({
        videoId,
        artist: author,
        track: title,
        album,
        duration,
        currentTime,
        state: playerState,
        playing: false,
        albumArt,
        youtubeMusic: isMusic(),
        timestamp: Date.now(),
        initializing: true
      });
      return;
    }

    const startedPlaying = playerState === 1 && lastPlayerState !== 1;
    const shouldStartPlay = (startedPlaying || (trackChanged && playerState === 1) || triggerPlay) && playerState === 1;
    lastPlayerState = playerState;

    if (trackChanged) {
      lastVideoId = videoId;
      lastSentTitle = title;
    }

    broadcast({
      videoId,
      artist: author,
      track: title,
      album,
      duration,
      currentTime,
      state: playerState,
      playing: playerState === 1 && shouldStartPlay,
      albumArt,
      youtubeMusic: isMusic(),
      timestamp: Date.now()
    });

    if (!shouldStartPlay) return;

    clearTimeout(timeout);
    const generation = ++playGeneration;
    timeout = setTimeout(() => {
      // Re-check the real player state before starting Last.fm validation.
      // YouTube Music can report a temporary playing state during reload even
      // though the restored player is actually paused. Never start the
      // 30-second scrobble countdown from that transient state.
      if (generation !== playGeneration) return;
      const currentPlayer = get();
      const currentData = currentPlayer?.getVideoData?.() || {};
      const currentId = currentData?.video_id || '';
      const currentState = currentPlayer?.getPlayerState?.();
      if (currentId !== videoId || currentState !== 1) return;
      if (discordStoppedKey === videoId) return;

      send({
        method: 'play',
        response,
        data: {
          ...(data || {}),
          video_id: videoId,
          title,
          author,
          album,
          albumArt
        },
        videoId,
        duration,
        state: 1,
        title,
        albumArt,
        category: isMusic() ? 'Music' : ''
      });
    }, 300);
  };

  watch();

  // The sidebar can explicitly stop Discord for the current track. Keep that
  // suppression tied to the track/video ID so a genuinely new song re-enables
  // detection automatically.
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.source !== 'lastfm-scrobbler' || e.data?.method !== 'discord-stop') return;
    try {
      const player = get();
      const data = player?.getVideoData?.() || {};
      const key = data?.video_id || '';
      if (key) discordStoppedKey = key;
      broadcast(null);
    } catch (_) {}
  });

  // Keep the external Now Playing feed alive. Five seconds is frequent enough
  // for a Discord presence while avoiding a message every animation frame.
  clearInterval(watch.nowPlayingTimer);
  watch.nowPlayingTimer = setInterval(() => {
    try {
      const player = get();
      if (!player) return;
      const data = player.getVideoData?.() || {};
      const response = player.getPlayerResponse?.() || null;
      const bar = isMusic() ? getMusicBar() : null;
      const videoId = data?.video_id || '';
      const track = bar?.title || data?.title || '';
      const artist = (bar?.author || data?.author || '').replace(/\s+-\s+Topic$/i, '').trim();
      const album = bar?.album || '';
      if (!videoId || !track) return;
      const state = player.getPlayerState?.();
      if (discordStoppedKey && videoId !== discordStoppedKey) discordStoppedKey = '';
      if (videoId !== discordStoppedKey && state === 1) {
        broadcast({
          videoId,
          artist,
          track,
          album,
          duration: Number(player.getDuration?.() || 0),
          currentTime: Number(player.getCurrentTime?.() || 0),
          state,
          playing: true,
          albumArt: getAlbumArt(data, response),
          youtubeMusic: isMusic(),
          timestamp: Date.now()
        });
      }
      else {
        // Paused/stopped tracks must not remain active in companion Discord
        // clients, and the Stop button suppresses the current track until the
        // video ID actually changes.
        broadcast(null);
      }

    } catch (_) {}
  }, 5000);

  if (isMusic()) {
    // YouTube Music is a single-page app.  Polling the lightweight player
    // metadata is more reliable than relying on yt-navigate-finish or a
    // particular play event for every track transition.
    clearInterval(watch.musicTimer);
    watch.musicTimer = setInterval(() => watch(), 750);

    window.addEventListener('yt-navigate-finish', () => watch());
    window.addEventListener('popstate', () => watch());
  }
  else {
    window.addEventListener('yt-navigate-finish', () => watch());
  }
}


// v4.0.0 UI polish: scroll artist/track text only when it overflows.
function setupLastfmMarquee(element) {
  if (!element) return;
  const text = element.textContent || "";
  let span = element.querySelector(".scroll-text");
  if (!span) {
    span = document.createElement("span");
    span.className = "scroll-text";
    span.textContent = text;
    element.textContent = "";
    element.appendChild(span);
  } else {
    span.textContent = text;
  }
  requestAnimationFrame(() => {
    const overflow = span.scrollWidth > element.clientWidth + 2;
    element.classList.toggle("has-overflow", overflow);
    if (overflow) {
      const distance = element.clientWidth - span.scrollWidth;
      span.style.setProperty("--lastfm-scroll-distance", `${distance}px`);
    } else {
      span.style.removeProperty("--lastfm-scroll-distance");
    }
  });
}
