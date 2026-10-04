const isYouTubeMusic = () => location.hostname === 'music.youtube.com';

const updateMusicPanelPosition = () => {
  const iframe = document.getElementById('last-fm-core');
  if (!iframe || !isYouTubeMusic()) return;

  // The sidebar player controls occupy a fixed bottom area. Keep the Last.fm
  // panel directly above that area rather than trying to infer its position
  // from YouTube Music's progress-slider hitbox, which changes independently.
  iframe.style.setProperty('top', 'auto', 'important');
  iframe.style.setProperty('bottom', '72px', 'important');
};

const watchMusicPlayerPosition = () => {
  if (!isYouTubeMusic()) return;
  updateMusicPanelPosition();
  window.addEventListener('resize', updateMusicPanelPosition);
  window.addEventListener('scroll', updateMusicPanelPosition, true);
  const timer = setInterval(updateMusicPanelPosition, 250);
  window.addEventListener('beforeunload', () => clearInterval(timer), {once: true});
};

const createCore = () => {
  if (document.getElementById('last-fm-core')) return true;

  const player = document.querySelector('.html5-video-player');
  const isMusic = isYouTubeMusic();
  const playerBar = isMusic ? document.querySelector('ytmusic-player-bar') : null;
  const node = isMusic
    ? (playerBar?.parentElement || document.querySelector('ytmusic-app-layout') || document.body)
    : document.querySelector('#info-contents, .song-media-controls, #player, body');

  if (!player || !node) return false;

  const iframe = document.createElement('iframe');
  iframe.id = 'last-fm-core';
  iframe.src = chrome.runtime.getURL('/data/core/index.html') + (isMusic ? '?ytmusic=1' : '');
  iframe.classList.add('hidden');

  if (isMusic) {
    iframe.classList.add('ytmusic', 'ytmusic-player-panel');
    setTimeout(watchMusicPlayerPosition, 0);
    // Keep the scrobbler attached to the same bottom player area as the
    // native YouTube Music player bar instead of floating over the content.
    iframe.setAttribute('title', 'Last.fm Scrobbler');
    // Keep the iframe directly under <body> so YouTube Music's layout
    // containers cannot create a different containing block for `position:
    // fixed`. The panel is positioned against the viewport using the actual
    // progress-bar coordinates above.
    (document.body || document.documentElement).appendChild(iframe);
  }
  else {
    if (node === document.body) node.appendChild(iframe);
    else node.after(iframe);
  }

  iframe.addEventListener('load', () => {
    window.dispatchEvent(new CustomEvent('lastfm-core-ready'));
  }, {once: true});

  return true;
};


window.addEventListener('message', e => {
  const iframe = document.getElementById('last-fm-core');
  if (!iframe) return;
  if (e.source !== iframe.contentWindow) return;
  if (!e.data || e.data.method !== 'lastfm-core-visibility') return;

  iframe.classList.toggle('hidden', e.data.value !== 'show');
});

window.addEventListener('message', e => {
  if (e.source !== document.getElementById('last-fm-core')?.contentWindow) return;
  if (e.data?.method !== 'discord-stop') return;
  try {
    const player = [...document.querySelectorAll('.html5-video-player')]
      .sort((a, b) => b.offsetHeight - a.offsetHeight)[0];
    const data = player?.getVideoData?.() || {};
    window.postMessage({
      source: 'lastfm-scrobbler',
      method: 'discord-stop',
      version: 1,
      videoId: data?.video_id || ''
    }, '*');
  } catch (_) {}
});

window.addEventListener('message', e => {
  if (e.source !== window || e.data?.source !== 'lastfm-scrobbler' || e.data?.method !== 'now-playing') return;
  try {
    chrome.runtime.sendMessage({
      method: 'now-playing-update',
      data: e.data.data
    }, () => void chrome.runtime.lastError);
  } catch (_) {}
});

window.addEventListener('message', e => {
  if (e.source !== window || e.data?.source !== 'lastfm-scrobbler' || e.data?.method !== 'discord-stop') return;
  try {
    chrome.runtime.sendMessage({method: 'now-playing-stop'}, () => void chrome.runtime.lastError);
  } catch (_) {}
});

const add = (count = 0) => setTimeout(() => {
  if (createCore()) return;
  if (count < 50) add(count + 1);
  else console.warn('Cannot inject last-fm-core');
}, 100);

add();
window.addEventListener('yt-navigate-finish', () => { add(); setTimeout(watchMusicPlayerPosition, 100); });
window.addEventListener('play', () => { add(); setTimeout(watchMusicPlayerPosition, 100); }, true);
