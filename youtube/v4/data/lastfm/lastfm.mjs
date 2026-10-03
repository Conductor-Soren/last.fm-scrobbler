/* globals md5 */
'use strict';

const CONFIG_DEFAULTS = {
  lastfmApiKey: '',
  lastfmApiSecret: ''
};

const getConfig = () => new Promise((resolve, reject) => {
  // Read credentials through the service worker. The scrobbler UI runs in
  // an extension iframe embedded in YouTube Music; keeping credential access
  // in the extension's background context avoids browser-specific storage
  // isolation issues.
  chrome.runtime.sendMessage({method: 'lastfm-get-config'}, response => {
    if (chrome.runtime.lastError) {
      reject(new Error('Could not read Last.fm settings: ' + chrome.runtime.lastError.message));
      return;
    }
    if (!response?.ok) {
      reject(new Error(response?.error || 'Last.fm API credentials are not configured. Open the extension Options and enter your API key and secret.'));
      return;
    }
    resolve({key: response.key, secret: response.secret});
  });
});

const fetchApi = async obj => {
  // Last.fm API requests are made by the service worker rather than the
  // YouTube Music iframe. This avoids CORS/network-policy differences in
  // embedded extension pages and keeps the API secret out of page contexts.
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({method: 'lastfm-api-request', params: obj}, response => {
      if (chrome.runtime.lastError) {
        reject(new Error('Could not contact the Last.fm service worker: ' + chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || 'Last.fm request failed'));
        return;
      }
      resolve(response.json);
    });
  });
};

const sendRuntimeMessage = request => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(request, response => {
    if (chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message));
      return;
    }
    if (!response?.ok) {
      reject(new Error(response?.error || 'Last.fm request failed'));
      return;
    }
    resolve(response);
  });
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const authenticate = async status => {
  const {key} = await getConfig();

  status?.('request-token');
  let tokenResponse;
  try {
    tokenResponse = await fetchApi({
      method: 'auth.getToken'
    });
  }
  catch (e) {
    throw new Error('Last.fm could not issue an authorization token. ' + (e?.message || e));
  }

  if (!tokenResponse?.token) {
    throw new Error(tokenResponse?.message || 'Last.fm did not return an authentication token.');
  }

  const token = tokenResponse.token;
  const authUrl = 'https://www.last.fm/api/auth?api_key=' +
    encodeURIComponent(key) +
    '&token=' + encodeURIComponent(token);

  status?.('opening');
  const {tabId} = await sendRuntimeMessage({
    method: 'lastfm-open-auth',
    url: authUrl
  });

  status?.('waiting');

  try {
    // Desktop authentication deliberately does not depend on an OAuth callback.
    // Last.fm's desktop flow asks the user to authorize in a normal browser tab;
    // once approved, auth.getSession starts returning the session.
    const deadline = Date.now() + 5 * 60 * 1000;

    while (Date.now() < deadline) {
      try {
        const json = await fetchApi({
          method: 'auth.getSession',
          token
        });

        if (json?.session) {
          await new Promise(resolve => chrome.storage.local.set({session: json.session}, resolve));
          status?.('connected');
          return json.session;
        }
      }
      catch (e) {
        const message = String(e?.message || e);
        // Error 14 means the user has not approved the token yet. Error 4 can
        // also occur while the token is still unauthorized. Keep polling those
        // two cases, but immediately surface every other API error.
        if (/API error (4|14):/i.test(message) || /not authorized|not been authorized/i.test(message)) {
          // Still waiting for the user.
        }
        else {
          throw e;
        }
      }

      await sleep(3000);
    }

    throw new Error('Last.fm authorization timed out. Approve the extension in the Last.fm tab, then try Connect again.');
  }
  finally {
    if (Number.isInteger(tabId)) {
      chrome.runtime.sendMessage({method: 'lastfm-close-auth', tabId}, () => void chrome.runtime.lastError);
    }
  }
};

const getStoredSession = () => new Promise(resolve => {
  chrome.storage.local.get({session: null}, prefs => resolve(prefs.session || null));
});

const validateSession = async () => {
  const session = await getStoredSession();
  if (!session?.key) return null;

  try {
    const json = await fetchApi({
      method: 'user.getInfo',
      sk: session.key
    });

    if (json?.user) {
      // Keep the saved session name current in case the Last.fm account name
      // changed or the API returned a normalized value.
      const updated = {
        ...session,
        name: json.user.name || session.name
      };
      await new Promise(resolve => chrome.storage.local.set({session: updated}, resolve));
      return updated;
    }

    return session;
  }
  catch (e) {
    const message = String(e?.message || e);
    if (/API error 9\b|invalid session key/i.test(message)) {
      await new Promise(resolve => chrome.storage.local.remove('session', resolve));
      return null;
    }
    // A temporary network/API problem should not throw away a perfectly good
    // saved session. The normal scrobble request will report the real error if
    // the service is unavailable.
    return session;
  }
};

const call = (request, watch = () => {}) => new Promise((resolve, reject) => {
  chrome.storage.local.get({session: null}, async prefs => {
    try {
      if (!prefs.session) {
        reject(new Error('Last.fm is not connected. Click Connect to authorize this extension.'));
        return;
      }
      watch('fetch');
      const json = await fetchApi({
        ...request,
        sk: prefs.session.key
      });
      if (json?.error === 9) {
        chrome.storage.local.remove('session');
        reject(new Error('Last.fm session expired. Please connect Last.fm again.'));
        return;
      }
      resolve(json);
    }
    catch (e) {
      reject(e);
    }
  });
});

const lastfm = {
  authenticate,
  call,
  getConfig,
  getStoredSession,
  validateSession
};

export {
  lastfm,
  authenticate,
  call,
  getConfig,
  getStoredSession,
  validateSession
};
