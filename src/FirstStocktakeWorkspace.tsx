import { useState } from 'react';
import { FirstStocktakeFlow } from './FirstStocktakeFlow';

const PHASE_KEY = 'ecoflow:first-stocktake-phase';
type Phase = 'identity' | 'count';

function initialPhase(): Phase {
  return window.localStorage.getItem(PHASE_KEY) === 'count' ? 'count' : 'identity';
}

export function FirstStocktakeWorkspace() {
  const [phase, setPhase] = useState<Phase>(initialPhase);

  function choose(next: Phase) {
    setPhase(next);
    window.localStorage.setItem(PHASE_KEY, next);
  }

  function openProductIdentity() {
    window.location.assign('/commissioning/product-identity');
  }

  return (
    <section className="first-stocktake-workspace">
      <nav className="first-stocktake-phase-switch" aria-label="First stocktake phase">
        <button type="button" className={phase === 'identity' ? 'active' : ''} onClick={() => choose('identity')}><b>1</b><span>Product identity</span></button>
        <button type="button" className={phase === 'count' ? 'active' : ''} onClick={() => choose('count')}><b>2</b><span>Opening count</span></button>
      </nav>
      {phase === 'identity' ? (
        <section className="first-stocktake-map-screen">
          <header className="first-stocktake-map-header">
            <div><span>PRODUCT IDENTITY</span><h2>Commission packaging before counting</h2></div>
            <strong>Stock unchanged</strong>
          </header>
          <div className="first-stocktake-session-status">
            <div>
              <strong>One identity authority</strong>
              <span>Barcode ownership, package conversion and retirement are published from Product Identity only.</span>
            </div>
            <button type="button" onClick={openProductIdentity}>Open Product Identity</button>
          </div>
          <p className="first-stocktake-map-note">
            Do not create barcode mappings inside Stocktake. Publish the physical packaging identity first, then return here and count the packages on the shelf.
          </p>
        </section>
      ) : <FirstStocktakeFlow />}
    </section>
  );
}