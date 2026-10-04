const frame = document.getElementById('music');
const status = document.getElementById('status');

function showStatus(message, timeout = 2500) {
  status.textContent = message;
  status.classList.add('show');
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => status.classList.remove('show'), timeout);
}

frame.addEventListener('load', () => {
  showStatus('YouTube Music loaded');
});

frame.addEventListener('error', () => {
  showStatus('YouTube Music could not be loaded.', 6000);
});
