interface LoadableImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
}
export function loadAssets(urls: readonly string[], create: () => LoadableImage,
  publish: (ready: Set<string>) => void) {
  let active = true;
  const ready = new Set<string>();
  const images = [...new Set(urls)].map(url => {
    const image = create();
    image.onload = () => {
      if (!active || !image.naturalWidth || !image.naturalHeight) return;
      ready.add(url); publish(new Set(ready));
    };
    image.onerror = () => {};
    image.src = url;
    return image;
  });
  return () => { active = false; images.forEach(image => { image.onload = image.onerror = null; }); };
}
