# CLAUDE.md

Guidance for agents working on this package: the Hyprland session and its Omarchy
(Quickshell) integration on the Linux desktop.

## Read first

**[`README.md`](README.md) is the reference for everything here — read it before changing
anything in `hyprland/`, `~/.config/omarchy/`, or `~/.config/variety/`.** It documents how
the desktop follows the active Omarchy theme, which is the source of most surprises:

- the wallpaper pipeline (`Variety` -> `set_wallpaper` -> `scripts/omarchy-tint-wallpaper.sh`
  -> `omarchy theme bg set`), its modes and environment knobs, and why the graded output
  alternates `graded-a`/`graded-b`
- what `omarchy theme set` does by itself and what the `theme-set` hook adds, in order
- kitty theming (`linux.conf` includes the Omarchy palette; `macos.conf` deliberately does not)
- herdr's `theme.name = "terminal"` plus the `[theme.custom]` pair that keeps the focused
  pane brighter than the others
- the gotchas: unchanged-path `background set`, kitty reloads only reaching new windows,
  ImageMagick `-clut` degrading to greyscale

Reach for it on any of these branches: **wallpapers** (Variety, grading, backgrounds),
**themes** (`omarchy theme set`, `current/theme/*`, hooks), **terminals** (kitty config and
palettes), **herdr** (config, theme tokens, pane border colours).

## Rules

- Leave macOS out of the Omarchy theming: no Omarchy palette or hook work in the Mac's
  config. `macos.conf` intentionally carries no colours, and the Mac's herdr follows its
  own kitty palette.
- Never edit generated state: `~/.local/state/omarchy/**`, `~/.config/variety/wallpaper/**`,
  or anything under `/usr/share/omarchy/` (read it freely).
- Theme and background config belongs in this repo (stowed into `~/.config/`), with
  `~/.config/kitty/*` on Linux hardlinked to the repo copies.
