# dotfiles

Clone the repo using:

```sh
clone https://github.com/malodev/dotfiles ~/.dotfiles
```

The configuration files in this repo are using [GNU Stow](https://www.gnu.org/software/stow/)

To install all of them use

```sh
stow *
```

in the `~/.dotfiles` dir

To install just one package:

```sh
stow <package_name>
```

For example, to just symlink nvim config

```sh
stow nvim
```

## Inspiration

The inspiration for this configuration comes from

- https://github.com/dreamsofcode-io/dotfiles
- https://github.com/typecraft-dev/dotfiles
- https://learn.typecraft.dev/tutorial/never-lose-your-configs-again/
