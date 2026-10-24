import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceInfo} from '../../src/server/photo-sources';

function asArrayBuffer(bytes:Uint8Array){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;}
function bytes(length:number){return new Uint8Array(length);}
function text(b:Uint8Array,at:number,value:string){for(let i=0;i<value.length;i++)b[at+i]=value.charCodeAt(i);}

function png(){const b=bytes(33);b.set([137,80,78,71,13,10,26,10]);new DataView(b.buffer).setUint32(8,13);text(b,12,'IHDR');new DataView(b.buffer).setUint32(16,1254);new DataView(b.buffer).setUint32(20,1254);return b;}
function jpeg(){const b=bytes(21);b.set([255,216,255,192,0,17,8,4,230,4,230,3,1,17,0,2,17,0,3,17,0]);return b;}
function gif(){const b=bytes(10);text(b,0,'GIF89a');new DataView(b.buffer).setUint16(6,640,true);new DataView(b.buffer).setUint16(8,480,true);return b;}
function webp(){const b=bytes(30);text(b,0,'RIFF');new DataView(b.buffer).setUint32(4,999,true);text(b,8,'WEBP');text(b,12,'VP8X');b[24]=127;b[27]=239;return b;}
function bmp(){const b=bytes(54);text(b,0,'BM');new DataView(b.buffer).setUint32(2,999,true);new DataView(b.buffer).setInt32(18,800,true);new DataView(b.buffer).setInt32(22,600,true);return b;}
function iso(brand:string){const b=bytes(44);new DataView(b.buffer).setUint32(0,44);text(b,4,'ftyp');text(b,8,brand);new DataView(b.buffer).setUint32(20,20);text(b,24,'ispe');new DataView(b.buffer).setUint32(32,1200);new DataView(b.buffer).setUint32(36,1600);return b;}
function tiff(){const b=bytes(34);text(b,0,'II');b[2]=42;new DataView(b.buffer).setUint32(4,8,true);new DataView(b.buffer).setUint16(8,2,true);for(const [i,tag,value] of [[0,256,900],[1,257,1200]]){const p=10+i*12;new DataView(b.buffer).setUint16(p,tag,true);new DataView(b.buffer).setUint16(p+2,4,true);new DataView(b.buffer).setUint32(p+4,1,true);new DataView(b.buffer).setUint32(p+8,value,true);}return b;}

test('accepts browser-decodable raster headers when trailing container markers or declared lengths are missing',()=>{
 const cases:[string,Uint8Array,string,number,number][]=[
  ['incomplete JPEG',jpeg(),'image/jpeg',1254,1254],['PNG without IEND',png(),'image/png',1254,1254],
  ['GIF without trailer',gif(),'image/gif',640,480],['WebP with stale RIFF length',webp(),'image/webp',128,240],
  ['BMP with stale file length',bmp(),'image/bmp',800,600],['AVIF without container tail',iso('avif'),'image/avif',1200,1600],
  ['HEIF without container tail',iso('heic'),'image/heif',1200,1600],['TIFF without pixel data',tiff(),'image/tiff',900,1200]
 ];
 for(const [label,fixture,type,width,height] of cases){assert.deepEqual(sourceInfo(asArrayBuffer(fixture)),{type,width,height},label);}
});

test('rejects truncated headers without usable dimensions and dimensions outside limits',()=>{
 assert.throws(()=>sourceInfo(asArrayBuffer(new Uint8Array([255,216,255,192,0,17]))),/原文件格式或尺寸无效/);
 const oversized=png();new DataView(oversized.buffer).setUint32(16,10000);new DataView(oversized.buffer).setUint32(20,6000);
 assert.throws(()=>sourceInfo(asArrayBuffer(oversized)),/原文件格式或尺寸无效/);
});
