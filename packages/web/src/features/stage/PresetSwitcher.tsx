import { STAGE_PRESETS, type StagePreset } from '@garden/shared';
import type { ReactNode } from 'react';
import { updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { useUiStore } from '../../state/uiStore';

interface PresetButton {
  label: string;
  icon: ReactNode;
}

/** Preset icons, each a miniature of the arrangement it selects. */
const BUTTONS: Record<StagePreset, PresetButton> = {
  single: {
    label: 'Single pane',
    icon: <rect x="2" y="2" width="20" height="16" rx="1" />,
  },
  'two-across': {
    label: 'Two side by side',
    icon: (
      <>
        <rect x="2" y="2" width="9" height="16" rx="1" />
        <rect x="13" y="2" width="9" height="16" rx="1" />
      </>
    ),
  },
  'two-stacked': {
    label: 'Two stacked',
    icon: (
      <>
        <rect x="2" y="2" width="20" height="7" rx="1" />
        <rect x="2" y="11" width="20" height="7" rx="1" />
      </>
    ),
  },
  three: {
    label: 'Three — large left, two stacked right',
    icon: (
      <>
        <rect x="2" y="2" width="12" height="16" rx="1" />
        <rect x="16" y="2" width="6" height="7" rx="1" />
        <rect x="16" y="11" width="6" height="7" rx="1" />
      </>
    ),
  },
  'grid-2x2': {
    label: 'Four, 2x2',
    icon: (
      <>
        <rect x="2" y="2" width="9" height="7" rx="1" />
        <rect x="13" y="2" width="9" height="7" rx="1" />
        <rect x="2" y="11" width="9" height="7" rx="1" />
        <rect x="13" y="11" width="9" height="7" rx="1" />
      </>
    ),
  },
};

/** The preset is a server-owned field like every other: the click issues the command and the
 *  new arrangement — with any pane the smaller preset dropped — arrives back over `WS /events`. */
export function PresetSwitcher() {
  const preset = useUiStore((state) => state.uiState.preset);

  return (
    <div className="preset-group" role="group" aria-label="Stage preset">
      {STAGE_PRESETS.map((key) => (
        <button
          key={key}
          type="button"
          className={key === preset ? 'preset-btn active-btn' : 'preset-btn'}
          title={BUTTONS[key].label}
          aria-pressed={key === preset}
          onClick={() => {
            updateUiState({ preset: key }).catch(reportCommandFailure);
          }}
        >
          <svg viewBox="0 0 24 20">{BUTTONS[key].icon}</svg>
        </button>
      ))}
    </div>
  );
}
