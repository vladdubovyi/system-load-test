import { SimulationEngine } from '../src/game/simulation';
import { buildPreset } from '../src/game/presets';
import { SCENARIO } from '../src/game/types';
import { buildReferenceComponentConfigs } from '../src/game/component-config';

const { components: presetComponents, belts: presetBelts } = buildPreset();
const componentConfigs = buildReferenceComponentConfigs(presetComponents);
const dt = 1 / 60;

let maxObservedLoad = 0;
let hundreds = 0;
const runs = 20;

for (let run = 0; run < runs; run++) {
  const components = structuredClone(presetComponents);
  const belts = structuredClone(presetBelts);
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

  // Flow assertions: the reference preset satisfies the URL shortener flows,
  // so no request may terminate as a flow violation and both kinds complete.
  const snap = engine.getSnapshot();
  if (snap.totalViolated !== 0) {
    console.error(
      `FAIL: reference preset produced ${snap.totalViolated} flow violations:`,
      snap.violationsByStep
    );
    process.exit(1);
  }
  for (const kind of ['create', 'read']) {
    const spawned = snap.spawnedByKind[kind] ?? 0;
    const completed = snap.completedByKind[kind] ?? 0;
    if (spawned === 0 || completed / spawned < 0.95) {
      console.error(
        `FAIL: kind "${kind}" completed ${completed}/${spawned} (< 95%)`
      );
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
