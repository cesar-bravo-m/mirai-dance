export const DRAW_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [0, 11], [0, 12],
];

export const BODY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const JOINT_COLORS = {
  face: "#ffdd57", arm: "#00d2ff", torso: "#ff6b6b",
  leg: "#51cf66", hand: "#cc5de8", foot: "#ff922b",
};

function jointCat(i) {
  if (i <= 10) return "face";
  if (i <= 16) return "arm";
  if (i >= 17 && i <= 22) return "hand";
  if (i === 23 || i === 24) return "torso";
  if (i <= 28) return "leg";
  return "foot";
}

function limbColor(a, b) {
  const ca = jointCat(a), cb = jointCat(b);
  for (const c of ["hand", "foot", "arm", "leg", "torso", "face"])
    if (ca === c || cb === c) return JOINT_COLORS[c];
  return "#fff";
}

export function drawGrid(ctx, w, h) {
  ctx.fillStyle = "#0f0f23";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

export function drawSkeleton(ctx, pts, w, h, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha ?? 1;

  for (const [a, b] of DRAW_CONNECTIONS) {
    if ((pts[a].v ?? 1) < 0.3 || (pts[b].v ?? 1) < 0.3) continue;
    const ax = pts[a].x * w, ay = pts[a].y * h;
    const bx = pts[b].x * w, by = pts[b].y * h;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = limbColor(a, b);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  for (const i of BODY_JOINTS) {
    if ((pts[i].v ?? 1) < 0.3) continue;
    const x = pts[i].x * w, y = pts[i].y * h;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = JOINT_COLORS[jointCat(i)];
    ctx.fill();
  }

  if ((pts[0].v ?? 1) > 0.3) {
    ctx.beginPath();
    ctx.arc(pts[0].x * w, pts[0].y * h, 16, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pts[0].x * w, pts[0].y * h, 16, 0, Math.PI * 2);
    ctx.strokeStyle = JOINT_COLORS.face;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}

export function drawDetectedPose(ctx, w, h, landmarks, mirror = true) {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks || landmarks.length === 0) return;
  for (const lm of landmarks) {
    const pts = lm.map(l => ({ x: mirror ? 1 - l.x : l.x, y: l.y, v: l.visibility ?? 0 }));
    drawSkeleton(ctx, pts, w, h, 1);
  }
}

export function drawTargetPose(ctx, w, h, pose, matchPct, threshold) {
  ctx.clearRect(0, 0, w, h);
  drawGrid(ctx, w, h);
  if (!pose) {
    ctx.fillStyle = "#555";
    ctx.font = "20px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Next pose...", w / 2, h / 2);
    return;
  }
  drawSkeleton(ctx, pose.joints, w, h, 0.5 + matchPct * 0.5);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(pose.name, w / 2, h - 16);
  if (matchPct >= threshold) {
    ctx.save();
    ctx.strokeStyle = "#51cf66";
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.3 + 0.7 * ((matchPct - threshold) / (1 - threshold));
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.restore();
  }
}
