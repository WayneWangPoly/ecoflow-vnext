/**
 * Decode a camera photo into a bounded-size JPEG data URL without holding the
 * full-resolution frame in memory. Cheap Android phones ship 50MP+ cameras; a
 * naive `new Image()` decode allocates hundreds of MB and kills the tab (the
 * "photo crash"). `createImageBitmap` with resize options lets the browser
 * downsample during decode, so the peak allocation stays near the target size.
 */

function bitmapToDataUrl(bitmap: ImageBitmap, maxDim: number, quality: number): string {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function legacyDecode(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Image could not be read'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('File could not be read'));
    reader.readAsDataURL(file);
  });
}

export async function readImageDownscaled(file: File, maxDim: number, quality: number): Promise<string> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Cap width at maxDim during decode; height scales proportionally, and the
      // canvas pass below caps the remaining dimension. Peak memory stays bounded.
      const bitmap = await createImageBitmap(file, { resizeWidth: maxDim, resizeQuality: 'medium' } as ImageBitmapOptions);
      try {
        return bitmapToDataUrl(bitmap, maxDim, quality);
      } finally {
        bitmap.close();
      }
    } catch {
      // Older Safari lacks resize options or rejects some camera files - fall through.
    }
  }
  return legacyDecode(file, maxDim, quality);
}
