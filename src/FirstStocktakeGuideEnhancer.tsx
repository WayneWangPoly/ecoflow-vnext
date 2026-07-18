import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';

type GuideSnapshot = {
  location: string;
  sku: string;
  barcode: string;
  lineCount: number;
  verifiedCount: number;
  postReady: boolean;
};

type CurrentAction = {
  step: string;
  title: string;
  detail: string;
};

const EMPTY_SNAPSHOT: GuideSnapshot = {
  location: '',
  sku: '',
  barcode: '',
  lineCount: 0,
  verifiedCount: 0,
  postReady: false,
};

function valueOf(screen: HTMLElement, selector: string) {
  return screen.querySelector<HTMLInputElement>(selector)?.value.trim() || '';
}

function readSnapshot(screen: HTMLElement): GuideSnapshot {
  const lines = Array.from(screen.querySelectorAll<HTMLButtonElement>('.first-stocktake-lines > button'));
  const postButton = screen.querySelector<HTMLButtonElement>('.first-stocktake-post');
  return {
    location: valueOf(screen, '#first-stocktake-location'),
    sku: valueOf(screen, '#first-stocktake-sku'),
    barcode: valueOf(screen, '#first-stocktake-package-barcode'),
    lineCount: lines.length,
    verifiedCount: lines.filter((line) => line.classList.contains('checked')).length,
    postReady: Boolean(postButton && !postButton.disabled),
  };
}

function actionFor(snapshot: GuideSnapshot): CurrentAction {
  if (!snapshot.location) {
    return {
      step: '1',
      title: 'Start at one physical shelf cell',
      detail: 'Enter the printed location code, then choose the side you are facing. Keep working at this location until every SKU there has been added.',
    };
  }
  if (!snapshot.sku) {
    return {
      step: '2',
      title: snapshot.lineCount ? 'Add the next SKU at this location' : 'Enter the product SKU',
      detail: 'Read the SKU printed on the packaging. Type a few letters and choose the matching Ordermentum code from the suggestions.',
    };
  }
  if (!snapshot.barcode) {
    return {
      step: '3',
      title: 'Scan the barcode on the package in front of you',
      detail: 'Use Scan beside Package barcode. Then choose whether the barcode is for an unopened carton, a sleeve inside the carton, or one individual item.',
    };
  }
  return {
    step: '4',
    title: 'Confirm the conversion and physical count',
    detail: 'For a sleeve the conversion is fixed at 1. For a carton, enter how many sleeves are inside, then enter how many cartons or sleeves you counted.',
  };
}

function reviewMessage(snapshot: GuideSnapshot) {
  if (!snapshot.lineCount) return 'No saved lines yet. Complete Steps 1–4 to add the first package.';
  if (snapshot.postReady) return 'Every saved line is verified. Post only when the entire opening stocktake is finished—not after each shelf or SKU.';
  return `${snapshot.verifiedCount} of ${snapshot.lineCount} saved lines verified. When you finish counting, tap each saved line below to check it.`;
}

export function FirstStocktakeGuideEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<GuideSnapshot>(EMPTY_SNAPSHOT);
  const [expanded, setExpanded] = useState(true);
  const frameRef = useRef<number | null>(null);

  useEffect(() => observeBody(() => {
    const screen = document.querySelector<HTMLElement>('.first-stocktake-screen');
    if (!screen) {
      setHost(null);
      return;
    }

    let mount = screen.querySelector<HTMLElement>(':scope > .first-stocktake-guide-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'first-stocktake-guide-mount';
      const steps = screen.querySelector('.first-stocktake-steps');
      screen.insertBefore(mount, steps || screen.firstChild);
    }
    setHost((current) => current === mount ? current : mount);
  }), []);

  useEffect(() => {
    const screen = host?.parentElement;
    if (!(screen instanceof HTMLElement)) return;

    const refresh = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        setSnapshot(readSnapshot(screen));
      });
    };

    refresh();
    screen.addEventListener('input', refresh, true);
    screen.addEventListener('change', refresh, true);
    screen.addEventListener('click', refresh, true);
    const observer = new MutationObserver(refresh);
    observer.observe(screen, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled'] });

    return () => {
      screen.removeEventListener('input', refresh, true);
      screen.removeEventListener('change', refresh, true);
      screen.removeEventListener('click', refresh, true);
      observer.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [host]);

  const currentAction = useMemo(() => actionFor(snapshot), [snapshot]);
  if (!host) return null;

  return createPortal(
    <section className="first-stocktake-guide" aria-label="First stocktake instructions">
      <div className="first-stocktake-current-action" aria-live="polite">
        <div className="first-stocktake-current-step">NEXT · {currentAction.step}</div>
        <div>
          <strong>{currentAction.title}</strong>
          <p>{currentAction.detail}</p>
        </div>
      </div>

      <div className={`first-stocktake-process-guide${expanded ? ' expanded' : ''}`}>
        <button
          className="first-stocktake-guide-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span><b>How the whole first stocktake works</b><small>Three phases · Add stages lines · Post writes stock once</small></span>
          <strong aria-hidden="true">{expanded ? '−' : '+'}</strong>
        </button>

        {expanded ? (
          <div className="first-stocktake-guide-body">
            <div className="first-stocktake-guide-phases">
              <article>
                <b>PHASE A</b>
                <strong>Choose one location</strong>
                <p>Enter the printed shelf code and select Left-facing or Right-facing. The location stays selected while you add every SKU stored there.</p>
              </article>
              <article>
                <b>PHASE B</b>
                <strong>Repeat for each SKU</strong>
                <p>SKU → scan package barcode → choose carton or sleeve → enter the carton conversion and count → press Add. Move to the next SKU at the same location.</p>
              </article>
              <article>
                <b>PHASE C</b>
                <strong>Review, then post once</strong>
                <p>Tap each saved line below to verify it. Post verified opening stock only after the whole first stocktake is complete and every line is checked.</p>
              </article>
            </div>

            <div className="first-stocktake-field-guide">
              <div><strong>Carton</strong><span>An unopened outer box. Enter how many sleeves are packed inside one carton.</span></div>
              <div><strong>Sleeve</strong><span>The countable pack found after opening a carton. Its Units per package value is fixed at 1.</span></div>
              <div><strong>Units per package</strong><span>For cartons: sleeves inside one carton. For sleeves or single items: automatically 1.</span></div>
              <div><strong>Packages counted</strong><span>The number of cartons, sleeves or individual items physically at this location.</span></div>
            </div>

            <div className="first-stocktake-guide-formula">
              <span>COUNT EXAMPLE</span>
              <strong>Sleeves per carton × Cartons counted = sleeve units staged for review</strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className={`first-stocktake-review-guidance${snapshot.postReady ? ' ready' : ''}`}>
        <strong>{snapshot.postReady ? 'Ready for final posting' : 'Review checkpoint'}</strong>
        <span>{reviewMessage(snapshot)}</span>
      </div>
    </section>,
    host,
  );
}
