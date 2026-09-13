# Hyprland / Omarchy session

This package holds the Hyprland session config and the Omarchy (Quickshell) integration
for the Linux desktop: window management, the shell/bar, themes, and the wallpapers.

The interesting part is how the desktop follows the active Omarchy theme: the wallpaper,
the terminal and herdr all derive from `~/.local/state/omarchy/current/theme/`.

<!--toc:start-->

- [Hyprland / Omarchy session](#hyprland--omarchy-session)
  - [Layout](#layout)
  - [Wallpapers: Variety -> Omarchy](#wallpapers-variety---omarchy)
  - [What `omarchy theme set` does, and what the hook adds](#what-omarchy-theme-set-does-and-what-the-hook-adds)
  - [Terminals (kitty)](#terminals-kitty)
  - [herdr](#herdr)
  - [Known gotchas](#known-gotchas)
  - [Verifying](#verifying)
  <!--toc:end-->

## Layout

| Path | Purpose |
| --- | --- |
| `hyprland/.config/hypr/` | Hyprland: `bindings.lua`, `monitors.lua`, `looknfeel.lua`, `autostart.lua`, `*_local.lua` overrides |
| `hyprland/.config/omarchy/shell.json` | Omarchy shell/bar layout |
| `hyprland/.config/omarchy/hooks/` | Event hooks, including the `theme-set` hook below |
| `hyprland/.config/variety/scripts/set_wallpaper` | Variety's wallpaper hook (symlinked to `~/.config/variety/scripts/`) |
| `scripts/omarchy-tint-wallpaper.sh` | Grades any image through the active theme palette |

## Wallpapers: Variety -> Omarchy

Variety rotates wallpapers and calls `set_wallpaper` with the final image (its "copy to
folder" output, `~/Pictures/variety-copied-wallpaper-*.jpg`) every time it changes —
including the per-minute clock refresh. On Hyprland with Omarchy available, that script
grades the image and hands the result to the background service:

```
Variety -> set_wallpaper -> omarchy_grade_wallpaper() -> omarchy theme bg set <graded>
```

`omarchy_grade_wallpaper()` lives in `hyprland/.config/variety/scripts/set_wallpaper` and
calls `scripts/omarchy-tint-wallpaper.sh` (resolved relative to the script itself, so the
repo can live anywhere). The grade reads the palette from
`~/.local/state/omarchy/current/theme/colors.toml`, so a theme switch changes the wallpaper
with no configuration.

Modes of `scripts/omarchy-tint-wallpaper.sh <image> [mode] [strength] [output] [top]`:

| Mode | Effect |
| --- | --- |
| `theme` | Ramps luminance through the theme's own roles: `background` -> `color6` -> `color5` -> top colour (`color7` by default, `color5` for a strict gold cap). `strength` is the tonal key (1.0 untouched, lower = darker). This is the mode the pipeline uses. |
| `tint` | Blends the theme background over the photo (default 30%), plus a slight dim/desaturate |
| `accent` | Keeps the photo, casts it toward the theme accent (default 8%) — a hue tie-in without darkening |
| `duotone` | Neutral two-colour map between `background` and `foreground` |
| `dim` | Only dims and desaturates (no colour shift) |

Knobs (environment variables):

| Variable | Default | Meaning |
| --- | --- | --- |
| `OMARCHY_WALLPAPER_GRADE` | `theme:0.7:color5` | `mode:key:top`; set to `off` to disable grading entirely |
| `OMARCHY_TINT_SCRIPT` | repo `scripts/omarchy-tint-wallpaper.sh` | Alternative helper |
| `OMARCHY_THEME_COLORS` | `~/.local/state/omarchy/current/theme/colors.toml` | Grade against another palette (useful to preview a theme without applying it) |

Output goes to `~/.cache/omarchy/variety-graded/graded-a.jpg` and `graded-b.jpg`,
alternating on every change. The alternation is deliberate: Omarchy's background service
ignores a `background set` request for the path it is already showing
(`Background.qml` -> `transitionBackground()` returns early on an unchanged `finalPath`),
so a fixed filename would freeze the wallpaper on the first grade.

If the palette, the helper or ImageMagick is unavailable, the raw wallpaper is used — the
pipeline can never leave the desktop without a background.

## What `omarchy theme set` does, and what the hook adds

`omarchy theme set <name>` runs, in order:

1. regenerate the dynamic configs for the theme (kitty/alacritty/ghostty/foot, btop, helix, …);
2. swap the staged theme in as `~/.local/state/omarchy/current/theme/` and write `theme.name`;
3. recolour the running shell/Hyprland and point `current/background` at the theme's own artwork;
4. in parallel: `omarchy-restart-terminal` (kitty `SIGUSR1`, ghostty `SIGUSR2`, alacritty `touch`) and the other app retints;
5. run `omarchy-hook theme-set "$THEME_NAME"`;
6. warm the theme/background selector caches.

Step 3 is why the theme's own artwork shows up briefly, and step 4 only *signals* terminals
— kitty applies a reload to windows created afterwards. `hyprland/.config/omarchy/hooks/theme-set.d/retint-terminals-and-wallpaper.sh`
(the `theme-set` hook, symlinked into `~/.config/omarchy/hooks/theme-set.d/`) closes both
gaps right after step 5's palette is staged:

- pushes `current/theme/kitty.conf` into every running kitty instance through
  `kitten @ --to unix:$XDG_RUNTIME_DIR/omarchy-kitty-* set-colors --all`;
- re-applies the last wallpaper through the Variety pipeline, so the grade uses the new
  palette immediately instead of waiting for the next rotation or clock tick;
- nudges a running `herdr server reload-config`.

Hooks in that directory run in glob order, so the theme-manager plugin's
`50-theme-manager-memory` (which restores that theme's remembered wallpaper/icons) runs
first and this hook runs after it.

## Terminals (kitty)

`kitty/.config/kitty/linux.conf` ends with:

```conf
include ~/.local/state/omarchy/current/theme/kitty.conf
```

`kitty.conf` parses the theme block (a static palette, `rose-pine.conf`) before the OS
block, so the Omarchy palette wins on Linux. `${KITTY_OS}.conf` is expanded by kitty itself
(it is not an environment variable), which is what selects `linux.conf` here and
`macos.conf` on the Mac.

macOS is intentionally left out of the Omarchy theming: there is no Omarchy state there, so
`macos.conf` carries no colours and the Mac keeps the static `rose-pine.conf` palette. Note
that `~/.config/kitty/*` on the Mac are real files, not stow symlinks, so repo edits need a
re-stow/copy there — unlike on Linux, where `~/.config/kitty/linux.conf` and the repo copy
are the same inode (hardlinked) and editing either updates both.

## herdr

`herdr/.config/herdr/config.toml`:

```toml
[theme]
name = "terminal"   # follow the host terminal's palette (kitty -> Omarchy)

[theme.custom]
accent = "lightmagenta"   # focused pane border + highlights
overlay0 = "darkgray"     # unfocused pane borders
```

`theme.name = "terminal"` makes herdr query the terminal it runs in (OSC 10/11 for the
default colours plus the palette) instead of using a built-in palette, so its chrome tracks
Omarchy on Linux and that machine's kitty elsewhere. `auto_switch` is unrelated: it only
reacts to the terminal's light/dark report.

The `[theme.custom]` pair fixes an inversion that shows up on dark themes whose ANSI 4 is
muted: herdr's `terminal` palette maps `accent` -> ANSI 4 and `overlay0` -> ANSI 7, and
`ui/panes.rs` paints focused borders with `accent` and unfocused ones with `overlay0`. With
blackgold (ANSI 4 `#6E6A58` vs ANSI 7 `#F6F1DD`) the focused pane looked dim and the others
highlighted. Both overrides are ANSI *slots* (`lightmagenta` = ANSI 13, `darkgray` = ANSI 8),
not hex values, so they keep following whatever theme is active.

Themes are per-client in herdr (the client renders the UI), so a running client needs the
`reload config` action — or a restart — to pick up config changes; a server reload is not
enough.

## Known gotchas

- `omarchy theme set` replaces `~/.local/state/omarchy/current/background` with the theme's
  own artwork; the graded wallpaper returns on the next Variety change (or immediately via
  the hook).
- Omarchy's background service ignores a `background set` for the path it is already
  showing — hence the `graded-a`/`graded-b` alternation.
- kitty's config reload only applies to windows created afterwards, so `SIGUSR1` alone does
  not recolour open windows; `kitten @ set-colors --all` does (that is what the hook does).
- ImageMagick's `-clut` degrades the ramp to greyscale on this build (the image is left
  flagged grey), so `scripts/omarchy-tint-wallpaper.sh` uses a dithered `-remap` instead.
- Omarchy refuses code-bearing files from git-cloned themes (terminal configs, `*.lua`,
  `vscode.json`) and regenerates them from `colors.toml`, printing what it ignored.

## Verifying

```sh
# what is on screen right now
omarchy theme bg current; readlink ~/.local/state/omarchy/current/background

# grade a photo without touching the desktop
scripts/omarchy-tint-wallpaper.sh ~/Pictures/photo.jpg theme 0.7 /tmp/out.jpg color5

# live kitty palette
kitten @ --to "unix:$XDG_RUNTIME_DIR/omarchy-kitty-$(pgrep -x kitty | head -n1)" get-colors \
  | grep -E '^(background|foreground|color5) '

# validate herdr's config
herdr config check

# fire the theme-set hook without changing theme
omarchy-hook theme-set "$(cat ~/.local/state/omarchy/current/theme.name)"
```
