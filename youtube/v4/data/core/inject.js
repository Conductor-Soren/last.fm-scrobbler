const isYouTubeMusic = () => location.hostname === 'music.youtube.com';

const add = (count = 0) => setTimeout(() => {
  const player = document.querySelector('.html5-video-player');
  const node = document.querySelector('#info-contents, .song-media-controls, ytmusic-player-bar, #player, body');

  // already injected
  if (document.getElementById('last-fm-core')) {
    return;
  }

  if (player && node) {
    const e = document.getElementById('last-fm-core');
    if (!e) {
      const iframe = document.createElement('iframe');
      iframe.id = 'last-fm-core';
      iframe.src = chrome.runtime.getURL('/data/core/index.html') + (isYouTubeMusic() ? '?ytmusic=1' : '');
      iframe.classList.add('hidden');
      if (isYouTubeMusic()) iframe.classList.add('ytmusic');

      iframe.addEventListener('load', () => {
        chrome.runtime.sendMessage({
          method: 'inject',
          file: '/data/core/watch.js'
        }, () => chrome.runtime.lastError);
      }, {
        once: true
      });
      if (node === document.body) node.appendChild(iframe);
      else node.after(iframe);
    }
  }
  else if (count < 30) {
    add(count + 1);
  }
  else {
    console.warn('Cannot inject last-fm-core', player, node);
  }
}, 100);

window.addEventListener('yt-navigate-finish', add);
window.addEventListener('play', () => add(), true);
