// @vitest-environment happy-dom
import { DockviewComponent } from 'dockview-core';
import { describe, expect, it } from 'vitest';
import { applyLayout } from './applyLayout';
import { PANE_COMPONENT } from './presetLayout';

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
