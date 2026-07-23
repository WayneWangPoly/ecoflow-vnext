import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const ZXING_FALLBACK_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';

 type Detector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

type DetectorConstructor = {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

type ZxingResult = {
  getText?: () => string;
  text?: string;
};

type ZxingReader = {
  decodeFromImageElement: (image: HTMLImageElement) => Promise<ZxingResult>;
};

type ZxingReaderConstructor = new (
  hints?: Map<unknown, unknown>,
  options?: { delayBetweenScanAttempts?: number; delayBetweenScanSuccess?: number },
) => ZxingReader;

type ZxingBrowserGlobal = {
  BrowserMultiFormatReader?: ZxingReaderConstructor;
  BrowserMultiFormatOneDReader?: ZxingReaderConstructor;
};

let zxingLoadPromise: Promise<ZxingBrowserGlobal> | null = null;

function zxingGlobal() {
  return (window as unknown as { ZXingBrowser?: ZxingBrowserGlobal }).ZXingBrowser ?? null;
}

function loadZxing() {
  const loaded = zxingGlobal();
  if (loaded) return Promise.resolve(loaded);
  if (zxingLoadPromise) return zxingLoadPromise;

  zxingLoadPromise = new Promise<ZxingBrowserGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-ecoflow-barcode-fallback="true"]');
    const script = existing ?? document.createElement('script');
    const finish = () => {
      const api = zxingGlobal();
      if (api) resolve(api);
      else reject(new Error('Photo barcode reader did not initialise.'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Photo barcode reader could not load.')), { once: true });
    if (!existing) {
      script.src = ZXING_FALLBACK_URL;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.ecoflowBarcodeFallback = 'true';
      document.head.appendChild(script);
    }
    if (existing && zxingGlobal()) finish();
  }).catch((error) => {
    zxingLoadPromise = null;
    throw error;
  });

  return zxingLoadPromise;
}

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function barcodeInput() {
  const active = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  if (active && isVisible(active) && /barcode|scan/i.test(`${active.placeholder} ${active.getAttribute('aria-label') || ''}`)) return active;
  return Array.from(document.querySelectorAll<HTMLInputElement>('input')).find((input) =>
    isVisible(input) && /barcode|scan/i.test(`${input.placeholder} ${input.getAttribute('aria-label') || ''}`)
  ) ?? null;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
}

function sheetStatus(sheet: HTMLElement, message: string, tone: 'busy' | 'error') {
  let status = sheet.querySelector<HTMLElement>('.warehouse-camera-gallery-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'warehouse-camera-gallery-status';
    sheet.querySelector('.warehouse-camera-actions')?.insertAdjacentElement('beforebegin', status);
  }
  status.className = `warehouse-camera-gallery-status ${tone}`;
  status.textContent = message;
}

function stopVisibleCamera(sheet: HTMLElement) {
  const video = sheet.querySelector<HTMLVideoElement>('video');
  const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
  stream?.getTracks().forEach((track) => track.stop());
  video?.pause();
}

function loadImage(file: File) {
  return new Promise<{ image: HTMLImageElement; url: string }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo could not be opened.'));
    };
    image.src = url;
  });
}

async function decodeNative(image: HTMLImageElement) {
  const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  if (!DetectorClass) return '';
  const requestedFormats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'codabar', 'upc_a', 'upc_e', 'itf'];
  const supported = DetectorClass.getSupportedFormats ? await DetectorClass.getSupportedFormats() : requestedFormats;
  const formats = requestedFormats.filter((format) => supported.includes(format));
  const detector = new DetectorClass(formats.length ? { formats } : undefined);
  const results = await detector.detect(image);
  return results.find((result) => result.rawValue)?.rawValue?.trim() || '';
}

async function decodeZxing(image: HTMLImageElement) {
  const api = await loadZxing();
  const Reader = api.BrowserMultiFormatReader ?? api.BrowserMultiFormatOneDReader;
  if (!Reader) throw new Error('Photo barcode reader is unavailable.');
  const reader = new Reader(undefined, { delayBetweenScanAttempts: 60, delayBetweenScanSuccess: 0 });
  const result = await reader.decodeFromImageElement(image);
  return result?.getText?.().trim() || result?.text?.trim() || '';
}

async function decodePhoto(file: File) {
  const { image, url } = await loadImage(file);
  try {
    const native = await decodeNative(image).catch(() => '');
    if (native) return native;
    return await decodeZxing(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function WarehouseScannerGalleryEnhancer() {
  useEffect(() => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'warehouse-camera-gallery-input';
    fileInput.setAttribute('aria-hidden', 'true');
    document.body.appendChild(fileInput);

    let targetInput: HTMLInputElement | null = null;
    let targetSheet: HTMLElement | null = null;
    let originalValue = '';
    let reading = false;

    const choosePhoto = () => {
      targetInput = barcodeInput();
      targetSheet = document.querySelector<HTMLElement>('.warehouse-camera-sheet');
      originalValue = targetInput?.value || '';
      fileInput.value = '';
      fileInput.click();
    };

    const onFileChange = async () => {
      const file = fileInput.files?.[0];
      if (!file || !targetInput || reading) return;
      if (targetInput.value !== originalValue && targetInput.value.trim()) return;
      reading = true;
      const sheet = targetSheet;
      if (sheet?.isConnected) {
        stopVisibleCamera(sheet);
        sheetStatus(sheet, 'Reading barcode from photo…', 'busy');
      }

      try {
        const code = await decodePhoto(file);
        if (!code) throw new Error('No barcode was found in this photo. Use a closer, sharper photo with the whole barcode visible.');
        setReactInputValue(targetInput, code);
        navigator.vibrate?.([35, 30, 35]);
        if (sheet?.isConnected) {
          const close = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button')).find((button) => /close|cancel/i.test(button.textContent || ''));
          close?.click();
        }
        if (/then enter/i.test(targetInput.placeholder)) {
          window.setTimeout(() => targetInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })), 80);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No barcode was found in this photo.';
        if (sheet?.isConnected) sheetStatus(sheet, message, 'error');
        else window.alert(message);
      } finally {
        reading = false;
        fileInput.value = '';
      }
    };

    fileInput.addEventListener('change', onFileChange);

    const stopObserving = observeBody(() => {
      const actions = document.querySelector<HTMLElement>('.warehouse-camera-sheet .warehouse-camera-actions');
      if (!actions || actions.querySelector('.warehouse-camera-gallery-button')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'warehouse-camera-gallery-button';
      button.textContent = 'Choose from Photos';
      button.addEventListener('click', choosePhoto);
      actions.insertBefore(button, actions.firstChild);
    });

    return () => {
      stopObserving();
      fileInput.removeEventListener('change', onFileChange);
      fileInput.remove();
      document.querySelectorAll('.warehouse-camera-gallery-button').forEach((button) => button.remove());
    };
  }, []);

  return null;
}
