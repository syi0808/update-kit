#!/bin/sh
# Universal mock binary for package managers (brew, npm, apt, etc.)
# Behavior controlled via environment variables:
#   MOCK_CALL_LOG  — file to append invocation log
#   MOCK_EXIT_CODE — exit code (default: 0)
#   MOCK_STDOUT    — stdout output
#   MOCK_STDERR    — stderr output
#   MOCK_DELAY_MS  — delay in milliseconds (for timeout testing)

if [ -n "$MOCK_CALL_LOG" ]; then
  echo "$(basename "$0") $*" >> "$MOCK_CALL_LOG"
fi

if [ -n "$MOCK_DELAY_MS" ]; then
  # Use perl for sub-second sleep (portable across macOS/Linux)
  perl -e "select(undef,undef,undef,$ENV{MOCK_DELAY_MS}/1000)"
fi

if [ -n "$MOCK_STDOUT" ]; then
  echo "$MOCK_STDOUT"
fi

if [ -n "$MOCK_STDERR" ]; then
  echo "$MOCK_STDERR" >&2
fi

exit "${MOCK_EXIT_CODE:-0}"
