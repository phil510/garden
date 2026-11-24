import type { DockviewApi, SerializedDockview } from 'dockview-core'
import { applyLayout } from './applyLayout'

export function wireMaximizedLayout(api: DockviewApi) {
  let visibleLayout: SerializedDockview | undefined

  // Dockview keeps the hidden panes' old pixel sizes when the stage resizes. Capture the
  // visible layout before those panes are hidden so fromJSON can scale all of them on restore.
  const willMutate = api.onWillMutateLayout(({ kind }) => {
    if (kind === 'maximize' && !api.hasMaximizedGroup()) visibleLayout = api.toJSON()
  })
  const didMutate = api.onDidMutateLayout(({ kind }) => {
    if (kind !== 'maximize' || api.hasMaximizedGroup() || visibleLayout === undefined) return
    const layout = visibleLayout
    visibleLayout = undefined
    if (layout.grid.width !== api.width || layout.grid.height !== api.height) {
      applyLayout(api, layout)
    }
  })

  return {
    apply(layout: SerializedDockview) {
      visibleLayout = undefined
      applyLayout(api, layout)
    },
    serialize(): SerializedDockview {
      // Dockview's serializer temporarily restores the native maximized grid.
      return visibleLayout ?? api.toJSON()
    },
    dispose() {
      willMutate.dispose()
      didMutate.dispose()
    },
  }
}
