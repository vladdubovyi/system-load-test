import { SimulationEngine } from '../src/game/simulation';
import { buildPreset } from '../src/game/presets';
import { SCENARIO } from '../src/game/types';
import { buildReferenceComponentConfigs } from '../src/game/component-config';

const { components, belts } = buildPreset();
const componentConfigs = buildReferenceComponentConfigs(components);
const dt = 1 / 60;

let maxObservedLoad = 0;
let hundreds = 0;
const runs = 20;

for (let run = 0; run < runs; run++) {
  const engine = new SimulationEngine(components, belts, componentConfigs);
  engine.start();

  while (true) {
    const snap = engine.tick(dt);
    for (const st of snap.components.values()) {
      maxObservedLoad = Math.max(maxObservedLoad, st.load);
    }
    if (snap.status === 'won' || snap.status === 'lost') break;
  }

  const report = engine.getReport();
  if (report.score === 100) hundreds += 1;
  for (const c of report.components) {
    if (c.maxLoad > 100.01) {
      console.error(`FAIL: ${c.label} reported maxLoad ${c.maxLoad}%`);
      process.exit(1);
    }
  }
}

console.log(`Preset runs: ${runs}, score 100: ${hundreds}/${runs}, duration: ${SCENARIO.duration}s`);
console.log(`Max observed load: ${maxObservedLoad.toFixed(2)}%`);

if (hundreds < runs * 0.85) {
  console.error('FAIL: preset with reference config should mostly score 100');
  process.exit(1);
}

if (maxObservedLoad > 100.01) {
  console.error('FAIL: load exceeded 100%');
  process.exit(1);
}

console.log('PASS');
