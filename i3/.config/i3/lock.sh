ringcolor=FFFFFFFF
insidecolor=00000000
linecolor=00000000
separatorcolor=00000000

ringvercolor=00000000
insidevercolor=00000000

ringwrongcolor=00000000
insidewrongcolor=00000000

keyhlcolor=AAAAAAFF
bshlcolor=AAAAAAFF

i3lock-color -i ~/.config/i3/wallpaper.jpg -t \
  --clock --force-clock --time-pos="w/2:h/2" --time-size=96 --time-color=FFFFFFFF \
  --date-str="$DATE" --date-pos="tx:ty+80" --date-size=32 --date-color=F0F0F0F0 \
  --ind-pos="w/2-r/2:h-r*2" --radius 20 \
  --ring-color=$ringcolor --inside-color=$insidecolor --line-color=$linecolor \
  --separator-color=$separatorcolor --ringver-color=$ringvercolor \
  --insidever-color=$insidevercolor --verif-text='' --ringwrong-color=$ringwrongcolor \
  --insidewrong-color=$insidewrongcolor --wrong-text='' --keyhl-color=$keyhlcolor \
  --bshl-color=$bshlcolor --noinput-text=''
