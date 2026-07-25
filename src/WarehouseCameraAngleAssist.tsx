import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const ZXING_FALLBACK_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
const ROTATIONS = [90, -90, 180, 30, -30, 45, -45, 15, -15];
const ATTEMPT_DELAY_MS = 115;

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
  decodeFromCanvas?: (canvas: HTMLCanvasElement) => Promise<ZxingResult>;
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
      else reject(new Error('Angle barcode reader did not initialise.'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Angle barcode reader could not load.')), { once: true });
    if (!existing) {
      script.src = ZXING_FALLBACK_URL;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.ecoflowBarcodeFallback = 'true';
      document.head.appendChild(script);
    } else if (zxingGlobal()) {
      finish();
    }
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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function rotatedFrame(video: HTMLVideoElement, degrees: number) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, 1440 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const radians = degrees * Math.PI / 180;
  const sine = Math.abs(Math.sin(radians));
  const cosine = Math.abs(Math.cos(radians));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * cosine + height * sine));
  canvas.height = Math.max(1, Math.round(width * sine + height * cosine));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(video, -width / 2, -height / 2, width, height);
  return canvas;
}

async function nativeDetector() {
  const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  if (!DetectorClass) return null;
  const requested = ['ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'codabar', 'upc_a', 'upc_e', 'itf'];
  const supported = DetectorClass.getSupportedFormats ? await DetectorClass.getSupportedFormats() : requested;
  const formats = requested.filter((format) => supported.includes(format));
  return new DetectorClass(formats.length ? { formats } : undefined);
}

async function zxingReader() {
  const api = await loadZxing();
  const Reader = api.BrowserMultiFormatReader ?? api.BrowserMultiFormatOneDReader;
  if (!Reader) return null;
  const reader = new Reader(undefined, { delayBetweenScanAttempts: 40, delayBetweenScanSuccess: 0 });
  return reader.decodeFromCanvas ? reader : null;
}

function closeScannerSheet() {
  const sheet = document.querySelector<HTMLElement>('.warehouse-camera-sheet');
  const close = Array.from(sheet?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((button) => /close|cancel/i.test(button.textContent || ''));
  close?.click();
}

async function acceptBarcode(code: string) {
  const input = barcodeInput();
  if (!input) return false;
  setReactInputValue(input, code);
  navigator.vibrate?.([35, 30, 35]);
  closeScannerSheet();
  if (/then enter/i.test(input.placeholder)) {
    window.setTimeout(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })), 80);
  }
  return true;
}

export function WarehouseCameraAngleAssist() {
  useEffect(() => {
    let generation = 0;
    let currentVideo: HTMLVideoElement | null = null;

    async function run(video: HTMLVideoElement, token: number) {
      let detector: Detector | null = null;
      let reader: ZxingReader | null = null;
      try {
        detector = await nativeDetector();
        if (!detector) reader = await zxingReader();
      } catch {
        return;
      }
      if (!detector && !reader) return;

      let rotationIndex = 0;
      while (token === generation && video.isConnected) {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
          await wait(ATTEMPT_DELAY_MS);
          continue;
        }
        const angle = ROTATIONS[rotationIndex % ROTATIONS.length];
        rotationIndex += 1;
        const canvas = rotatedFrame(video, angle);
        if (canvas) {
          try {
            let code = '';
            if (detector) {
              const results = await detector.detect(canvas);
              code = results.find((result) => result.rawValue)?.rawValue?.trim() || '';
            } else if (reader?.decodeFromCanvas) {
              const result = await reader.decodeFromCanvas(canvas);
              code = result?.getText?.().trim() || result?.text?.trim() || '';
            }
            if (code && await acceptBarcode(code)) return;
          } catch {
            // No code at this rotation. Continue through the angle cycle.
          }
        }
        await wait(ATTEMPT_DELAY_MS);
      }
    }

    function refresh() {
      const video = document.querySelector<HTMLVideoElement>('.warehouse-camera-sheet video');
      if (video === currentVideo) return;
      generation += 1;
      currentVideo = video;
      if (video) void run(video, generation);
    }

    const stopObserving = observeBody(refresh);
    refresh();
    return () => {
      generation += 1;
      currentVideo = null;
      stopObserving();
    };
  }, []);

  return null;
}
