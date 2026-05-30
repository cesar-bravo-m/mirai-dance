import { useRef, useState, useCallback, useEffect } from 'react';
import SongSelect from './components/SongSelect';
import Game from './components/Game';
import useMediaPipe from './hooks/useMediaPipe';
import { initBlockRenderer } from './lib/blockRenderer';
import { loadAssets, getAssets } from './assets';

function preloadAllAssets(songs) {
  const assets = {};
  for (const [title, urls] of Object.entries(songs)) {
    const img = new Image();
    img.src = urls.Cover;

    const audio = new Audio();
    audio.src = urls.AudioSample;
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = 0;
    audio.load();

    assets[title] = { img, audio };
  }
  return assets;
}

const MENU_MUSIC_VOLUME = 1.2;
const MENU_MUSIC_FADE_MS = 280;

const DISCLAIMER_ACCEPTED_KEY = "mirai-dance:disclaimer-accepted";

export default function App() {
  const [accepted, setAccepted] = useState(
    () => localStorage.getItem(DISCLAIMER_ACCEPTED_KEY) === "true"
  );

  const [assetsReady, setAssetsReady] = useState(false);
  const [assetsError, setAssetsError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadAssets()
      .then(() => { if (!cancelled) setAssetsReady(true); })
      .catch((err) => { if (!cancelled) setAssetsError(err.message || String(err)); });
    return () => { cancelled = true; };
  }, []);

  const handleAccept = () => {
    localStorage.setItem(DISCLAIMER_ACCEPTED_KEY, "true");
    setAccepted(true);
  };
  if (!accepted) return <Disclaimer onAccept={handleAccept} />;
  if (assetsError) {
    return <AppError title="Couldn't load assets" message={assetsError} hint="Check your connection and reload the page." />;
  }
  if (!assetsReady) return <AppLoader status="Loading…" />;
  return <DanceApp />;
}

function DanceApp() {

  const REMOTE_ASSETS = getAssets();
  const SONGS = REMOTE_ASSETS.songs;

  const cameraVideoRef = useRef(null);
  const {
    landmarksRef: userLandmarks,
    isReady: cameraReady,
    error: cameraError,
    statusMessage: cameraStatus,
  } = useMediaPipe(cameraVideoRef);

  const cameraPermission = useCameraPermission();

  const assetsRef = useRef(null);
  if (assetsRef.current === null) {
    assetsRef.current = preloadAllAssets(SONGS);
  }

  useEffect(() => { initBlockRenderer(); }, []);

  const [bgVideoUrl, setBgVideoUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let createdBlobUrl = null;
    (async () => {
      const url = REMOTE_ASSETS.background_animation;
      try {
        const cache = typeof caches !== 'undefined'
          ? await caches.open('mirai-dance-v1')
          : null;
        let response = cache ? await cache.match(url) : null;
        if (!response) {
          response = await fetch(url, { credentials: 'omit' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          if (cache) cache.put(url, response.clone()).catch(() => {});
        }
        const blob = await response.blob();
        if (cancelled) return;
        createdBlobUrl = URL.createObjectURL(blob);
        setBgVideoUrl(createdBlobUrl);
      } catch (err) {
        console.warn('Background video load failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, []);

  const menuMusicRef = useRef(null);
  if (menuMusicRef.current === null) {
    const m = new Audio(REMOTE_ASSETS.sounds.menumusic);
    m.loop = true;
    m.preload = 'auto';
    m.volume = 0;
    menuMusicRef.current = m;
  }
  const menuMusicStoppedRef = useRef(false);
  const blurStoppedRef = useRef(false);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);

  const [song, setSong] = useState(null);

  const [lastPlayedTitle, setLastPlayedTitle] = useState(null);

  const playMenuMusic = useCallback(() => {
    menuMusicStoppedRef.current = false;
    const m = menuMusicRef.current;
    if (!m) return;

    function rampToTarget() {
      if (menuMusicStoppedRef.current) return;
      const ctx = audioCtxRef.current;
      const gain = gainNodeRef.current;
      if (ctx && gain) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (gain.gain.value < MENU_MUSIC_VOLUME - 0.001) {
          fadeGain(ctx, gain, MENU_MUSIC_VOLUME, MENU_MUSIC_FADE_MS);
        }
      } else if (m.volume < 0.999) {

        fadeElementVolume(m, 1, MENU_MUSIC_FADE_MS);
      }
    }

    if (m.paused) {

      const p = m.play();
      if (p && typeof p.then === 'function') {
        p.then(rampToTarget).catch(() => {  });
      } else {
        rampToTarget();
      }
    } else {
      rampToTarget();
    }
  }, []);

  useEffect(() => {
    const m = menuMusicRef.current;
    function upgradeOnGesture() {
      if (audioCtxRef.current) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        const ctx = new Ctx();
        const source = ctx.createMediaElementSource(m);
        const gain = ctx.createGain();
        gain.gain.value = m.volume;
        source.connect(gain);
        gain.connect(ctx.destination);
        audioCtxRef.current = ctx;
        gainNodeRef.current = gain;
        m.volume = 1;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (!menuMusicStoppedRef.current && !m.paused) {
          fadeGain(ctx, gain, MENU_MUSIC_VOLUME, MENU_MUSIC_FADE_MS);
        }
      } catch {  }
    }
    window.addEventListener('pointerdown', upgradeOnGesture, { capture: true, once: true });
    window.addEventListener('keydown', upgradeOnGesture, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', upgradeOnGesture, true);
      window.removeEventListener('keydown', upgradeOnGesture, true);
    };
  }, []);

  useEffect(() => {
    const m = menuMusicRef.current;
    function onPause() {
      if (menuMusicStoppedRef.current) return;
      const p = m.play();
      if (p && p.catch) p.catch(() => {});
    }
    m.addEventListener('pause', onPause);
    return () => m.removeEventListener('pause', onPause);
  }, []);

  useEffect(() => {
    playMenuMusic();

  }, []);

  const stopMenuMusic = useCallback(() => {
    if (menuMusicStoppedRef.current) return;
    menuMusicStoppedRef.current = true;
    const m = menuMusicRef.current;
    if (!m || m.paused) return;
    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    if (ctx && gain) {
      fadeGain(ctx, gain, 0, MENU_MUSIC_FADE_MS);
    } else {
      fadeElementVolume(m, 0, MENU_MUSIC_FADE_MS);
    }
    setTimeout(() => {

      m.pause();
    }, MENU_MUSIC_FADE_MS + 30);
  }, []);

  useEffect(() => {
    if (cameraReady) stopMenuMusic();
  }, [cameraReady, stopMenuMusic]);

  useEffect(() => {
    function onBlur() {
      if (!menuMusicStoppedRef.current) {
        blurStoppedRef.current = true;
        stopMenuMusic();
      }
    }
    function onFocus() {
      if (blurStoppedRef.current) {
        blurStoppedRef.current = false;
        if (!cameraReady) playMenuMusic();
      }
    }
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [cameraReady, playMenuMusic, stopMenuMusic]);

  const handleSelect = useCallback((s) => {
    setLastPlayedTitle(s.title);
    stopMenuMusic();
    setSong(s);
  }, [stopMenuMusic]);
  const handleExit = useCallback(() => {
    setSong(prev => {

      if (prev?.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.videoUrl);
      return null;
    });
  }, []);

  const stillLoading = !cameraReady && !cameraError;

  const permissionDenied =
    cameraPermission === 'denied' ||
    (!!cameraError && /denied|NotAllowed|Permission/i.test(cameraError));

  const permissionPending =
    cameraPermission === 'prompt' ||
    (cameraPermission !== 'granted' && cameraStatus === 'Requesting camera...');

  const showPermissionGuard =
    !cameraReady &&
    cameraPermission !== 'granted' &&
    (permissionDenied || permissionPending);

  return (
    <>

      {bgVideoUrl && (
        <video
          className="page-bg-video"
          src={bgVideoUrl}
          autoPlay
          loop
          muted
          playsInline
          ref={(el) => { if (el) el.playbackRate = 0.8; }}
        />
      )}

      <video
        ref={cameraVideoRef}
        className="cam-hidden"
        autoPlay
        playsInline
        muted
        width={640}
        height={480}
      />

      {showPermissionGuard ? (
        <CameraPermissionGuard isDenied={permissionDenied} />
      ) : stillLoading ? (
        <AppLoader status={cameraStatus} />
      ) : cameraError ? (
        <AppError message={cameraError} />
      ) : null}

      {cameraReady && !song && (
        <SongSelect
          assets={assetsRef.current}
          initialTitle={lastPlayedTitle}
          onSelect={handleSelect}
          onMenuMusicStop={stopMenuMusic}
          onMenuMusicPlay={playMenuMusic}
        />
      )}

      {cameraReady && song && (
        <Game
          key={song.title}
          song={song}
          userLandmarks={userLandmarks}
          cameraVideoRef={cameraVideoRef}
          onExit={handleExit}
        />
      )}
    </>
  );
}

function Disclaimer({ onAccept }) {
  return (
    <div className="app-loader-screen">
      <div className="app-loader-card disclaimer-card">
        <h1 className="logo app-loader-logo">MIRAI<span className="logo-accent">DANCE</span></h1>
        <p className="disclaimer-body">
          Mirai Dance is dance game that works with just your laptop camera. No extra apps or hardware required.
        </p>
        <p className="disclaimer-note">
          This is a non-commercial proof of concept, online until <strong>May&nbsp;30,&nbsp;2026</strong> for evaluation purposes only.
        </p>
        <p className="disclaimer-note">
          The pose detection model works locally in your browser. Nothing is ever recorded or sent anywhere.
        </p>
        <a
          className="disclaimer-link"
          href="https://bsky.app/profile/cesarbravo.me"
          target="_blank"
          rel="noopener noreferrer"
        >
          Follow me on Bluesky: @cesarbravo.me
        </a>
        <button type="button" className="disclaimer-accept" onClick={onAccept}>
          Let's Dance!

        </button>
      </div>
    </div>
  );
}

function AppLoader({ status }) {
  return (
    <div className="app-loader-screen">
      <div className="app-loader-card">
        <h1 className="logo app-loader-logo">MIRAI<span className="logo-accent">DANCE</span></h1>
        <div className="app-loader-spinner" />
        <div className="app-loader-status">{status || 'Loading…'}</div>
      </div>
    </div>
  );
}

function fadeGain(audioCtx, gainNode, target, durationMs) {
  if (!audioCtx || !gainNode) return;
  const now = audioCtx.currentTime;
  const current = gainNode.gain.value;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(current, now);
  gainNode.gain.linearRampToValueAtTime(target, now + durationMs / 1000);
}

function fadeElementVolume(audio, target, durationMs) {
  if (audio.__fadeRaf) cancelAnimationFrame(audio.__fadeRaf);
  const start = audio.volume;
  const startedAt = performance.now();
  function tick() {
    const t = Math.min(1, (performance.now() - startedAt) / durationMs);
    audio.volume = Math.max(0, Math.min(1, start + (target - start) * t));
    if (t < 1) audio.__fadeRaf = requestAnimationFrame(tick);
    else audio.__fadeRaf = null;
  }
  audio.__fadeRaf = requestAnimationFrame(tick);
}

function AppError({
  message,
  title = 'Camera not available',
  hint = 'Allow camera access in your browser and reload the page.',
}) {
  return (
    <div className="app-loader-screen">
      <div className="app-loader-card app-loader-card-error">
        <h1 className="logo app-loader-logo">MIRAI<span className="logo-accent">DANCE</span></h1>
        <div className="app-loader-error-badge">!</div>
        <div className="app-loader-status">{title}</div>
        <div className="app-loader-error">{message}</div>
        <div className="app-loader-hint">{hint}</div>
      </div>
    </div>
  );
}

function useCameraPermission() {
  const [state, setState] = useState('unknown');
  useEffect(() => {
    if (!navigator.permissions?.query) return undefined;
    let cancelled = false;
    let permStatus = null;
    navigator.permissions
      .query({ name: 'camera' })
      .then((s) => {
        if (cancelled) return;
        permStatus = s;
        setState(s.state);
        s.onchange = () => {
          if (!cancelled) setState(s.state);
        };
      })
      .catch(() => {

      });
    return () => {
      cancelled = true;
      if (permStatus) permStatus.onchange = null;
    };
  }, []);
  return state;
}

function CameraPermissionGuard({ isDenied }) {
  return (
    <div className="permission-guard">
      <div className="permission-arrow-anchor">
        <svg
          className="permission-arrow"
          viewBox="0 0 200 240"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >

          <polygon
            points="100,10 30,90 70,90 70,230 130,230 130,90 170,90"
            fill="#00d2ff"
          />
        </svg>
        <div className="permission-arrow-label">
          {isDenied ? 'Re-enable here' : 'Allow camera here'}
        </div>
      </div>

      <div className="permission-panel">
        <h1 className="permission-title">Camera Access Required</h1>
        <p className="permission-body">
          MIRAI DANCE uses your webcam to track your dance moves. No video is
          ever recorded or sent anywhere — pose detection runs entirely in your
          browser.
        </p>
        <p className="permission-cta">
          {isDenied
            ? 'Access was blocked. Click the camera icon in your address bar above to re-enable it, then reload.'
            : 'Click "Allow" on the browser prompt at the top of the window.'}
        </p>
      </div>
    </div>
  );
}
