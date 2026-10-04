// @vitest-environment happy-dom
import { DockviewComponent } from 'dockview-core';
import { describe, expect, it } from 'vitest';
import { applyLayout, exitMaximizedUnlessFocused } from './applyLayout';
import { groupIdsFromSlots, wireRowMirror } from './mirrorRows';
import { PANE_COMPONENT, groupIdForSlot, presetLayout } from './presetLayout';

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

  /** The four leaf group ids the fixture's own `SLOTS` maps to. */
  function appliedIds(): readonly [string, string, string, string] {
    return groupIdsFromSlots(SLOTS);
  }

  it('reflects a leaf group resize in toJSON, redistributing its row sibling', () => {
    const component = makeSizedComponent();
    const [topLeft, topRight] = appliedIds();

    component.api.getGroup(topLeft)?.api.setSize({ width: 300 });

    expect(component.api.getGroup(topLeft)?.api.width).toBe(300);
    expect(component.api.getGroup(topRight)?.api.width).toBe(700);
  });

  it('a resolveRowMirror-gated handler self-terminates without a re-entrancy guard', async () => {
    // `setSize` re-fires `onDidLayoutChange` asynchronously (confirmed empirically — a plain
    // handler that unconditionally calls `setSize` again cascades without ever converging on
    // its own). `wireRowMirror` doesn't call `setSize` unconditionally, though: it asks
    // `resolveRowMirror` first, and once both rows have been observed at matching widths, the
    // next re-fire's call returns `null` and the chain stops itself. No extra "applying" flag
    // needed.
    const component = makeSizedComponent();
    const [topLeft, topRight, bottomLeft, bottomRight] = appliedIds();
    let fireCount = 0;
    component.api.onDidLayoutChange(() => fireCount++);
    wireRowMirror(component.api, SLOTS);

    component.api.getGroup(topLeft)?.api.setSize({ width: 300 });
    component.api.getGroup(topRight)?.api.setSize({ width: 700 });
    // The re-fires this triggers happen asynchronously; flush them before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fireCount).toBeLessThan(10);
    expect(component.api.getGroup(bottomLeft)?.api.width).toBe(300);
    expect(component.api.getGroup(bottomRight)?.api.width).toBe(700);
  });

  it('leaves a lopsided layout untouched when a non-width layout change fires', async () => {
    // The two rows already differ here, as a legacy pre-fix layout would. Pins that a
    // height-only change (the row-height divider) doesn't treat that mismatch as something to
    // fix — see `resolveRowMirror`'s doc comment for why.
    const component = makeSizedComponent();
    const [topLeft, topRight, bottomLeft, bottomRight] = appliedIds();
    component.api.getGroup(topLeft)?.api.setSize({ width: 300 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Widths now differ between rows (300/700 on top, 500/500 on bottom) — wire the mirror only
    // now, so it observes exactly this lopsided state as its starting point, the same way
    // Stage.tsx seeds from whatever `applyLayout` just produced.
    wireRowMirror(component.api, SLOTS);

    component.api.getGroup(topLeft)?.api.setSize({ height: 300 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.api.getGroup(topLeft)?.api.width).toBe(300);
    expect(component.api.getGroup(topRight)?.api.width).toBe(700);
    expect(component.api.getGroup(bottomLeft)?.api.width).toBe(500);
    expect(component.api.getGroup(bottomRight)?.api.width).toBe(500);
  });
});

describe('exitMaximizedUnlessFocused', () => {
  const SLOTS = ['a', 'b', 'c', 'd'];

  function makeMaximized(slot: number): DockviewComponent {
    const component = makeComponent();
    component.layout(1000, 1000);
    applyLayout(component.api, presetLayout('grid-2x2', SLOTS));
    const panel = component.api.getPanel(SLOTS[slot] as string);
    if (panel === undefined) throw new Error('panel missing');
    component.api.maximizeGroup(panel);
    return component;
  }

  it('collapses a maximized pane when focus moves to a different slot', () => {
    const component = makeMaximized(0);

    exitMaximizedUnlessFocused(component.api, groupIdForSlot(SLOTS, 1));

    expect(component.api.hasMaximizedGroup()).toBe(false);
  });

  it('leaves a pane maximized when focus lands on that same pane', () => {
    const component = makeMaximized(0);

    exitMaximizedUnlessFocused(component.api, groupIdForSlot(SLOTS, 0));

    expect(component.api.hasMaximizedGroup()).toBe(true);
  });
});
