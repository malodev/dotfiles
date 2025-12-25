#!/usr/bin/env bash

# Configuration
MAX_EVENTS="${MAX_EVENTS:-10}"
DAYS_AHEAD="${DAYS_AHEAD:-14}"
CALENDARS="${CALENDARS:-}"

# Path to icalBuddy
ICALBUDDY="/opt/homebrew/bin/icalBuddy"
# Check if icalBuddy exists
if [[ ! -x "$ICALBUDDY" ]]; then
    echo "NO_ICALBUDDY"
    exit 0
fi

# Build and run the icalBuddy command
if [[ -n "$CALENDARS" ]]; then
    output=$("$ICALBUDDY" -npn -nc -li "$MAX_EVENTS" \
        -ps "/ » /" -eep "url" \
        -ic "$CALENDARS" \
        "eventsToday+$DAYS_AHEAD" 2>/dev/null) || true
else
    output=$("$ICALBUDDY" -npn -nc -li "$MAX_EVENTS" \
        -ps "/ » /" -eep "url" \
        "eventsToday+$DAYS_AHEAD" 2>/dev/null) || true
fi

# Check if we got any output
if [[ -z "$output" ]]; then
    echo "NO_EVENTS"
    exit 0
fi

# Parse the output
# Format: "• Event Title » date/time info"
echo "$output" | while IFS= read -r line; do
    # Skip empty lines
    [[ -z "$line" ]] && continue

    # Remove leading bullet and space: "• Title » time" -> "Title » time"
    line="${line#• }"

    # Parse: "Title » date/time info"
    if [[ "$line" == *" » "* ]]; then
        title="${line%% » *}"
        datetime="${line#* » }"
        echo "${datetime}|${title}"
    fi
done
