# Occupancy is the last assistant turn's prompt plus its output, not the sum over every turn
# — summing would count the same cached prefix once per turn and run far higher than actual
# context use. Shared by warn.sh and orchestrate-sessions/scripts/context_tokens.sh; edit here,
# not in a per-script copy.
select(.type == "assistant" and .message.usage != null)
| .message.usage
| (.input_tokens // 0)
  + (.cache_creation_input_tokens // 0)
  + (.cache_read_input_tokens // 0)
  + (.output_tokens // 0)
