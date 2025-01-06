# dotfiles

<!--toc:start-->

- [dotfiles](#dotfiles)
  - [Inspiration](#inspiration)
  <!--toc:end-->

Clone the repo using:

```sh
git clone https://github.com/malodev/dotfiles ~/.dotfiles
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

- [dreamsofcode-io/dotfiles](https://github.com/dreamsofcode-io/dotfiles)
- [typecraft-dev/dotfiles](https://github.com/typecraft-dev/dotfiles)
- [never-lose-your-configs-again](https://learn.typecraft.dev/tutorial/never-lose-your-configs-again/)
