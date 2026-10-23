import { upload as uploadBlob } from '@vercel/blob/client';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const audio = $('#audio');
let songs = [];
let view = 'all';
let searchTerm = '';
let sortBy = 'newest';
let currentId = null;
let playQueue = [];
let menuOpenId = null;
let editId = null;
let shuffle = false;
let repeat = 0; // 0: off, 1: all, 2: one
let uploading = false;

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(message, error = false) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}
async function api(route, options = {}) {
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  let response;
  try {
    response = await fetch(route, { credentials: 'same-origin', ...options, headers: { ...headers, ...options.headers } });
  } catch {
    throw new Error('Không kết nối được với server. Kiểm tra kết nối mạng.');
  }
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) {
    if (response.status === 401 && route !== '/api/login') showLogin();
    throw new Error(result.error || 'Có lỗi xảy ra.');
  }
  return result;
}
function showLogin() {
  audio.pause();
  audio.removeAttribute('src');
  $('#authScreen').hidden = false;
}
async function initialize() {
  try {
    const session = await api('/api/session');
    if (session.authenticated) await loginSuccess();
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
}
async function loginSuccess() {
  $('#authScreen').hidden = true;
  await refreshSongs();
}
async function refreshSongs() {
  try {
    songs = await api('/api/songs');
    if (currentId && !songs.some(s => s.id === currentId)) {
      currentId = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    render();
  } catch (error) { toast(error.message, true); }
}
function songById(id) { return songs.find(s => s.id === id); }
function coverClass(id) {
  let code = 0;
  for (const char of id) code = (code * 31 + char.charCodeAt(0)) % 997;
  return `art-${code % 6}`;
}
function niceBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${Math.max(.1, mb).toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
function dateLabel(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}
function filteredSongs() {
  let list = songs.slice();
  if (view === 'favorites') list = list.filter(s => s.favorite);
  if (view === 'recent') list = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  if (searchTerm) {
    const q = searchTerm.toLocaleLowerCase('vi');
    list = list.filter(s => `${s.title} ${s.artist}`.toLocaleLowerCase('vi').includes(q));
  }
  if (sortBy === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
  else if (sortBy === 'artist') list.sort((a, b) => a.artist.localeCompare(b.artist, 'vi'));
  else list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list;
}
function featuredSongs() {
  return [...songs].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
}
function render() {
  $('#totalCount').textContent = songs.length.toLocaleString('vi-VN');
  $('#favoriteCount').textContent = songs.filter(s => s.favorite).length.toLocaleString('vi-VN');
  $('#storageSize').textContent = niceBytes(songs.reduce((acc, s) => acc + (s.size || 0), 0));
  const names = { all: 'Tất cả bài hát', favorites: 'Nhạc yêu thích', recent: 'Mới tải lên' };
  $('#libraryTitle').textContent = names[view];
  $$('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  const list = filteredSongs();
  $('#visibleCount').textContent = `${list.length} bài hát`;
  const featured = featuredSongs();
  $('#featuredSection').hidden = featured.length === 0 || view !== 'all' || !!searchTerm;
  $('#featuredGrid').innerHTML = featured.map(s => `
    <button class="featured-card" data-id="${escapeHtml(s.id)}" aria-label="Phát ${escapeHtml(s.title)}">
      <div class="featured-cover cover ${coverClass(s.id)}">${icon('music')}<span class="card-play">${icon('play')}</span></div>
      <strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.artist)}</span>
    </button>`).join('');
  $('#songList').innerHTML = list.map((song, index) => `
    <div class="song-row${currentId === song.id ? ' is-current' : ''}" data-id="${escapeHtml(song.id)}">
      <div class="song-number">${currentId === song.id && !audio.paused ? '♫' : index + 1}</div>
      <div class="song-details" data-action="play" role="button" tabindex="0" aria-label="Phát ${escapeHtml(song.title)}">
        <div class="track-cover cover ${coverClass(song.id)}">${icon('music')}</div>
        <div class="track-meta"><span class="track-title">${escapeHtml(song.title)}</span><span class="track-artist">${escapeHtml(song.artist)}</span></div>
      </div>
      <div class="song-date">${dateLabel(song.createdAt)}</div>
      <div class="song-controls">
        <button class="icon-btn${song.favorite ? ' is-favorite' : ''}" data-action="favorite" title="${song.favorite ? 'Bỏ yêu thích' : 'Yêu thích'}" aria-label="${song.favorite ? 'Bỏ yêu thích' : 'Yêu thích'}">${icon('heart')}</button>
        <div class="row-menu"><button class="icon-btn" data-action="menu" aria-label="Tùy chọn bài hát" aria-expanded="${menuOpenId === song.id}">${icon('more')}</button>
          ${menuOpenId === song.id ? `<div class="popover-menu"><button data-action="edit">${icon('edit')} Chỉnh sửa thông tin</button><button class="danger" data-action="delete">${icon('trash')} Xóa bài hát</button></div>` : ''}
        </div>
      </div>
    </div>`).join('');
  $('#emptyState').hidden = list.length > 0;
  $('#songList').hidden = !list.length;
  $('.table-head').hidden = !list.length;
  if (!list.length) {
    $('#emptyState h3').textContent = songs.length && (searchTerm || view !== 'all') ? 'Không tìm thấy bài hát phù hợp' : 'Thư viện đang đợi giai điệu đầu tiên';
    $('#emptyState p').textContent = songs.length && (searchTerm || view !== 'all') ? 'Hãy thử từ khóa khác hoặc chọn mục Tất cả bài hát.' : 'Thêm các file nhạc từ máy tính để tạo không gian âm nhạc dành riêng cho bạn.';
    $('#emptyUpload').hidden = songs.length > 0;
  }
  syncPlayer();
}
function syncPlayer() {
  const song = songById(currentId);
  $('#playerTitle').textContent = song?.title || 'Chưa phát bài hát';
  $('#playerArtist').textContent = song?.artist || 'Chọn một bài trong thư viện';
  $('#playerArt').className = `player-art cover ${song ? coverClass(song.id) : 'art-0'}`;
  $('#playerArt').innerHTML = icon('music');
  $('#playBtn').disabled = !songs.length;
  $('#playIcon').innerHTML = `<use href="#i-${song && !audio.paused ? 'pause' : 'play'}"/>`;
  $('#playBtn').setAttribute('aria-label', song && !audio.paused ? 'Tạm dừng' : 'Phát');
  $('#playerFavorite').disabled = !song;
  $('#playerFavorite').classList.toggle('is-favorite', Boolean(song?.favorite));
  $('#playerFavorite').setAttribute('aria-label', song?.favorite ? 'Bỏ yêu thích' : 'Yêu thích');
  $('#shuffleBtn').classList.toggle('active', shuffle);
  $('#repeatBtn').classList.toggle('active', repeat !== 0);
  $('#repeatBtn').classList.toggle('repeat-one-active', repeat === 2);
  $('#repeatBtn').title = ['Không lặp', 'Lặp danh sách', 'Lặp một bài'][repeat];
}
function setRangePercent(el, percent) {
  el.style.setProperty('--percent', `${Math.max(0, Math.min(100, percent))}%`);
}
function displayTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const total = Math.floor(Math.max(0, seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function updateTiming() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  $('#currentTime').textContent = displayTime(audio.currentTime);
  $('#duration').textContent = displayTime(duration);
  const position = duration > 0 ? audio.currentTime / duration * 1000 : 0;
  $('#seekSlider').value = Math.max(0, Math.min(1000, position));
  setRangePercent($('#seekSlider'), position / 10);
}
async function playSong(id, newQueue = null) {
  const song = songById(id);
  if (!song) return;
  if (newQueue) playQueue = newQueue.slice();
  if (!playQueue.includes(id)) playQueue = songs.map(s => s.id);
  if (currentId === id) {
    if (audio.paused) {
      try { await audio.play(); } catch { toast('Không phát được định dạng âm thanh này trên thiết bị.', true); }
    } else audio.pause();
    syncPlayer();
    return;
  }
  currentId = id;
  audio.src = `/api/stream/${encodeURIComponent(id)}`;
  audio.load();
  render();
  try { await audio.play(); } catch { toast('Không phát được file này. Hãy thử MP3 hoặc M4A.', true); }
  syncPlayer();
}
async function togglePlay() {
  if (!currentId) {
    const first = filteredSongs()[0] || songs[0];
    if (first) await playSong(first.id, filteredSongs().map(s => s.id));
    return;
  }
  if (audio.paused) {
    try { await audio.play(); } catch { toast('Không phát được bài hát này.', true); }
  } else audio.pause();
  syncPlayer();
}
async function moveSong(direction, fromEnded = false) {
  if (!songs.length) return;
  if (!fromEnded && direction < 0 && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  let queue = playQueue.filter(id => !!songById(id));
  if (!queue.length) queue = songs.map(s => s.id);
  const index = queue.indexOf(currentId);
  if (shuffle && queue.length > 1 && direction > 0) {
    const others = queue.filter(id => id !== currentId);
    await playSong(others[Math.floor(Math.random() * others.length)]);
    return;
  }
  const next = index + direction;
  if (fromEnded && repeat === 0 && next >= queue.length) {
    audio.pause();
    syncPlayer();
    return;
  }
  const target = queue[(next + queue.length) % queue.length] || queue[0];
  await playSong(target);
}
async function updateSong(id, patch) {
  try {
    const updated = await api(`/api/songs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    songs = songs.map(s => s.id === id ? updated : s);
    render();
    return true;
  } catch (error) { toast(error.message, true); return false; }
}
async function toggleFavorite(id) {
  const song = songById(id);
  if (song) await updateSong(id, { favorite: !song.favorite });
}
function openModal(selector) { $(selector).hidden = false; }
function closeModal(selector) { $(selector).hidden = true; }
function showEdit(song) {
  editId = song.id;
  $('#editTitle').value = song.title;
  $('#editArtist').value = song.artist;
  openModal('#editModal');
  $('#editTitle').focus();
}
async function deleteSong(id) {
  const song = songById(id);
  if (!song || !window.confirm(`Xóa "${song.title}" khỏi thư viện và server? Thao tác này không thể hoàn tác.`)) return;
  try {
    await api(`/api/songs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    songs = songs.filter(s => s.id !== id);
    if (currentId === id) {
      currentId = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      updateTiming();
    }
    playQueue = playQueue.filter(songId => songId !== id);
    menuOpenId = null;
    render();
    toast('Đã xóa bài hát khỏi server.');
  } catch (error) { toast(error.message, true); }
}
async function uploadFiles(files) {
  if (uploading || !files.length) return;
  const supported = new Set(['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'aac', 'webm']);
  const filtered = files.filter(file => supported.has(file.name.split('.').pop().toLowerCase()));
  const rejected = files.length - filtered.length;
  if (rejected) toast(`Bỏ qua ${rejected} file không đúng định dạng.`, true);
  if (!filtered.length) return;
  uploading = true;
  let completed = 0;
  let failed = 0;
  const status = $('#uploadStatus');
  for (const [index, file] of filtered.entries()) {
    status.textContent = `Đang tải ${index + 1}/${filtered.length}: ${file.name}…`;
    try {
      // Browser uploads directly to Blob, so Vercel Functions never receive the MP3 body.
      const ext = file.name.split('.').pop().toLowerCase();
      const pathname = `sonora-audio/${crypto.randomUUID()}.${ext}`;
      const blob = await uploadBlob(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload',
        multipart: file.size > 100 * 1024 * 1024,
      });
      const song = await api('/api/songs', {
        method: 'POST',
        body: JSON.stringify({
          url: blob.url,
          title: file.name.replace(/\.[^.]+$/, ''),
          originalName: file.name,
        }),
      });
      songs.unshift(song);
      completed++;
      render();
    } catch (error) {
      failed++;
      toast(`${file.name}: ${error.message}`, true);
    }
  }
  uploading = false;
  $('#fileInput').value = '';
  status.textContent = `Hoàn tất: ${completed} bài hát đã lưu${failed ? `, ${failed} file lỗi` : ''}. Bạn có thể nghe ngay!`;
  if (completed) toast(`Đã thêm ${completed} bài hát vào thư viện ✨`);
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  $('#loginError').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#passwordInput').value }) });
    $('#passwordInput').value = '';
    await loginSuccess();
  } catch (error) { $('#loginError').textContent = error.message; }
  finally { btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* Clear local UI even when offline */ }
  songs = [];
  currentId = null;
  render();
  showLogin();
});
$$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view;
  menuOpenId = null;
  render();
}));
$('#searchInput').addEventListener('input', e => { searchTerm = e.target.value.trim(); render(); });
$('#sortSelect').addEventListener('change', e => { sortBy = e.target.value; render(); });
$('#featuredGrid').addEventListener('click', e => {
  const card = e.target.closest('.featured-card');
  if (card) playSong(card.dataset.id, filteredSongs().map(s => s.id));
});
$('#songList').addEventListener('click', async e => {
  const row = e.target.closest('.song-row');
  if (!row) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'play') return playSong(row.dataset.id, filteredSongs().map(s => s.id));
  if (action === 'favorite') return toggleFavorite(row.dataset.id);
  if (action === 'menu') { menuOpenId = menuOpenId === row.dataset.id ? null : row.dataset.id; return render(); }
  if (action === 'edit') { menuOpenId = null; return showEdit(songById(row.dataset.id)); }
  if (action === 'delete') return deleteSong(row.dataset.id);
});
$('#songList').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.song-details')) {
    e.preventDefault();
    const row = e.target.closest('.song-row');
    if (row) playSong(row.dataset.id, filteredSongs().map(s => s.id));
  }
});
document.addEventListener('click', e => {
  if (menuOpenId && !e.target.closest('.row-menu')) { menuOpenId = null; render(); }
});
$('#editForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!editId) return;
  const saved = await updateSong(editId, { title: $('#editTitle').value, artist: $('#editArtist').value });
  if (saved) {
    closeModal('#editModal');
    editId = null;
    toast('Đã cập nhật thông tin bài hát.');
  }
});
$$('.upload-trigger').forEach(button => button.addEventListener('click', () => {
  $('#uploadStatus').textContent = '';
  openModal('#uploadModal');
}));
$$('.close-modal').forEach(button => button.addEventListener('click', () => {
  if (uploading && button.dataset.close === 'uploadModal') return toast('Đang tải file lên, vui lòng đợi tải xong.');
  closeModal(`#${button.dataset.close}`);
}));
$$('.modal-backdrop').forEach(modal => modal.addEventListener('click', e => {
  if (e.target === modal && !(modal.id === 'uploadModal' && uploading)) closeModal(`#${modal.id}`);
}));
const dropzone = $('#dropzone');
dropzone.addEventListener('click', () => $('#fileInput').click());
dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); }
});
$('#fileInput').addEventListener('change', e => uploadFiles([...e.target.files]));
['dragenter', 'dragover'].forEach(name => dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(name => dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', e => uploadFiles([...e.dataTransfer.files]));

$('#playBtn').addEventListener('click', togglePlay);
$('#prevBtn').addEventListener('click', () => moveSong(-1));
$('#nextBtn').addEventListener('click', () => moveSong(1));
$('#shuffleBtn').addEventListener('click', () => { shuffle = !shuffle; syncPlayer(); toast(shuffle ? 'Đã bật phát ngẫu nhiên.' : 'Đã tắt phát ngẫu nhiên.'); });
$('#repeatBtn').addEventListener('click', () => { repeat = (repeat + 1) % 3; syncPlayer(); toast(['Không lặp', 'Lặp lại danh sách', 'Lặp lại một bài'][repeat]); });
$('#playerFavorite').addEventListener('click', () => { if (currentId) toggleFavorite(currentId); });
$('#seekSlider').addEventListener('input', e => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(e.target.value) / 1000 * audio.duration;
  setRangePercent(e.target, Number(e.target.value) / 10);
});
const savedVolume = (() => { try { return Number(localStorage.getItem('sonora-volume')); } catch { return NaN; } })();
audio.volume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1 ? savedVolume : .8;
$('#volumeSlider').value = String(audio.volume * 100);
setRangePercent($('#volumeSlider'), audio.volume * 100);
$('#volumeSlider').addEventListener('input', e => {
  audio.volume = Number(e.target.value) / 100;
  audio.muted = false;
  try { localStorage.setItem('sonora-volume', String(audio.volume)); } catch { /* Storage might be disabled */ }
  setRangePercent(e.target, audio.volume * 100);
  $('#muteBtn').innerHTML = icon(audio.volume === 0 ? 'volume-off' : 'volume');
});
$('#muteBtn').addEventListener('click', () => {
  audio.muted = !audio.muted;
  $('#muteBtn').innerHTML = icon(audio.muted ? 'volume-off' : 'volume');
});
audio.addEventListener('timeupdate', updateTiming);
audio.addEventListener('durationchange', updateTiming);
audio.addEventListener('loadedmetadata', updateTiming);
audio.addEventListener('play', () => { syncPlayer(); $$('.song-row').forEach(row => { const num = row.querySelector('.song-number'); if (row.dataset.id === currentId) num.textContent = '♫'; }); });
audio.addEventListener('pause', () => { syncPlayer(); if (currentId) render(); });
audio.addEventListener('ended', () => {
  if (repeat === 2) { audio.currentTime = 0; audio.play().catch(() => {}); }
  else moveSong(1, true);
});
audio.addEventListener('error', () => {
  if (audio.src && currentId) toast('Không thể phát file. Hãy kiểm tra định dạng hoặc phiên đăng nhập.', true);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (uploading) return;
    closeModal('#uploadModal');
    closeModal('#editModal');
    if (menuOpenId) { menuOpenId = null; render(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('#authScreen').hidden) $('#searchInput').focus();
  }
  if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName) && $('.modal-backdrop:not([hidden])') === null && $('#authScreen').hidden) {
    e.preventDefault();
    togglePlay();
  }
});

render();
updateTiming();
initialize();
