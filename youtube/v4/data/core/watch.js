// Injected into the YouTube page's MAIN world.
// Sends player information to the Last.fm iframe.

const core = () => document.getElementById('last-fm-core');

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
state.watch = value => send({
  method: 'state',
  state: value
});

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

    return {
      title,
      author: links.join(', ')
    };
  };

  const watch = (suggestedTitle = '', count = 0) => {
    if (!isVideoPage()) return;

    const iframe = core();
    if (!iframe) return;

    const player = get();
    if (!player) {
      if (count < 30) {
        setTimeout(watch, 500, suggestedTitle, count + 1);
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

    if (!videoId || !rawTitle) {
      if (count < 30) {
        setTimeout(watch, 500, suggestedTitle, count + 1);
      }
      else {
        console.warn('[Last.fm] Player found, but track metadata is unavailable', {data, bar});
        send({method: 'detection', status: 'error', reason: 'Track metadata unavailable'});
      }
      return;
    }

    const title = rawTitle;
    const duration = Number(player.getDuration?.() || 0);
    const playerState = player.getPlayerState?.();
    const author = rawAuthor.replace(/\s+-\s+Topic$/i, '').trim();

    state(player);
    if (!isMusic()) chapter(track => watch(track));

    const detectionKey = `${videoId}|${title}|${author}`;
    if (detectionKey !== lastDetectedKey) {
      lastDetectedKey = detectionKey;
      send({
        method: 'detection',
        status: 'detected',
        videoId,
        title,
        author,
        duration,
        state: playerState,
        youtubeMusic: isMusic()
      });
    }

    // A chapter change or a new YouTube Music track should produce one play
    // event. Re-checking the player is cheap, but duplicate Last.fm requests
    // are not.
    if (videoId === lastVideoId && title === lastSentTitle) return;

    lastVideoId = videoId;
    lastSentTitle = title;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      let response = null;
      try {
        response = player.getPlayerResponse?.() || null;
      }
      catch (e) {
        console.warn('[Last.fm] getPlayerResponse() failed', e);
      }

      send({
        method: 'play',
        response,
        data: {
          ...(data || {}),
          video_id: videoId,
          title,
          author
        },
        duration,
        state: playerState,
        title,
        category: isMusic() ? 'Music' : ''
      });
    }, 300);
  };

  watch();

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
