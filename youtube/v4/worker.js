importScripts('/data/lastfm/md5.min.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.method === 'inject') {
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id,
        frameIds: [sender.frameId]
      },
      files: [request.file],
      world: 'MAIN'
    });
  }

  else if (request.method === 'lastfm-get-config') {
    chrome.storage.local.get({
      lastfmApiKey: '',
      lastfmApiSecret: ''
    }, prefs => {
      if (chrome.runtime.lastError) {
        sendResponse({ok: false, error: chrome.runtime.lastError.message});
        return;
      }

      const key = String(prefs.lastfmApiKey || '').trim();
      const secret = String(prefs.lastfmApiSecret || '').trim();
      if (!key || !secret) {
        sendResponse({
          ok: false,
          error: 'Last.fm API credentials are not configured. Open the extension Options, enter your API key and secret, and click Save Last.fm Credentials.'
        });
        return;
      }

      sendResponse({ok: true, key, secret});
    });
    return true;
  }

  else if (request.method === 'lastfm-api-request') {
    (async () => {
      try {
        const obj = request.params && typeof request.params === 'object' ? request.params : {};
        const prefs = await chrome.storage.local.get({
          lastfmApiKey: '',
          lastfmApiSecret: ''
        });
        const key = String(prefs.lastfmApiKey || '').trim();
        const secret = String(prefs.lastfmApiSecret || '').trim();

        if (!key || !secret) {
          throw new Error('Last.fm API credentials are not configured. Open Extension Settings and enter your API key and secret.');
        }

        const params = {...obj, api_key: key};
        if (params.method !== 'track.getInfo') {
          params.api_sig = md5(Object.keys(params).sort().map(k => k + params[k]).join('') + secret);
        }
        params.format = 'json';

        // Last.fm requires POST for write/authenticated methods such as
        // track.scrobble. Send the complete signed parameter set in the
        // application/x-www-form-urlencoded request body. In particular,
        // keep `sk` in the request: it is part of the signature and is the
        // session key Last.fm uses to authenticate scrobbling.
        const body = Object.entries(params)
          .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
          .join('&');

        const url = 'https://ws.audioscrobbler.com/2.0/';

        let response;
        let text = '';
        let json = null;
        let lastError = null;

        // Last.fm documents POST + form-urlencoded for write services such as
        // track.scrobble and track.updateNowPlaying. Retry transient 5xx
        // responses because the API occasionally returns an HTML 500 from its
        // front-end rather than a normal JSON API error.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json'
              },
              body,
              credentials: 'omit',
              cache: 'no-store'
            });
            text = await response.text();
            json = null;
            try { json = text ? JSON.parse(text) : null; } catch (_) {}

            if (response.ok) break;

            const transient = response.status >= 500 && response.status <= 599;
            if (!transient || attempt === 2) break;
            await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
          }
          catch (e) {
            lastError = e;
            if (attempt === 2) {
              throw new Error('Could not reach Last.fm: ' + (e?.message || e));
            }
            await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
          }
        }

        if (lastError && !response) {
          throw new Error('Could not reach Last.fm: ' + (lastError?.message || lastError));
        }

        if (!response.ok) {
          const detail = json?.message ? ': ' + json.message : (text ? ': ' + text.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
          throw new Error('Last.fm network error: ' + response.status + detail);
        }

        if (json?.error) {
          throw new Error(`Last.fm API error ${json.error}: ${json.message || 'Unknown error'}`);
        }

        sendResponse({ok: true, json});
      }
      catch (e) {
        sendResponse({ok: false, error: e?.message || String(e)});
      }
    })();
    return true;
  }

  else if (request.method === 'lastfm-open-auth') {
    (async () => {
      try {
        if (!request.url || !/^https:\/\/www\.last\.fm\/api\/auth(?:\/|\?)/.test(request.url)) {
          throw new Error('Invalid Last.fm authorization URL.');
        }

        const tab = await chrome.tabs.create({
          url: request.url,
          active: true
        });

        sendResponse({ok: true, tabId: tab?.id ?? null});
      }
      catch (e) {
        sendResponse({ok: false, error: e?.message || String(e)});
      }
    })();
    return true;
  }

  else if (request.method === 'lastfm-close-auth') {
    (async () => {
      try {
        if (Number.isInteger(request.tabId)) {
          await chrome.tabs.remove(request.tabId).catch(() => {});
        }
        sendResponse({ok: true});
      }
      catch (e) {
        sendResponse({ok: false, error: e?.message || String(e)});
      }
    })();
    return true;
  }

  else if (request.method === 'lastfm-open-profile') {
    (async () => {
      try {
        const prefs = await chrome.storage.local.get({session: null});
        const name = String(prefs.session?.name || '').trim();
        if (!name) {
          throw new Error('Last.fm account name is not available.');
        }

        const url = 'https://www.last.fm/user/' + encodeURIComponent(name);
        await chrome.tabs.create({
          url,
          active: true
        });
        sendResponse({ok: true});
      }
      catch (e) {
        sendResponse({ok: false, error: e?.message || String(e)});
      }
    })();
    return true;
  }

  else if (request.method === 'show' || request.method === 'hide') {
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id
      },
      func: method => {
        const e = document.getElementById('last-fm-core');
        e.classList[method === 'show' ? 'remove' : 'add']('hidden');
      },
      args: [request.method]
    });
  }
});

/* FAQs & Feedback */
{
  const {runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, currentWindow: true}, tbs => tabs.create({
              url: page + '&version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      });
    });
    setUninstallURL(page + '&rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
