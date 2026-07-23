import { useEffect, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';

const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';
const ZXING_FALLBACK_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
const NATIVE_SCAN_INTERVAL_MS = 90;
const ZXING_SCAN_INTERVAL_MS = 80;

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

let zxingLoadPromise: Promise<ZxingBrowserGlobal> | null = null;

function zxingGlobal() {
  return (window as unknown as { ZXingBrowser?: ZxingBrowserGlobal }).ZXingBrowser ?? null;
}

function loadZxingFallback() {
  const loaded = zxingGlobal();
  if (loaded) return Promise.resolve(loaded);
  if (zxingLoadPromise) return zxingLoadPromise;

  zxingLoadPromise = new Promise<ZxingBrowserGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ZXING_FALLBACK_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.ecoflowBarcodeFallback = 'true';
    script.onload = () => {
      const api = zxingGlobal();
      if (api) resolve(api);
      else reject(new Error('The iPhone barcode scanner did not initialise.'));
    };
    script.onerror = () => reject(new Error('The iPhone barcode scanner could not load.'));
    document.head.appendChild(script);
  }).catch((error) => {
    zxingLoadPromise = null;
    throw error;
  });

  return zxingLoadPromise;
}

function createZxingReader(api: ZxingBrowserGlobal) {
  const Reader = api.BrowserMultiFormatOneDReader ?? api.BrowserMultiFormatReader;
  if (!Reader) throw new Error('The iPhone barcode scanner is unavailable.');
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
    .sort((left, right) => cameraScore(right) - cameraScore(left))[0] ?? null;
}

function cameraConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
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

async function openBestRearStream() {
  const knownDevices = await enumerateVideoDevices();
  const knownRear = bestRearCamera(knownDevices.filter((device) => Boolean(device.label)));
  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(knownRear?.deviceId));
  } catch (error) {
    if (!knownRear?.deviceId) throw error;
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
  }

  const track = stream.getVideoTracks()[0];
  const selectedLabel = track?.label.toLowerCase() || '';
  const poorSelection = /(ultra[\s-]?wide|0\.5x|front|facetime)/.test(selectedLabel);
  if (!poorSelection) return stream;

  const permittedDevices = await enumerateVideoDevices();
  const betterRear = bestRearCamera(permittedDevices.filter((device) => !/(ultra[\s-]?wide|0\.5x|front|facetime)/i.test(device.label)));
  const currentDeviceId = track?.getSettings().deviceId;
  if (!betterRear?.deviceId || betterRear.deviceId === currentDeviceId) return stream;

  stream.getTracks().forEach((item) => item.stop());
  try {
    return await navigator.mediaDevices.getUserMedia(cameraConstraints(betterRear.deviceId));
  } catch {
    return navigator.mediaDevices.getUserMedia(cameraConstraints());
  }
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
  return {
    range: zoom,
    value: Math.min(zoom.max, Math.max(zoom.min, settings.zoom ?? zoom.min)),
  };
}

export function WarehouseCameraScanner() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const zxingControlsRef = useRef<ZxingControls | null>(null);
  const scanningRef = useRef(false);
  const acceptedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);

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
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    void zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setZoomRange(null);
    setZoomLevel(1);
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

  async function scanFrame() {
    if (!scanningRef.current || !videoRef.current || !detectorRef.current) return;
    const video = videoRef.current;
    const now = performance.now();
    if (now - lastDetectRef.current >= NATIVE_SCAN_INTERVAL_MS && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      lastDetectRef.current = now;
      try {
        const results = await detectorRef.current.detect(video);
        const code = results.find((result) => result.rawValue)?.rawValue?.trim();
        if (code) {
          await acceptBarcode(code);
          return;
        }
      } catch {
        // The camera may still be focusing. Keep scanning.
      }
    }
    rafRef.current = window.requestAnimationFrame(() => void scanFrame());
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
    scanningRef.current = true;
    void scanFrame();
  }

  async function startIphoneScanner(video: HTMLVideoElement) {
    const api = await loadZxingFallback();
    const reader = createZxingReader(api);
    const stream = await prepareStream();
    const controls = await reader.decodeFromStream(
      stream,
      video,
      (result) => {
        const code = result?.getText?.().trim() || result?.text?.trim();
        if (code) void acceptBarcode(code);
      },
    );
    zxingControlsRef.current = controls;
  }

  async function startCamera() {
    const target = barcodeInput();
    if (!target) return;
    acceptedRef.current = false;
    setOpen(true);
    setError('');
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

  return (
    <>
      {available && !open ? <button className="warehouse-camera-scan-launch" type="button" onClick={() => void startCamera()}>Scan barcode</button> : null}
      {open ? (
        <div className="warehouse-camera-overlay" role="dialog" aria-modal="true" aria-label="Scan warehouse barcode">
          <div className="warehouse-camera-sheet">
            <header><div><h2>Scan barcode</h2></div><button type="button" onClick={closeScanner}>Close</button></header>
            <div className="warehouse-camera-view"><video ref={videoRef} playsInline muted /><div className="warehouse-camera-reticle" /></div>
            {error ? <div className="warehouse-camera-error">{error}</div> : <p>{starting ? 'Opening camera…' : 'Fill the green frame with one barcode.'}</p>}
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
