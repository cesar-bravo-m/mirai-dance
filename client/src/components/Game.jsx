import { useEffect, useRef, useState, useCallback } from 'react';
import usePosePlayback from '../hooks/usePosePlayback';
import { comparePoses } from '../lib/comparison';
import { drawSkeleton } from '../lib/drawing';
import { renderBlockCharacter } from '../lib/blockRenderer';
import REMOTE_ASSETS from '../remote_assets.json';

const BAR_H = 240;
const BOX_W = 200;
const BOX_H = 210;
const PAD = 24;
const BOX_GAP = 14;
const CONV_GAP = 36;
const THUMB_W = 180;
const THUMB_H = 200;
const THUMB_GAP = 56;
const MAX_SCORE = 1_000_000;

const VISUAL_BEAT_INTERVAL_CAP = 1.6;

const SCORE_TAU_RISE = 0.18;
const SCORE_TAU_FALL = 1.40;

function findFrameAtTime(poseData, time) {
  if (!poseData?.frames?.length) return null;
  const frames = poseData.frames;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

function buildEvalBeats(poseData, savedData) {
  let evalBeats;
  let endEarlyTime = null;

  if (savedData?.timestamps?.length) {
    evalBeats = [...savedData.timestamps].sort((a, b) => a - b);
    endEarlyTime = savedData.endEarly ?? null;
    if (endEarlyTime != null) evalBeats = evalBeats.filter(t => t <= endEarlyTime);
  } else {
    const beatOffset = poseData?.beatOffset || 0;
    let rawBeats;
    if (poseData?.beats?.length >= 4) {
      rawBeats = poseData.beats;
    } else {
      const beatInterval = poseData?.bpm ? (60 / poseData.bpm) : 0.5;
      const duration = poseData?.duration || 300;
      rawBeats = [];
      for (let t = beatOffset + beatInterval; t < duration; t += beatInterval) rawBeats.push(t);
    }
    evalBeats = rawBeats.filter((_, i) => (i + 1) % 4 === 0);
  }

  const goldenSet = new Set();
  const specialSet = new Set();
  for (let i = 0; i < evalBeats.length; i++) {
    const n = i + 1;
    if (n % 8 === 0) specialSet.add(evalBeats[i]);
    else if (n % 4 === 0) goldenSet.add(evalBeats[i]);
  }
  return { evalBeats, goldenSet, specialSet, endEarlyTime };
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawMiniGrid(ctx, w, h, step) {
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function drawUserBox(ctx, x, y, w, h, landmarks, cameraVideo) {
  ctx.save();

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fillStyle = '#08121f';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.clip();
  ctx.translate(x, y);

  if (cameraVideo && cameraVideo.readyState >= 2) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(cameraVideo, 0, 0, w, h);
    ctx.restore();
  } else {
    drawMiniGrid(ctx, w, h, 24);
  }

  if (landmarks?.length > 0) {
    for (const lm of landmarks) {
      const pts = lm.map(l => ({ x: 1 - l.x, y: l.y, v: l.visibility ?? 0 }));
      drawSkeleton(ctx, pts, w, h, 1);
    }
  }
  ctx.restore();
  ctx.restore();
}

function drawRefBox(ctx, x, y, w, h, landmarks) {
  ctx.save();

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fillStyle = '#0a1c10';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.clip();
  ctx.translate(x, y);

  if (landmarks?.length > 0 && landmarks[0]) {
    const offscreen = renderBlockCharacter(landmarks[0], w, h);
    if (offscreen) ctx.drawImage(offscreen, 0, 0, w, h);
  }
  ctx.restore();
  ctx.restore();
}

function drawConveyorItem(ctx, x, y, w, h, landmarks, alpha, isNext, golden, special) {
  if (!landmarks || landmarks.length === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  if (special) {
    ctx.shadowColor = '#cc5de8';
    ctx.shadowBlur = 24;
  } else if (golden) {
    ctx.shadowColor = '#ffd54a';
    ctx.shadowBlur = 20;
  } else if (isNext) {
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
  }

  const off = renderBlockCharacter(landmarks, w, h);
  if (off) ctx.drawImage(off, x, y, w, h);

  ctx.restore();
}

export default function Game({ song, userLandmarks, cameraVideoRef, onExit }) {
  const videoRef = useRef(null);
  const barRef = useRef(null);

  const dancers = song.payload?.dancers ?? [];
  const dancerIndex = Math.min(Math.max(song.dancerIndex ?? 0, 0), dancers.length - 1);
  const poseData = dancers[dancerIndex] ?? null;
  const savedTimestamps = song.payload?.timestamps ?? null;

  const { landmarksRef: refLandmarks } = usePosePlayback(poseData, videoRef);

  const [phase, setPhase] = useState('ready');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [countdown, setCountdown] = useState(null);
  const [hud, setHud] = useState({ score: 0, accuracy: 0, time: '0:00', cal: 0 });
  const [judgment, setJudgment] = useState(null);
  const [streamReady, setStreamReady] = useState(false);

  const [showSkeleton, setShowSkeleton] = useState(false);
  const showSkeletonRef = useRef(showSkeleton);
  showSkeletonRef.current = showSkeleton;
  const overlayCanvasRef = useRef(null);

  const scoreRef = useRef({ total: 0, simTotal: 0, samples: 0, current: 0, combo: 0, bestCombo: 0 });
  const dampedScoreRef = useRef(0);
  const scoreHistoryRef = useRef([]);
  const [scoreHistory, setScoreHistory] = useState([]);

  const specialSfxRef = useRef(null);
  const applauseSfxRef = useRef(null);

  useEffect(() => {
    specialSfxRef.current = new Audio(REMOTE_ASSETS.sounds.special);
    applauseSfxRef.current = new Audio(REMOTE_ASSETS.sounds.applause);
    specialSfxRef.current.preload = 'auto';
    applauseSfxRef.current.preload = 'auto';
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onReady = () => setStreamReady(true);
    if (v.readyState >= 1) onReady();
    v.addEventListener('loadedmetadata', onReady);
    v.addEventListener('canplay', onReady);
    return () => {
      v.removeEventListener('loadedmetadata', onReady);
      v.removeEventListener('canplay', onReady);
    };
  }, [song.videoUrl]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      const v = videoRef.current;
      if (v) v.play().catch(() => {});
      setPhase('playing');
      return;
    }
    const id = setTimeout(() => setCountdown(c => c - 1), 800);
    return () => clearTimeout(id);
  }, [countdown]);

  const startGame = useCallback(() => {
    scoreRef.current = { total: 0, simTotal: 0, samples: 0, current: 0, combo: 0, bestCombo: 0 };
    dampedScoreRef.current = 0;
    scoreHistoryRef.current = [];
    setHud({ score: 0, accuracy: 0, time: '0:00', cal: 0 });
    setJudgment(null);
    const v = videoRef.current;
    if (v) { v.currentTime = 0; v.muted = false; v.volume = 1; }
    setPhase('countdown');
    setCountdown(3);
  }, []);

  const handlePause = useCallback(() => {
    const v = videoRef.current;
    if (v) v.pause();
    setPhase('paused');
  }, []);

  const handleResume = useCallback(() => {
    setPhase('countdown');
    setCountdown(3);
  }, []);

  const handleRestart = useCallback(() => {
    const v = videoRef.current;
    if (v) v.pause();
    startGame();
  }, [startGame]);

  const handleEnd = useCallback(() => {
    const s = scoreRef.current;
    if (s.total >= 950_000) s.total = MAX_SCORE;
    setHud(h => ({ ...h, score: Math.round(s.total) }));
    setScoreHistory([...scoreHistoryRef.current]);
    setPhase('ended');
    const v = videoRef.current;
    if (v) v.pause();

    try {
      const elapsedMin = (v ? v.currentTime : 0) / 60;
      const avgMatch = s.samples > 0 ? s.simTotal / s.samples : 0;
      const runCal = elapsedMin * 7 * (0.5 + 0.5 * avgMatch);
      const prev = parseFloat(
        localStorage.getItem('mirai-dance.totalCalories') || '0',
      );
      const next = (Number.isFinite(prev) ? prev : 0) + runCal;
      localStorage.setItem('mirai-dance.totalCalories', String(next));
    } catch { /* localStorage unavailable */ }
  }, []);

  useEffect(() => {
    let rafId;
    let lastFlush = 0;
    let nextEvalIdx = 0;
    let lastCanvasW = 0;
    let lastDampTime = 0;

    const { evalBeats, goldenSet, specialSet, endEarlyTime } = buildEvalBeats(poseData, savedTimestamps);
    const N = evalBeats.length;
    const evalPoses = evalBeats.map(t => findFrameAtTime(poseData, t)?.landmarks || null);
    const beatInterval = evalBeats.length >= 2
      ? evalBeats[1] - evalBeats[0]
      : (poseData?.bpm ? (4 * 60 / poseData.bpm) : 2);
const VISIBILITY_THRESHOLD = 0.5;
const HAND_LANDMARK_IDX = [15, 16];
const LEG_LANDMARK_IDX = [25, 26, 27, 28];
function isOutOfFrame(landmarks) {
  if (!landmarks || landmarks.length === 0) return true;
  const anyHand = HAND_LANDMARK_IDX.some(
    (i) => (landmarks[i]?.visibility ?? 0) >= VISIBILITY_THRESHOLD,
  );
  const anyLeg = LEG_LANDMARK_IDX.some(
    (i) => (landmarks[i]?.visibility ?? 0) >= VISIBILITY_THRESHOLD,
  );
  return !anyHand && !anyLeg;
}

    const visualBeatInterval = Math.min(beatInterval, VISUAL_BEAT_INTERVAL_CAP);
    const slotSpacing = THUMB_W + THUMB_GAP;
    let ended = false;

    function tick() {
      if (ended) return;
      const video = videoRef.current;
      const currentTime = video ? video.currentTime : 0;

      if (endEarlyTime != null && currentTime >= endEarlyTime && phaseRef.current === 'playing') {
        ended = true;
        handleEnd();
        return;
      }

      if (video && video.ended && phaseRef.current === 'playing') {
        ended = true;
        handleEnd();
        return;
      }

      if (N > 0 && nextEvalIdx >= N && phaseRef.current === 'playing') {
        ended = true;
        handleEnd();
        return;
      }

      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        if (overlayCanvas.width !== winW * dpr || overlayCanvas.height !== winH * dpr) {
          overlayCanvas.width = winW * dpr;
          overlayCanvas.height = winH * dpr;
          overlayCanvas.style.width = winW + 'px';
          overlayCanvas.style.height = winH + 'px';
        }
        const octx = overlayCanvas.getContext('2d');
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.clearRect(0, 0, winW, winH);

        if (showSkeletonRef.current && video && video.videoWidth > 0 && video.videoHeight > 0) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const containerAR = winW / winH;
          const videoAR = vw / vh;
          let rectW, rectH, rectX, rectY;
          if (videoAR > containerAR) {
            rectW = winW;
            rectH = winW / videoAR;
            rectX = 0;
            rectY = (winH - rectH) / 2;
          } else {
            rectH = winH;
            rectW = winH * videoAR;
            rectX = (winW - rectW) / 2;
            rectY = 0;
          }
          const lm = refLandmarks.current;
          if (lm && lm.length > 0) {
            octx.save();
            octx.translate(rectX, rectY);
            for (const person of lm) {
              const pts = person.map(l => ({ x: l.x, y: l.y, v: l.visibility ?? 0 }));
              drawSkeleton(octx, pts, rectW, rectH, 0.85);
            }
            octx.restore();
          }
        }
      }

      const canvas = barRef.current;
      if (canvas) {
        const cw = window.innerWidth;
        const dpr = window.devicePixelRatio || 1;
        if (cw !== lastCanvasW) {
          canvas.width = cw * dpr;
          canvas.height = BAR_H * dpr;
          canvas.style.width = cw + 'px';
          canvas.style.height = BAR_H + 'px';
          lastCanvasW = cw;
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, BAR_H);

        ctx.fillStyle = 'rgba(7, 9, 22, 0.96)';
        ctx.fillRect(0, 0, cw, BAR_H);

        const boxY = (BAR_H - BOX_H) / 2 + 4;
        const youX = PAD;
        const refX = youX + BOX_W + BOX_GAP;
        const convStartX = refX + BOX_W + CONV_GAP;

        drawUserBox(
          ctx, youX, boxY, BOX_W, BOX_H,
          userLandmarks.current, cameraVideoRef.current,
        );
        drawRefBox(
          ctx, refX, boxY, BOX_W, BOX_H,
          refLandmarks.current,
        );

        if (phase === 'playing' || phase === 'paused' || phase === 'countdown') {
          let firstDrawn = true;
          let prevX = -Infinity;
          const overlapGuard = THUMB_W + 8;
          for (let i = nextEvalIdx; i < evalBeats.length; i++) {
            const timeUntil = evalBeats[i] - currentTime;
            if (timeUntil <= 0) continue;

            let x = refX + (timeUntil / visualBeatInterval) * slotSpacing;
            if (x - prevX < overlapGuard) x = prevX + overlapGuard;
            if (x > cw - PAD) break;

            const landmarks = evalPoses[i];
            if (!landmarks) { prevX = x; continue; }

            const distFactor = timeUntil / visualBeatInterval - 1;
            const alpha = Math.max(0.45, Math.min(1, 1.1 - distFactor * 0.18));
            const beatTime = evalBeats[i];
            drawConveyorItem(
              ctx, x, boxY, THUMB_W, THUMB_H, landmarks, alpha,
              firstDrawn, goldenSet.has(beatTime), specialSet.has(beatTime),
            );
            prevX = x;
            firstDrawn = false;
          }
        }

        if (phase === 'playing') {
          const sc = Math.max(0, Math.min(1, dampedScoreRef.current));
          const col = sc >= 0.6 ? '#51cf66'
            : sc >= 0.4 ? '#ffdd57'
            : sc >= 0.25 ? '#ff922b'
            : '#ff6b6b';

          const barH = 14;
          const barX = 0;
          const barY = 0;
          const barW = cw;

          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(barX, barY, barW, barH);

          const fillW = barW * sc;
          if (fillW > 0.5) {
            ctx.fillStyle = col;
            ctx.fillRect(barX, barY, fillW, barH);
          }
          ctx.restore();
        }
      }

      if (phase !== 'playing') {
        lastDampTime = 0;
      }
      if (phase === 'playing') {
        const uLm = userLandmarks.current;
        const vLm = refLandmarks.current;

        if (uLm?.length > 0 && vLm?.length > 0) {
          const result = comparePoses(uLm[0], vLm[0]);
          scoreRef.current.current = result.score;
        }

        const dampNow = performance.now();
        if (lastDampTime > 0) {
          const dt = Math.min(0.1, (dampNow - lastDampTime) / 1000);
          const instant = scoreRef.current.current;
          const damped = dampedScoreRef.current;
          const tau = instant > damped ? SCORE_TAU_RISE : SCORE_TAU_FALL;
          const alpha = 1 - Math.exp(-dt / tau);
          dampedScoreRef.current = damped + (instant - damped) * alpha;
        }
        lastDampTime = dampNow;

        while (nextEvalIdx < evalBeats.length && currentTime >= evalBeats[nextEvalIdx]) {
          const s = scoreRef.current;
          const rawSim = dampedScoreRef.current;
          const outOfFrame = isOutOfFrame(userLandmarks.current?.[0]);
          const similarity = outOfFrame ? 0 : rawSim;
          const beatMax = N > 0 ? MAX_SCORE / N : 0;

          let earned = 0;
          let label;
          if (similarity >= 0.6) { earned = beatMax; label = 'PERFECT'; }
          else if (similarity >= 0.4) { earned = beatMax * 0.6; label = 'GREAT'; }
          else if (similarity >= 0.25) { earned = beatMax * 0.3; label = 'GOOD'; }
          else { earned = 0; label = 'MISS'; }

          if (similarity >= 0.4) {
            s.combo += 1;
            if (s.combo > s.bestCombo) s.bestCombo = s.combo;
          } else {
            s.combo = 0;
          }

          s.total += earned;
          s.simTotal += similarity;
          s.samples++;
          scoreHistoryRef.current.push({ time: evalBeats[nextEvalIdx], score: similarity });

          const beatTime = evalBeats[nextEvalIdx];
          const isSpecial = specialSet.has(beatTime);
          const isGolden = goldenSet.has(beatTime);

          if (isSpecial) {
            const sfx = specialSfxRef.current;
            if (sfx) { sfx.currentTime = 0; sfx.play().catch(() => {}); }
            if (similarity >= 0.4) {
              const app = applauseSfxRef.current;
              if (app) { app.currentTime = 0; app.play().catch(() => {}); }
            }
          }

          setJudgment({
            key: nextEvalIdx,
            label,
            score: similarity,
            golden: isGolden,
            special: isSpecial && similarity >= 0.4,
          });

          nextEvalIdx++;
        }

        const now = performance.now();
        if (now - lastFlush > 100) {
          lastFlush = now;
          const s = scoreRef.current;
          const t = currentTime;
          const m = Math.floor(t / 60);
          const sec = Math.floor(t % 60);
          const elapsedMin = t / 60;
          const avgMatch = s.samples > 0 ? s.simTotal / s.samples : 0;
          const cal = Math.round(elapsedMin * 7 * (0.5 + 0.5 * avgMatch));
          setHud({
            score: Math.round(s.total),
            accuracy: Math.round(s.current * 100),
            time: `${m}:${sec.toString().padStart(2, '0')}`,
            cal,
          });
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [phase, poseData, savedTimestamps, userLandmarks, refLandmarks, cameraVideoRef, handleEnd]);

  const judgClass = judgment
    ? judgment.special ? 'judge-special'
      : judgment.golden ? 'judge-golden'
      : judgment.label === 'PERFECT' ? 'judge-perfect'
      : judgment.label === 'GREAT' ? 'judge-great'
      : judgment.label === 'GOOD' ? 'judge-good'
      : 'judge-miss'
    : '';

  const avgPct = scoreRef.current.samples > 0
    ? Math.round((scoreRef.current.simTotal / scoreRef.current.samples) * 100)
    : 0;

  return (
    <div className="game-root">
      <video
        ref={videoRef}
        src={song.videoUrl}
        className="game-video"
        playsInline
        preload="auto"
        onEnded={handleEnd}
      />

      <canvas ref={overlayCanvasRef} className="game-skeleton-overlay" />

      <canvas ref={barRef} className="game-bar" />

      {phase === 'playing' && (
        <div className="game-hud">
          <div className="hud-row hud-row-top">
            <div className="hud-group">
              <div className="hud-block">
                <div className="hud-label">SCORE</div>
                <div className="hud-score">{hud.score.toLocaleString()}</div>
              </div>
              <div className="hud-block hud-cal">
                <div className="hud-label">CALORIES</div>
                <div className="hud-cal-val">
                  {hud.cal.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <button className="btn-pause" onClick={handlePause} aria-label="Pause" />
      )}

      {judgment && phase === 'playing' && (
        <>
          <div key={`j-${judgment.key}`} className={`judge-popup ${judgClass}`}>
            {judgment.label}
          </div>
          <div key={`b-${judgment.key}`} className="beat-flash" />
          {(judgment.golden || judgment.special) && (
            <div key={`f-${judgment.key}`} className={`screen-flash ${judgClass}`} />
          )}
        </>
      )}

      {phase === 'ready' && (
        <div className="overlay overlay-ready">
          <div className="modal-card">
            <h2 className="ready-title">{song.title}</h2>
            <img src={song.cover} alt="" className="ready-cover" />
            {dancers.length > 1 && (
              <div className="ready-dancer-tag">DANCER {dancerIndex + 1}</div>
            )}
            <div className="ready-actions">
              <button className="btn-back" onClick={onExit}>Go back</button>
              <button className="btn-start" onClick={startGame} disabled={!streamReady}>
                PLAY
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'countdown' && countdown !== null && (
        <div className="countdown">
          <span key={countdown} className="countdown-num">
            {countdown > 0 ? countdown : 'GO!'}
          </span>
        </div>
      )}

      {phase === 'paused' && (
        <div className="overlay overlay-paused">
          <div className="modal-card">
            <h2 className="paused-title">PAUSED</h2>
            <div className="paused-actions">
              <button className="btn-start" onClick={handleResume}>RESUME</button>
              <button className="btn-secondary" onClick={handleRestart}>RESTART</button>
              <button className="btn-danger" onClick={onExit}>QUIT</button>
              <label className="toggle-row">
                <span className="toggle-label">SHOW REFERENCE POSE</span>
                <span
                  className={`toggle-switch ${showSkeleton ? 'on' : ''}`}
                  role="switch"
                  aria-checked={showSkeleton}
                  tabIndex={0}
                  onClick={() => setShowSkeleton(s => !s)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setShowSkeleton(s => !s);
                    }
                  }}
                >
                  <span className="toggle-knob" />
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {phase === 'ended' && (
        <div className="overlay overlay-ended">
          <div className="modal-card">
            <h2 className="ended-title">DANCE COMPLETE</h2>
            <div className="ended-score">{hud.score.toLocaleString()}<span className="ended-score-max"> / {MAX_SCORE.toLocaleString()}</span></div>
            <div className="ended-stats">
              <div className="ended-stat">
                <div className="hud-label">AVG MATCH</div>
                <div className="ended-stat-val">{avgPct}%</div>
              </div>
              <div className="ended-stat">
                <div className="hud-label">BEST COMBO</div>
                <div className="ended-stat-val">{scoreRef.current.bestCombo}</div>
              </div>
              <div className="ended-stat">
                <div className="hud-label">GRADE</div>
                <div className="ended-stat-val">{gradeFor(hud.score)}</div>
              </div>
            </div>
            <ScoreGraph history={scoreHistory} />
            <div className="ended-actions">
              <button className="btn-start" onClick={onExit}>SONG SELECT</button>
              <button className="btn-secondary" onClick={handleRestart}>RETRY</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function gradeFor(score) {
  if (score >= 950_000) return 'S+';
  if (score >= 900_000) return 'S';
  if (score >= 800_000) return 'A';
  if (score >= 700_000) return 'B';
  if (score >= 500_000) return 'C';
  if (score >= 250_000) return 'D';
  return 'F';
}

function ScoreGraph({ history }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !history.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 560, H = 160;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { t: 18, r: 18, b: 24, l: 36 };
    const pW = W - pad.l - pad.r;
    const pH = H - pad.t - pad.b;
    const maxT = history[history.length - 1].time || 1;

    ctx.fillStyle = '#08101e';
    rrect(ctx, 0, 0, W, H, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#4a4a6a';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let p = 0; p <= 100; p += 25) {
      const y = pad.t + pH * (1 - p / 100);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pW, y); ctx.stroke();
      ctx.fillText(`${p}%`, pad.l - 6, y + 3);
    }

    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(81,207,102,0.35)';
    const y60 = pad.t + pH * 0.4;
    ctx.beginPath(); ctx.moveTo(pad.l, y60); ctx.lineTo(pad.l + pW, y60); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,221,87,0.35)';
    const y40 = pad.t + pH * 0.6;
    ctx.beginPath(); ctx.moveTo(pad.l, y40); ctx.lineTo(pad.l + pW, y40); ctx.stroke();
    ctx.setLineDash([]);

    const pts = history.map(h => ({
      x: pad.l + (h.time / maxT) * pW,
      y: pad.t + pH * (1 - h.score),
    }));
    if (pts.length >= 2) {
      ctx.strokeStyle = '#00d2ff';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = '#4a4a6a';
    ctx.textAlign = 'center';
    const step = maxT > 180 ? 30 : maxT > 60 ? 15 : 10;
    for (let t = 0; t <= maxT; t += step) {
      const x = pad.l + (t / maxT) * pW;
      ctx.fillText(`${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`, x, H - 8);
    }
  }, [history]);

  if (!history.length) return null;
  return <canvas ref={ref} className="score-graph" />;
}
