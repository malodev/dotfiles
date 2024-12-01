# write generated to the file $HOME/dotfiles/nushell/.config/nushell/generated.nu
let generated_file = $"($nu.home-path)/dotfiles/nushell/.config/nushell/generated.nu"

def save-alias [...args: string] {
    $"alias ($args | str join ' ')\n" | save -a $generated_file
}

def save-code [...args: string] {
    $"($args | str join '\n')" | save -a $generated_file
}

'' | save -f $generated_file

# To load from a custom file you can use:
# source ($nu.default-config-dir | path join 'custom.nu')
mkdir ~/.cache/starship
starship init nu | save -f ~/.cache/starship/init.nu
zoxide init nushell | save -f ~/.zoxide.nu

$env.CARAPACE_BRIDGES = 'zsh,fish,bash,inshellisense' # optional
mkdir ~/.cache/carapace
carapace _carapace nushell | save --force ~/.cache/carapace/init.nu
