const WHITE = '#ffffff';

const LIMBS = [

  [11, 12, 7, WHITE],

  ['shoulder_mid', 'hip_mid', 7, WHITE],

  [23, 24, 7, WHITE],

  ['head', 'shoulder_mid', 5, WHITE],

  [11, 13, 6, WHITE],
  [13, 15, 5, WHITE],

  [12, 14, 6, WHITE],
  [14, 16, 5, WHITE],

  [23, 25, 7, WHITE],
  [25, 27, 6, WHITE],

  [24, 26, 7, WHITE],
  [26, 28, 6, WHITE],
];

const HEAD_RADIUS = 16;
const HEAD_COLOR = WHITE;

let canvas = null;
let ctx = null;

export function initBlockRenderer() {
  if (ctx) return true;
  canvas = document.createElement('canvas');
  ctx = canvas.getContext('2d');
  return !!ctx;
}

export function renderBlockCharacter(landmarks, w, h) {
  if (!ctx || !landmarks || landmarks.length < 29) return canvas;

  const dpr = 2;
  const cw = w * dpr, ch = h * dpr;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pt = (i) => {
    const l = landmarks[i];
    return l ? [l.x * w, l.y * h] : null;
  };

  const shoulderMid = mid(pt(11), pt(12));
  const hipMid = mid(pt(23), pt(24));

  const syn = {
    shoulder_mid: shoulderMid,
    hip_mid: hipMid,
    head: pt(0),
  };

  const resolve = (ref) => typeof ref === 'number' ? pt(ref) : syn[ref];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [from, to, lw, color] of LIMBS) {
    const p1 = resolve(from);
    const p2 = resolve(to);
    if (!p1 || !p2) continue;

    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  const headPt = pt(0);
  if (headPt) {
    ctx.beginPath();
    ctx.arc(headPt[0], headPt[1], HEAD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = HEAD_COLOR;
    ctx.fill();
  }

  return canvas;
}

export function drawDancer(ctx, landmarks, w, h, color, alpha = 1) {
  if (!landmarks || landmarks.length < 29) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  const pt = (i) => {
    const l = landmarks[i];
    return l ? [l.x * w, l.y * h] : null;
  };

  const shoulderMid = mid(pt(11), pt(12));
  const hipMid = mid(pt(23), pt(24));
  const syn = { shoulder_mid: shoulderMid, hip_mid: hipMid, head: pt(0) };
  const resolve = (ref) => typeof ref === 'number' ? pt(ref) : syn[ref];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [from, to, lw] of LIMBS) {
    const p1 = resolve(from);
    const p2 = resolve(to);
    if (!p1 || !p2) continue;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  const headPt = pt(0);
  if (headPt) {
    ctx.beginPath();
    ctx.arc(headPt[0], headPt[1], HEAD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  ctx.restore();
}

export function disposeBlockRenderer() {
  ctx = null;
  canvas = null;
}

function mid(a, b) {
  if (!a || !b) return a || b || null;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
