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
