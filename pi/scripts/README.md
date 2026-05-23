# Pi scripts

## `copy-pi-skills.sh`

Copies skills from [mattpocock-skills](https://github.com/mattpocock/mattpocock-skills)
into the pi stow source directory so pi can discover them.

### Setup (one-time)

```bash
cd ~/dotfiles/pi
git clone https://github.com/mattpocock/mattpocock-skills.git
```

The script expects the repo at `~/dotfiles/pi/mattpocock-skills` by default.
You can override this with the `MATTPOCOCK_SKILLS_REPO` env var or pass the path
as the first argument.

### Usage

```bash
# Copy all skills into ~/.dotfiles/pi/.pi/agent/skills/
cd ~/dotfiles/pi
./scripts/copy-pi-skills.sh

# Or from a custom location:
./scripts/copy-pi-skills.sh /path/to/mattpocock-skills
```

### Update skills

```bash
cd ~/dotfiles/pi/mattpocock-skills
git pull
cd ..
./scripts/copy-pi-skills.sh
```

Then commit the changes in `~/.dotfiles/pi` and re-stow if needed.
