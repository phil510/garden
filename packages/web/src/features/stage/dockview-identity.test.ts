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

  /** Mirrors Stage.tsx's actual `onDidLayoutChange` handler shape, so these tests exercise the
   *  real control flow (including dockview's real async re-fire) rather than a stand-in. */
  function wireMirrorHandler(
    component: DockviewComponent,
    ids: readonly [string, string, string, string],
  ): { fireCount: () => number } {
    const [topLeft, topRight, bottomLeft, bottomRight] = ids;
    let fireCount = 0;
    let previousTop = rowWidths(component, [topLeft, topRight]);
    let previousBottom = rowWidths(component, [bottomLeft, bottomRight]);
    component.api.onDidLayoutChange(() => {
      fireCount++;
      if (fireCount > 10) return; // safety net only; a converging handler never reaches this
      const top = rowWidths(component, [topLeft, topRight]);
      const bottom = rowWidths(component, [bottomLeft, bottomRight]);
      const mirror = resolveRowMirror(top, bottom, previousTop, previousBottom);
      if (mirror !== null) {
        const [leftId, rightId] =
          mirror.target === 'top' ? [topLeft, topRight] : [bottomLeft, bottomRight];
        component.api.getGroup(leftId)?.api.setSize({ width: mirror.widths[0] });
        component.api.getGroup(rightId)?.api.setSize({ width: mirror.widths[1] });
      }
      previousTop = mirror?.target === 'top' ? mirror.widths : top;
      previousBottom = mirror?.target === 'bottom' ? mirror.widths : bottom;
    });
    return { fireCount: () => fireCount };
  }

  function rowWidths(
    component: DockviewComponent,
    ids: readonly [string, string],
  ): readonly [number, number] {
    return [
      component.api.getGroup(ids[0])?.api.width ?? 0,
      component.api.getGroup(ids[1])?.api.width ?? 0,
    ];
  }

  it('a resolveRowMirror-gated handler self-terminates without a re-entrancy guard', async () => {
    // `setSize` re-fires `onDidLayoutChange` asynchronously (confirmed empirically — a plain
    // handler that unconditionally calls `setSize` again cascades without ever converging on
    // its own). The real handler doesn't call `setSize` unconditionally, though: it asks
    // `resolveRowMirror` first, and once both rows have been observed at matching widths, the
    // next re-fire's call returns `null` and the chain stops itself. No extra "applying" flag
    // needed.
    const component = makeSizedComponent();
    const ids = groupIdsForGrid2x2(SLOTS);
    const [topLeft, topRight, bottomLeft, bottomRight] = ids;
    const handler = wireMirrorHandler(component, ids);

    component.api.getGroup(topLeft)?.api.setSize({ width: 300 });
    component.api.getGroup(topRight)?.api.setSize({ width: 700 });
    // The re-fires this triggers happen asynchronously; flush them before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler.fireCount()).toBeLessThan(10);
    expect(component.api.getGroup(bottomLeft)?.api.width).toBe(300);
    expect(component.api.getGroup(bottomRight)?.api.width).toBe(700);
  });

  it('leaves a lopsided layout untouched when a non-width layout change fires', async () => {
    // The two rows already differ here, as a legacy pre-fix layout would. A shared-baseline
    // design would treat that mismatch itself as something to "fix" the moment any layout event
    // fires, even one that never touched column widths — this pins that a height-only change
    // does not do that.
    const component = makeSizedComponent();
    const ids = groupIdsForGrid2x2(SLOTS);
    const [topLeft, topRight, bottomLeft, bottomRight] = ids;
    component.api.getGroup(topLeft)?.api.setSize({ width: 300 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Widths now differ between rows (300/700 on top, 500/500 on bottom) — attach the handler
    // only now, so it observes exactly this lopsided state as its starting point, the same way
    // Stage.tsx seeds from whatever `applyLayout` just produced.
    wireMirrorHandler(component, ids);

    component.api.getGroup(topLeft)?.api.setSize({ height: 300 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.api.getGroup(topLeft)?.api.width).toBe(300);
    expect(component.api.getGroup(topRight)?.api.width).toBe(700);
    expect(component.api.getGroup(bottomLeft)?.api.width).toBe(500);
    expect(component.api.getGroup(bottomRight)?.api.width).toBe(500);
  });
});
