# Occupancy is the last assistant turn's prompt plus its output, not the sum over every turn
# — summing would count the same cached prefix once per turn and run far higher than actual
# context use. Usage recorded before the most recent compact boundary is discarded: the
# boundary empties the context, and until the model replies there is no figure to report.
# Emits one number, or nothing. Reads the whole stream, so run it as `jq -n -f`.
# Shared by warn.sh and orchestrate-sessions/scripts/context_tokens.sh; edit here, not in a
# per-script copy.
reduce inputs as $line (null;
  if $line.type == "system" and $line.subtype == "compact_boundary" then null
  elif $line.type == "assistant" and $line.message.usage != null then
    $line.message.usage
    | (.input_tokens // 0)
      + (.cache_creation_input_tokens // 0)
      + (.cache_read_input_tokens // 0)
      + (.output_tokens // 0)
  else . end)
| values
