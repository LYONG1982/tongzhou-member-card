'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const W = 1440, H = 1080;
  const LAYOUT = Object.freeze({
    info: { x: 32, y: 216, w: 788, h: 404 },
    photo: { x: 840, y: 216, w: 568, h: 404 },
    family: { x: 62, y: 499, w: 728, h: 116 },
    review: { x: 32, y: 632, w: 676, h: 192 },
    match: { x: 724, y: 632, w: 684, h: 192 }
  });
  const PW = LAYOUT.photo.w, PH = LAYOUT.photo.h;
  const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  const MAX_BYTES = 20 * 1024 * 1024, MAX_PIXELS = 50 * 1000 * 1000;
  const state = { photo: null, number: null, assignedName: '', transform: { zoom: 1, x: 0, y: 0 }, photoToken: 0, revision: 0, busy: false, pending: 0, photoError: '' };
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const crop = $('crop'), cropCtx = crop.getContext('2d');
  ctx.imageSmoothingQuality = 'high'; cropCtx.imageSmoothingQuality = 'high';
  const TEMPLATES = Object.freeze({
    男: { key: 'male', accent: '#0759a6', deep: '#073b70', pale: '#f0f7ff', soft: '#d8eafa', mid: '#74a9de', title: '他的资料', panel: '#ffffffed' },
    女: { key: 'female', accent: '#b24672', deep: '#71304d', pale: '#fff2f7', soft: '#f7dfE9', mid: '#d985a6', title: '她的资料', panel: '#fffdfdf0' }
  });
  const themeFor = gender => TEMPLATES[gender];
  const backgrounds = new Map();
  function loadBackground(key) {
    if (!backgrounds.has(key)) backgrounds.set(key, new Promise(resolve => {
      const source = window.TONGZHOU_BACKGROUNDS?.[key];
      if (!source) { resolve(null); return; }
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth === 1448 && image.naturalHeight === 1086 ? image : null);
      image.onerror = () => resolve(null);
      image.src = source;
    }));
    return backgrounds.get(key);
  }
  // Preload without exposing unhandled failures; generation reports only its selected template.
  loadBackground('male'); loadBackground('female');
  const gender = () => document.querySelector('[name=gender]:checked').value;
  const count = value => Array.from(value).length;
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  function ageFromYear(value, now = new Date()) {
    if (!/^\d{4}$/.test(value) || Number(value) < 1900) throw new Error('请选择 1900 年以后的有效出生年份。');
    if (Number(value) > now.getFullYear()) throw new Error('出生年份不能晚于当前年份。');
    return now.getFullYear() - Number(value);
  }
  let listedYear = 0;
  function syncAge() {
    const currentYear = new Date().getFullYear();
    if (listedYear !== currentYear) {
      const previous = listedYear ? $('birth').value : '1982';
      $('birth').replaceChildren(new Option('请选择年份', ''));
      for (let year = currentYear; year >= 1900; year--) {
        const option = new Option(year + '年', String(year), year === 1982, String(year) === previous);
        $('birth').add(option);
      }
      $('birth').value = previous; listedYear = currentYear;
    }
    try { $('age').value = '约 ' + ageFromYear($('birth').value) + ' 岁'; } catch { $('age').value = '请选择有效年份'; }
  }
  function sync() {
    syncAge();
    document.body.classList.toggle('female', gender() === '女');
    $('themeLabel').textContent = gender() === '女' ? '她的资料 · 粉色' : '他的资料 · 蓝色';
    $('eduOther').hidden = $('edu').value !== '其他';
    for (const id of ['family', 'review', 'match']) {
      const n = count($(id).value); $(id + 'Count').textContent = `已输入 ${n}/100`;
      $(id + 'Count').classList.toggle('over', n > 100); $(id).setAttribute('aria-invalid', n > 100 ? 'true' : 'false');
    }
  }
  function changed() { state.revision++; if (state.number && $('memberName').value.trim() !== state.assignedName) { state.number = null; state.assignedName = ''; } sync(); syncNumber(); if (!state.busy) status('资料已更新，点击“生成并下载 PNG”即可下载最新卡片。'); }
  function fieldError(id, message) { $(id).setAttribute('aria-invalid', 'true'); (id === 'photo' ? $('uploadPhoto') : $(id)).focus(); throw new Error(message); }
  function data() {
    for (const el of document.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const name = $('memberName').value.trim();
    if (!name || count(name) > 40) fieldError('memberName', '请填写姓名（1–40 个字符），姓名不会显示在成品中。');
    let age; try { age = ageFromYear($('birth').value); } catch (e) { fieldError('birth', e.message); }
    const height = Number($('height').value);
    if (!Number.isInteger(height) || height < 100 || height > 230) fieldError('height', '请填写 100–230 之间的整数身高（cm）。');
    const result = { gender: gender(), birth: $('birth').value, age, height };
    for (const [id, title, limit] of [['ethnic', '民族', 12], ['job', '工作', 24], ['income', '月收入', 24], ['assets', '资产', 30], ['family', '家庭情况', 100], ['review', '红娘评价', 100], ['match', '择偶要求', 100]]) {
      if (count($(id).value) > limit) fieldError(id, `${title}最多 ${limit} 个字符，当前 ${count($(id).value)} 个。请修改后再生成。`);
      result[id] = $(id).value.trim();
    }
    result.marital = $('marital').value;
    result.edu = $('edu').value === '其他' ? $('eduOther').value.trim() : $('edu').value;
    if (!result.edu || count(result.edu) > 16) fieldError('eduOther', '请填写其他学历，最多 16 个字符。');
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
  async function uploadPhoto() {
    const file = $('photo').files[0];
    if (!file) return; // Canceling the picker must preserve the existing photo.
    const token = ++state.photoToken;
    release(state.photo); state.photo = null; state.photoError = ''; changed();
    state.transform = { zoom: 1, x: 0, y: 0 }; drawCrop();
    $('photoFilename').textContent = file.name; $('uploadPhoto').textContent = '更换照片';
    $('photoMessage').classList.remove('error');
    $('photoMessage').textContent = '正在读取图片…'; state.pending++; $('generate').disabled = true;
    try {
      const image = await decodeFile(file);
      if (token !== state.photoToken) { release(image); return; }
      state.photo = image; drawCrop();
    } catch (error) {
      if (token !== state.photoToken) return;
      state.photoError = error.message; $('photoMessage').textContent = error.message; $('photoMessage').classList.add('error');
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
  function drawCrop() {
    cropCtx.clearRect(0, 0, PW, PH);
    $('cropPlaceholder').hidden = !!state.photo;
    for (const id of ['zoom', 'centerPhoto', 'resetPhoto']) $(id).disabled = !state.photo;
    $('zoom').value = Math.round(state.transform.zoom * 100); $('zoomValue').value = $('zoom').value + '%';
    if (!state.photo) return;
    const g = geometry(); cropCtx.drawImage(state.photo, g.x, g.y, g.width, g.height);
    const effectiveW = Math.round(PW / g.scale), effectiveH = Math.round(PH / g.scale);
    $('photoMessage').textContent = `原图 ${state.photo.width} × ${state.photo.height}；有效裁切约 ${effectiveW} × ${effectiveH} 像素。${effectiveW < PW || effectiveH < PH ? '清晰度偏低，建议更换高清照片，也可继续生成。' : '清晰度满足当前导出尺寸。'}`;
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
  function gradient(x, y, x2, y2, stops) { const g = ctx.createLinearGradient(x, y, x2, y2); stops.forEach(([p, c]) => g.addColorStop(p, c)); return g; }
  function heart(x, y, size, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 32, size / 32); ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(16, 29); ctx.bezierCurveTo(10, 23, -4, 13, 3, 5); ctx.bezierCurveTo(8, 0, 14, 3, 16, 8); ctx.bezierCurveTo(20, 0, 27, 1, 30, 6); ctx.bezierCurveTo(36, 14, 22, 25, 16, 29); ctx.fill(); ctx.restore();
  }
  function person(x, y, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.fill(); ctx.beginPath(); ctx.ellipse(x, y + 19, 13, 12, 0, Math.PI, 2 * Math.PI); ctx.fill(); }
  function panel(box, theme) {
    round(box.x, box.y, box.w, box.h, 16, theme.panel);
    ctx.strokeStyle = '#ffffffd9'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(box.x + .5, box.y + .5, box.w - 1, box.h - 1, 16); ctx.stroke();
  }
  function sectionTitle(title, box, theme, number) {
    const x = box.x + 12, y = box.y + 7;
    round(x, y, 240, 36, 18, gradient(x, y, x + 240, y, [[0, theme.mid], [1, theme.accent]]));
    if (number) person(x + 22, y + 10, '#fff'); else heart(x + 10, y + 7, 24, '#fff');
    text(title, x + 45, y + 1, 30, '#fff', 700);
    if (number) text('编号 ' + number, box.x + box.w - 24, y + 5, 25, theme.deep, 600, 'right');
    else {
      ctx.strokeStyle = theme.soft; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 258, y + 18); ctx.lineTo(box.x + box.w - 42, y + 18); ctx.stroke();
      heart(box.x + box.w - 32, y + 9, 18, theme.mid);
    }
  }
  function layoutCard(d) {
    const left = [['出生年份', d.birth + '年'], ['年龄', `约${d.age}岁`], ['民族', d.ethnic], ['婚姻状况', d.marital], ['身高', `${d.height} cm`]];
    const right = [['学历', d.edu], ['工作', d.job], ['月收入', d.income], ['资产', d.assets]];
    const rows = [];
    for (const [entries, x, w, h] of [[left, 48, 370, 39], [right, 430, 374, 48.75]]) {
      entries.forEach(([label, value], i) => {
        const lines = measuredLines(value, w - 133, h - 7, 26, 28, label, 600);
        rows.push({ label, lines, x, y: 266 + i * h, w, h });
      });
    }
    const f = LAYOUT.family;
    const family = measuredLines(d.family, f.w, f.h, 22, 29, '家庭情况');
    const sections = [['红娘评价', d.review, LAYOUT.review], ['择偶要求', d.match, LAYOUT.match]].map(([title, value, box]) => ({
      title, box, lines: measuredLines(value, box.w - 40, 132, 24, 32.5, title)
    }));
    return { rows, family, sections };
  }
  function renderCard(d, transform, theme, background, layout) {
    // Background assets already contain the brand, slogans, waves and boat. Never redraw them.
    ctx.clearRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(background, 0, 0, W, H);
    const p = LAYOUT.photo, g = geometry({ ...transform });
    ctx.save();
    // Restrict shadow to the working area, keeping the original branding and footer untouched.
    ctx.beginPath(); ctx.rect(828, 208, 592, 420); ctx.clip();
    ctx.shadowColor = '#173c5c26'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    round(p.x, p.y, p.w, p.h, 16, '#fff'); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 16); ctx.clip();
    ctx.fillStyle = theme.pale; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.drawImage(state.photo, p.x + g.x, p.y + g.y, g.width, g.height); ctx.restore();
    ctx.strokeStyle = '#fffffff0'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4, 14); ctx.stroke();
    panel(LAYOUT.info, theme); sectionTitle(theme.title, LAYOUT.info, theme, d.number);
    for (const row of layout.rows) {
      const { label, lines, x, y, w, h } = row;
      round(x, y, w, h - 4, 9, theme.pale); round(x, y, 113, h - 4, 9, theme.soft);
      text(label, x + 12, y + (h - 4 - 24) / 2, 24, theme.deep, 600);
      drawLines(lines, x + 124, y + (h - 4 - lines.length * 28) / 2, 26, 28, '#17263b', 600);
    }
    round(48, 467, 756, 149, 10, theme.pale);
    text('家庭情况', 62, 470, 23, theme.deep, 600); text('年龄按年份估算', 790, 473, 16, '#506176', 400, 'right');
    drawLines(layout.family, LAYOUT.family.x, LAYOUT.family.y, 22, 29);
    for (const section of layout.sections) {
      panel(section.box, theme); sectionTitle(section.title, section.box, theme);
      drawLines(section.lines, section.box.x + 20, section.box.y + 51, 24, 32.5);
    }
    return canvas;
  }
  const COUNTER_KEY = 'tongzhou.memberCard.counter.v1';
  const LOCK_NAME = 'tongzhou.memberCard.number-lock.v1';
  let seenRecord = false;
  const formatNumber = value => 'TZ' + String(value).padStart(4, '0');
  function readCounter() {
    let raw;
    try { raw = localStorage.getItem(COUNTER_KEY); }
    catch { throw new Error('浏览器无法读取编号记录，请允许本地存储后重试。'); }
    if (raw === null) {
      if (seenRecord) throw new Error('编号记录已被清除，请重新打开工具，并将起始号设置到已使用的最大号之后。');
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
  function syncNumber(updateSetting = false) {
    try {
      const record = readCounter();
      const next = record.next > 9999 ? '已用完 TZ9999' : '下一编号 ' + formatNumber(record.next);
      $('numberStatus').textContent = state.number ? `当前编号 ${formatNumber(state.number)} · ${next}` : next + '（生成时分配）';
      $('numberStatus').classList.remove('error');
      if (updateSetting) $('startNumber').value = record.next > 9999 ? '' : String(record.next);
    } catch (error) {
      $('numberStatus').textContent = state.number ? `当前编号 ${formatNumber(state.number)}；新编号不可用：${error.message}` : error.message;
      $('numberStatus').classList.add('error');
    }
  }
  $('saveNumber').onclick = async () => {
    $('saveNumber').disabled = true;
    try {
      const value = $('startNumber').value;
      if (!/^\d{1,4}$/.test(value) || Number(value) < 1) throw new Error('起始序号请输入 1–9999 的整数。');
      const next = Number(value);
      await withCounterLock(() => {
        const record = readCounter();
        if (record.lastIssued > 0 && next < record.next) throw new Error('已有编号被使用，起始序号不能小于下一个待分配号。');
        writeCounter({ ...record, next });
      });
      $('numberMessage').textContent = '已设置：下一份新资料从 ' + formatNumber(next) + ' 开始。';
      $('numberMessage').classList.remove('error'); syncNumber(true);
    } catch (error) { $('numberMessage').textContent = error.message; $('numberMessage').classList.add('error'); }
    finally { $('saveNumber').disabled = false; }
  };
  async function generate(event) {
    event.preventDefault(); if (state.busy || state.pending) return;
    state.busy = true; $('generate').disabled = true; $('generate').textContent = '正在生成…';
    const revision = state.revision;
    try {
      syncAge(); const d = data(); await document.fonts.ready;
      const theme = themeFor(d.gender), background = await loadBackground(theme.key);
      if (!background) throw new Error('当前主题底图加载失败，请完整解压工具文件后重试。');
      const layout = layoutCard(d);
      let blob = null, assigned = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (revision !== state.revision) throw new Error('资料已变化，请重新点击生成。');
        const existing = state.number;
        const candidate = existing || readCounter().next;
        if (candidate > 9999) throw new Error('编号已达到 TZ9999，不能继续分配新编号。');
        d.number = formatNumber(candidate);
        renderCard(d, { ...state.transform }, theme, background, layout);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('图片生成失败，请重新尝试。');
        if (revision !== state.revision) throw new Error('资料已变化，请重新点击生成。');
        if (existing) { assigned = true; break; }
        assigned = await withCounterLock(() => {
          if (revision !== state.revision) throw new Error('资料已变化，请重新点击生成。');
          const record = readCounter();
          if (record.next !== candidate) return false; // Another window issued first; render with the new number.
          writeCounter({ version: 1, next: candidate + 1, lastIssued: candidate });
          state.number = candidate; state.assignedName = $('memberName').value.trim();
          return true;
        });
        if (assigned) break;
      }
      if (!assigned) throw new Error('其他窗口正在分配编号，请稍后重试。');
      syncNumber();
      if (revision !== state.revision) throw new Error('资料已变化，请重新点击生成。');
      const date = new Date(), pad = n => String(n).padStart(2, '0');
      const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `同舟婚恋_会员卡片_${d.number}_${d.gender}_${stamp}.png`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      status(`已生成 ${d.number} · 1440 × 1080 PNG，并发起下载。请在浏览器下载列表中查看。`);
    } catch (error) { syncNumber(); status(error.message || '生成失败，请检查资料后重试。', true); }
    finally { state.busy = false; $('generate').disabled = state.pending > 0; $('generate').textContent = '生成并下载 PNG'; }
  }
  $('cardForm').addEventListener('submit', generate);
  $('cardForm').addEventListener('input', event => { if (event.target.type !== 'file') changed(); });
  $('photo').addEventListener('change', uploadPhoto);
  $('uploadPhoto').onclick = () => $('photo').click();
  $('zoom').addEventListener('input', () => { state.transform.zoom = Number($('zoom').value) / 100; drawCrop(); });
  $('centerPhoto').onclick = () => { state.transform.x = 0; state.transform.y = 0; changed(); drawCrop(); };
  $('resetPhoto').onclick = () => { state.transform = { zoom: 1, x: 0, y: 0 }; changed(); drawCrop(); };
  let drag = null;
  crop.addEventListener('pointerdown', event => { if (!state.photo) return; crop.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY }; });
  crop.addEventListener('pointermove', event => { if (!drag || !state.photo) return; const rect = crop.getBoundingClientRect(); state.transform.x += (event.clientX - drag.x) * PW / rect.width; state.transform.y += (event.clientY - drag.y) * PH / rect.height; drag = { x: event.clientX, y: event.clientY }; changed(); drawCrop(); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) crop.addEventListener(name, () => { drag = null; });
  crop.addEventListener('keydown', event => { if (!state.photo || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const step = event.shiftKey ? 20 : 3; state.transform.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; state.transform.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0; changed(); drawCrop(); });
  $('reset').onclick = () => {
    state.photoToken++; release(state.photo); state.photo = null; state.photoError = ''; state.number = null; state.assignedName = '';
    state.transform = { zoom: 1, x: 0, y: 0 }; HTMLFormElement.prototype.reset.call($('cardForm'));
    $('photoMessage').classList.remove('error'); $('photoMessage').textContent = '请选择会员照片。';
    $('photoFilename').textContent = '尚未选择照片'; $('uploadPhoto').textContent = '上传照片';
    for (const el of document.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    changed(); drawCrop(); syncNumber(true); status('已重置资料并清除照片，编号计数保持不变。');
  };
  window.addEventListener('focus', () => { syncAge(); syncNumber(); });
  document.addEventListener('visibilitychange', syncAge); setInterval(syncAge, 60000);
  window.addEventListener('storage', event => { if (event.key === COUNTER_KEY || event.key === null) syncNumber(true); });
  sync(); drawCrop(); syncNumber(true);
})();
