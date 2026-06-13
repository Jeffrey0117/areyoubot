"use strict";(()=>{var h=String.raw`
var K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
var enc = new TextEncoder();
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256Bytes(input) {
  var msg = enc.encode(input);
  var bitLen = msg.length * 8;
  var withOne = msg.length + 1;
  var totalLen = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  var padded = new Uint8Array(totalLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  var dv = new DataView(padded.buffer);
  dv.setUint32(totalLen - 8, (Math.floor(bitLen / 0x100000000)) >>> 0);
  dv.setUint32(totalLen - 4, bitLen >>> 0);
  var h = new Int32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  ]);
  var w = new Int32Array(64);
  for (var off = 0; off < totalLen; off += 64) {
    for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (var i = 16; i < 64; i++) {
      var s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
      var s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for (var i = 0; i < 64; i++) {
      var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h[0]=(h[0]+a)|0; h[1]=(h[1]+b)|0; h[2]=(h[2]+c)|0; h[3]=(h[3]+d)|0;
    h[4]=(h[4]+e)|0; h[5]=(h[5]+f)|0; h[6]=(h[6]+g)|0; h[7]=(h[7]+hh)|0;
  }
  var out = new Uint8Array(32);
  var ov = new DataView(out.buffer);
  for (var i = 0; i < 8; i++) ov.setUint32(i * 4, h[i] >>> 0);
  return out;
}
function leadingZeroBits(bytes) {
  var count = 0;
  for (var i = 0; i < bytes.length; i++) {
    var byte = bytes[i];
    if (byte === 0) { count += 8; continue; }
    var mask = 0x80;
    while (mask > 0 && (byte & mask) === 0) { count++; mask >>= 1; }
    break;
  }
  return count;
}
function solvePow(token, difficulty) {
  for (var n = 0; ; n++) {
    var s = String(n);
    if (leadingZeroBits(sha256Bytes(token + ':' + s)) >= difficulty) return s;
  }
}
self.onmessage = function (ev) {
  var token = ev.data.token;
  var difficulty = ev.data.difficulty;
  try {
    var solution = solvePow(token, difficulty);
    self.postMessage({ solution: solution });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
`;(()=>{let b="areyoubot-token";function v(){let t=document.currentScript??null;if(!t)return null;let r=t.getAttribute("data-ayb-sitekey");if(!r)return null;let n="";try{n=new URL(t.src,window.location.href).origin}catch{n=window.location.origin}return{sitekey:r,base:n,callback:t.getAttribute("data-ayb-callback"),badge:t.getAttribute("data-ayb-badge")!=="off",script:t}}function m(){let t=document.createElement("div");Object.assign(t.style,{position:"fixed",right:"12px",bottom:"12px",zIndex:"2147483647",display:"inline-flex",alignItems:"center",gap:"6px",padding:"6px 10px",borderRadius:"8px",fontFamily:"system-ui, -apple-system, Segoe UI, sans-serif",fontSize:"12px",lineHeight:"1",color:"#1f2937",background:"#ffffff",border:"1px solid #e5e7eb",boxShadow:"0 1px 3px rgba(0,0,0,0.12)",userSelect:"none"});let r=document.createElement("span");r.textContent="are you bot? \u{1F60F}";let n=document.createElement("span");n.style.fontWeight="600",t.appendChild(r),t.appendChild(n);let e=a=>{a==="solving"?(n.textContent="checking\u2026",n.style.color="#6b7280"):a==="verified"?(n.textContent="\u2713 verified",n.style.color="#16a34a"):a==="error"?(n.textContent="\u26A0 retry",n.style.color="#dc2626"):n.textContent=""};return e("idle"),{el:t,set:e}}function p(t){let r=t?.closest("form");return r||document.querySelector("form")}function w(t,r){let n=t.querySelector(`input[name="${b}"]`);if(n){n.value=r;return}let e=document.createElement("input");e.type="hidden",e.name=b,e.value=r,t.appendChild(e)}function y(t,r){return new Promise((n,e)=>{let a="",l=null,s=()=>{l&&l.terminate(),a&&URL.revokeObjectURL(a)};try{let o=new Blob([h],{type:"text/javascript"});a=URL.createObjectURL(o),l=new Worker(a)}catch(o){s(),e(o instanceof Error?o:new Error(String(o)));return}l.onmessage=o=>{let{solution:c,error:i}=o.data;s(),typeof c=="string"?n(c):e(new Error(i??"worker failed"))},l.onerror=o=>{s(),e(new Error(o.message||"worker error"))},l.postMessage({token:t,difficulty:r})})}function x(t){let r=p(t.script),n=t.badge?m():null;n&&document.body.appendChild(n.el);let e={ready:!1,token:null,fullToken:null,expiresAt:0,inFlight:null};async function a(){let i=await fetch(`${t.base}/api/challenge?sitekey=${encodeURIComponent(t.sitekey)}`,{method:"GET"});if(!i.ok)throw new Error(`challenge request failed: ${i.status}`);return await i.json()}async function l(){n?.set("solving");let i=await a(),d=await y(i.token,i.difficulty),f=`${i.token}.${d}`;if(e.token=i.token,e.fullToken=f,e.expiresAt=Date.now()+i.ttl,e.ready=!0,r&&w(r,f),n?.set("verified"),t.callback){let g=window[t.callback];typeof g=="function"&&g(f)}return f}function s(){return!e.fullToken||Date.now()>=e.expiresAt}function o(){if(e.inFlight)return e.inFlight;let i=l().catch(d=>{throw n?.set("error"),d}).finally(()=>{e.inFlight=null});return e.inFlight=i,i}function c(){return s()?(e.ready=!1,o()):Promise.resolve(e.fullToken)}r&&r.addEventListener("submit",i=>{s()&&(i.preventDefault(),c().then(()=>{r.requestSubmit?r.requestSubmit():r.submit()}).catch(()=>{}))}),window.areyoubot={get ready(){return e.ready&&!s()},solve(){return c()},getToken(){return s()?null:e.fullToken}},o().catch(()=>{}),window.setInterval(()=>{s()&&!e.inFlight&&o().catch(()=>{})},15e3)}let u=v();u&&(document.body?x(u):document.addEventListener("DOMContentLoaded",()=>x(u),{once:!0}))})();})();
