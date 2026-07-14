import type { ArchitectureConfig } from '../game/architecture-config';
import {
  cloneArchitectureConfig,
  createDefaultArchitectureConfig,
  createReferenceArchitectureConfig,
} from '../game/architecture-config';

function toggleRow(
  id: string,
  label: string,
  description: string,
  checked: boolean
): string {
  return `
    <label class="config-toggle" for="${id}">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />
      <span class="config-toggle-body">
        <span class="config-toggle-label">${label}</span>
        <span class="config-toggle-desc">${description}</span>
      </span>
    </label>
  `;
}

function numberField(
  id: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step = 1
): string {
  return `
    <label class="config-field" for="${id}">
      <span class="config-field-label">${label}</span>
      <input class="config-input" type="number" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}" />
    </label>
  `;
}

function selectField(
  id: string,
  label: string,
  value: string,
  options: { value: string; label: string }[]
): string {
  return `
    <label class="config-field" for="${id}">
      <span class="config-field-label">${label}</span>
      <select class="config-select" id="${id}">
        ${options.map((o) => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </label>
  `;
}

function serviceScalingSection(
  service: 'shortener' | 'backend',
  title: string,
  cfg: ArchitectureConfig['autoScaling']['shortener']
): string {
  const p = `cfg-${service}`;
  return `
    <details class="config-group" open>
      <summary>${title}</summary>
      <div class="config-group-body">
        ${toggleRow(
          `${p}-horizontal`,
          'Horizontal auto-scaling',
          'Add/remove instances based on utilization (scale out/in).',
          cfg.horizontal.enabled
        )}
        <div class="config-subgrid" data-disabled="${!cfg.horizontal.enabled}">
          ${numberField(`${p}-h-min`, 'Min instances', cfg.horizontal.minInstances, 1, 8)}
          ${numberField(`${p}-h-max`, 'Max instances', cfg.horizontal.maxInstances, 1, 12)}
          ${numberField(`${p}-h-target`, 'Target utilization %', cfg.horizontal.targetUtilization, 40, 90)}
          ${numberField(`${p}-h-boot`, 'Instance startup (s)', cfg.horizontal.startupTimeSeconds, 0, 15, 0.5)}
        </div>

        ${toggleRow(
          `${p}-vertical`,
          'Vertical auto-scaling',
          'Increase per-instance capacity when horizontally scaled out.',
          cfg.vertical.enabled
        )}
        <div class="config-subgrid" data-disabled="${!cfg.vertical.enabled}">
          ${numberField(`${p}-v-max`, 'Max capacity multiplier', cfg.vertical.maxMultiplier, 1, 3, 0.1)}
          ${numberField(`${p}-v-target`, 'Scale-up threshold %', cfg.vertical.targetUtilization, 60, 95)}
        </div>

        ${toggleRow(
          `${p}-reactive`,
          'Reactive scaling',
          'Respond to real-time load — scale up when hot, down when idle.',
          cfg.reactive.enabled
        )}
        <div class="config-subgrid" data-disabled="${!cfg.reactive.enabled}">
          ${numberField(`${p}-r-up`, 'Scale-up delay (s)', cfg.reactive.scaleUpDelaySeconds, 0.5, 10, 0.5)}
          ${numberField(`${p}-r-down`, 'Scale-down delay (s)', cfg.reactive.scaleDownDelaySeconds, 2, 30, 0.5)}
        </div>

        ${toggleRow(
          `${p}-predictive`,
          'Predictive scaling',
          'Pre-scale ahead of detected traffic spikes.',
          cfg.predictive.enabled
        )}
        <div class="config-subgrid" data-disabled="${!cfg.predictive.enabled}">
          ${numberField(`${p}-p-factor`, 'Pre-scale factor', cfg.predictive.preScaleFactor, 1, 2.5, 0.05)}
        </div>
      </div>
    </details>
  `;
}

export function renderConfigPanel(config: ArchitectureConfig): string {
  const db = config.database;
  return `
    <section class="panel config-panel">
      <div class="config-panel-header">
        <h2>Configurations</h2>
        <button class="btn btn-ghost btn-sm" id="cfg-load-reference" type="button">Load reference</button>
      </div>
      <p class="panel-hint">
        Enable auto-scaling, replication, and sharding instead of manually placing duplicate services.
      </p>

      ${serviceScalingSection('shortener', '✂️ Shortener service', config.autoScaling.shortener)}
      ${serviceScalingSection('backend', '🔍 Backend service', config.autoScaling.backend)}

      <details class="config-group" open>
        <summary>🗄️ Database</summary>
        <div class="config-group-body">
          ${toggleRow(
            'cfg-db-replication',
            'Read replication',
            'Route cache misses to read replicas — offloads the primary.',
            db.replication.enabled
          )}
          <div class="config-subgrid" data-disabled="${!db.replication.enabled}">
            ${numberField('cfg-db-replicas', 'Read replicas', db.replication.readReplicas, 1, 4)}
          </div>

          ${toggleRow(
            'cfg-db-sharding',
            'Sharding',
            'Partition URL mappings across shards by hash or range.',
            db.sharding.enabled
          )}
          <div class="config-subgrid" data-disabled="${!db.sharding.enabled}">
            ${numberField('cfg-db-shards', 'Shard count', db.sharding.shardCount, 2, 8)}
            ${selectField('cfg-db-strategy', 'Strategy', db.sharding.strategy, [
              { value: 'hash', label: 'Hash (short code)' },
              { value: 'range', label: 'Range (URL bucket)' },
            ])}
          </div>
        </div>
      </details>
    </section>
  `;
}

function readServiceConfig(
  service: 'shortener' | 'backend',
  root: HTMLElement
): ArchitectureConfig['autoScaling']['shortener'] {
  const p = `cfg-${service}`;
  const num = (id: string, fallback: number) => {
    const el = root.querySelector<HTMLInputElement>(`#${id}`);
    return el ? Number(el.value) : fallback;
  };
  const on = (id: string) => root.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false;

  return {
    horizontal: {
      enabled: on(`${p}-horizontal`),
      minInstances: num(`${p}-h-min`, 1),
      maxInstances: num(`${p}-h-max`, 4),
      targetUtilization: num(`${p}-h-target`, 70),
      startupTimeSeconds: num(`${p}-h-boot`, 4),
    },
    vertical: {
      enabled: on(`${p}-vertical`),
      maxMultiplier: num(`${p}-v-max`, 2),
      targetUtilization: num(`${p}-v-target`, 85),
    },
    reactive: {
      enabled: on(`${p}-reactive`),
      scaleUpDelaySeconds: num(`${p}-r-up`, 2.5),
      scaleDownDelaySeconds: num(`${p}-r-down`, 8),
    },
    predictive: {
      enabled: on(`${p}-predictive`),
      preScaleFactor: num(`${p}-p-factor`, 1.35),
    },
  };
}

export function readConfigFromPanel(root: HTMLElement): ArchitectureConfig {
  const num = (id: string, fallback: number) => {
    const el = root.querySelector<HTMLInputElement>(`#${id}`);
    return el ? Number(el.value) : fallback;
  };
  const on = (id: string) => root.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false;

  return {
    autoScaling: {
      shortener: readServiceConfig('shortener', root),
      backend: readServiceConfig('backend', root),
    },
    database: {
      replication: {
        enabled: on('cfg-db-replication'),
        readReplicas: num('cfg-db-replicas', 1),
      },
      sharding: {
        enabled: on('cfg-db-sharding'),
        shardCount: num('cfg-db-shards', 2),
        strategy:
          (root.querySelector<HTMLSelectElement>('#cfg-db-strategy')?.value as 'hash' | 'range') ??
          'hash',
      },
    },
  };
}

export function mountConfigPanel(
  container: HTMLElement,
  config: ArchitectureConfig,
  onChange: (config: ArchitectureConfig) => void
): void {
  container.innerHTML = renderConfigPanel(config);
  wireConfigPanel(container, onChange);
  updateDisabledSections(container);
}

function wireConfigPanel(
  container: HTMLElement,
  onChange: (config: ArchitectureConfig) => void
): void {
  const sync = (): void => {
    onChange(readConfigFromPanel(container));
    updateDisabledSections(container);
  };

  container.addEventListener('change', sync);
  container.addEventListener('input', sync);

  container.querySelector('#cfg-load-reference')?.addEventListener('click', () => {
    const reference = createReferenceArchitectureConfig();
    onChange(cloneArchitectureConfig(reference));
    container.innerHTML = renderConfigPanel(reference);
    wireConfigPanel(container, onChange);
    updateDisabledSections(container);
  });
}

function updateDisabledSections(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.config-subgrid').forEach((grid) => {
    const disabled = grid.dataset.disabled === 'true';
    grid.classList.toggle('is-disabled', disabled);
    grid.querySelectorAll('input, select').forEach((el) => {
      (el as HTMLInputElement).disabled = disabled;
    });
  });

  const toggles: [string, string][] = [
    ['cfg-shortener-horizontal', 'cfg-shortener-h-min'],
    ['cfg-shortener-vertical', 'cfg-shortener-v-max'],
    ['cfg-shortener-reactive', 'cfg-shortener-r-up'],
    ['cfg-shortener-predictive', 'cfg-shortener-p-factor'],
    ['cfg-backend-horizontal', 'cfg-backend-h-min'],
    ['cfg-backend-vertical', 'cfg-backend-v-max'],
    ['cfg-backend-reactive', 'cfg-backend-r-up'],
    ['cfg-backend-predictive', 'cfg-backend-p-factor'],
    ['cfg-db-replication', 'cfg-db-replicas'],
    ['cfg-db-sharding', 'cfg-db-shards'],
  ];

  for (const [toggleId, fieldId] of toggles) {
    const enabled = root.querySelector<HTMLInputElement>(`#${toggleId}`)?.checked ?? false;
    const grid = root.querySelector<HTMLInputElement>(`#${fieldId}`)?.closest('.config-subgrid');
    if (grid) {
      grid.setAttribute('data-disabled', String(!enabled));
      grid.classList.toggle('is-disabled', !enabled);
      grid.querySelectorAll('input, select').forEach((el) => {
        (el as HTMLInputElement).disabled = !enabled;
      });
    }
  }
}

export {
  cloneArchitectureConfig,
  createDefaultArchitectureConfig,
  createReferenceArchitectureConfig,
};
