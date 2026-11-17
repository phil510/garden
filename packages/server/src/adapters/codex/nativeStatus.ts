import WebSocket from 'ws';
import type { HarnessSignal, ReportedStatus } from '../../domain/types.js';
import { readCodexEndpoint } from './launcher.js';

export interface NativeBinding {
  id: string;
  cwd: string;
  codexId: string;
  transcriptPath: string;
  generation: number;
  backendGeneration?: string | undefined;
}

export function nativeStatus(value: unknown): ReportedStatus {
  const status = value as { type?: unknown; activeFlags?: unknown } | null;
  if (status?.type === 'active')
    return {
      status:
        Array.isArray(status.activeFlags) && status.activeFlags.includes('waitingOnApproval')
          ? 'needs-approval'
          : 'working',
      reason: null,
    };
  return { status: status?.type === 'idle' ? 'waiting' : 'unknown', reason: null };
}

/** A passive connection observes only the TUI's already-bound thread. It never owns a turn. */
export function observeNativeStatus(options: {
  appDir: string;
  bindings: () => NativeBinding[];
  onSignal: (signal: HarnessSignal) => void;
  pollMs?: number;
}) {
  const entries = new Map<string, { key: string; socket?: WebSocket; stop: () => void }>();
  let closed = false;
  function refresh() {
    if (closed) return;
    const bindings = options.bindings();
    for (const [id, entry] of entries) {
      if (!bindings.some((binding) => binding.id === id)) {
        entry.stop();
        entries.delete(id);
      }
    }
    for (const binding of bindings) {
      const descriptor = readCodexEndpoint(options.appDir, binding.id);
      const endpoint = descriptor?.generation === binding.backendGeneration ? descriptor : null;
      const key = JSON.stringify([binding.codexId, binding.generation, endpoint]);
      const prior = entries.get(binding.id);
      if (
        prior?.key === key &&
        (prior.socket === undefined || prior.socket.readyState < WebSocket.CLOSING)
      )
        continue;
      prior?.stop();
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const current = () =>
        !closed &&
        !stopped &&
        entries.get(binding.id)?.key === key &&
        options
          .bindings()
          .some(
            (b) =>
              b.id === binding.id &&
              b.codexId === binding.codexId &&
              b.generation === binding.generation &&
              b.backendGeneration === binding.backendGeneration,
          ) &&
        JSON.stringify(readCodexEndpoint(options.appDir, binding.id)) ===
          JSON.stringify(descriptor);
      function report(reported: ReportedStatus) {
        if (current())
          options.onSignal({
            sessionId: binding.id,
            cwd: binding.cwd,
            transcriptPath: binding.transcriptPath,
            reported,
            ended: null,
            conversationCleared: false,
          });
      }
      if (endpoint === null) {
        entries.set(binding.id, {
          key,
          stop: () => {
            stopped = true;
          },
        });
        report(nativeStatus(null));
        continue;
      }
      const socket = new WebSocket(`ws+unix://${endpoint.endpoint.slice('unix://'.length)}:/`, {
        handshakeTimeout: 5000,
      });
      entries.set(binding.id, {
        key,
        socket,
        stop: () => {
          stopped = true;
          clearTimeout(timer);
          socket.terminate();
        },
      });
      report(nativeStatus(null));
      let revision = 0;
      let snapshotRevision = 0;
      function deadline() {
        clearTimeout(timer);
        timer = setTimeout(() => socket.terminate(), 5000);
        timer.unref();
      }
      socket.on('open', () => {
        if (!current()) {
          socket.terminate();
          return;
        }
        deadline();
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'initialize',
            params: {
              clientInfo: { name: 'garden_status_observer', version: '0.0.0' },
              capabilities: { experimentalApi: true, requiredHumanApproval: false },
            },
          }),
        );
      });
      socket.on('message', (data) => {
        if (!current()) return;
        let message: {
          id?: number;
          method?: string;
          error?: unknown;
          result?: { thread?: { id?: string; status?: unknown } };
          params?: { threadId?: string; status?: unknown };
        };
        try {
          const bytes = Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data);
          message = JSON.parse(bytes.toString('utf8')) as typeof message;
        } catch {
          return;
        }
        // Native server requests belong to the TUI; never answer them or treat their arrival as approval state.
        if (message.method !== undefined) {
          if (
            message.id === undefined &&
            message.method === 'thread/status/changed' &&
            message.params?.threadId === binding.codexId
          ) {
            revision++;
            report(nativeStatus(message.params.status));
          }
          return;
        }
        if (message.error !== undefined) {
          socket.terminate();
          return;
        }
        if (message.id === 1) {
          socket.send(JSON.stringify({ method: 'initialized' }));
          snapshotRevision = revision;
          deadline();
          socket.send(
            JSON.stringify({
              id: 2,
              method: 'thread/read',
              params: { threadId: binding.codexId, includeTurns: false },
            }),
          );
        } else if (message.id === 2) {
          clearTimeout(timer);
          if (revision === snapshotRevision && message.result?.thread?.id === binding.codexId)
            report(nativeStatus(message.result.thread.status));
        }
      });
      socket.on('error', () => {
        socket.terminate();
      });
      socket.on('close', () => {
        clearTimeout(timer);
        report(nativeStatus(null));
      });
    }
  }
  const poll = setInterval(refresh, options.pollMs ?? 500);
  poll.unref();
  refresh();
  return {
    refresh,
    close() {
      closed = true;
      clearInterval(poll);
      for (const entry of entries.values()) entry.stop();
      entries.clear();
    },
  };
}
