// dev use only
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDest = resolve(root, 'public/mediapipe/wasm');
const modelDest = resolve(root, 'public/mediapipe/pose_landmarker_lite.task');

const MODEL_URL =
  'https://miraidancepublic.blob.core.windows.net/mediapipe/pose_landmarker_lite.task';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(wasmDest, { recursive: true });
await cp(wasmSrc, wasmDest, { recursive: true });
console.log('[mediapipe] copied WASM runtime -> public/mediapipe/wasm');

if (await exists(modelDest)) {
  console.log('[mediapipe] model already cached, skipping download');
} else {
  console.log(`[mediapipe] downloading model from ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(`model download failed: ${res.status} ${res.statusText}`);
  }
  await writeFile(modelDest, Buffer.from(await res.arrayBuffer()));
  console.log('[mediapipe] cached model -> public/mediapipe/pose_landmarker_lite.task');
}
