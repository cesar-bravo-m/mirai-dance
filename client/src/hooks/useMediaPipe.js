import { useRef, useState, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export default function useMediaPipe(videoRef) {
  const landmarksRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Loading...');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let rafId = null;
    let stream = null;

    async function setup() {
      try {
        setStatusMessage('Requesting camera...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        setStatusMessage('Loading pose model...');
        const isLocalhost = ['localhost', '127.0.0.1', '[::1]', '::1']
          .includes(window.location.hostname);
        const wasmBase = isLocalhost
          ? '/mediapipe/wasm'
          : 'https://miraidancepublic.blob.core.windows.net/mediapipe/wasm';
        const modelAssetPath = isLocalhost
          ? '/mediapipe/pose_landmarker_lite.task'
          : 'https://miraidancepublic.blob.core.windows.net/mediapipe/pose_landmarker_lite.task';

        const vision = await FilesetResolver.forVisionTasks(wasmBase);
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        setStatusMessage('Ready!');
        setIsReady(true);

        let lastTime = -1;
        function detect() {
          if (cancelled) return;
          const video = videoRef.current;
          if (video && video.currentTime !== lastTime) {
            lastTime = video.currentTime;
            landmarksRef.current = poseLandmarker.detectForVideo(video, performance.now()).landmarks;
          }
          rafId = requestAnimationFrame(detect);
        }
        rafId = requestAnimationFrame(detect);
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setStatusMessage('Camera access denied.');
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [videoRef]);

  return { landmarksRef, isReady, error, statusMessage };
}
