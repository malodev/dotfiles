# To add entries to PATH (on Windows you might use Path), you can use the following pattern:
# $env.PATH = ($env.PATH | split row (char esep) | prepend '/some/path')
# An alternate way to add entries to $env.PATH is to use the custom command `path add`
# which is built into the nushell stdlib:
use std "path add"
# $env.PATH = ($env.PATH | split row (char esep))
# path add /some/path
# path add ($env.CARGO_HOME | path join "bin")
path add ($env.HOME | path join ".local" "bin")
# $env.PATH = ($env.PATH | uniq)
path add /usr/local/bin

# write generated to the file $HOME/dotfiles/nushell/.config/nushell/generated.nu
let generated_file = $"($nu.home-path)/dotfiles/nushell/.config/nushell/generated.nu"

def save-alias [...args: string] {
    $"alias ($args | str join ' ')\n" | save -a $generated_file
}

def save-code [...args: string] {
    $"($args | str join '\n')" | save -a $generated_file
}

'' | save -f $generated_file

def v [...args] {
  with-env { NVIM_APPNAME: nvim-malo} { nvim ...$args }
}

def vi [...args] {
  with-env { NVIM_APPNAME: nvim-malo} { nvim ...$args }
}

def vt [...args] {
  with-env { NVIM_APPNAME: nvim-test} { nvim ...$args }
}

def va [...args] {
  with-env { NVIM_APPNAME: nvim-astro} { nvim ...$args }
}

$env.EDITOR = 'v'
# Check the operating system
let is_macos = ( $nu.os-info.name == "macos" )
let is_linux  = ( $nu.os-info.name == "linux" )

if $is_macos {
  print $"(ansi wb)(ansi reset)(ansi gi) macOS env loaded(ansi reset)"
  save-alias 'as = aoerospace'
  save-code r#'
def --env ff [] {
  aerospace list-windows --all | fzf --bind 'enter:execute(bash -c "aerospace focus --window-id {1}")+abort'
}
'#
  path add /opt/homebrew/bin
}

if $is_linux {
  print $"(ansi wb)🐧(ansi reset)(ansi gi) Linux env loaded(ansi reset)"
  path add /home/linuxbrew/.linuxbrew/bin
}

save-code r#'
print $"(ansi wb)(ansi reset)(ansi pi) Generated env loaded(ansi reset)"
'#

# To load from a custom file you can use:
# source ($nu.default-config-dir | path join 'custom.nu')
mkdir ~/.cache/starship
starship init nu | save -f ~/.cache/starship/init.nu
zoxide init nushell | save -f ~/.zoxide.nu

$env.CARAPACE_BRIDGES = 'zsh,fish,bash,inshellisense' # optional
mkdir ~/.cache/carapace
carapace _carapace nushell | save --force ~/.cache/carapace/init.nu
