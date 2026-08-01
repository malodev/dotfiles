# Locale — must be set before anything else, otherwise ZLE calculates
# prompt width incorrectly for multi-byte UTF-8 glyphs (Nerd Fonts, icons).
# This is the root cause of ghost/duplicate text during tab completion.
export LANG=en_US.UTF-8
export LC_CTYPE=en_US.UTF-8
export LC_TIME=en_GB.UTF-8
export LC_PAPER=it_IT.UTF-8

# Clean FPATH: remove non-existent directories (leftover from uninstalled tools)
#  - fpath=( ... ) — reassign the fpath array
#     - ${fpath} — the current fpath entries
#     - ^ — apply the glob qualifier to each element individually (not the whole array as one)
#     - (u) — unique — deduplicate, keeping first occurrence
#     - (N/) — two glob qualifiers:
#        - N — null glob — if a path doesn't match, remove it silently (no error)
#        - / — must be a directory — only keep entries that are actual existing directories
# So: "rebuild fpath keeping only unique entries that are real existing directories." One line to clean up dead paths like the ~/.zplug ones.
fpath=( ${(u)^fpath}(N/) )

# >>> machine-specific overrides (untracked) <<<
[[ -f ~/.zshenv_local ]] && source ~/.zshenv_local
# >>> END MANAGED CONFIG <<<
