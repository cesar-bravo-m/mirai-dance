import { useEffect, useMemo, useRef, useState } from 'react';
import { getAssets } from '../assets';
import { renderBlockCharacter } from '../lib/blockRenderer';

const ARTIST_FONTS = [
  '"Brush Script MT", "Lucida Handwriting", cursive',
  '"Georgia", "Times New Roman", serif',
  '"Courier New", "Lucida Console", monospace',
  '"Comic Sans MS", "Marker Felt", cursive',
  '"Trebuchet MS", "Lucida Grande", sans-serif',
  '"Palatino", "Book Antiqua", serif',
  '"Verdana", "Geneva", sans-serif',
  '"Copperplate", "Copperplate Gothic Bold", serif',
];

function buildSongEntries(songs) {
  return Object.entries(songs).map(([title, urls]) => {
    const dashIdx = title.indexOf(' - ');
    const songName = dashIdx >= 0 ? title.slice(dashIdx + 3) : title;
    return {
      title,
      songName,
      cover: urls.Cover,
      video: urls.Video,
      data: urls.Data,
      sample: urls.AudioSample,
      genre: urls.Genre,
      artist: urls.Artist,
      difficulty: urls.Difficulty,

      dancerImages: urls.Dancers,
    };
  });
}

const SAMPLE_VOLUME = 0.7;
const FADE_MS = 220;

const MIN_LOAD_DURATION_MS = 1800;

const VISIBLE_SIDE_COUNT = 3;

function wrapOffset(from, to, n) {
  const raw = ((to - from) % n + n) % n;
  return raw > n / 2 ? raw - n : raw;
}

function playSfx(audio) {
  if (!audio) return;
  try {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {  }
}

export default function SongSelect({ assets, onSelect, onMenuMusicStop, initialTitle }) {

  const SONG_ENTRIES = useMemo(() => buildSongEntries(getAssets().songs), []);
  const SONG_COUNT = SONG_ENTRIES.length;

  const songSelectedSfxRef = useRef(null);
  const scratchSfxRef = useRef(null);
  if (songSelectedSfxRef.current === null) {
    const { sounds } = getAssets();
    const selected = new Audio(sounds.song_selected);
    selected.preload = 'auto';
    songSelectedSfxRef.current = selected;
    const scratch = new Audio(sounds.scratch_sound);
    scratch.preload = 'auto';
    scratchSfxRef.current = scratch;
  }

  useEffect(() => {
    Object.values(getAssets().logos).forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (initialTitle) {
      const i = SONG_ENTRIES.findIndex(s => s.title === initialTitle);
      if (i >= 0) return i;
    }
    return 0;
  });

  const [lifetimeCal] = useState(() => {
    try {
      const v = parseFloat(
        localStorage.getItem('mirai-dance.totalCalories') || '0',
      );
      return Number.isFinite(v) ? Math.round(v) : 0;
    } catch {
      return 0;
    }
  });
  const [fetchingTitle, setFetchingTitle] = useState(null);
  const [dancerPick, setDancerPick] = useState(null);
  const [buffering, setBuffering] = useState(null);
  const activeAudioRef = useRef(null);
  const abortRef = useRef(null);
  const dancerResolverRef = useRef(null);

  const selectedIndexRef = useRef(selectedIndex);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);

  const inFlow = !!fetchingTitle || !!dancerPick || !!buffering;
  const selectedSong = SONG_ENTRIES[selectedIndex];

  useEffect(() => {
    onMenuMusicStop?.();
    startSample(SONG_ENTRIES[selectedIndexRef.current].title);

    function retryStart() {
      startSample(SONG_ENTRIES[selectedIndexRef.current].title);
    }
    const opts = { once: true, capture: true };
    window.addEventListener('pointerdown', retryStart, opts);
    window.addEventListener('keydown', retryStart, opts);

    return () => {
      window.removeEventListener('pointerdown', retryStart, opts);
      window.removeEventListener('keydown', retryStart, opts);
      stopAll(assets);
    };

  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && inFlow) {
        e.preventDefault();
        cancelFlow();
        return;
      }
      if (inFlow) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelected(selectedIndex - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelected(selectedIndex + 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSelect(selectedSong);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function setSelected(idx) {
    if (inFlow) return;

    const wrapped = ((idx % SONG_COUNT) + SONG_COUNT) % SONG_COUNT;
    if (wrapped === selectedIndex) return;
    setSelectedIndex(wrapped);
    startSample(SONG_ENTRIES[wrapped].title);
  }

  function startSample(title) {
    const audio = assets?.[title]?.audio;
    if (!audio) return;
    for (const [t, { audio: a }] of Object.entries(assets)) {
      if (t !== title && !a.paused) {
        cancelRamp(a);
        a.pause();
        a.currentTime = 0;
        a.volume = 0;
      }
    }
    activeAudioRef.current = audio;
    if (audio.paused) {
      audio.currentTime = 0;
      audio.volume = 0;
      audio.loop = true;
      audio.play().catch(() => {});
    }
    rampVolume(audio, SAMPLE_VOLUME, FADE_MS);
  }

  function handleCardClick(idx, song) {
    if (inFlow) return;
    if (idx === selectedIndex) {
      handleSelect(song);
    } else {
      setSelected(idx);
    }
  }

  function cancelFlow() {
    abortRef.current?.abort();
    dancerResolverRef.current?.reject(new CancelledError());
    abortRef.current = null;
    dancerResolverRef.current = null;
    setBuffering(null);
    setDancerPick(null);
    setFetchingTitle(null);
  }

  function askDancer(song, payload) {
    return new Promise((resolve, reject) => {
      dancerResolverRef.current = { resolve, reject };
      setDancerPick({ song, payload });
    });
  }

  function chooseDancer(idx) {
    dancerResolverRef.current?.resolve(idx);
    dancerResolverRef.current = null;
    setDancerPick(null);
  }

  async function handleSelect(song) {
    if (inFlow) return;
    onMenuMusicStop?.();
    playSfx(songSelectedSfxRef.current);
    setFetchingTitle(song.title);

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const startedAt = performance.now();

    try {

      setBuffering({
        song,
        steps:    { received: 0, total: 0, ratio: 0 },
        videoData: { received: 0, total: 0, ratio: 0 },
      });

      const stepsPromise = downloadBytes(song.data, signal, (snap) =>
        setBuffering(s => (s ? { ...s, steps: snap } : null))
      );
      const videoPromise = downloadBytes(song.video, signal, (snap) =>
        setBuffering(s => (s ? { ...s, videoData: snap } : null))
      );

      const dataBytes = await stepsPromise;
      const payload = JSON.parse(new TextDecoder('utf-8').decode(dataBytes));
      const dancers = payload?.dancers ?? [];

      let dancerIndex = 0;
      if (dancers.length > 1) {
        dancerIndex = await askDancer(song, payload);
      }

      const videoBytes = await videoPromise;
      const blob = new Blob([videoBytes], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);

      const elapsed = performance.now() - startedAt;
      if (elapsed < MIN_LOAD_DURATION_MS) {
        await sleepAbortable(MIN_LOAD_DURATION_MS - elapsed, signal);
      }

      playSfx(scratchSfxRef.current);

      onSelect({
        title: song.title,
        cover: song.cover,
        videoUrl: blobUrl,
        payload,
        dancerIndex,
      });
    } catch (err) {

      abortRef.current?.abort();
      if (!isCancelled(err)) {
        console.error('Pre-load failed:', err);
        alert(`Failed to load "${song.title}": ${err.message}`);
      }
      setBuffering(null);
      setDancerPick(null);
      setFetchingTitle(null);
      dancerResolverRef.current = null;
    }
  }

  return (
    <div className="select-screen">

      <div className="select-header">
        <div className="select-header-brand">MIRAI DANCE</div>
      </div>

      <div className="select-stage-area">

        <div className="carousel-wrap">
        <button
          type="button"
          className="carousel-arrow carousel-arrow-left"
          onClick={() => setSelected(selectedIndex - 1)}
          disabled={inFlow}
          aria-label="Previous song"
        >‹</button>

        <div className="carousel-stage">
          {SONG_ENTRIES.map((song, i) => {

            const offset = wrapOffset(selectedIndex, i, SONG_COUNT);
            const absOffset = Math.abs(offset);

            if (absOffset > VISIBLE_SIDE_COUNT) return null;

            const isCenter = offset === 0;
            const isFetching = fetchingTitle === song.title;
            const sign = offset > 0 ? 1 : offset < 0 ? -1 : 0;

            const xPx = sign * (absOffset === 0 ? 0 : 200 + (absOffset - 1) * 140);
            const rotY = -sign * (absOffset === 0 ? 0 : 32);
            const scale = absOffset === 0
              ? 1
              : absOffset === 1 ? 0.78
              : absOffset === 2 ? 0.62
              : 0.5;
            const z = isCenter ? 60 : -absOffset * 80;

            return (
              <button
                key={song.title}
                type="button"
                className={
                  'carousel-card'
                  + (isCenter ? ' carousel-card-center' : '')
                  + (isFetching ? ' carousel-card-loading' : '')
                }
                style={{
                  transform: `translate(-50%, -50%) translateX(${xPx}px) translateZ(${z}px) rotateY(${rotY}deg) scale(${scale})`,
                  zIndex: 100 - absOffset,
                }}
                onClick={() => handleCardClick(i, song)}
                disabled={inFlow}
                aria-label={song.title}
                aria-current={isCenter ? 'true' : undefined}
                tabIndex={0}
              >

                <img
                  src={song.cover}
                  alt=""
                  className="carousel-card-cover"
                  draggable={false}
                />
                {!isCenter && <div className="carousel-card-shade" />}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="carousel-arrow carousel-arrow-right"
          onClick={() => setSelected(selectedIndex + 1)}
          disabled={inFlow}
          aria-label="Next song"
        >›</button>
      </div>

      <div className="select-info">
        <div className="select-info-panel">
          <div className="select-info-titles">
            <div className="select-info-title">{selectedSong.songName}</div>
            {selectedSong.artist && (
              <div
                className="select-info-artist"
                style={{
                  fontFamily: ARTIST_FONTS[selectedIndex % ARTIST_FONTS.length],
                }}
              >
                {selectedSong.artist}
              </div>
            )}
          </div>
          <div className="select-info-cells">
            <div className="select-info-cell">
              <div className="select-info-cell-value">
                {selectedSong.genre
                  ? <GenreLogo genre={selectedSong.genre} />
                  : '—'}
              </div>
            </div>
            <div className="select-info-cell">
              <div className="select-info-cell-value">
                <DifficultyStars level={selectedSong.difficulty} />
              </div>
            </div>
          </div>
        </div>
      </div>

      </div>

      <div className="select-calorie-readout">
        <div className="select-calorie-value">
          {lifetimeCal.toLocaleString()}
          <span className="select-calorie-unit">kcal</span>
        </div>
      </div>

      {buffering && !dancerPick && (
        <BufferingScreen
          song={buffering.song}
          steps={buffering.steps}
          videoData={buffering.videoData}
          onCancel={cancelFlow}
        />
      )}

      {dancerPick && (
        <DancerPickModal
          song={dancerPick.song}
          payload={dancerPick.payload}
          onChoose={chooseDancer}
          onCancel={cancelFlow}
        />
      )}
    </div>
  );
}

function DifficultyStars({ level }) {
  const n = Math.max(0, Math.min(5, parseInt(level, 10) || 0));
  return (
    <span
      className="song-stars"
      aria-label={`Difficulty ${n} of 5`}
      title={`Difficulty ${n} / 5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < n ? 'star star-on' : 'star star-off'}>★</span>
      ))}
    </span>
  );
}

function GenreLogo({ genre }) {
  const slug = genre.toLowerCase().replace(/\s+/g, '');
  const src = getAssets().logos[slug];
  if (!src) return <>{genre}</>;

  return (
    <img
      key={src}
      className="genre-logo"
      src={src}
      alt={genre}
      draggable={false}
    />
  );
}

function DancerPickModal({ song, payload, onChoose, onCancel }) {
  const dancers = payload?.dancers ?? [];
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <button
          type="button"
          className="modal-close"
          aria-label="Close"
          onClick={onCancel}
        >
          ✕
        </button>
        <div className="modal-header">
          <img src={song.cover} alt="" className="modal-cover" />
          <div className="modal-header-text">
            <div className="modal-title">{song.title}</div>
          </div>
        </div>

        <div className="dancer-grid">
          {dancers.map((dancer, i) => {
            const imgUrl = song.dancerImages?.[i];
            return (
              <button
                key={i}
                type="button"
                className={
                  'dancer-pick-card'
                  + (imgUrl ? ' dancer-pick-card-image' : '')
                }
                onClick={() => onChoose(i)}
              >

                <div className="dancer-pick-lights" aria-hidden="true" />
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt=""
                    className="dancer-pick-image"
                    draggable={false}
                  />
                ) : (
                  <>
                    <DancerPreview dancer={dancer} />
                    <div className="dancer-pick-num">{i + 1}</div>
                    <div className="dancer-pick-label">DANCER {i + 1}</div>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="btn-back" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function DancerPreview({ dancer, width = 150, height = 200 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#08101e';
    ctx.fillRect(0, 0, width, height);

    const frame = pickPreviewFrame(dancer);
    if (!frame?.landmarks) return;
    const normalized = normalizeFigure(frame.landmarks);
    const off = renderBlockCharacter(normalized, width, height);
    if (off) ctx.drawImage(off, 0, 0, width, height);
  }, [dancer, width, height]);

  return <canvas ref={ref} className="dancer-preview-canvas" />;
}

function pickPreviewFrame(dancer) {
  const frames = dancer?.frames;
  if (!frames?.length) return null;
  const start = Math.floor(frames.length * 0.35);
  for (let i = 0; i < frames.length; i++) {
    const a = start + i;
    const b = start - i;
    if (a < frames.length && frames[a]?.landmarks) return frames[a];
    if (b >= 0 && frames[b]?.landmarks) return frames[b];
  }
  return null;
}

function normalizeFigure(landmarks, padding = 0.08) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let any = false;
  for (const lm of landmarks) {
    if ((lm.visibility ?? 1) < 0.3) continue;
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
    any = true;
  }
  if (!any) return landmarks;
  const dw = maxX - minX, dh = maxY - minY;
  const s = Math.max(dw, dh, 0.001);
  const usable = 1 - 2 * padding;
  const scale = usable / s;
  const outW = dw * scale;
  const outH = dh * scale;
  const offX = padding + (usable - outW) / 2;
  const offY = padding + (usable - outH) / 2;
  return landmarks.map(lm => ({
    ...lm,
    x: offX + (lm.x - minX) * scale,
    y: offY + (lm.y - minY) * scale,
  }));
}

function BufferingScreen({ song, steps, videoData, onCancel }) {
  return (
    <div className="loader-screen">
      <div className="loader-card">
        <img src={song.cover} alt="" className="loader-cover" />
        <div className="loader-title">{song.title}</div>
        <LoaderBar label="Downloading steps" snap={steps} />
        <LoaderBar label="Downloading song"  snap={videoData} />
        <button className="btn-back loader-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function LoaderBar({ label, snap }) {
  const pct = Math.round(snap.ratio * 100);
  const done = pct >= 100;
  return (
    <div className={'loader-phase' + (done ? ' loader-phase-done' : '')}>
      <div className="loader-phase-head">
        <span className="loader-eyebrow">{label}</span>
        <span className="loader-pct">{done ? 'READY' : `${pct}%`}</span>
      </div>
      <div className="loader-bar-outer">
        <div className="loader-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="loader-bytes">
        {fmtBytes(snap.received)}{snap.total ? ` / ${fmtBytes(snap.total)}` : ''}
      </div>
    </div>
  );
}

function fmtBytes(n) {
  if (!n) return '0 KB';
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = n / 1024;
  return `${kb.toFixed(0)} KB`;
}

const CACHE_NAME = 'mirai-dance-v1';

class CancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelledError'; }
}

function isCancelled(err) {
  return err?.name === 'AbortError' || err?.name === 'CancelledError';
}

function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function openCache() {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function downloadBytes(url, signal, onProgress) {

  const cache = await openCache();
  if (cache) {
    const cached = await cache.match(url);
    if (cached) {
      const buf = await cached.arrayBuffer();
      const bytes = new Uint8Array(buf);
      onProgress({ received: bytes.length, total: bytes.length, ratio: 1 });
      return bytes;
    }
  }

  let res;
  try {
    res = await fetch(url, { signal, credentials: 'omit' });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(
      `Network/CORS error fetching ${url}. ` +
      `If the response is visible in DevTools but JS can't read it, the server is ` +
      `likely missing an Access-Control-Allow-Origin header for this origin. ` +
      `(Original: ${err?.message || err})`
    );
  }

  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
  }

  const cacheCopy = cache ? res.clone() : null;

  let total = 0;
  const cr = res.headers.get('Content-Range');
  if (cr) {
    const m = cr.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
    if (m) {
      const start = Number(m[1]);
      if (start !== 0) {
        throw new Error(
          `Server returned partial content starting at byte ${start} ` +
          `(expected 0). Try clearing your browser cache and reloading.`
        );
      }
      if (m[3] !== '*') total = Number(m[3]);
    }
  }
  if (!total) {
    const cl = res.headers.get('Content-Length');
    if (cl) total = Number(cl);
  }

  if (!res.body) throw new Error('Response has no body');
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastReport = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const now = performance.now();
    if (now - lastReport > 80) {
      lastReport = now;
      onProgress({
        received,
        total,
        ratio: total ? Math.min(1, received / total) : 0,
      });
    }
  }

  onProgress({ received, total: total || received, ratio: 1 });

  if (cache && cacheCopy) {
    cache.put(url, cacheCopy).catch(err => {
      console.warn('Cache.put failed (continuing anyway):', err);
    });
  }

  return mergeChunks(chunks, received);
}

function mergeChunks(chunks, totalLength) {
  if (chunks.length === 1) return chunks[0];
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

function rampVolume(audio, target, durationMs, onDone) {
  cancelRamp(audio);
  const start = audio.volume;
  const startedAt = performance.now();
  function tick() {
    const t = Math.min(1, (performance.now() - startedAt) / durationMs);
    audio.volume = Math.max(0, Math.min(1, start + (target - start) * t));
    if (t < 1) {
      audio.__rampId = requestAnimationFrame(tick);
    } else {
      audio.__rampId = null;
      onDone?.();
    }
  }
  audio.__rampId = requestAnimationFrame(tick);
}

function cancelRamp(audio) {
  if (audio.__rampId) {
    cancelAnimationFrame(audio.__rampId);
    audio.__rampId = null;
  }
}

function stopAll(assets) {
  if (!assets) return;
  for (const { audio } of Object.values(assets)) {
    cancelRamp(audio);
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
  }
}
