'use strict';

const toast = document.getElementById('toast');

const restore = () => chrome.storage.local.get({
  categories: ['Música', 'Music', 'Entertainment'],
  blacklistAuthors: [],
  checkCategory: true,
  filter: true,
  minTime: 30,
  lastfmApiKey: '',
  lastfmApiSecret: ''
}, prefs => {
  document.getElementById('checkCategory').checked = prefs.checkCategory;
  document.getElementById('filter').checked = prefs.filter;
  document.getElementById('categories').value = prefs.categories.join(', ');
  document.getElementById('blacklistAuthors').value = prefs.blacklistAuthors.join(', ');
  document.getElementById('minTime').value = prefs.minTime;
  document.getElementById('lastfmApiKey').value = prefs.lastfmApiKey;
  document.getElementById('lastfmApiSecret').value = prefs.lastfmApiSecret;
});
restore();

document.getElementById('saveLastfm').addEventListener('click', () => {
  const apiKey = document.getElementById('lastfmApiKey').value.trim();
  const apiSecret = document.getElementById('lastfmApiSecret').value.trim();
  const status = document.getElementById('lastfmStatus');

  if (!apiKey || !apiSecret) {
    status.textContent = 'Enter both the API key and secret.';
    return;
  }

  chrome.storage.local.set({
    lastfmApiKey: apiKey,
    lastfmApiSecret: apiSecret,
    session: null
  }, () => {
    status.textContent = chrome.runtime.lastError ? 'Could not save.' : 'Saved. Connect Last.fm from YouTube Music.';
    window.setTimeout(() => status.textContent = '', 2500);
  });
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.local.set({
    filter: document.getElementById('filter').checked,
    checkCategory: document.getElementById('checkCategory').checked,
    categories: document.getElementById('categories').value.split(/\s*,\s*/).filter((s, i, l) => s && l.indexOf(s) === i),
    blacklistAuthors: document.getElementById('blacklistAuthors').value.split(/\s*,\s*/).filter((s, i, l) => s && l.indexOf(s) === i),
    minTime: +document.getElementById('minTime').value
  }, () => {
    toast.textContent = 'Options saved';
    window.setTimeout(() => toast.textContent = '', 750);
    restore();
  });
});
// reset
document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    toast.textContent = 'Double-click to reset!';
    window.setTimeout(() => toast.textContent = '', 750);
  }
  else {
    localStorage.clear();
    chrome.storage.local.clear(() => {
      chrome.runtime.reload();
      window.close();
    });
  }
});
// support
document.getElementById('support').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url + '&rd=donate'
}));
// clean
document.getElementById('clean').addEventListener('click', () => chrome.storage.local.set({
  renames: {}
}, () => {
  toast.textContent = 'Done!';
  window.setTimeout(() => toast.textContent = '', 750);
}));
