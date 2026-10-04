// https://github.com/rNeomy/last.fm-scrobbler/issues/27

{
  const cache = {};

  document.querySelector('form').addEventListener('submit', () => {
    const track = document.getElementById('track').value;
    const artist = document.getElementById('artist').value;

    const oTrack = document.getElementById('track').dataset.value;
    const oArtist = document.getElementById('artist').dataset.value;

    // save user-edited tracks
    if (track !== oTrack || artist !== oArtist) {
      console.info('Save custom parsing...');
      chrome.storage.local.get({
        renames: {}
      }, prefs => chrome.storage.local.set({
        renames: {
          ...prefs.renames,
          [oArtist + '|' + oTrack]: {artist, track}
        }
      }));
    }
  });

  self.parse = new Proxy(self.parse, {
    apply(target, self, args) {
      return Reflect.apply(target, self, args).then(({artist, track}) => {
        return new Promise(resolve => chrome.storage.local.get({
          renames: {}
        }, prefs => {
          const key = artist + '|' + track;
          cache[key] = prefs;

          document.getElementById('track').dataset.value = track;
          document.getElementById('artist').dataset.value = artist;
          if (prefs.renames[key]) {
            resolve(prefs.renames[key]);
          }
          else {
            resolve({artist, track});
          }
        }));
      });
    }
  });
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
