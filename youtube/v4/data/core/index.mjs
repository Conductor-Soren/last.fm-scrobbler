if (new URLSearchParams(location.search).has('ytmusic')) document.body.dataset.ytmusic = 'true';
import {toast, tools} from './helper.mjs';
import {lastfm} from '../lastfm/lastfm.mjs';

// find artist and track name
self.parse = (data, suggestedTitle) => new Promise(resolve => {
  let {title, author} = data;
  title = suggestedTitle || title;
  title = tools.clean(title, 'title');

  let artist = author;
  let track = title;

  const separators = tools.separators.filter(s => title.includes(s));
  if (separators.length) {
    [artist, track] = title.split(separators[0]);
  }

  artist = tools.clean(artist, 'artist');
  track = tools.clean(track, 'track');

  resolve({artist, track});
});

const error = e => {
  document.body.dataset.mode = 'error';
  const n = document.getElementById('submit');
  n.disabled = true;
  n.value = 'Error';
  console.error(e);
  toast(e.message, -1);
};

const timer = {
  id: -1,
  duration: 30,
  mode: 'active', // disabled, active, paused
  get: () => {
    const duration = timer.duration;
    return ('0' + Math.floor(duration / 60)).substr(-2) + ':' + ('0' + duration % 60).substr(-2);
  },
  update: () => {
    timer.duration -= 1;
    if (timer.duration === 0) {
      timer.stop();
      document.getElementById('submit').click();
    }
    else {
      document.getElementById('submit').value = `Submit (${timer.get()})`;
    }
  },
  stop(value = 'Submit') {
    clearInterval(timer.id);
    timer.mode = 'disabled';
    document.getElementById('submit').value = value;
  },
  set(duration) {
    chrome.storage.local.get({
      minTime: 30
    }, prefs => {
      timer.now = Date.now();
      timer.duration = Math.min(Math.round(duration) - 10, prefs.minTime);
      timer.stop();
      timer.mode = 'active';
      if (timer.mode === 'active') {
        clearInterval(timer.id);
        timer.id = setInterval(timer.update, 1000);
      }
    });
  },
  pause() {
    if (timer.mode === 'paused' || timer.mode === 'active') {
      clearInterval(timer.id);
      document.getElementById('submit').value = 'Submit (paused)';
      timer.state = 'paused';
    }
  },
  resume() {
    if (timer.mode === 'paused' || timer.mode === 'active') {
      clearInterval(timer.id);
      timer.id = setInterval(timer.update, 1000);
      timer.update();
    }
  }
};


// Last.fm's Now Playing status is refreshed while the current track remains
// active. This also keeps our internal state aligned for consumers such as the
// Discord plugin. The external page-level feed is maintained by watch.js.
const nowPlaying = {
  artist: '',
  track: '',
  album: '',
  duration: 0,
  active: false,
  albumArt: '',
  timer: -1,
  set(artist, track, album = '', albumArt = '', duration = 0) {
    this.artist = artist;
    this.track = track;
    this.album = album || '';
    this.albumArt = albumArt || '';
    this.duration = Number(duration) || 0;
    this.active = true;
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), 8000);
  },
  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.timer = -1;
  },
  pause() {
    clearInterval(this.timer);
    this.timer = -1;
  },
  resume() {
    if (!this.artist || !this.track) return;
    this.active = true;
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), 8000);
  },
  async refresh() {
    if (!this.active || !this.artist || !this.track) return;
    try {
      const request = {
        method: 'track.updateNowPlaying',
        artist: this.artist,
        track: this.track
      };
      if (this.album) request.album = this.album;
      if (this.duration > 0) request.duration = Math.round(this.duration);
      await lastfm.call(request);
    } catch (e) {
      console.warn('[Last.fm] Now Playing refresh failed:', e);
    }
  }
};

let discordStoppedKey = '';

const discordStop = document.getElementById('discordStop');
if (discordStop) {
  discordStop.addEventListener('click', () => {
    nowPlaying.stop();
    timer.stop('Submit');
    discordStoppedKey = window.currentVideoId || discordStoppedKey || '';
    try {
      window.parent.postMessage({
        source: 'lastfm-scrobbler',
        method: 'discord-stop',
        version: 1
      }, '*');
    } catch (_) {}
    toast('Discord detection stopped for this song');
  });
}

const validateTrack = () => {
  const artist = document.getElementById('artist').value.trim();
  const track = document.getElementById('track').value.trim();
  const duration = Number(document.getElementById('duration').value) || 0;
  const submit = document.getElementById('submit');

  if (!artist || !track) return;

  document.body.dataset.mode = 'submit';
  submit.disabled = true;
  submit.value = 'Validating...';
  toast('Validating with Last.fm...', -1);

  lastfm.call({
    method: 'track.getInfo',
    artist,
    track,
    duration
  }, state => {
    submit.value = state === 'authenticate' ? 'Authenticating' : 'Validating...';
  }).then(r => {
    if (r.track) {
      const lastfmAlbum = r.track.album?.title || r.track.album?.name || '';
      const albumImage = r.track.album?.image?.find(x => x.size === 'large')?.['#text'] ||
        r.track.album?.image?.find(x => x.size === 'extralarge')?.['#text'] || '';
      const album = window.youtubeAlbum || lastfmAlbum || '';
      window.lastfmAlbum = album;
      window.lastfmAlbumArt = window.lastfmAlbumArt || albumImage;
      nowPlaying.set(artist, track, album, window.lastfmAlbumArt || '', duration);
      submit.disabled = false;
      toast('Ready to scrobble');
      timer.set(duration);
    }
    else {
      timer.stop();
      submit.disabled = false;
      submit.value = 'Submit';
      toast(r?.message || 'Not Found!');
      console.warn('Response', r);
    }
  }).catch(error);
};


// Toggle the host page's scrobbler iframe. In Opera's sidebar build the
// Last.fm UI runs inside an extension iframe, so there is no tabId on the
// runtime message sender. The parent YouTube Music page handles visibility.
const persistentPanel = document.body.dataset.ytmusic === 'true';

const setCoreVisibility = method => {
  try {
    window.parent.postMessage({
      method: 'lastfm-core-visibility',
      value: method
    }, '*');
  } catch (_) {}

  // Normal tab fallback. The background worker handles this when a tabId
  // exists; harmlessly ignore the message error in extension-only contexts.
  try {
    chrome.runtime.sendMessage({method}, () => void chrome.runtime.lastError);
  } catch (_) {}
};

const openSettings = () => {
  try {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) {
        console.warn('[Last.fm] Could not open Options:', chrome.runtime.lastError.message);
      }
    });
  }
  catch (e) {
    console.warn('[Last.fm] Could not open Options:', e);
  }
};

const openLastfm = () => {
  chrome.runtime.sendMessage({
    method: 'lastfm-open-profile'
  }, response => {
    if (chrome.runtime.lastError) {
      console.warn('[Last.fm] Could not open profile:', chrome.runtime.lastError.message);
      toast('Could not open Last.fm');
      return;
    }
    if (!response?.ok) {
      toast(response?.error || 'Could not open Last.fm');
    }
  });
};

const showSettingsButton = visible => {
  const button = document.getElementById('openSettings');
  button.dataset.visible = visible ? 'true' : 'false';
  button.hidden = !visible;
};

const errorNeedsSettings = message => /credentials are not configured|api key|api secret|invalid api key|api error 10\b|api error 26\b|network error: 403\b/i.test(message);

const formatConnectedAccount = name => {
  const clean = String(name || 'Last.fm').trim();
  // Keep the external-link marker visible within the existing compact panel.
  const maxChars = 10;
  const short = clean.length > maxChars ? clean.slice(0, maxChars) + '…' : clean;
  return `🟢 ${short} ↗`;
};

const connect = () => {
  const button = document.getElementById('connect');

  // When already connected, the compact account button opens the Last.fm profile.
  if (button.dataset.connected === 'true') {
    openLastfm();
    return;
  }

  button.disabled = true;
  button.value = 'Connecting...';
  showSettingsButton(false);
    toast('Checking Last.fm settings...', -1);

  // Check the local credentials before starting the network authentication
  // flow. If they are missing, take the user directly to Options instead of
  // making them discover the settings page themselves.
  lastfm.getConfig().then(() => {
    toast('Opening Last.fm authorization tab...', -1);
    return lastfm.authenticate(stage => {
      if (stage === 'request-token') toast('Requesting Last.fm authorization...', -1);
      else if (stage === 'opening') toast('Opening Last.fm authorization tab...', -1);
      else if (stage === 'waiting') toast('Authorize Last.fm in the new tab...', -1);
    });
  }).then(session => {
    button.value = formatConnectedAccount(session?.name || 'Last.fm');
    button.title = 'Open Last.fm: ' + (session?.name || 'Last.fm');
    button.dataset.connected = 'true';
    button.disabled = false;
        if (document.getElementById('artist').value && document.getElementById('track').value) {
      validateTrack();
    }
    else {
      toast('Last.fm connected');
    }
  }).catch(error => {
    button.disabled = false;
    button.value = 'Connect Last.fm';
    button.title = 'Connect Last.fm';
    button.dataset.connected = 'false';
    errorState(error);
  });
};

const errorState = e => {
  document.body.dataset.mode = 'error';
  const message = e?.message || String(e);
  const needsSettings = errorNeedsSettings(message);
  console.error('[Last.fm] Connection error:', e);

  if (needsSettings) {
    showSettingsButton(true);
        toast('Last.fm credentials are missing or invalid. Opening Extension Settings...', -1);
    openSettings();
  }
  else {
    showSettingsButton(false);
        toast(message, -1);
  }
};

const play = request => {
  document.body.dataset.mode = 'parsing';
  toast('parsing...', -1);

  const {data, response, duration, title, state, albumArt, album} = request;
  const videoId = request.videoId || data?.video_id || '';
  if (videoId) window.currentVideoId = videoId;
  if (videoId && discordStoppedKey === videoId) {
    nowPlaying.stop();
    timer.stop('Submit');
    document.getElementById('submit').disabled = false;
    document.getElementById('submit').value = 'Submit';
    return;
  }
  let {category} = request;
  window.youtubeAlbum = album || data?.album || window.youtubeAlbum || '';
  window.lastfmAlbumArt = albumArt || data?.albumArt || window.lastfmAlbumArt || '';

  // Start/refresh Last.fm Now Playing immediately when YouTube Music changes
  // tracks. Do not wait for track.getInfo/validation: MusicRichPresence polls
  // Last.fm independently, so delaying this update can create a noticeable
  // gap in Discord Rich Presence after a track change.
  const immediateArtist = String(data?.author || '').replace(/vevo/i, '').trim();
  const immediateTrack = String(title || data?.title || '').trim();
  if (state === 1 && immediateArtist && immediateTrack) {
    nowPlaying.set(
      immediateArtist,
      immediateTrack,
      window.youtubeAlbum || '',
      window.lastfmAlbumArt || '',
      duration
    );
  }
  else if (state !== 1) {
    nowPlaying.stop();
  }

  timer.mode = state === 1 ? 'active' : 'disabled';

  category = category ||
    response?.microformat?.playerMicroformatRenderer?.category ||
    response?.microformat?.microformatDataRenderer?.category ||
    'NA';

  const channel = (data.author || '').replace(/vevo/i, '');

  console.info('Channel:', channel, 'Category:', category);

  chrome.storage.local.get({
    categories: ['Música', 'Music', 'Entertainment'],
    pretendToBeMusic: ['full album'],
    blacklistAuthors: [],
    checkCategory: true
  }, async prefs => {
    setCoreVisibility('show');

    const hide = () => {
      // In the Opera YouTube Music sidebar the scrobbler is a persistent
      // player-bar control. Toasts such as "less than 30 seconds" must not
      // hide the panel; only the explicit Close button should do that.
      if (!persistentPanel) setCoreVisibility('hide');
    };

    // https://github.com/rNeomy/last.fm-scrobbler/issues/29
    if (prefs.pretendToBeMusic.length && prefs.categories.includes(category) === false) {
      const t = data.title.toLowerCase();
      for (const word of prefs.pretendToBeMusic) {
        if (t.includes(word)) {
          category = 'Music';
          break;
        }
      }
    }

    if (prefs.categories.indexOf(category) === -1 && prefs.checkCategory) {
      toast(`Scrobbling skipped ("${category}" category is not listed)`, undefined, hide);
    }
    else if (duration <= 30) {
      toast('Scrobbling skipped (Less than 30 seconds)', undefined, hide);
    }
    else if (prefs.blacklistAuthors.map(s => s.toLowerCase()).indexOf(channel.toLowerCase()) !== -1) {
      toast(`Scrobbling skipped ("${channel}" is in the blacklist)`, undefined, hide);
    }
    else {
      const o = await self.parse(data, title);
      let {artist} = o;
      const {track} = o;

      chrome.storage.local.get({
        'filter': true
      }, prefs => {
        if (prefs.filter) {
          artist = tools.filter(artist);
        }

        document.body.dataset.mode = 'submit';
        document.getElementById('artist').value = artist || '';
        document.getElementById('track').value = track || '';
        requestAnimationFrame(refreshMarquees);

        document.getElementById('duration').value = duration;
        try {
          window.parent.postMessage({
            source: 'lastfm-scrobbler',
            method: 'now-playing-normalized',
            version: 1,
            data: {
              artist: artist || '',
              track: track || '',
              duration,
              album: window.lastfmAlbum || '',
              albumArt: window.lastfmAlbumArt || '',
              playing: state === 1,
              timestamp: Date.now()
            }
          }, '*');
        } catch (_) {}
        toast('Validating...', -1);

        if (artist && track) {
          validateTrack();
        }
        else {
          document.body.dataset.mode = 'edit';
          toast('Scrobbling skipped (Unknown artist or track)', 20, hide);
        }
      });
    }
  });
};

// this is called when a new track is played
window.addEventListener('message', e => {
  if (!e.data || typeof e.data !== 'object') return;

  if (e.data.method === 'discord-stop') {
    if (e.data.videoId) {
      discordStoppedKey = e.data.videoId;
      window.currentVideoId = e.data.videoId;
    }
    nowPlaying.stop();
    timer.stop('Submit');
    document.getElementById('submit').disabled = false;
    document.getElementById('submit').value = 'Submit';
    toast('Discord detection stopped for this song');
    return;
  }

  if (e.data.method === 'waiting') {
    const hasSong = e.data.hasSong === true;
    if (!hasSong) {
      document.body.dataset.mode = 'waiting-empty';
      const toast = document.getElementById('toast');
      if (toast) toast.textContent = '';
      setCoreVisibility('hide');
      return;
    }

    // A song is loaded, but playback has not started during this extension
    // session. Keep the compact panel visible as a simple startup indicator
    // without starting Last.fm validation, Now Playing, or the scrobble timer.
    document.body.dataset.mode = 'waiting';
    const toast = document.getElementById('toast');
    if (toast) toast.textContent = 'Waiting for song to start…';
    setCoreVisibility('show');
    return;
  }

  if (e.data.method === 'detection') {
    const {status, reason, title, author, duration} = e.data;
    setCoreVisibility('show');

    if (status === 'detected') {
      console.info('[Last.fm] YouTube detected:', {
        artist: author || '',
        track: title || '',
        duration
      });
      toast(`Detected: ${author || 'Unknown artist'} — ${title || 'Unknown track'}`, 8);
    }
    else {
      console.warn('[Last.fm] YouTube detection failed:', reason);
      toast(`YouTube detection: ${reason}`, 12);
    }
    return;
  }

  if (e.data.method === 'play') {
    play(e.data);
  }
  else if (e.data.method === 'state') {
    if (e.data.state === 1) {
      timer.resume();
      nowPlaying.resume();
    }
    else {
      timer.pause();
      nowPlaying.pause();
    }
  }
});

const autoConnect = async () => {
  const button = document.getElementById('connect');

  try {
    const session = await lastfm.getStoredSession();
    if (!session?.key) return;

    // A saved Last.fm session is enough to skip the authorization page. Show
    // the connected state immediately, then validate it in the background.
    button.value = formatConnectedAccount(session.name || 'Last.fm');
    button.title = 'Open Last.fm: ' + (session.name || 'Last.fm');
    button.dataset.connected = 'true';
    button.disabled = false;
    showSettingsButton(false);
    
    const validated = await lastfm.validateSession();
    if (!validated) {
      button.value = 'Connect Last.fm';
      button.title = 'Connect Last.fm';
      button.dataset.connected = 'false';
      button.disabled = false;
            return;
    }

    button.value = formatConnectedAccount(validated.name || 'Last.fm');
    button.title = 'Open Last.fm: ' + (validated.name || 'Last.fm');
    button.dataset.connected = 'true';
    button.disabled = false;
        console.info('[Last.fm] Restored saved session for:', validated.name || 'Last.fm');
  }
  catch (e) {
    // Do not interrupt song detection if startup validation cannot reach
    // Last.fm. The saved session remains available for normal requests.
    console.warn('[Last.fm] Automatic session restore failed:', e);
  }
};

document.getElementById('connect').addEventListener('click', connect);
document.getElementById('openSettings').addEventListener('click', openSettings);

autoConnect();

document.querySelector('form').addEventListener('submit', e => {
  e.preventDefault();
  timer.stop('Wait...');
  document.body.dataset.mode = 'perform';

  const track = document.getElementById('track').value;
  const artist = document.getElementById('artist').value;

  const scrobbleAlbum = window.youtubeAlbum || window.lastfmAlbum || '';
  lastfm.call({
    method: 'track.scrobble',
    track,
    artist,
    ...(scrobbleAlbum ? {album: scrobbleAlbum} : {}),
    timestamp: Math.floor((timer.now || Date.now()) / 1000)
  }).then(result => {
    const accepted = Number(result?.scrobbles?.['@accepted'] ?? result?.scrobbles?.accepted ?? 1);
    const ignored = Number(result?.scrobbles?.['@ignored'] ?? result?.scrobbles?.ignored ?? 0);
    if (accepted === 0 && ignored > 0) {
      toast('Last.fm received the scrobble but ignored it.');
      console.warn('[Last.fm] Scrobble ignored:', result);
      return;
    }
    if (!persistentPanel) document.getElementById('close').click();
  }).catch(error);
});

document.getElementById('close').addEventListener('click', () => {
  setCoreVisibility('hide');
  timer.stop();
});

// stop counting on edit


// Scroll long artist/track names back and forth when the compact panel cannot
// display the complete value. Short values remain completely still.
const marqueeInputs = [
  document.getElementById('artist'),
  document.getElementById('track')
];

const marqueeState = new WeakMap();

const updateMarquee = input => {
  if (!input) return;
  const old = marqueeState.get(input);
  if (old?.timer) clearInterval(old.timer);

  input.scrollLeft = 0;
  const max = input.scrollWidth - input.clientWidth;
  if (max <= 2) {
    marqueeState.delete(input);
    return;
  }

  let direction = 1;
  let paused = true;
  let pauseTicks = 0;

  const timer = setInterval(() => {
    if (paused) {
      pauseTicks++;
      if (pauseTicks >= 18) {
        paused = false;
        pauseTicks = 0;
      }
      return;
    }

    input.scrollLeft += direction;
    if (input.scrollLeft >= max) {
      input.scrollLeft = max;
      direction = -1;
      paused = true;
    }
    else if (input.scrollLeft <= 0) {
      input.scrollLeft = 0;
      direction = 1;
      paused = true;
    }
  }, 80);

  marqueeState.set(input, {timer});
};

const refreshMarquees = () => marqueeInputs.forEach(updateMarquee);

document.getElementById('artist').addEventListener('input', () => { timer.stop(); refreshMarquees(); });
document.getElementById('track').addEventListener('input', () => { timer.stop(); refreshMarquees(); });


requestAnimationFrame(refreshMarquees);
