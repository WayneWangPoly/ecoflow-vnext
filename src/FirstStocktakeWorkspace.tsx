import { useState } from 'react';
import { FirstStocktakeFlow } from './FirstStocktakeFlow';
import { FirstStocktakeMappingFlow } from './FirstStocktakeMappingFlow';

const PHASE_KEY = 'ecoflow:first-stocktake-phase';
type Phase = 'map' | 'count';

function initialPhase(): Phase {
  return window.localStorage.getItem(PHASE_KEY) === 'count' ? 'count' : 'map';
}

export function FirstStocktakeWorkspace() {
  const [phase, setPhase] = useState<Phase>(initialPhase);

  function choose(next: Phase) {
    setPhase(next);
    window.localStorage.setItem(PHASE_KEY, next);
  }

  return (
    <section className="first-stocktake-workspace">
      <nav className="first-stocktake-phase-switch" aria-label="First stocktake phase">
        <button type="button" className={phase === 'map' ? 'active' : ''} onClick={() => choose('map')}><b>1</b><span>Map products</span></button>
        <button type="button" className={phase === 'count' ? 'active' : ''} onClick={() => choose('count')}><b>2</b><span>Opening count</span></button>
      </nav>
      {phase === 'map' ? <FirstStocktakeMappingFlow /> : <FirstStocktakeFlow />}
    </section>
  );
}
