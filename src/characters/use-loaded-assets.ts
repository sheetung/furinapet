import { useEffect, useState } from 'react';
import { loadAssets } from './asset-loader';

/** Ignore late loads after a character switch; failed images never become renderable. */
export function useLoadedAssets(urls: readonly string[]) {
  const key = JSON.stringify(urls);
  const [loaded, setLoaded] = useState<{ key: string; urls: Set<string> }>({ key: '', urls: new Set() });
  useEffect(() => {
    return loadAssets(JSON.parse(key), () => new Image(), urls => setLoaded({ key, urls }));
  }, [key]);
  return loaded.key === key ? loaded.urls : new Set<string>();
}
