import { useEffect, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';

const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';
const ZXING_BROWSER_VERSION = '0.2.1';
const ZXING_FALLBACK_URL = `/vendor/zxing-browser/${ZXING_BROWSER_VERSION}/zxing-browser.min.js`;
const ZXING_WASM_VERSION = '2.0.2';
const ZXING_WASM_READER_URL = `/vendor/zxing-wasm/${ZXING_WASM_VERSION}/reader/index.js`;
const ZXING_WASM_BINARY_URL = `/vendor/zxing-wasm/${ZXING_WASM_VERSION}/reader/zxing_reader.wasm`;
const NATIVE_SCAN_INTERVAL_MS = 90;
const WASM_SCAN_INTERVAL_MS = 110;
const ZXING_SCAN_INTERVAL_MS = 80;
const MAX_SCAN_CANVAS_WIDTH = 1600;
const WASM_RUNTIME_FAILURE_LIMIT = 2;
const WASM_RECOVERY_LIMIT = 1;

const WAREHOUSE_WASM_FORMATS = [
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'Code128',
  'Code39',
  'Code93',
  'Codabar',
  'ITF',
  'ITF14',
  'DataBar',
];

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

type ZxingControls = {
  stop: () => void | Promise<void>;
  switchTorch?: (onOff?: boolean) => Promise<void>;
};

type ZxingReaderOptions = {
  delayBetweenScanAttempts?: number;
  delayBetweenScanSuccess?: number;
  tryPlayVideoTimeout?: number;
};

type ZxingReader = {
  decodeFromStream: (
    stream: MediaStream,
    videoElement: HTMLVideoElement,
    callback: (result?: ZxingResult, error?: unknown, controls?: ZxingControls) => void,
  ) => Promise<ZxingControls>;
};

type ZxingReaderConstructor = new (
  hints?: Map<unknown, unknown>,
  options?: ZxingReaderOptions,
) => ZxingReader;

type ZxingBrowserGlobal = {
  BrowserMultiFormatOneDReader?: ZxingReaderConstructor;
  BrowserMultiFormatReader?: ZxingReaderConstructor;
};

type ZxingWasmReadResult = {
  text?: string;
  error?: string;
  isValid?: boolean;
};

type ZxingWasmReaderOptions = {
  formats?: string[];
  tryHarder?: boolean;
  maxNumberOfSymbols?: number;
};

type ZxingWasmModuleOverrides = {
  locateFile?: (path: string, prefix: string) => string;
};

type ZxingWasmPrepareOptions = {
  overrides?: ZxingWasmModuleOverrides;
  equalityFn?: (left: ZxingWasmModuleOverrides, right: ZxingWasmModuleOverrides) => boolean;
  fireImmediately?: boolean;
};

type ZxingWasmGlobal = {
  readBarcodes?: (source: ImageData, options?: ZxingWasmReaderOptions) => Promise<ZxingWasmReadResult[]>;
  prepareZXingModule?: (options?: ZxingWasmPrepareOptions) => void | Promise<unknown>;
  purgeZXingModule?: () => void;
  ZXING_WASM_VERSION?: string;
};

type CameraScanRequestDetail = {
  inputId?: string;
};

type NumericCapability = {
  min: number;
  max: number;
  step?: number;
};

type ExtendedTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  zoom?: NumericCapability;
};

type ExtendedTrackSettings = MediaTrackSettings & {
  zoom?: number;
};

type ExtendedConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
  zoom?: number;
};

type ZoomRange = NumericCapability;
type ScannerEngineStatus = 'idle' | 'native' | 'fast' | 'recovering' | 'fallback';

type ScanProfile = {
  widthFraction: number;
  heightFraction: number;
  contrast: number;
  upscale: number;
};

const SCAN_PROFILES: ScanProfile[] = [
  { widthFraction: 0.82, heightFraction: 0.34, contrast: 1, upscale: 1 },
  { widthFraction: 0.82, heightFraction: 0.34, contrast: 1.45, upscale: 1 },
  { widthFraction: 0.68, heightFraction: 0.28, contrast: 1.3, upscale: 1.35 },
  { widthFraction: 0.94, heightFraction: 0.55, contrast: 1.35, upscale: 1 },
  { widthFraction: 1, heightFraction: 1, contrast: 1.15, upscale: 1 },
];

const ZXING_WASM_MODULE_OVERRIDES: ZxingWasmModuleOverrides = {
  locateFile: (path, prefix) => path.endsWith('.wasm') ? ZXING_WASM_BINARY_URL : `${prefix}${path}`,
};

let zxingLoadPromise: Promise<ZxingBrowserGlobal> | null = null;
let zxingWasmLoadPromise: Promise<ZxingWasmGlobal> | null = null;

function zxingGlobal() {
  return (window as unknown as { ZXingBrowser?: ZxingBrowserGlobal }).ZXingBrowser ?? null;
}

function zxingWasmGlobal() {
  return (window as unknown as { ZXingWASM?: ZxingWasmGlobal }).ZXingWASM ?? null;
}

function loadZxingFallback() {
  const loaded = zxingGlobal();
  if (loaded) return Promise.resolve(loaded);
  if (zxingLoadPromise) return zxingLoadPromise;

  zxingLoadPromise = new Promise<ZxingBrowserGlobal>((resolve, reject) => {
    document.querySelector<HTMLScriptElement>('script[data-ecoflow-barcode-fallback="true"]')?.remove();
    const script = document.createElement('script');
    script.src = ZXING_FALLBACK_URL;
    script.async = true;
    script.dataset.ecoflowBarcodeFallback = 'true';
    script.onload = () => {
      const api = zxingGlobal();
      if (api) resolve(api);
      else reject(new Error('The backup barcode scanner did not initialise.'));
    };
    script.onerror = () => reject(new Error('The backup barcode scanner could not load.'));
    document.head.appendChild(script);
  }).catch((error) => {
    zxingLoadPromise = null;
    document.querySelector<HTMLScriptElement>('script[data-ecoflow-barcode-fallback="true"]')?.remove();
    throw error;
  });

  return zxingLoadPromise;
}

function loadZxingWasmReader() {
  const loaded = zxingWasmGlobal();
  if (loaded?.readBarcodes) return Promise.resolve(loaded);
  if (zxingWasmLoadPromise) return zxingWasmLoadPromise;

  zxingWasmLoadPromise = new Promise<ZxingWasmGlobal>((resolve, reject) => {
    document.querySelector<HTMLScriptElement>('script[data-ecoflow-barcode-wasm="true"]')?.remove();
    const script = document.createElement('script');
    script.src = ZXING_WASM_READER_URL;
    script.async = true;
    script.dataset.ecoflowBarcodeWasm = 'true';
    script.onload = () => {
      const api = zxingWasmGlobal();
      if (api?.readBarcodes) resolve(api);
      else reject(new Error('Warehouse scanner engine did not initialise.'));
    };
    script.onerror = () => reject(new Error('Warehouse scanner engine could not load.'));
    document.head.appendChild(script);
  }).catch((error) => {
    zxingWasmLoadPromise = null;
    document.querySelector<HTMLScriptElement>('script[data-ecoflow-barcode-wasm="true"]')?.remove();
    throw error;
  });

  return zxingWasmLoadPromise;
}

async function prepareZxingWasmReader(api: ZxingWasmGlobal, forceReinitialise = false) {
  if (!api.readBarcodes || !api.prepareZXingModule) throw new Error('Warehouse scanner engine API is incomplete.');
  if (api.ZXING_WASM_VERSION && api.ZXING_WASM_VERSION !== ZXING_WASM_VERSION) {
    throw new Error(`Warehouse scanner engine version mismatch: ${api.ZXING_WASM_VERSION}.`);
  }

  if (forceReinitialise) api.purgeZXingModule?.();
  await api.prepareZXingModule({
    overrides: ZXING_WASM_MODULE_OVERRIDES,
    fireImmediately: true,
    ...(forceReinitialise ? { equalityFn: () => false } : {}),
  });
  return api;
}

async function loadPreparedZxingWasmReader() {
  return prepareZxingWasmReader(await loadZxingWasmReader());
}

function createZxingReader(api: ZxingBrowserGlobal) {
  const Reader = api.BrowserMultiFormatOneDReader ?? api.BrowserMultiFormatReader;
  if (!Reader) throw new Error('The backup iPhone barcode scanner is unavailable.');
  return new Reader(undefined, {
    delayBetweenScanAttempts: ZXING_SCAN_INTERVAL_MS,
    delayBetweenScanSuccess: 0,
    tryPlayVideoTimeout: 8000,
  });
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

function warehouseSurfaceVisible() {
  return window.location.pathname === '/warehouse-map'
    || Boolean(Array.from(document.querySelectorAll<HTMLElement>('.warehouse-receive-screen, .barcode-sprint-screen, .first-stocktake-screen, .mobile-title')).find(isVisible));
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
}

function nextFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function cameraScore(device: MediaDeviceInfo) {
  const label = device.label.toLowerCase().trim();
  if (!label) return 0;
  let score = 0;
  if (/(back|rear|environment)/.test(label)) score += 100;
  if (/^(back|rear) camera$/.test(label)) score += 45;
  if (/(main|dual|triple)/.test(label)) score += 20;
  if (/wide/.test(label)) score += 8;
  if (/(ultra[\s-]?wide|0\.5x)/.test(label)) score -= 140;
  if (/(telephoto|tele\b)/.test(label)) score -= 70;
  if (/(front|user|facetime)/.test(label)) score -= 250;
  return score;
}

function bestRearCamera(devices: MediaDeviceInfo[]) {
  return devices
    .filter((device) => device.kind === 'videoinput' && Boolean(device.deviceId))
    .map((device) => ({ device, score: cameraScore(device) }))
    .filter(({ device, score }) => score > 0 && !/(front|user|facetime)/i.test(device.label))
    .sort((left, right) => right.score - left.score)[0]?.device ?? null;
}

function cameraConstraints(deviceId?: string, strictEnvironment = false): MediaStreamConstraints {
  const selection: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: strictEnvironment ? { exact: 'environment' } : { ideal: 'environment' } };
  return {
    audio: false,
    video: {
      ...selection,
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30, max: 60 },
    },
  };
}

async function enumerateVideoDevices() {
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [] as MediaDeviceInfo[];
  }
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function selectedFrontCamera(track?: MediaStreamTrack) {
  const settingsFacingMode = track?.getSettings().facingMode?.toLowerCase() || '';
  const label = track?.label.toLowerCase() || '';
  return settingsFacingMode === 'user' || /(front|user|facetime)/.test(label);
}

function selectedPoorRearLens(track?: MediaStreamTrack) {
  const label = track?.label.toLowerCase() || '';
  return /(ultra[\s-]?wide|0\.5x|telephoto|tele\b)/.test(label);
}

async function requestEnvironmentStream() {
  try {
    return await navigator.mediaDevices.getUserMedia(cameraConstraints(undefined, true));
  } catch {
    return navigator.mediaDevices.getUserMedia(cameraConstraints(undefined, false));
  }
}

async function openBestRearStream() {
  // Prefer the browser's semantic rear-camera constraint first. This is more reliable on iOS
  // than pre-permission device labels, which can be empty or generic and previously let the
  // first/front camera win.
  let stream = await requestEnvironmentStream();
  let track = stream.getVideoTracks()[0];

  if (!selectedFrontCamera(track) && !selectedPoorRearLens(track)) return stream;

  // Permission should now expose more useful labels. Only choose a device that we can
  // positively identify as rear-facing; never treat an arbitrary first device as "rear".
  const permittedDevices = await enumerateVideoDevices();
  const betterRear = bestRearCamera(permittedDevices);
  const currentDeviceId = track?.getSettings().deviceId;

  if (betterRear?.deviceId && betterRear.deviceId !== currentDeviceId) {
    stopStream(stream);
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(betterRear.deviceId));
    track = stream.getVideoTracks()[0];
    if (!selectedFrontCamera(track)) return stream;
  }

  if (!selectedFrontCamera(track)) return stream;

  // If Safari still handed us the user-facing camera, fail closed instead of silently
  // scanning with the selfie camera. Retry the strict environment constraint once after
  // permission, when iOS has the best chance of resolving the rear camera correctly.
  stopStream(stream);
  try {
    const rearStream = await navigator.mediaDevices.getUserMedia(cameraConstraints(undefined, true));
    if (!selectedFrontCamera(rearStream.getVideoTracks()[0])) return rearStream;
    stopStream(rearStream);
  } catch {
    // Surface a clear error below rather than falling back to the front camera.
  }
  throw new Error('Rear camera could not be selected. Check Safari camera permission and try again.');
}

async function applyAdvancedConstraint(track: MediaStreamTrack, constraint: ExtendedConstraintSet) {
  try {
    await track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
  } catch {
    // Camera capabilities differ between iPhones. Unsupported tuning is non-fatal.
  }
}

async function optimiseCameraTrack(track: MediaStreamTrack) {
  if ('contentHint' in track) track.contentHint = 'detail';
  const capabilities = track.getCapabilities?.() as ExtendedTrackCapabilities | undefined;
  if (!capabilities) return null;

  if (capabilities.focusMode?.includes('continuous')) await applyAdvancedConstraint(track, { focusMode: 'continuous' });
  if (capabilities.exposureMode?.includes('continuous')) await applyAdvancedConstraint(track, { exposureMode: 'continuous' });
  if (capabilities.whiteBalanceMode?.includes('continuous')) await applyAdvancedConstraint(track, { whiteBalanceMode: 'continuous' });

  const zoom = capabilities.zoom;
  if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max) || zoom.max <= zoom.min) return null;
  const settings = track.getSettings() as ExtendedTrackSettings;
  const current = Math.min(zoom.max, Math.max(zoom.min, settings.zoom ?? zoom.min));
  const preferred = Math.min(zoom.max, Math.max(current, Math.max(zoom.min, Math.min(1.5, Math.max(1.25, zoom.min + 0.35)))));
  if (preferred > current + 0.01) await applyAdvancedConstraint(track, { zoom: preferred });
  return {
    range: zoom,
    value: preferred,
  };
}

function scanProfileForAttempt(attempt: number) {
  return SCAN_PROFILES[attempt % SCAN_PROFILES.length];
}

function applyBarcodeContrast(imageData: ImageData, contrast: number) {
  if (contrast <= 1.01) return imageData;
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const value = Math.max(0, Math.min(255, Math.round((luminance - 128) * contrast + 128)));
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
  return imageData;
}

function captureBarcodeCandidate(video: HTMLVideoElement, canvas: HTMLCanvasElement, profile: ScanProfile) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const cropWidth = Math.max(1, Math.round(sourceWidth * profile.widthFraction));
  const cropHeight = Math.max(1, Math.round(sourceHeight * profile.heightFraction));
  const sourceX = Math.max(0, Math.round((sourceWidth - cropWidth) / 2));
  const sourceY = Math.max(0, Math.round((sourceHeight - cropHeight) / 2));
  const requestedWidth = Math.round(cropWidth * profile.upscale);
  const targetWidth = Math.max(320, Math.min(MAX_SCAN_CANVAS_WIDTH, requestedWidth));
  const targetHeight = Math.max(160, Math.round(targetWidth * (cropHeight / cropWidth)));

  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.imageSmoothingEnabled = requestedWidth <= cropWidth;
  context.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  if (profile.contrast > 1.01) {
    applyBarcodeContrast(imageData, profile.contrast);
    context.putImageData(imageData, 0, 0);
  }
  return { canvas, imageData };
}

export function WarehouseCameraScanner() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [engineStatus, setEngineStatus] = useState<ScannerEngineStatus>('idle');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const wasmReaderRef = useRef<ZxingWasmGlobal | null>(null);
  const zxingControlsRef = useRef<ZxingControls | null>(null);
  const scanningRef = useRef(false);
  const decodeBusyRef = useRef(false);
  const acceptedRef = useRef(false);
  const fallbackStartingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);
  const scanAttemptRef = useRef(0);
  const wasmRuntimeFailureRef = useRef(0);
  const wasmRecoveryAttemptRef = useRef(0);

  useEffect(() => {
    function refresh() {
      setAvailable(window.innerWidth <= 960 && warehouseSurfaceVisible() && Boolean(barcodeInput()));
    }
    const stopObserving = observeBody(refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('focusin', refresh);
    return () => {
      stopObserving();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('focusin', refresh);
    };
  }, []);

  function stopCamera() {
    scanningRef.current = false;
    decodeBusyRef.current = false;
    fallbackStartingRef.current = false;
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    void zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    wasmReaderRef.current = null;
    scanAttemptRef.current = 0;
    wasmRuntimeFailureRef.current = 0;
    wasmRecoveryAttemptRef.current = 0;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setZoomRange(null);
    setZoomLevel(1);
    setEngineStatus('idle');
    setStarting(false);
  }

  function closeScanner() {
    stopCamera();
    setOpen(false);
    setError('');
  }

  async function acceptBarcode(value: string) {
    if (acceptedRef.current) return;
    const target = barcodeInput();
    if (!target) {
      setError('Open a barcode field before scanning.');
      return;
    }
    acceptedRef.current = true;
    setReactInputValue(target, value);
    navigator.vibrate?.([35, 30, 35]);
    closeScanner();
    if (/then enter/i.test(target.placeholder)) {
      window.setTimeout(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })), 80);
    }
  }

  async function decodeCurrentFrame() {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return '';
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvasRef.current = canvas;
    const profile = scanProfileForAttempt(scanAttemptRef.current);
    scanAttemptRef.current += 1;
    const candidate = captureBarcodeCandidate(video, canvas, profile);
    if (!candidate) return '';

    if (wasmReaderRef.current?.readBarcodes) {
      const results = await wasmReaderRef.current.readBarcodes(candidate.imageData, {
        formats: WAREHOUSE_WASM_FORMATS,
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      wasmRuntimeFailureRef.current = 0;
      return results.find((result) => result.isValid !== false && result.text?.trim())?.text?.trim() ?? '';
    }

    if (detectorRef.current) {
      const results = await detectorRef.current.detect(candidate.canvas);
      return results.find((result) => result.rawValue)?.rawValue?.trim() ?? '';
    }

    return '';
  }

  async function recoverZxingWasmReader() {
    const api = wasmReaderRef.current ?? zxingWasmGlobal();
    if (!api?.readBarcodes) throw new Error('Fast scanner engine is unavailable for recovery.');
    wasmRecoveryAttemptRef.current += 1;
    setEngineStatus('recovering');
    await prepareZxingWasmReader(api, true);
    if (!streamRef.current) return;
    wasmReaderRef.current = api;
    wasmRuntimeFailureRef.current = 0;
    setEngineStatus('fast');
  }

  async function activateLegacyFallback() {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || fallbackStartingRef.current || zxingControlsRef.current) return;

    fallbackStartingRef.current = true;
    scanningRef.current = false;
    wasmReaderRef.current = null;
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setEngineStatus('fallback');
    try {
      await startLegacyIphoneFallback(video, stream);
    } catch (fallbackError) {
      if (streamRef.current === stream) {
        setError(fallbackError instanceof Error
          ? `${fallbackError.message} Enter the barcode manually if needed.`
          : 'Backup barcode scanner is unavailable. Enter the barcode manually if needed.');
      }
    } finally {
      fallbackStartingRef.current = false;
    }
  }

  async function handleWasmRuntimeFailure() {
    if (!wasmReaderRef.current) return;
    wasmRuntimeFailureRef.current += 1;
    if (wasmRuntimeFailureRef.current < WASM_RUNTIME_FAILURE_LIMIT) return;

    if (wasmRecoveryAttemptRef.current < WASM_RECOVERY_LIMIT) {
      try {
        await recoverZxingWasmReader();
        return;
      } catch {
        // A failed reinitialisation is an engine-health failure, not a barcode miss.
      }
    }
    await activateLegacyFallback();
  }

  async function scanFrame() {
    if (!scanningRef.current) return;
    const interval = wasmReaderRef.current ? WASM_SCAN_INTERVAL_MS : NATIVE_SCAN_INTERVAL_MS;
    const now = performance.now();
    if (!decodeBusyRef.current && now - lastDetectRef.current >= interval) {
      lastDetectRef.current = now;
      decodeBusyRef.current = true;
      try {
        const code = await decodeCurrentFrame();
        if (code) {
          await acceptBarcode(code);
          return;
        }
      } catch {
        if (wasmReaderRef.current) await handleWasmRuntimeFailure();
      } finally {
        decodeBusyRef.current = false;
      }
    }
    if (scanningRef.current) rafRef.current = window.requestAnimationFrame(() => void scanFrame());
  }

  async function mountedVideo() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (videoRef.current) return videoRef.current;
      await nextFrame();
    }
    return null;
  }

  async function prepareStream() {
    const stream = await openBestRearStream();
    streamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      const zoom = await optimiseCameraTrack(track);
      if (zoom) {
        setZoomRange(zoom.range);
        setZoomLevel(zoom.value);
      }
    }
    return stream;
  }

  async function startNativeScanner(video: HTMLVideoElement, DetectorClass: DetectorConstructor) {
    const requestedFormats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'codabar', 'upc_a', 'upc_e', 'itf'];
    const supported = DetectorClass.getSupportedFormats ? await DetectorClass.getSupportedFormats() : requestedFormats;
    const formats = requestedFormats.filter((format) => supported.includes(format));
    detectorRef.current = new DetectorClass(formats.length ? { formats } : undefined);
    const stream = await prepareStream();
    video.srcObject = stream;
    await video.play();
    setEngineStatus('native');
    scanningRef.current = true;
    void scanFrame();
  }

  async function startLegacyIphoneFallback(video: HTMLVideoElement, stream: MediaStream) {
    const api = await loadZxingFallback();
    const reader = createZxingReader(api);
    const controls = await reader.decodeFromStream(
      stream,
      video,
      (result) => {
        const code = result?.getText?.().trim() || result?.text?.trim();
        if (code) void acceptBarcode(code);
      },
    );
    zxingControlsRef.current = controls;
    setEngineStatus('fallback');
  }

  async function startIphoneScanner(video: HTMLVideoElement) {
    // Start self-hosted ZXing-C++ initialisation while the camera opens. fireImmediately
    // prewarms the local WASM before we declare the fast scanner ready.
    const wasmPromise = loadPreparedZxingWasmReader();
    const stream = await prepareStream();
    video.srcObject = stream;
    await video.play();

    try {
      const api = await wasmPromise;
      if (streamRef.current !== stream) return;
      wasmReaderRef.current = api;
      wasmRuntimeFailureRef.current = 0;
      wasmRecoveryAttemptRef.current = 0;
      setEngineStatus('fast');
      scanningRef.current = true;
      void scanFrame();
    } catch {
      // Same-origin WASM failed to initialise. Move explicitly to the same-origin backup
      // decoder instead of leaving a dead WASM reader in an endless silent retry loop.
      await startLegacyIphoneFallback(video, stream);
    }
  }

  async function startCamera() {
    const target = barcodeInput();
    if (!target) return;
    acceptedRef.current = false;
    setOpen(true);
    setError('');
    setEngineStatus('idle');
    setStarting(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser.');
      setStarting(false);
      return;
    }
    try {
      const video = await mountedVideo();
      if (!video) throw new Error('Camera screen could not be opened. Close and try again.');
      const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (DetectorClass) await startNativeScanner(video, DetectorClass);
      else await startIphoneScanner(video);
      setStarting(false);
    } catch (cameraError) {
      setError(cameraError instanceof Error ? `${cameraError.message} Enter the barcode manually if needed.` : 'Camera could not be opened.');
      stopCamera();
    }
  }

  useEffect(() => {
    function handleCameraRequest(event: Event) {
      const detail = (event as CustomEvent<CameraScanRequestDetail>).detail;
      const requested = detail?.inputId ? document.getElementById(detail.inputId) : null;
      if (requested instanceof HTMLInputElement && isVisible(requested)) requested.focus();
      void startCamera();
    }

    window.addEventListener(CAMERA_SCAN_EVENT, handleCameraRequest);
    return () => window.removeEventListener(CAMERA_SCAN_EVENT, handleCameraRequest);
    // The scanner is mounted once per Warehouse surface; refs hold the active camera state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeZoom(direction: -1 | 1) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !zoomRange) return;
    const increment = Math.max(zoomRange.step || 0, 0.25);
    const next = Math.min(zoomRange.max, Math.max(zoomRange.min, zoomLevel + increment * direction));
    if (Math.abs(next - zoomLevel) < 0.001) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] });
      setZoomLevel(next);
    } catch {
      setError('Camera zoom is not available on this device.');
    }
  }

  async function toggleTorch() {
    const next = !torchOn;
    try {
      if (zxingControlsRef.current?.switchTorch) {
        await zxingControlsRef.current.switchTorch(next);
        setTorchOn(next);
        return;
      }
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track?.applyConstraints) throw new Error('Torch control is not available on this device.');
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setError('Torch control is not available on this device.');
    }
  }

  useEffect(() => () => stopCamera(), []);

  const scannerMessage = starting
    ? 'Opening camera and warming scanner…'
    : engineStatus === 'fast'
      ? 'Fast scanner ready — hold one barcode inside the green frame.'
      : engineStatus === 'recovering'
        ? 'Recovering fast scanner… keep the barcode inside the green frame.'
        : engineStatus === 'fallback'
          ? 'Backup scanner active — hold one barcode inside the green frame.'
          : 'Hold one barcode inside the green frame.';

  return (
    <>
      {available && !open ? <button className="warehouse-camera-scan-launch" type="button" onClick={() => void startCamera()}>Scan barcode</button> : null}
      {open ? (
        <div className="warehouse-camera-overlay" role="dialog" aria-modal="true" aria-label="Scan warehouse barcode">
          <div className="warehouse-camera-sheet">
            <header><div><h2>Scan barcode</h2></div><button type="button" onClick={closeScanner}>Close</button></header>
            <div className="warehouse-camera-view"><video ref={videoRef} playsInline muted /><div className="warehouse-camera-reticle" /></div>
            {error ? <div className="warehouse-camera-error">{error}</div> : <p>{scannerMessage}</p>}
            <div className="warehouse-camera-actions">
              {zoomRange ? <button type="button" disabled={zoomLevel <= zoomRange.min + 0.01} onClick={() => void changeZoom(-1)}>Zoom −</button> : null}
              {zoomRange ? <button type="button" disabled={zoomLevel >= zoomRange.max - 0.01} onClick={() => void changeZoom(1)}>Zoom +</button> : null}
              {streamRef.current ? <button type="button" onClick={() => void toggleTorch()}>{torchOn ? 'Torch off' : 'Torch on'}</button> : null}
              <button type="button" onClick={closeScanner}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
