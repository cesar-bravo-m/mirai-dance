const ASSETS_URL = 'https://miraidancepublic.blob.core.windows.net/public/assets.json';

let assets = null;
let loadPromise = null;

export function loadAssets() {
  if (assets) return Promise.resolve(assets);
  if (!loadPromise) {
    loadPromise = fetch(ASSETS_URL, { credentials: 'omit' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
        return res.json();
      })
      .then((data) => {
        assets = data;
        return assets;
      })
      .catch((err) => {

        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

export function getAssets() {
  if (!assets) throw new Error('Assets manifest not loaded yet — call loadAssets() first');
  return assets;
}
