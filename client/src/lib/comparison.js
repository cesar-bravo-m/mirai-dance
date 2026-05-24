export const DEFAULT_SEGMENTS = [
  // TODO: Legs are not scored!!! This is temporary until I figure out a solution
  { from: 11, to: 13, weight: 1 },
  { from: 13, to: 15, weight: 1 },
  { from: 12, to: 14, weight: 1 },
  { from: 14, to: 16, weight: 1 },
];

export const DEFAULT_TOLERANCE = 200; // degrees

function limbAngle(landmarks, a, b) {
  return Math.atan2(landmarks[b].y - landmarks[a].y, landmarks[b].x - landmarks[a].x);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

export function comparePoses(detected, reference, options = {}) {
  const {
    tolerance = DEFAULT_TOLERANCE,
    segments = DEFAULT_SEGMENTS,
  } = options;

  const tolRad = tolerance * Math.PI / 180;
  let scoreSum = 0;
  let weightSum = 0;
  const limbs = [];

  for (const seg of segments) {
    const w = seg.weight ?? 1;
    const detectedAngle = limbAngle(detected, seg.from, seg.to);
    const referenceAngle = limbAngle(reference, seg.from, seg.to);
    const diff = angleDiff(detectedAngle, referenceAngle);
    const limbScore = Math.max(0, 1 - diff / tolRad);

    scoreSum += limbScore * w;
    weightSum += w;

    limbs.push({
      from: seg.from,
      to: seg.to,
      diff: diff * 180 / Math.PI, // degrees
      score: limbScore,
    });
  }

  return {
    score: weightSum > 0 ? scoreSum / weightSum : 0,
    limbs,
  };
}
