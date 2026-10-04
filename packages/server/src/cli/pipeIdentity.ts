/**
 * The session a `garden events --follow` pipe belongs to, or null when this command is not
 * its own session's monitor. Checked once, at start, and only here: the pipe keeps its
 * startup env for life, so a `/clear` that changes the Claude session id later does not
 * disconnect it. The returned id is the garden id, which is what the server keys every pipe
 * connection on; the Claude session id is only compared, never used as a key.
 */
export function ownPipeSession(env: NodeJS.ProcessEnv): string | null {
  const gardenId = env.GARDEN_SESSION_ID;
  if (gardenId === undefined || gardenId === '') return null;
  return gardenId === env.CLAUDE_CODE_SESSION_ID ? gardenId : null;
}
