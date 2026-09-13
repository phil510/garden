// @vitest-environment happy-dom
import { DockviewComponent } from 'dockview-core';
import { describe, expect, it } from 'vitest';
import { applyLayout } from './applyLayout';
import { resolveRowMirror } from './mirrorRows';
import { groupIdsForGrid2x2, PANE_COMPONENT, presetLayout } from './presetLayout';

/** Stands in for garden's xterm pane: what matters is that it is one long-lived instance per
 *  panel id, the same relationship a real pane holds with its socket. */
class RecordingRenderer {
  static instances: RecordingRenderer[] = [];
  readonly element = document.createElement('div');
  constructor(readonly id: string) {
    RecordingRenderer.instances.push(this);
  }
  init(): void {}
  dispose(): void {}
}

function makeComponent(): DockviewComponent {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new DockviewComponent(container, {
    createComponent: (options) => new RecordingRenderer(options.id),
  });
}

function addTwoPanels(component: DockviewComponent): void {
  component.addPanel({ id: 'session-a', component: PANE_COMPONENT });
  component.addPanel({ id: 'session-b', component: PANE_COMPONENT });
}

describe('dockview identity across a preset switch', () => {
  it('keeps a surviving panel on its existing content renderer when the stage applies a layout', () => {
    const component = makeComponent();
    addTwoPanels(component);
    const before = new Map(RecordingRenderer.instances.map((renderer) => [renderer.id, renderer]));
    const layout = component.toJSON();
    const countBefore = RecordingRenderer.instances.length;

    applyLayout(component.api, layout);

    expect(RecordingRenderer.instances).toHaveLength(countBefore);
    expect(RecordingRenderer.instances.find((renderer) => renderer.id === 'session-a')).toBe(
      before.get('session-a'),
    );
    expect(RecordingRenderer.instances.find((renderer) => renderer.id === 'session-b')).toBe(
      before.get('session-b'),
    );
  });

  it('rebuilds every content renderer from scratch when reuseExistingPanels is omitted', () => {
    const component = makeComponent();
    addTwoPanels(component);
    const before = new Map(RecordingRenderer.instances.map((renderer) => [renderer.id, renderer]));
    const layout = component.toJSON();
    const countBefore = RecordingRenderer.instances.length;

    component.fromJSON(layout);

    expect(RecordingRenderer.instances.length).toBeGreaterThan(countBefore);
    const rebuilt = RecordingRenderer.instances
      .filter((renderer) => renderer.id === 'session-a')
      .at(-1);
    expect(rebuilt).not.toBe(before.get('session-a'));
  });
});

describe('grid-2x2 leaf group resize', () => {
  const SLOTS = ['a', 'b', 'c', 'd'];

  /** happy-dom has no real box model, so dockview's own DOM measurements read as zero; `layout`
   *  is the API's escape hatch to size the component explicitly instead. */
  function makeSizedComponent(): DockviewComponent {
    const component = makeComponent();
    component.layout(1000, 1000);
    applyLayout(component.api, presetLayout('grid-2x2', SLOTS));
    return component;
  }

  it('reflects a leaf group resize in toJSON, redistributing its row sibling', () => {
    const component = makeSizedComponent();
    const [topLeft, topRight] = groupIdsForGrid2x2(SLOTS);

    component.api.getGroup(topLeft)?.api.setSize({ width: 300 });

    expect(component.api.getGroup(topLeft)?.api.width).toBe(300);
    expect(component.api.getGroup(topRight)?.api.width).toBe(700);
  });

  it('a resolveRowMirror-gated handler self-terminates without a re-entrancy guard', async () => {
    // `setSize` re-fires `onDidLayoutChange` asynchronously (confirmed empirically — a plain
    // handler that unconditionally calls `setSize` again cascades without ever converging on
    // its own). Task 4's actual handler doesn't call `setSize` unconditionally, though: it asks
    // `resolveRowMirror` first, and after one mirror the two rows match, so the next re-fire's
    // call returns `null` and the chain stops itself. No extra "applying" flag needed.
    const component = makeSizedComponent();
    const [topLeft, topRight, bottomLeft, bottomRight] = groupIdsForGrid2x2(SLOTS);
    let fireCount = 0;
    let baseline: readonly [number, number] = [
      component.api.getGroup(topLeft)?.api.width ?? 0,
      component.api.getGroup(topRight)?.api.width ?? 0,
    ];
    component.api.onDidLayoutChange(() => {
      fireCount++;
      if (fireCount > 10) return; // safety net only; a real cascade would never reach this
      const top: readonly [number, number] = [
        component.api.getGroup(topLeft)?.api.width ?? 0,
        component.api.getGroup(topRight)?.api.width ?? 0,
      ];
      const bottom: readonly [number, number] = [
        component.api.getGroup(bottomLeft)?.api.width ?? 0,
        component.api.getGroup(bottomRight)?.api.width ?? 0,
      ];
      const mirror = resolveRowMirror(top, bottom, baseline);
      if (mirror === null) return;
      const [leftId, rightId] =
        mirror.target === 'top' ? [topLeft, topRight] : [bottomLeft, bottomRight];
      component.api.getGroup(leftId)?.api.setSize({ width: mirror.widths[0] });
      component.api.getGroup(rightId)?.api.setSize({ width: mirror.widths[1] });
      baseline = mirror.widths;
    });

    component.api.getGroup(topLeft)?.api.setSize({ width: 300 });
    component.api.getGroup(topRight)?.api.setSize({ width: 700 });
    // The re-fires this triggers happen asynchronously; flush them before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fireCount).toBe(2);
    expect(component.api.getGroup(bottomLeft)?.api.width).toBe(300);
    expect(component.api.getGroup(bottomRight)?.api.width).toBe(700);
  });
});
