export function mountEditor(root, bridge) {
  let disposed = false, quietValidation = false, liveTimer = null;
  const $ = id => root.querySelector("#" + id);
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
  const FONT = '"Noto Sans SC", "PingFang SC", sans-serif';
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
      const source = '/brand/figma-' + key + '-background.png';
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
  const gender = () => root.querySelector('[name=gender]:checked')?.value || '';
  const count = value => Array.from(value).length;
  function status(message, error = false) { for (const id of ['status', 'previewStatus']) { $(id).textContent = message; $(id).classList.toggle('error', error); } }
  function ageFromYear(value, now = new Date()) {
    if (!/^\d{4}$/.test(value) || Number(value) < 1900) throw new Error('请填写 1900 年起的四位出生年份。');
    if (Number(value) > now.getFullYear()) throw new Error('出生年份不能晚于当前年份。');
    return now.getFullYear() - Number(value);
  }
  function sync() {
    root.classList.toggle('female', gender() === '女');
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
    if (name !== lastName) { state.manualNumber = null; }
    else if (sex !== lastGender) { invalidateMask(); state.avatar = null; }

    lastName = name; lastGender = sex;
    bridge.dirty(true); sync(); if (!state.busy) status('资料已更新，点击“生成卡片”检查最终效果。'); syncNumber(); if (sex) ensureRecord().catch(e => status(e.message, true)); scheduleLive();
  }
  function fieldError(id, message) { if (quietValidation) throw new Error(message); $(id).setAttribute('aria-invalid', 'true'); (id === 'photo' ? $('uploadPhoto') : $(id)).focus(); throw new Error(message); }
  function data() {
    for (const el of root.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
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
    if (/\.svgz?$/i.test(file.name) || /svg/i.test(file.type) || /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) throw new Error('不接受 SVG 矢量文件，请转换为 PNG 或 JPG。');
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
      state.photo = image; photoMedia = null; photoBlob = null; originalFile = file; drawCrop(); photoMessage(); scheduleLive();
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
  let createPromise = null, photoMedia = bridge.record?.photoId || null, photoBlob = null, originalFile = null;
  let pendingDraft = null, pendingConfirm = null, lastSavedRevision = -1;
  const snapshotEditor = () => ({ transform: { ...state.transform }, privacy: state.privacy, mask: state.mask && { ...state.mask }, template: 'figma-v1' });
  const blobOf = (canvas,type='image/png',quality) => new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')),type,quality));
  async function ensureRecord() {
    if (disposed) throw new Error('页面已离开');
    if (createPromise) return createPromise;
    createPromise = (async () => {
      if (!bridge.record) {
        const sex = gender(); if (!sex) throw new Error('请先选择性别');
        const record = await bridge.send('POST','/members',{requestKey:bridge.requestKey,gender:sex});
        if (disposed) return record;
        bridge.record = record; bridge.created(record); syncNumber();
      }
      while (!disposed && bridge.record.status === 'draft' && gender() && bridge.record.gender !== gender()) {
        bridge.record = await bridge.send('PUT','/members/'+bridge.record.id+'/gender',{gender:gender(),version:bridge.record.version});
      }
      return bridge.record;
    })();
    try { return await createPromise; } finally { createPromise = null; }
  }
  function syncNumber() {
    const code = bridge.record?.number || (createPromise ? '正在创建编号…' : '选择性别后自动生成编号');
    for (const id of ['numberStatus','previewNumberStatus']) $(id).textContent = code;
    for (const id of ['numberPending','previewNumberPending']) $(id).textContent = bridge.record ? '云端统一编号' : '';
  }
  async function persistDraft(d, revision) {
    await ensureRecord(); if (disposed) throw new Error('页面已离开');
    if (!photoBlob && !photoMedia) {
      const work = document.createElement('canvas'), scale = Math.min(1,4096/Math.max(state.photo.width,state.photo.height));
      work.width = Math.round(state.photo.width*scale); work.height = Math.round(state.photo.height*scale);
      const wc = work.getContext('2d'); wc.fillStyle='#fff'; wc.fillRect(0,0,work.width,work.height); wc.drawImage(state.photo,0,0,work.width,work.height);
      photoBlob = await blobOf(work,'image/jpeg',.96); photoMedia = crypto.randomUUID();
    }
    if (photoBlob) await bridge.upload(bridge.record.id,photoMedia,'photo',photoBlob);
    if (originalFile) await bridge.source(bridge.record.id,photoMedia,originalFile);
    if (!pendingDraft || pendingDraft.revision !== revision) {
      const {age,number,...profile} = d; profile.memberName = $('memberName').value.trim();
      pendingDraft = {revision,body:{operationId:crypto.randomUUID(),version:bridge.record.version,profile,editor:snapshotEditor(),photoId:photoMedia}};
    }
    const saved=await bridge.send('PUT','/members/'+bridge.record.id+'/draft',pendingDraft.body);
    bridge.record={...bridge.record,version:saved.version,status:'pending',photoId:photoMedia,profile:pendingDraft.body.profile};
    pendingDraft=null; photoBlob=null; originalFile=null; lastSavedRevision=-1; bridge.dirty(false); syncNumber();
  }
  async function readyFonts(d) {
    const characters=Object.values(d).join('')+'他的资料她的资料出生年份身高民族婚姻状况学历工作月收入资产家庭情况红娘评价择偶要求编号未填写';
    await Promise.all([400,500,700].map(w=>document.fonts.load(`${w} 24px ${FONT}`,characters)));
    await document.fonts.ready;
  }
  function scheduleLive() {
    clearTimeout(liveTimer);liveTimer=setTimeout(async()=>{
      if(disposed||state.busy||state.view!=='edit')return;
      const revision=state.revision;
      try {
        quietValidation=true;const d=data();quietValidation=false;
        await readyFonts(d);const theme=themeFor(d.gender),background=await loadBackground(theme.key);
        if(disposed||revision!==state.revision||state.busy||!background)return;
        if(state.privacy==='cover'&&!state.avatar)state.avatar=await loadAvatar(theme.key);
        if(disposed||revision!==state.revision||state.busy)return;
        quietValidation=true;const layout=layoutCard(d);quietValidation=false;d.number=bridge.record?.number;renderCard(d,{...state.transform},theme,background,layout);
        const live=$('liveCard');live.getContext('2d').clearRect(0,0,W,H);live.getContext('2d').drawImage(canvas,0,0);live.hidden=false;
        $('liveStatus').textContent='实时预览 · 保存前仍可调整照片展示方式';
      }catch(e){if(!disposed){$('liveCard').hidden=true;$('liveStatus').textContent=e.message;}}finally{quietValidation=false;}
    },180);
  }
  const avatarCache = new Map();
  const editor = $('maskEditor'), editorCtx = editor.getContext('2d');
  let avatarLoading = false, maskDrag = null;
  function loadAvatar(key) {
    if (!avatarCache.has(key)) avatarCache.set(key, new Promise((resolve, reject) => {
      const source = '/brand/' + key + '-avatar.png', image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { avatarCache.delete(key); reject(new Error('卡通头像加载失败，请重试或明确选择保留原照。')); };
      if (!source) { reject(new Error('卡通头像资源缺失，请重试或明确选择保留原照。')); return; }
      image.src = source;
    }));
    return avatarCache.get(key);
  }
  function controls() {
    for (const el of root.querySelectorAll('#cardForm input, #cardForm select, #cardForm textarea, #cardForm button')) el.disabled = state.busy;
    for (const id of ['zoom','centerPhoto','resetPhoto']) $(id).disabled=state.busy||!state.photo;
    const covered = state.privacy === 'cover';
    $('generate').disabled = state.busy || state.pending > 0;
    $('generate').textContent = state.busy ? '正在处理…' : '生成卡片';
    $('saveCard').disabled = state.busy || avatarLoading || !state.preview || !state.privacy || (covered && (!state.mask || !state.avatar));
    $('saveCard').textContent = state.busy ? '正在保存…' : '保存并查看详情';
    $('saveDownload').disabled = $('saveCard').disabled;
    $('backToEdit').disabled = state.busy;
    $('privacyChoices').disabled = state.busy;

    $('maskControls').hidden = !covered;
    $('maskSize').disabled = state.busy || avatarLoading || !state.mask;
    $('repositionMask').disabled = state.busy || !state.mask;
    $('avatarLabel').textContent = gender() === '女' ? '使用女生卡通头像' : '使用男生卡通头像';
    editor.classList.toggle('cover-mode', covered);
    editor.tabIndex = covered ? 0 : -1;
    for (const radio of root.querySelectorAll('[name=privacy]')) radio.checked = radio.value === state.privacy;
    if (state.mask) { $('maskSize').value = state.mask.size; $('maskSizeValue').value = Math.round(state.mask.size) + ' px'; }
  }
  function showView(view) {
    state.view = view;
    $('cardForm').hidden = view === 'preview'; $('previewPage').hidden = view !== 'preview';
    root.classList.toggle('previewing', view === 'preview');
    controls();
  }
  function updatePreview() {
    if (!state.preview) return;
    const { d, transform, theme, background, layout } = state.preview;
    d.number = bridge.record?.number || null;
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
    state.privacy = value; state.revision++; bridge.dirty(true); const token = ++state.privacyToken;
    avatarLoading = value === 'cover' && !state.avatar; controls(); updatePreview();
    if (avatarLoading) status('正在读取卡通头像…');
    if (value === 'original') { status('已保留原照，检查卡片后点击保存下载。'); return; }
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
      const d = data(); await readyFonts(d);
      const theme = themeFor(d.gender), background = await loadBackground(theme.key);
      if (!background) throw new Error('当前主题底图加载失败，请检查工具资源后重试。');
      const layout = layoutCard(d);
      await persistDraft(d, revision);
      if (revision !== state.revision) throw new Error('资料已变化，请重新点击生成。');
      state.preview = { d, transform: { ...state.transform }, theme, background, layout, revision };
      updatePreview(); showView('preview');

      $('previewTitle').focus(); window.scrollTo(0, 0);
      status(state.privacy ? '请检查卡片内容后保存下载。' : '请选择卡通遮挡或保留原照。');
    } catch (error) { status(error.message || '生成失败，请检查资料。', true); }
    finally { state.busy = false; controls(); }
    if (state.view === 'preview' && state.privacy === 'cover') await selectPrivacy('cover');
  }
  async function saveCard(withDownload = false) {
    if ($('saveCard').disabled || state.busy || !state.preview) return;
    state.busy = true; controls();
    try {
      if(lastSavedRevision !== state.revision) {
        if (!pendingConfirm || pendingConfirm.revision !== state.revision) {
          updatePreview();
          const png=await blobOf(canvas), thumb=document.createElement('canvas');thumb.width=480;thumb.height=360;thumb.getContext('2d').drawImage(canvas,0,0,480,360);
          pendingConfirm={revision:state.revision,png,thumb:await blobOf(thumb,'image/jpeg',.9),body:{operationId:crypto.randomUUID(),version:bridge.record.version,editor:snapshotEditor(),cardId:crypto.randomUUID(),thumbId:crypto.randomUUID()}};
        }
        const task=pendingConfirm;
        await bridge.upload(bridge.record.id,task.body.cardId,'card',task.png);
        await bridge.upload(bridge.record.id,task.body.thumbId,'thumb',task.thumb);
        const saved=await bridge.send('POST','/members/'+bridge.record.id+'/confirm',task.body);
        bridge.record={...bridge.record,...saved,status:'confirmed'};lastSavedRevision=task.revision;pendingConfirm=null;bridge.dirty(false);bridge.saved();
      }
      if (withDownload) await bridge.download(bridge.record.id);
      if (!withDownload) bridge.done(bridge.record.id);
      else status('成品已保存到工作台，并已发起下载。');
    } catch(error){status(error.message||'保存失败，当前预览已保留，请重试。',true);}
    finally{state.busy=false;controls();}
  }
  $('saveCard').onclick=()=>saveCard(false);
  $('saveDownload').onclick=()=>saveCard(true);
  $('backToEdit').onclick=()=>{if(!state.busy){showView('edit');$('generate').focus();}};
  for (const radio of root.querySelectorAll('[name=privacy]')) radio.onchange = () => selectPrivacy(radio.value);
  function maskPoint(event) {
    const rect = editor.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width - LAYOUT.photo.x, y: (event.clientY - rect.top) * H / rect.height - LAYOUT.photo.y };
  }
  function moveMask(x, y) {
    state.mask.x = Math.max(0, Math.min(PW, x)); state.mask.y = Math.max(0, Math.min(PH, y));
    state.revision++; bridge.dirty(true); updatePreview(); status('请检查面部已完整遮住，再保存下载。');
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
  $('maskSize').oninput = () => { if (!state.busy && state.mask) { state.mask.size = Number($('maskSize').value); state.revision++; bridge.dirty(true); updatePreview(); } };
  $('repositionMask').onclick = () => { if (!state.busy) { state.mask = defaultMask(); state.revision++; bridge.dirty(true); updatePreview(); status('已恢复默认位置，请调整头像确保遮住面部。'); } };
  $('cardForm').addEventListener('submit', generate);
  $('cardForm').addEventListener('input', event => { if (event.target.type !== 'file') changed(); });
  $('photo').addEventListener('change', uploadPhoto);
  $('uploadPhoto').onclick = () => $('photo').click();
  $('zoom').addEventListener('input', () => { invalidateMask(); state.transform.zoom = Number($('zoom').value) / 100; changed(); drawCrop(); });
  $('centerPhoto').onclick = () => { invalidateMask(); state.transform.x = 0; state.transform.y = 0; changed(); drawCrop(); };
  $('resetPhoto').onclick = () => { invalidateMask(); state.transform = { zoom: 1, x: 0, y: 0 }; changed(); drawCrop(); };
  let drag = null;
  crop.addEventListener('pointerdown', event => { if (state.busy || !state.photo) return; crop.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY }; });
  crop.addEventListener('pointermove', event => { if (state.busy || !drag || !state.photo) return; invalidateMask(); const rect = crop.getBoundingClientRect(); state.transform.x += (event.clientX - drag.x) * PW / rect.width; state.transform.y += (event.clientY - drag.y) * PH / rect.height; drag = { x: event.clientX, y: event.clientY }; changed(); drawCrop(); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) crop.addEventListener(name, () => { drag = null; });
  crop.addEventListener('keydown', event => { if (state.busy || !state.photo || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); invalidateMask(); const step = event.shiftKey ? 20 : 3; state.transform.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; state.transform.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0; changed(); drawCrop(); });
  $('reset').onclick = () => { if(!state.busy) bridge.next(); };
  async function hydrate() {
    const record=bridge.record;
    if(record) {
      for(const [key,value] of Object.entries(record.profile || {})) {
        if(key==='gender') continue;
        if(key==='edu') { const el=$('edu'); if(!Array.from(el.options).some(o=>o.value===value)){el.value='其他';$('eduOther').value=value;}else el.value=value; }
        else if($(key)) $(key).value=value;
      }
      for(const el of root.querySelectorAll('[name=gender]'))el.checked=el.value===record.gender;
      if(record.editor?.transform)state.transform={...record.editor.transform};
      state.privacy=record.editor?.privacy || '';state.mask=record.editor?.mask && {...record.editor.mask};
      if(record.photoId){state.busy=true;controls();try{const response=await bridge.photo(record.photoId); const file=new File([response],'photo.jpg',{type:response.type});const decoded=await decodeFile(file);if(disposed){release(decoded);return;}state.photo=decoded;$('uploadPhoto').textContent='更换照片';}catch(e){photoMessage(e.message,true);}finally{state.busy=false;}}
    }
    if(disposed)return;
    lastName=$('memberName').value.trim();lastGender=gender();sync();drawCrop();syncNumber();controls();scheduleLive();
  }
  sync();drawCrop();syncNumber();hydrate();
  return () => {disposed=true;clearTimeout(liveTimer);state.photoToken++;state.privacyToken++;release(state.photo);};
}
