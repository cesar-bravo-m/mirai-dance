import { useRef, useEffect, useCallback } from 'react';

export default function usePosePlayback(poseData, mediaRef) {
  const landmarksRef = useRef(null);

  const findFrame = useCallback((time) => {
    if (!poseData?.frames?.length) return null;
    const frames = poseData.frames;
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].time <= time) lo = mid;
      else hi = mid - 1;
    }
    return frames[lo];
  }, [poseData]);

  useEffect(() => {
    if (!poseData || !mediaRef) return;

    let rafId;

    function tick() {
      const media = mediaRef.current;
      if (media && !media.paused && !media.ended) {
        const frame = findFrame(media.currentTime);
        landmarksRef.current = frame?.landmarks ? [frame.landmarks] : null;
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [poseData, mediaRef, findFrame]);

  return { landmarksRef };
}
