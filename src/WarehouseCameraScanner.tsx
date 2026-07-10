import { useEffect, useRef, useState } from 'react';

type Detector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

type DetectorConstructor = {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

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
  return ['/warehouse-map'].includes(window.location.pathname)
    || Boolean(Array.from(document.querySelectorAll<HTMLElement>('.warehouse-receive-screen, .barcode-sprint-screen, .mobile-title')).find(isVisible));
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
}

export function WarehouseCameraScanner() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const scanningRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    function refresh() {
      setAvailable(window.innerWidth <= 960 && warehouseSurfaceVisible() && Boolean(barcodeInput()));
    }
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', refresh);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refresh);
    };
  }, []);

  function stopCamera() {
    scanningRef.current = false;
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    setTorchOn(false);
  }

  function closeScanner() {
    stopCamera();
    setOpen(false);
    setError('');
  }

  async function acceptBarcode(value: string) {
    const target = barcodeInput();
    if (!target) {
      setError('Open a barcode field before scanning.');
      return;
    }
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
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        const results = await detectorRef.current.detect(video);
        const code = results.find((result) => result.rawValue)?.rawValue?.trim();
        if (code) {
          await acceptBarcode(code);
          return;
        }
      } catch {
        // A frame may be unreadable while the camera is focusing; keep scanning.
      }
    }
    rafRef.current = window.requestAnimationFrame(() => void scanFrame());
  }

  async function startCamera() {
    setOpen(true);
    setError('');
    const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!DetectorClass) {
      setError('Live barcode detection is not supported by this browser. Use the barcode field or the device scanner shortcut.');
      return;
    }
    try {
      const requestedFormats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf'];
      const supported = DetectorClass.getSupportedFormats ? await DetectorClass.getSupportedFormats() : requestedFormats;
      const formats = requestedFormats.filter((format) => supported.includes(format));
      detectorRef.current = new DetectorClass(formats.length ? { formats } : undefined);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      scanningRef.current = true;
      void scanFrame();
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : 'Camera could not be opened.');
      stopCamera();
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0] as (MediaStreamTrack & { getCapabilities?: () => { torch?: boolean } }) | undefined;
    if (!track?.applyConstraints) return;
    const next = !torchOn;
    try {
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
            <header><div><span>CAMERA SCANNER</span><h2>Aim at one barcode</h2></div><button type="button" onClick={closeScanner}>Close</button></header>
            <div className="warehouse-camera-view"><video ref={videoRef} playsInline muted /><div className="warehouse-camera-reticle" /></div>
            {error ? <div className="warehouse-camera-error">{error}</div> : <p>Hold steady. The code is captured automatically and returned to the active warehouse field.</p>}
            <div className="warehouse-camera-actions"><button type="button" onClick={() => void toggleTorch()}>{torchOn ? 'Torch off' : 'Torch on'}</button><button type="button" onClick={closeScanner}>Cancel</button></div>
          </div>
        </div>
      ) : null}
    </>
  );
}
