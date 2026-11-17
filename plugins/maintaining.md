# Maintaining the Garden plugins

The two packages are deliberately self-contained. A change in one does not update the other,
so review the counterpart whenever changing a workflow, prompt or hook. Compare outcomes first:
which work is authorized, when it stops, what survives interruption, and what the user sees.
Keep harness mechanics in their own package; do not introduce symlinks or shared-source builds.

Each harness has its own `garden` marketplace catalog: `.claude-plugin/marketplace.json` lists
only `garden-claude`, and `.agents/plugins/marketplace.json` lists only `garden-codex`. Codex
selects the native catalog before the Claude fallback, so adding this repository exposes only
the matching package. Source paths in both catalogs are relative to the repository root.
The Codex package still uses `.claude-plugin/plugin.json` for legacy plugin loading. See the
[pinned Codex catalog loader](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core-plugins/src/marketplace.rs)
for discovery and source resolution.

| Surface                                           | Claude                                     | Codex                                                   |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Installation identity                             | `garden-claude`                            | `garden-codex`                                          |
| Session controls, messaging, alerts, review queue | Garden CLI skills                          | Garden CLI skills                                       |
| PR digests                                        | Plugin monitor                             | Explicitly owned foreground forwarder                   |
| Specialist reviews                                | Registered bundled Markdown agents         | Bundled prompts read by fresh native subagents          |
| Compaction note                                   | Claude scratchpad and transcript occupancy | Private temporary directory and Codex rollout occupancy |
| Ship-it                                           | Existing background workflow               | Not yet ported                                          |

Review every change for semantic parity and record intentional differences in the affected
package README. Ship-it's stages and policy remain the reference for its eventual Codex port;
only harness dispatch, waiting and recovery mechanics should differ unless the user chooses a
policy change. User instructions take precedence over workflow defaults, including already
authorized publication. Do not install personal configuration or named roles to make parity work.

Reviewer prompts are editable forks in each package's `agents/` directory; review semantic parity,
not byte identity. For upstream updates, manually review and apply relevant diffs following each
package's `third-party.md`. For hooks, run the
real-subprocess unit tests and check warning, recovery and cleanup behavior independently of any
ship-it state. Both harnesses assume a user-managed 200K compaction threshold and warn at 175K;
review counting semantics against the harness version before changing either implementation.

Review loops are an optional integration: Claude ship-it defaults to `none`. If injected
instructions select a skill, that skill becomes a required gate for that run; an unavailable
selected skill blocks clearly instead of silently skipping the gate. Garden does not require
personal bot-loop or comment-fetching skills. User-level conventions may independently require
them. The same boundary should hold when ship-it is ported to Codex.
