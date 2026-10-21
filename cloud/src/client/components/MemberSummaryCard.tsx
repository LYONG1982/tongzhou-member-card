import React, {useEffect, useRef, useState} from 'react';

export type PortraitTransform = {x:number; y:number; zoom:number};
export type MemberSummary = {
  id:string; number:string; name:string; gender:string; birth:string;
  height:number | null; marital:string; edu:string; ethnic:string | null;
  photo_id:string | null; template:string | null; transform:PortraitTransform | null;
};

// Match the saved figma-v1 editor viewport, including clamping at image edges.
// x/y are viewport pixels, not source-image pixels or CSS percentages.
export function portraitGeometry(width:number, height:number, transform:PortraitTransform) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      !transform || ![transform.x, transform.y, transform.zoom].every(Number.isFinite) ||
      transform.zoom < 1 || transform.zoom > 3 || Math.abs(transform.x) > 100000 || Math.abs(transform.y) > 100000) {
    throw new Error('照片构图无效');
  }
  const scale = Math.max(612 / width, 816 / height) * transform.zoom;
  const w = width * scale, h = height * scale;
  const x = Math.max(-(w - 612) / 2, Math.min((w - 612) / 2, transform.x));
  const y = Math.max(-(h - 816) / 2, Math.min((h - 816) / 2, transform.y));
  return {x:(612 - w) / 2 + x, y:(816 - h) / 2 + y, width:w, height:h};
}

export function Portrait({member}:{member:MemberSummary}) {
  const frame = useRef<HTMLSpanElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'waiting'|'ready'|'error'>('waiting');
  const [message, setMessage] = useState('');
  const {photo_id:photoId, template, transform} = member;
  useEffect(() => {
    let disposed = false, started = false, objectUrl:string | undefined;
    const controller = new AbortController();
    setState('waiting'); setMessage('');
    const ctx = canvas.current?.getContext('2d');
    ctx?.clearRect(0, 0, 612, 816);
    // A missing upload is a normal state, distinct from a failed private-media request.
    if (!photoId) return;
    async function load() {
      if (started || !photoId) return;
      started = true;
      try {
        if (template !== 'figma-v1' || !transform) throw new Error('照片构图暂不可用');
        portraitGeometry(612, 816, transform);
        const response = await fetch('/api/media/' + encodeURIComponent(photoId), {
          credentials:'same-origin', cache:'no-store', signal:controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
          throw new Error('照片加载失败，进入详情重试');
        }
        const blob = await response.blob();
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        const photo = new Image();
        photo.src = objectUrl;
        await photo.decode();
        if (disposed) return;
        const g = portraitGeometry(photo.naturalWidth, photo.naturalHeight, transform);
        if (!ctx) throw new Error('当前浏览器无法显示照片');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(photo, g.x, g.y, g.width, g.height);
        setState('ready');
      } catch (error) {
        if (!disposed) {setMessage((error as Error).message); setState('error');}
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    }
    // Only decode portraits near the viewport, not all sixteen original files.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {observer.disconnect(); void load();}
    }, {rootMargin:'100px'});
    if (frame.current) observer.observe(frame.current);
    return () => {disposed = true; controller.abort(); observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [photoId, template, transform?.x, transform?.y, transform?.zoom]);

  const defaultAvatar = member.gender === '男' ? 'male' : member.gender === '女' ? 'female' : null;
  return <span className="member-portrait" ref={frame} data-photo-state={!photoId ? 'missing' : state}>
    <canvas ref={canvas} width={612} height={816} role="img" aria-label={member.name + '的原照（已按编辑构图裁剪）'} hidden={!photoId || state !== 'ready'}/>
    {!photoId ? (defaultAvatar
      ? <img className="portrait-default" src={'/brand/' + defaultAvatar + '-avatar.png'} alt={(member.gender === '男' ? '男生' : '女生') + '默认头像（未上传照片）'}/>
      : <span className="portrait-placeholder"><img src="/brand/member-photo-missing.svg" alt="未上传照片，性别未填写" width={282} height={352.5}/></span>
    ) : state !== 'ready' && <span className="portrait-placeholder" aria-live="polite">
      <img src="/brand/member-photo-missing.svg" alt="" width={282} height={352.5}/>
      <span>{state === 'error' ? message : '正在加载照片…'}</span>
    </span>}
    {(member.gender === '男' || member.gender === '女') && <span className={'gender-corner ' + (member.gender === '女' ? 'female' : 'male')}>{member.gender === '女' ? '女生' : '男生'}</span>}
  </span>;
}

export default function MemberSummaryCard({member, onOpen}:{member:MemberSummary; onOpen:()=>void}) {
  const summary = [member.height ? member.height + 'cm' : '身高未填写', member.marital || '婚况未填写', member.edu || '学历未填写', member.ethnic || '民族未填写'].join(' · ');
  return <article className="member-summary-card">
    <button className="member-summary-link" onClick={onOpen} aria-label={'查看 ' + member.name + '，' + member.number}>
      <Portrait member={member}/>
      <span className="member-summary-info">
        <span className="member-summary-title">
          <span className="member-summary-name" title={member.name}>{member.name || '姓名未填写'}</span>
          <span className="member-summary-birth">{member.birth ? member.birth + '年' : '未填写'}</span>
          <span className="member-summary-number">{member.number}</span>
        </span>
        <span className="member-summary-facts" title={summary}>{summary}</span>
      </span>
    </button>
  </article>;
}
