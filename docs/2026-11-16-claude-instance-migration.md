# Claude instance migration

Claude now defaults to port `4310`, tmux socket `garden-claude`, and app directory
`~/.garden-claude`. Codex is unchanged. This is a coordinated cutover, not an automatic
startup migration. **Implementation is prepared; the live migration is pending.**

## Before cutover

Arrange a quiet window with the user. Inventory the Claude launcher (shell command,
alias or service), its explicit `GARDEN_*` overrides, and the existing sessions. Keep
custom overrides unless the user explicitly chooses to migrate them. The commands below
assume the former defaults; substitute the actual old directory, socket and port when
needed. Run from an ordinary terminal outside Garden: existing panes carry their old
`GARDEN_APP_DIR`, `GARDEN_TMUX_SOCKET` and `GARDEN_PORT` into nested CLI commands.

If work is still running, defer the cutover. The updated binary can continue serving the
old instance with `GARDEN_HARNESS=claude GARDEN_APP_DIR="$HOME/.garden"
GARDEN_TMUX_SOCKET=garden`. Use those overrides consistently for start, CLI and stop until
cutover. Do not start a second Claude server on the same port.

A directory copy does not move a tmux server or a running Claude process. Have the user
finish or explicitly end every live pane on the old socket. `garden stop` stops only the
web server; `garden stop --all` kills panes and must not be used to prepare this migration.
Record sessions to resume and their working directories. Transcript history stays in
Claude's existing transcript directory, including any explicit override.

## Cutover

1. With all live work finished, stop the old web server using its explicit namespace:

   ```sh
   GARDEN_HARNESS=claude GARDEN_APP_DIR="$HOME/.garden" GARDEN_TMUX_SOCKET=garden garden stop
   ```

   Confirm it stopped. Check the old socket with
   `tmux -L garden list-panes -a -F '#{session_name} #{pane_dead}'`.
   Every remaining pane must report `1` (dead); a connection failure needs investigation
   unless the socket is known to have no server. Keep the old socket and dead panes for
   rollback. Do not resume the same session on both sockets.

2. Copy durable state into a **new** directory, leaving the original untouched. Stop if
   the destination already exists; inspect its ownership rather than merging two instances.
   Run each command only after the preceding one succeeds:

   ```sh
   mkdir "$HOME/.garden-claude"
   cp -p "$HOME/.garden/config.json" "$HOME/.garden-claude/config.json"
   cp -p "$HOME/.garden/state.json" "$HOME/.garden-claude/state.json"
   cmp "$HOME/.garden/config.json" "$HOME/.garden-claude/config.json"
   cmp "$HOME/.garden/state.json" "$HOME/.garden-claude/state.json"
   ```

   An absent state file is valid only for an unused instance; confirm that before skipping
   its copy. Configuration preserves roots, command, permissions and polling settings;
   `state.json` preserves UI layout, pins, session mappings, watches, alerts and review state.
   Leave logs and any other files in the original directory. Do not copy `server.pid`,
   generated tmux configuration or the Claude settings overlay: startup recreates runtime
   files for the new instance. Do not move or edit Claude's own configuration or transcripts.

3. Update the launcher to select `GARDEN_HARNESS=claude` and remove only obsolete app-dir
   and socket overrides (or set them to the new names). Retain deliberate port, transcript
   and command overrides. Start the rebuilt binary from that launcher. For former defaults:

   ```sh
   GARDEN_HARNESS=claude GARDEN_APP_DIR="$HOME/.garden-claude" GARDEN_TMUX_SOCKET=garden-claude garden
   ```

4. Verify the settings and saved UI state before resuming sessions. Old sessions initially
   appear dead because the new socket has no panes. Resume one saved session, create one
   new session, and confirm hooks update their status. In each pane, `garden ls --json`
   must address Claude; inspect its `GARDEN_HARNESS`, `GARDEN_APP_DIR`, `GARDEN_TMUX_SOCKET`
   and `GARDEN_PORT` values. Confirm both panes live on `tmux -L garden-claude list-sessions`.
   Check Codex still lists its own sessions. A plain `garden stop` from the new launcher
   must stop only the new web server and leave its panes intact; restart and confirm they
   reconnect. Record the result and any custom overrides before calling the cutover complete.

## Rollback

First finish or explicitly end any new live Claude panes, then stop the new web server
with its new namespace. Preserve `~/.garden-claude` and its socket for diagnosis; do not
run uninstall. Restore the old launcher overrides and start with `GARDEN_APP_DIR="$HOME/.garden"
GARDEN_TMUX_SOCKET=garden GARDEN_HARNESS=claude`. The original config and state are still there.
Resume only sessions no longer running on the new socket.

Rollback restores the pre-cutover overlay, not changes made afterward. If new settings or
UI/watch state need retaining, stop both servers and deliberately reconcile those files
before restarting one instance; never copy a pid file. Transcript history remains in the
unchanged Claude transcript directory. Keep both directories until the user accepts the
migration; deleting old state and removing old dead tmux panes is a later cleanup decision.

## Verification boundary

The isolated integration suite exercises copying synthetic config/state, reading the copy,
CLI selection and stop isolation, and new/resumed pane routing for both harnesses. Sandbox
setup refuses `garden`, `garden-claude` and `garden-codex` before invoking tmux. These checks
prepare the migration; they do not substitute for the live smoke test above.
