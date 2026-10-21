'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const W = 1440, H = 1080;
  // Figma nodes 2:19 / 2:72; coordinates include the parent border.
  const LAYOUT = Object.freeze({
    info: { x: 688, y: 184, w: 712, h: 832 },
    photo: { x: 46, y: 192, w: 612, h: 816 },
    family: { x: 717, y: 472, w: 654, h: 146 },
    review: { x: 717, y: 632, w: 654, h: 186 },
    match: { x: 717, y: 832, w: 654, h: 150 }
  });
  const PROSE = { family: { title: '家庭情况', width: 618, lines: 2 }, review: { title: '红娘评价', width: 654, lines: 4 }, match: { title: '择偶要求', width: 654, lines: 3 } };
  const PW = LAYOUT.photo.w, PH = LAYOUT.photo.h;
  const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  const MAX_BYTES = 20 * 1024 * 1024, MAX_PIXELS = 50 * 1000 * 1000;
  const state = { photo: null, number: null, manualNumber: null, assignedName: '', transform: { zoom: 1, x: 0, y: 0 }, photoToken: 0, revision: 0, busy: false, pending: 0, photoError: '', privacy: '', mask: null, avatar: null, preview: null, view: 'edit', privacyToken: 0 };
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const crop = $('crop'), cropCtx = crop.getContext('2d');
  crop.width = PW; crop.height = PH;
  const preview = $('finalCard'), previewCtx = preview.getContext('2d');
  const photoLayer = document.createElement('canvas'); photoLayer.width = PW; photoLayer.height = PH;
  const photoCtx = photoLayer.getContext('2d');
  ctx.imageSmoothingQuality = 'high'; cropCtx.imageSmoothingQuality = 'high'; photoCtx.imageSmoothingQuality = 'high';
  const TEMPLATES = Object.freeze({
    男: { key: 'male', accent: '#145f9e', deep: '#145f9e', pale: '#eaf3fc', soft: '#d1e2f1', ink: '#18364f', muted: '#58728b', border: '#7eafd7', title: '他的资料' },
    女: { key: 'female', accent: '#b64d6a', deep: '#b64d6a', pale: '#fff0f3', soft: '#f0d9df', ink: '#543340', muted: '#8e6977', border: '#dfa1b4', title: '她的资料' }
  });
  const themeFor = gender => TEMPLATES[gender];
  const backgrounds = new Map();
  function loadBackground(key) {
    if (!backgrounds.has(key)) backgrounds.set(key, new Promise(resolve => {
      const source = window.TONGZHOU_BACKGROUNDS?.[key];
      if (!source) { resolve(null); return; }
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth === W && image.naturalHeight === H ? image : null);
      image.onerror = () => resolve(null);
      image.src = source;
    }));
    return backgrounds.get(key);
  }
  // Preload without exposing unhandled failures; generation reports only its selected template.
  loadBackground('male'); loadBackground('female');
  const gender = () => document.querySelector('[name=gender]:checked')?.value || '';
  const count = value => Array.from(value).length;
  function status(message, error = false) { for (const id of ['status', 'previewStatus']) { $(id).textContent = message; $(id).classList.toggle('error', error); } }
  function ageFromYear(value, now = new Date()) {
    if (!/^\d{4}$/.test(value) || Number(value) < 1900) throw new Error('请填写 1900 年起的四位出生年份。');
    if (Number(value) > now.getFullYear()) throw new Error('出生年份不能晚于当前年份。');
    return now.getFullYear() - Number(value);
  }
  function sync() {
    document.body.classList.toggle('female', gender() === '女');
    $('themeLabel').textContent = gender() ? (gender() === '女' ? '她的资料 · 粉色' : '他的资料 · 蓝色') : '请选择性别';
    $('eduOther').hidden = $('edu').value !== '其他';
    for (const [id, spec] of Object.entries(PROSE)) {
      const n = count($(id).value), capacity = proseCapacity(spec);
      $(id + 'Count').textContent = `已输入 ${n} 字 · 建议约 ${capacity} 字以内，最多 ${spec.lines} 行`;
      const overflow = wrap($(id).value, spec.width, 24).length > spec.lines;
      $(id + 'Count').classList.toggle('over', overflow);
      $(id).setAttribute('aria-invalid', overflow ? 'true' : 'false');
    }
  }
  function proseCapacity(spec) { font(24); return Math.floor(spec.width / ctx.measureText('汉').width) * spec.lines; }
  function invalidateMask(clearChoice = false) {
    state.mask = null; state.privacyToken++; avatarLoading = false;
    if (clearChoice) { state.privacy = ''; state.avatar = null; $('maskSize').value = 300; $('maskSizeValue').value = '300 px'; }
    state.preview = null;
  }
  let lastName = '', lastGender = '';
  function changed() {
    state.revision++; state.preview = null;
    const name = $('memberName').value.trim(), sex = gender();
    if (name !== lastName) { invalidateMask(true); state.manualNumber = null; }
    else if (sex !== lastGender) { invalidateMask(); state.avatar = null; }
    if (state.number && name !== state.assignedName) { state.number = null; state.assignedName = ''; }
    lastName = name; lastGender = sex;
    sync(); if (!state.busy) status('资料已更新，点击“生成卡片”检查最终效果。'); syncNumber();
  }
  function fieldError(id, message) { $(id).setAttribute('aria-invalid', 'true'); (id === 'photo' ? $('uploadPhoto') : $(id)).focus(); throw new Error(message); }
  function data() {
    for (const el of document.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const name = $('memberName').value.trim();
    if (!name || count(name) > 40) fieldError('memberName', '请填写姓名（1–40 个字符），姓名不会显示在成品中。');
    if (!gender()) fieldError('genderMale', '请选择TA的性别，以匹配卡片风格。');
    let age; try { age = ageFromYear($('birth').value.trim()); } catch (e) { fieldError('birth', e.message); }
    const height = Number($('height').value);
    if (!Number.isInteger(height) || height < 100 || height > 230) fieldError('height', '请填写 100–230 之间的整数身高（cm）。');
    const result = { gender: gender(), birth: $('birth').value.trim(), age, height };
    for (const [id, title, limit] of [['ethnic', '民族', 12], ['job', '工作', 24], ['income', '月收入', 24], ['assets', '资产', 30]]) {
      if (count($(id).value) > limit) fieldError(id, `${title}最多 ${limit} 个字符，当前 ${count($(id).value)} 个。请修改后再生成。`);
      result[id] = $(id).value.trim();
    }
    for (const id of Object.keys(PROSE)) result[id] = $(id).value.trim();
    result.marital = $('marital').value;
    result.edu = $('edu').value === '其他' ? $('eduOther').value.trim() : $('edu').value;
    if (!result.edu || count(result.edu) > 16) fieldError($('edu').value === '其他' ? 'eduOther' : 'edu', '请选择学历；其他学历最多 16 个字符。');
    if (state.photoError) fieldError('photo', state.photoError);
    if (!state.photo) fieldError('photo', '请先上传会员照片。');
    return result;
  }
  // Extract a static, first-image GIF, preserving its palette and transparency.
  function firstGifFrame(bytes) {
    if (bytes.length < 13) throw new Error('GIF 文件损坏。');
    let p = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
    const skipBlocks = () => { while (p < bytes.length) { const size = bytes[p++]; if (!size) return; p += size; } throw new Error('GIF 数据不完整。'); };
    while (p < bytes.length) {
      const marker = bytes[p++];
      if (marker === 0x21) { p++; skipBlocks(); }
      else if (marker === 0x2c) {
        if (p + 9 > bytes.length) break;
        const packed = bytes[p + 8]; p += 9;
        if (packed & 128) p += 3 * (1 << ((packed & 7) + 1));
        p++; skipBlocks();
        if (p > bytes.length) break;
        const out = new Uint8Array(p + 1); out.set(bytes.subarray(0, p)); out[p] = 0x3b;
        return new Blob([out], { type: 'image/gif' });
      } else break;
    }
    throw new Error('GIF 没有可读取的首帧。');
  }
  async function decodeFile(file) {
    if (file.size > MAX_BYTES) throw new Error('图片超过 20MB，请压缩后重新选择。');
    if (!file.size) throw new Error('图片文件为空，请重新选择。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder().decode(bytes.subarray(0, 2048));
    if (/\.svgz?$/i.test(file.name) || /svg/i.test(file.type) || /<svg[\s>]/i.test(head)) throw new Error('不接受 SVG 矢量文件，请转换为 PNG 或 JPG。');
    let blob = file;
    if (/^GIF8[79]a/.test(head)) blob = firstGifFrame(bytes);
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.decoding = 'async';
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('当前浏览器无法读取此图片，或文件已损坏。请转换为 PNG/JPG 后重试。')); image.src = url; });
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width * height > MAX_PIXELS || Math.max(width, height) > 20000) throw new Error('图片像素尺寸过大或无效，请缩小至 5000 万像素以内再上传。');
      // Canvas freezes animated formats and uses the browser's EXIF-oriented dimensions.
      const frozen = document.createElement('canvas'); frozen.width = width; frozen.height = height;
      frozen.getContext('2d').drawImage(image, 0, 0);
      return frozen;
    } finally { URL.revokeObjectURL(url); }
  }
  function release(image) { if (image) { image.width = 1; image.height = 1; } }
  function photoMessage(message = '', error = false) {
    const el = $('photoMessage'); el.textContent = message; el.hidden = !message;
    el.classList.toggle('error', error);
  }
  async function uploadPhoto() {
    const file = $('photo').files[0];
    if (!file) return; // Canceling the picker must preserve the existing photo.
    const token = ++state.photoToken;
    invalidateMask(); release(state.photo); state.photo = null; state.photoError = ''; changed();
    state.transform = { zoom: 1, x: 0, y: 0 }; drawCrop();
    $('uploadPhoto').textContent = '更换照片';
    photoMessage('正在读取图片…'); state.pending++; $('generate').disabled = true;
    try {
      const image = await decodeFile(file);
      if (token !== state.photoToken) { release(image); return; }
      state.photo = image; drawCrop(); photoMessage();
    } catch (error) {
      if (token !== state.photoToken) return;
      state.photoError = error.message; photoMessage(error.message, true);
      status(error.message, true);
    } finally { state.pending--; $('generate').disabled = state.busy || state.pending > 0; }
  }
  function geometry(transform = state.transform) {
    const scale = Math.max(PW / state.photo.width, PH / state.photo.height) * transform.zoom;
    const width = state.photo.width * scale, height = state.photo.height * scale;
    transform.x = Math.max(-(width - PW) / 2, Math.min((width - PW) / 2, transform.x));
    transform.y = Math.max(-(height - PH) / 2, Math.min((height - PH) / 2, transform.y));
    return { scale, width, height, x: (PW - width) / 2 + transform.x, y: (PH - height) / 2 + transform.y };
  }
  // Render at the same local pixel origin for both adjustment and export, avoiding resampling drift.
  function paintPhoto(target, transform = state.transform) {
    target.clearRect(0, 0, PW, PH);
    const g = geometry(transform); target.drawImage(state.photo, g.x, g.y, g.width, g.height);
  }
  function drawCrop() {
    cropCtx.clearRect(0, 0, PW, PH);
    $('cropPlaceholder').hidden = !!state.photo;
    for (const id of ['zoom', 'centerPhoto', 'resetPhoto']) $(id).disabled = !state.photo;
    $('zoom').value = Math.round(state.transform.zoom * 100); $('zoomValue').value = $('zoom').value + '%';
    if (!state.photo) return;
    paintPhoto(cropCtx);
  }
  function font(size, weight = 400) { ctx.font = `${weight} ${size}px ${FONT}`; }
  function text(value, x, y, size, color, weight = 400, align = 'left') {
    font(size, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top'; ctx.fillText(value, x, y);
  }
  function wrap(value, width, size, weight = 400) {
    font(size, weight); const lines = [];
    for (const segment of String(value || '未填写').replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const char of Array.from(segment)) {
        if (line && ctx.measureText(line + char).width > width) {
          // Avoid starting a new Chinese line with closing punctuation.
          const previous = Array.from(line);
          if (/[，。！？；：、）》】」』”’]/u.test(char) && previous.length > 1) {
            const tail = previous.pop(); lines.push(previous.join('')); line = tail + char;
          } else { lines.push(line); line = char; }
        } else line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  function measuredLines(value, width, height, size, lineHeight, label, weight = 400) {
    const lines = wrap(value, width, size, weight);
    if (lines.length * lineHeight > height) throw new Error(`${label}内容超出可读排版空间，请减少换行或精简文字后再生成。`);
    return lines;
  }
  function drawLines(lines, x, y, size, lineHeight, color = '#17263b', weight = 400) {
    lines.forEach((line, index) => text(line, x, y + index * lineHeight, size, color, weight));
  }
  function round(x, y, w, h, radius, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); }
  function layoutCard(d) {
    const left = [['出生年份', d.birth + '年'], ['身高', `${d.height} cm`], ['民族', d.ethnic], ['婚姻状况', d.marital]];
    const right = [['学历', d.edu], ['工作', d.job], ['月收入', d.income], ['资产', d.assets]];
    const longMarital = wrap(d.marital, 207, 27, 500).length > 1;
    const rows = [];
    for (const [entries, x] of [[left, 717], [right, 1056]]) {
      entries.forEach(([label, value], i) => {
        const lines = measuredLines(value, 207, label === '婚姻状况' ? 72 : 36, 27, 36, label, 500);
        rows.push({ label, lines, x, y: (longMarital ? 278 : 290) + i * 44 });
      });
    }
    const sections = Object.entries(PROSE).map(([id, spec]) => {
      const lines = wrap(d[id], spec.width, 24);
      if (lines.length > spec.lines) fieldError(id, `${spec.title}内容超出可读排版空间（最多 ${spec.lines} 行），请减少换行或精简文字。`);
      return { id, title: spec.title, box: { ...LAYOUT[id], y: longMarital ? { family: 490, review: 644, match: 838 }[id] : LAYOUT[id].y }, lines };
    });
    return { rows, sections, dividerY: longMarital ? 269 : 275 };
  }
  function paintMask(target, theme, mask, avatar) {
    if (!mask || !avatar) return;
    const { x, y, size } = mask;
    target.save(); target.beginPath(); target.rect(0, 0, PW, PH); target.clip();
    // Preserve the supplied PNG alpha; never add a background behind the avatar.
    target.drawImage(avatar, x - size / 2, y - size / 2, size, size); target.restore();
  }
  function renderCard(d, transform, theme, background, layout, privacy = state.privacy, mask = state.mask, avatar = state.avatar) {
    ctx.clearRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(background, 0, 0, W, H);
    const p = LAYOUT.photo; paintPhoto(photoCtx, { ...transform });
    if (privacy === 'cover') paintMask(photoCtx, theme, mask, avatar);
    ctx.save(); ctx.shadowColor = theme.border + '3b'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    round(40, 184, 624, 832, 26, '#fffffff5'); ctx.restore();
    ctx.strokeStyle = theme.border; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(41.5, 185.5, 621, 829, 24.5); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 20); ctx.clip(); ctx.drawImage(photoLayer, p.x, p.y); ctx.restore();
    round(688, 184, 712, 832, 24, '#ffffffdb');
    ctx.strokeStyle = theme.border + '38'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(688.5, 184.5, 711, 831, 23.5); ctx.stroke();
    text(theme.title, 717, 213 + 6, 36, theme.accent, 700);
    text(d.number ? '编号 ' + d.number : '编号待保存', 1371, 219 + 4.5, 27, theme.accent, 500, 'right');
    round(717, layout.dividerY, 654, 1, 0, theme.soft);
    for (const row of layout.rows) {
      text(row.label, row.x, row.y + 6.5, 23, theme.muted);
      drawLines(row.lines, row.x + 108, row.y + 4.5, 27, 36, theme.ink, 500);
    }
    for (const section of layout.sections) {
      const family = section.id === 'family', { x, y, w, h } = section.box;
      if (family) round(x, y, w, h, 16, theme.pale);
      const tx = x + (family ? 18 : 0), ty = y + (family ? 16 : 0);
      text(section.title, tx, ty + 4, 26, theme.accent, 700);
      drawLines(section.lines, tx, ty + 42 + 6, 24, 36, theme.ink);
    }
    return canvas;
  }
  const COUNTER_KEY = 'tongzhou.memberCard.counter.v1';
  const LOCK_NAME = 'tongzhou.memberCard.number-lock.v1';
  let seenRecord = false;
  const formatNumber = value => 'TZ-' + String(value).padStart(5, '0');
  function readCounter() {
    let raw;
    try { raw = localStorage.getItem(COUNTER_KEY); }
    catch { throw new Error('浏览器无法读取编号记录，请允许本地存储后重试。'); }
    if (raw === null) {
      if (seenRecord) throw new Error('编号记录已被清除，已停止新发号。请联系维护人员核对并恢复原编号记录。');
      return { version: 1, next: 1, lastIssued: 0 };
    }
    let record;
    try { record = JSON.parse(raw); } catch { throw new Error('编号记录损坏，请先核对已使用的最大编号，勿直接从 0001 重新生成。'); }
    if (!record || record.version !== 1 || !Number.isInteger(record.next) || record.next < 1 || record.next > 10000 || !Number.isInteger(record.lastIssued) || record.lastIssued < 0 || record.lastIssued >= record.next) {
      throw new Error('编号记录无效，请先核对已使用的最大编号。');
    }
    seenRecord = true; return record;
  }
  function writeCounter(record) {
    const value = JSON.stringify(record);
    try {
      localStorage.setItem(COUNTER_KEY, value);
      if (localStorage.getItem(COUNTER_KEY) !== value) throw new Error('write failed');
      seenRecord = true;
    } catch { throw new Error('编号保存失败，已停止下载。请允许浏览器本地存储并保留足够空间后重试。'); }
  }
  // All counter changes are synchronous inside this cross-window mutex.
  // The IDB fallback uses an exclusive readwrite transaction, never an unsafe localStorage spinlock.
  function withCounterLock(action) {
    if (navigator.locks?.request) return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, action);
    return new Promise((resolve, reject) => {
      let request, cancelled = false;
      try { request = indexedDB.open(LOCK_NAME, 1); } catch { reject(new Error('当前浏览器无法安全协调编号，请使用允许本地存储的新版 Chrome/Edge。')); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('mutex');
      request.onerror = () => reject(new Error('无法锁定编号记录，请使用允许本地存储的新版 Chrome/Edge。'));
      request.onblocked = () => { cancelled = true; reject(new Error('其他窗口占用了编号配置，请关闭其他工具窗口后重试。')); };
      request.onsuccess = () => {
        const db = request.result;
        if (cancelled) { db.close(); return; }
        let result, failure;
        try {
          const tx = db.transaction('mutex', 'readwrite'), store = tx.objectStore('mutex');
          const get = store.get('gate');
          get.onsuccess = () => { try { result = action(); store.put(1, 'gate'); } catch (error) { failure = error; tx.abort(); } };
          tx.oncomplete = () => { db.close(); resolve(result); };
          tx.onabort = tx.onerror = () => { db.close(); reject(failure || new Error('编号协调失败，已停止下载，请重试。')); };
        } catch { db.close(); reject(new Error('无法安全协调编号，已停止下载。')); }
      };
    });
  }
  function suggestedNumber() { return state.manualNumber ?? state.number ?? readCounter().next; }
  function checkManualNumber(value, record = readCounter()) {
    if (!Number.isInteger(value) || value < 1 || value > 9999) throw new Error('请输入 1–9999 的整数序号。');
    if (value !== state.number && value < record.next) throw new Error('该编号已使用或已保留，请选择当前会员原号，或不小于 ' + formatNumber(record.next) + ' 的新号。');
    return value;
  }
  function syncNumber() {
    let code, pending = '', error = '', title = '';
    try {
      const record = readCounter(), candidate = state.manualNumber ?? state.number ?? record.next;
      if (candidate > 9999) { code = '编号已用完'; error = '编号已达到 ' + formatNumber(9999); }
      else {
        code = formatNumber(candidate); pending = candidate === state.number ? '已分配' : '待保存';
        title = candidate === state.number ? '当前会员正式编号' : '保存前不占用编号';
        if (state.manualNumber !== null) { try { checkManualNumber(candidate, record); } catch (e) { error = e.message; pending = '编号冲突'; } }
      }
    } catch (e) { code = state.number ? formatNumber(state.number) : '编号不可用'; error = e.message; }
    for (const id of ['numberStatus', 'previewNumberStatus']) { $(id).textContent = code; $(id).title = error || title; $(id).classList.toggle('error', !!error); }
    for (const id of ['numberPending', 'previewNumberPending']) $(id).textContent = pending;
    if (error) status(error, true);
  }
  function openNumberEditor() {
    if (state.busy) return;
    $('numberError').textContent = ''; $('numberInput').removeAttribute('aria-invalid');
    try { const value = suggestedNumber(); $('numberInput').value = value <= 9999 ? String(value).padStart(5, '0') : ''; } catch { $('numberInput').value = ''; }
    $('numberDialog').showModal(); $('numberInput').focus(); $('numberInput').select();
  }
  function applyNumber() {
    if (state.busy) return;
    try {
      const raw = $('numberInput').value.trim(); if (!/^\d{1,5}$/.test(raw)) throw new Error('请输入 1–9999 的整数序号。');
      state.manualNumber = checkManualNumber(Number(raw)); state.revision++;
      $('numberDialog').close(); syncNumber(); updatePreview(); status('编号已应用，保存下载时正式提交。');
    } catch (e) { $('numberError').textContent = e.message; $('numberInput').setAttribute('aria-invalid', 'true'); $('numberInput').focus(); }
  }
  $('editNumber').onclick = $('editPreviewNumber').onclick = openNumberEditor;
  $('applyNumber').onclick = applyNumber;
  $('numberInput').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); applyNumber(); } };
  $('cancelNumber').onclick = () => $('numberDialog').close();
  $('autoNumber').onclick = () => {
    if (state.busy) return;
    state.manualNumber = null; state.revision++; $('numberDialog').close(); syncNumber(); updatePreview(); status('已恢复自动编号，现有正式编号保持不变。');
  };
  const avatarCache = new Map();
  const editor = $('maskEditor'), editorCtx = editor.getContext('2d');
  let avatarLoading = false, maskDrag = null;
  function loadAvatar(key) {
    if (!avatarCache.has(key)) avatarCache.set(key, new Promise((resolve, reject) => {
      const source = window.TONGZHOU_AVATARS?.[key], image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { avatarCache.delete(key); reject(new Error('卡通头像加载失败，请重试或明确选择保留原照。')); };
      if (!source) { reject(new Error('卡通头像资源缺失，请重试或明确选择保留原照。')); return; }
      image.src = source;
    }));
    return avatarCache.get(key);
  }
  function controls() {
    const covered = state.privacy === 'cover';
    $('generate').disabled = state.busy || state.pending > 0;
    $('generate').textContent = state.busy ? '正在处理…' : '生成卡片';
    $('saveCard').disabled = state.busy || avatarLoading || !state.preview || !state.privacy || (covered && (!state.mask || !state.avatar));
    $('saveCard').textContent = state.busy ? '正在处理…' : '保存下载';
    $('backToEdit').disabled = state.busy;
    $('privacyChoices').disabled = state.busy;
    for (const id of ['editNumber', 'editPreviewNumber', 'applyNumber', 'autoNumber']) $(id).disabled = state.busy;
    $('maskControls').hidden = !covered;
    $('maskSize').disabled = state.busy || avatarLoading || !state.mask;
    $('repositionMask').disabled = state.busy || !state.mask;
    $('avatarLabel').textContent = gender() === '女' ? '使用女生卡通头像' : '使用男生卡通头像';
    editor.classList.toggle('cover-mode', covered);
    editor.tabIndex = covered ? 0 : -1;
    for (const radio of document.querySelectorAll('[name=privacy]')) radio.checked = radio.value === state.privacy;
    if (state.mask) { $('maskSize').value = state.mask.size; $('maskSizeValue').value = Math.round(state.mask.size) + ' px'; }
  }
  function showView(view) {
    state.view = view;
    $('cardForm').hidden = view === 'preview'; $('previewPage').hidden = view !== 'preview';
    document.body.classList.toggle('previewing', view === 'preview');
    controls();
  }
  function updatePreview() {
    if (!state.preview) return;
    const { d, transform, theme, background, layout } = state.preview;
    try { const candidate = suggestedNumber(); d.number = candidate <= 9999 ? formatNumber(candidate) : null; } catch { d.number = null; }
    renderCard(d, transform, theme, background, layout);
    previewCtx.clearRect(0, 0, W, H); previewCtx.drawImage(canvas, 0, 0);
    editorCtx.clearRect(0, 0, W, H);
    if (state.privacy === 'cover' && state.mask) {
      const m = state.mask; editorCtx.strokeStyle = theme.accent; editorCtx.lineWidth = 3; editorCtx.setLineDash([8, 6]);
      editorCtx.save(); editorCtx.beginPath(); editorCtx.rect(LAYOUT.photo.x, LAYOUT.photo.y, PW, PH); editorCtx.clip();
      editorCtx.strokeRect(LAYOUT.photo.x + m.x - m.size / 2, LAYOUT.photo.y + m.y - m.size / 2, m.size, m.size); editorCtx.restore();
    }
    controls();
  }
  const defaultMask = () => ({ x: PW / 2, y: PH * .3, size: 300 });
  async function selectPrivacy(value) {
    if (state.busy) return;
    state.privacy = value; state.revision++; const token = ++state.privacyToken;
    avatarLoading = value === 'cover' && !state.avatar; controls(); updatePreview();
    if (avatarLoading) status('正在读取卡通头像…');
    if (value === 'original') { status('已保留原照，确认卡片后点击保存下载。'); return; }
    try {
      if (!state.avatar) { const avatar = await loadAvatar(themeFor(gender()).key); if (token !== state.privacyToken) return; state.avatar = avatar; }
      if (!state.mask) state.mask = defaultMask();
      status('请调整头像大小和位置，确保遮住面部。');
    } catch (error) { if (token === state.privacyToken) status(error.message, true); }
    finally { if (token === state.privacyToken) { avatarLoading = false; updatePreview(); controls(); } }
  }
  async function generate(event) {
    event.preventDefault(); if (state.busy || state.pending) return;
    state.busy = true; controls(); const revision = state.revision;
    try {
      const d = data(); await document.fonts.ready;
      const theme = themeFor(d.gender), background = await loadBackground(theme.key);
      if (!background) throw new Error('当前主题底图加载失败，请检查工具资源后重试。');
      const layout = layoutCard(d);
      if (revision !== state.revision) throw new Error('资料已变化，请重新点击生成。');
      state.preview = { d, transform: { ...state.transform }, theme, background, layout, revision };
      updatePreview(); showView('preview');
      if (history.state?.cardView !== 'preview') history.pushState({ cardView: 'preview' }, '');
      $('previewTitle').focus(); window.scrollTo(0, 0);
      status(state.privacy ? '请检查卡片内容后保存下载。' : '请选择卡通遮挡或保留原照。');
    } catch (error) { status(error.message || '生成失败，请检查资料。', true); }
    finally { state.busy = false; controls(); }
    if (state.view === 'preview' && state.privacy === 'cover') await selectPrivacy('cover');
  }
  async function saveCard() {
    if ($('saveCard').disabled || state.busy || !state.preview) return;
    state.busy = true; controls(); const revision = state.revision;
    const snap = state.preview, d = { ...snap.d }, mask = state.mask && { ...state.mask }, privacy = state.privacy, avatar = state.avatar;
    const filenameName = $('memberName').value.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '') || '未命名';
    try {
      if (privacy === 'cover' && (!mask || !avatar)) throw new Error('请先放置卡通头像。');
      let blob = null, assigned = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (revision !== state.revision) throw new Error('资料已变化，请返回修改后重新生成。');
        const candidate = state.manualNumber ?? state.number ?? readCounter().next;
        const existing = candidate === state.number;
        if (state.manualNumber !== null) checkManualNumber(candidate);
        if (candidate > 9999) throw new Error('编号已达到 ' + formatNumber(9999) + '，不能继续分配新编号。');
        d.number = formatNumber(candidate);
        renderCard(d, snap.transform, snap.theme, snap.background, snap.layout, privacy, mask, avatar);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('图片生成失败，请重新尝试。');
        if (revision !== state.revision) throw new Error('资料已变化，请返回修改后重新生成。');
        if (existing) { assigned = true; break; }
        assigned = await withCounterLock(() => {
          if (revision !== state.revision) throw new Error('资料已变化，请返回修改后重新生成。');
          const record = readCounter();
          if (state.manualNumber !== null) {
            if (candidate < record.next) throw new Error('该编号已被其他窗口占用，请修改编号后重试。');
          } else if (record.next !== candidate) return false;
          writeCounter({ version: 1, next: candidate + 1, lastIssued: candidate });
          state.number = candidate; state.manualNumber = null; state.assignedName = $('memberName').value.trim(); return true;
        });
        if (assigned) break;
      }
      if (!assigned) throw new Error('其他窗口正在分配编号，请稍后重试。');
      syncNumber();
      if (revision !== state.revision) throw new Error('资料已变化，请返回修改后重新生成。');
      // Copy the exact exported canvas: preview and downloaded image share the final pixels.
      snap.d.number = d.number; previewCtx.clearRect(0, 0, W, H); previewCtx.drawImage(canvas, 0, 0);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${d.number}_${filenameName}_${d.birth}_${d.gender}.png`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      status(`已生成 ${d.number} · 1440 × 1080 PNG，并发起下载。可在浏览器下载列表中查看。`);
    } catch (error) { syncNumber(); status(error.message || '保存失败，请重试。', true); }
    finally { state.busy = false; controls(); }
  }
  $('saveCard').onclick = saveCard;
  $('backToEdit').onclick = () => { if (state.busy) return; showView('edit'); history.replaceState({ cardView: 'edit' }, ''); $('generate').focus(); };
  window.addEventListener('popstate', () => {
    if (state.busy) state.revision++;
    const canPreview = history.state?.cardView === 'preview' && state.preview && state.photo;
    showView(canPreview ? 'preview' : 'edit'); if (canPreview) updatePreview();
  });
  history.replaceState({ cardView: 'edit' }, '');
  for (const radio of document.querySelectorAll('[name=privacy]')) radio.onchange = () => selectPrivacy(radio.value);
  function maskPoint(event) {
    const rect = editor.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width - LAYOUT.photo.x, y: (event.clientY - rect.top) * H / rect.height - LAYOUT.photo.y };
  }
  function moveMask(x, y) {
    state.mask.x = Math.max(0, Math.min(PW, x)); state.mask.y = Math.max(0, Math.min(PH, y));
    state.revision++; updatePreview(); status('请检查面部已完整遮住，再保存下载。');
  }
  editor.onpointerdown = event => {
    if (state.busy || avatarLoading || state.privacy !== 'cover' || !state.avatar || event.button !== 0) return;
    const pt = maskPoint(event); if (pt.x < 0 || pt.x > PW || pt.y < 0 || pt.y > PH) return;
    editor.setPointerCapture(event.pointerId);
    if (!state.mask || Math.hypot(pt.x - state.mask.x, pt.y - state.mask.y) > state.mask.size / 2) state.mask = { ...pt, size: Number($('maskSize').value) };
    maskDrag = { dx: pt.x - state.mask.x, dy: pt.y - state.mask.y }; moveMask(state.mask.x, state.mask.y);
  };
  editor.onpointermove = event => { if (maskDrag && !state.busy && state.mask) { const pt = maskPoint(event); moveMask(pt.x - maskDrag.dx, pt.y - maskDrag.dy); } };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) editor.addEventListener(name, () => { maskDrag = null; });
  editor.onkeydown = event => {
    if (state.busy || !state.mask || state.privacy !== 'cover' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const n = event.shiftKey ? 20 : 3;
    moveMask(state.mask.x + (event.key === 'ArrowLeft' ? -n : event.key === 'ArrowRight' ? n : 0), state.mask.y + (event.key === 'ArrowUp' ? -n : event.key === 'ArrowDown' ? n : 0));
  };
  $('maskSize').oninput = () => { if (!state.busy && state.mask) { state.mask.size = Number($('maskSize').value); state.revision++; updatePreview(); } };
  $('repositionMask').onclick = () => { if (!state.busy) { state.mask = defaultMask(); state.revision++; updatePreview(); status('已恢复默认位置，请调整头像确保遮住面部。'); } };
  $('cardForm').addEventListener('submit', generate);
  $('cardForm').addEventListener('input', event => { if (event.target.type !== 'file') changed(); });
  $('photo').addEventListener('change', uploadPhoto);
  $('uploadPhoto').onclick = () => $('photo').click();
  $('zoom').addEventListener('input', () => { invalidateMask(); state.transform.zoom = Number($('zoom').value) / 100; drawCrop(); });
  $('centerPhoto').onclick = () => { invalidateMask(); state.transform.x = 0; state.transform.y = 0; changed(); drawCrop(); };
  $('resetPhoto').onclick = () => { invalidateMask(); state.transform = { zoom: 1, x: 0, y: 0 }; changed(); drawCrop(); };
  let drag = null;
  crop.addEventListener('pointerdown', event => { if (!state.photo) return; crop.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY }; });
  crop.addEventListener('pointermove', event => { if (!drag || !state.photo) return; invalidateMask(); const rect = crop.getBoundingClientRect(); state.transform.x += (event.clientX - drag.x) * PW / rect.width; state.transform.y += (event.clientY - drag.y) * PH / rect.height; drag = { x: event.clientX, y: event.clientY }; changed(); drawCrop(); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) crop.addEventListener(name, () => { drag = null; });
  crop.addEventListener('keydown', event => { if (!state.photo || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); invalidateMask(); const step = event.shiftKey ? 20 : 3; state.transform.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; state.transform.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0; changed(); drawCrop(); });
  $('reset').onclick = () => {
    invalidateMask(true); avatarLoading = false; state.photoToken++; release(state.photo); state.photo = null; state.photoError = ''; state.number = null; state.manualNumber = null; state.assignedName = '';
    state.transform = { zoom: 1, x: 0, y: 0 }; HTMLFormElement.prototype.reset.call($('cardForm'));
    photoMessage(); $('uploadPhoto').textContent = '上传照片';
    for (const el of document.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    changed(); drawCrop(); status('已重置资料并清除照片，编号计数保持不变。'); syncNumber();
  };
  function refreshNumber() { syncNumber(); if (!state.busy && state.preview) updatePreview(); }
  window.addEventListener('focus', refreshNumber);
  window.addEventListener('storage', event => { if (event.key === COUNTER_KEY || event.key === null) refreshNumber(); });
  sync(); drawCrop(); syncNumber();
  // Page opens use their own storage and mutex; failures never affect member numbering.
  const OPEN_KEY = 'tongzhou.memberCard.pageOpenCount.v1', OPEN_LOCK = 'tongzhou.memberCard.page-open-lock.v1';
  function readOpenCount() {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (!record || record.version !== 1 || !Number.isSafeInteger(record.count) || record.count < 1) throw new Error('Invalid page-open count');
    return record.count;
  }
  function showOpenCount() {
    try {
      const count = readOpenCount();
      if (count === null) throw new Error('No page-open count');
      $('pageOpenCount').textContent = `本机已打开 ${count} 次`;
    } catch { $('pageOpenCount').textContent = '打开次数暂不可用'; }
  }
  async function withOpenCountLock(action) {
    if (navigator.locks?.request) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
      try { return await navigator.locks.request(OPEN_LOCK, { mode: 'exclusive', signal: controller.signal }, action); }
      finally { clearTimeout(timer); }
    }
    return new Promise((resolve, reject) => {
      let request, db, cancelled = false;
      const timer = setTimeout(() => fail(), 5000);
      function fail() { cancelled = true; clearTimeout(timer); db?.close(); reject(new Error('Page-open storage unavailable')); }
      try { request = indexedDB.open(OPEN_LOCK, 1); } catch { fail(); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('mutex');
      request.onerror = request.onblocked = fail;
      request.onsuccess = () => {
        db = request.result;
        if (cancelled) { db.close(); return; }
        try {
          const tx = db.transaction('mutex', 'readwrite'), store = tx.objectStore('mutex');
          store.get('gate').onsuccess = () => {
            if (cancelled) { tx.abort(); return; }
            try { action(); store.put(1, 'gate'); } catch { tx.abort(); }
          };
          tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(); };
          tx.onabort = tx.onerror = fail;
        } catch { fail(); }
      };
    });
  }
  async function countPageOpen() {
    try {
      await withOpenCountLock(() => {
        const count = (readOpenCount() ?? 0) + 1;
        if (!Number.isSafeInteger(count)) throw new Error('Page-open count overflow');
        const value = JSON.stringify({ version: 1, count });
        localStorage.setItem(OPEN_KEY, value);
        if (localStorage.getItem(OPEN_KEY) !== value) throw new Error('Page-open count not saved');
      });
      showOpenCount();
    } catch { $('pageOpenCount').textContent = '打开次数暂不可用'; }
  }
  window.addEventListener('storage', event => { if (event.key === OPEN_KEY || event.key === null) showOpenCount(); });
  window.addEventListener('pageshow', event => { if (event.persisted) showOpenCount(); });
  countPageOpen();
})();
