#!/usr/bin/env bash
#
# Tint/grade a wallpaper with the active Omarchy theme palette, so rotating
# photos sit closer to the theme instead of fighting it.
#
# Usage: omarchy-tint-wallpaper.sh <image> [mode] [strength] [output] [top-colour]
#   mode     tint (default) | accent | theme | duotone | dim
#   strength tint/accent: overlay percentage (default 30 / 8)
#            dim: brightness percentage (default 96)
#            theme: tonal key, 1.0 = untouched, lower = darker (default 0.85)
#   output   defaults to $XDG_CACHE_HOME/omarchy/tinted-wallpaper.jpg
#   top-colour  theme mode only: palette role for the highlights (default
#               color7, the theme's warm white; use color5 for gold-capped)
#
# Prints the path of the written image. Exits non-zero when the theme palette
# or ImageMagick is unavailable, so callers can fall back to the original.

set -euo pipefail

src=${1:?usage: omarchy-tint-wallpaper.sh <image> [tint|accent|theme|duotone|dim] [strength] [output] [top-colour]}
mode=${2:-tint}
strength=${3:-}
out=${4:-${XDG_CACHE_HOME:-$HOME/.cache}/omarchy/tinted-wallpaper.jpg}
top_role=${5:-color7}

colors=${OMARCHY_THEME_COLORS:-$HOME/.local/state/omarchy/current/theme/colors.toml}
[ -r "$src" ] || { echo "cannot read $src" >&2; exit 2; }
[ -r "$colors" ] || { echo "no theme palette at $colors" >&2; exit 3; }
command -v magick >/dev/null 2>&1 || { echo "ImageMagick (magick) not found" >&2; exit 4; }

read_color() {
  sed -n "s/^$1 *= *\"\(#\?[0-9a-fA-F]\{6\}\)\".*/\1/p" "$colors" | head -n1
}

bg=$(read_color background)
fg=$(read_color foreground)
[ -n "$bg" ] && [ -n "$fg" ] || { echo "theme palette is missing background/foreground" >&2; exit 3; }

mkdir -p "$(dirname "$out")"

case "$mode" in
tint)
  strength=${strength:-30}
  # Slight dim + desaturation, then blend the theme background over the photo.
  magick "$src" -modulate 96,88 \
    \( +clone -fill "$bg" -colorize "${strength}%" \) -compose over -composite \
    -quality 90 "$out"
  ;;
accent)
  # Keep the photo, but cast it toward the theme accent colour so the grade
  # tracks the theme's hue (a neutral theme background would only darken).
  strength=${strength:-8}
  accent=$(read_color accent)
  [ -n "$accent" ] || { echo "theme palette is missing accent" >&2; exit 3; }
  magick "$src" -modulate 98,92 \
    \( +clone -fill "$accent" -colorize "${strength}%" \) -compose over -composite \
    -quality 90 "$out"
  ;;
theme)
  # Low-key theme grade: the photo's luminance is ramped through the theme's
  # own palette (background -> olive -> gold -> top colour), so bright areas
  # turn theme-gold instead of washing out, and shadows sink to the theme
  # background. The tonal key darkens the whole grade like the theme art does.
  key=${strength:-0.85}
  c_dark=$(read_color background)
  c_olive=$(read_color color6)
  c_gold=$(read_color color5)
  c_top=$(read_color "$top_role")
  [ -n "$c_dark" ] && [ -n "$c_olive" ] && [ -n "$c_gold" ] && [ -n "$c_top" ] \
    || { echo "theme palette is missing background/color6/color5/$top_role" >&2; exit 3; }
  clutdir=$(mktemp -d)
  trap 'rm -rf "$clutdir"' EXIT
  # Dark-heavy ramp: most of the range stays in the theme background/olive so
  # shadows sink to near-black; gold carries the mid/high band and the top
  # colour only appears in the brightest pixels.
  magick \( -size 128x1 gradient:"${c_dark}-${c_olive}" \) \
         \( -size 88x1 gradient:"${c_olive}-${c_gold}" \) \
         \( -size 40x1 gradient:"${c_gold}-${c_top}" \) +append "$clutdir/clut.png"
  # NB: -remap, not -clut. -clut leaves the image flagged grey on this
  # ImageMagick build and the theme ramp is silently lost.
  magick "$src" -colorspace Gray -auto-level -level 0%,100%,"$key" \
    -dither FloydSteinberg -remap "$clutdir/clut.png" -quality 90 "$out"
  ;;
duotone)
  # Stylised: map luminance between the theme background and foreground.
  strength=${strength:-100}
  magick "$src" -colorspace Gray -auto-level \
    -brightness-contrast "0x$(( strength / 5 ))" +level-colors "$bg,$fg" \
    -quality 90 "$out"
  ;;
dim)
  strength=${strength:-96}
  magick "$src" -modulate "$strength",85 -quality 90 "$out"
  ;;
*)
  echo "unknown mode: $mode (use tint, accent, theme, duotone or dim)" >&2
  exit 5
  ;;
esac

printf '%s\n' "$out"
