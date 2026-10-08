#!/usr/bin/env bash
#=============================================================================
# link-pi-agent-entries.sh
#
# Manages the agent skills and extensions tracked in this repo. Two things make
# this more than a plain symlink farm:
#
#   1. Each target directory mixes dotfile-managed entries with machine-local
#      ones. Skills shipped by the OS (Omarchy keeps its skills under
#      /usr/share/omarchy/...) and extension hooks pointing at a path that
#      exists on one host only must never enter the repo, and must survive
#      whatever we do here.
#
#   2. Skills are not all pi-specific. Anything usable by Codex, Claude Code or
#      any other Agent Skills harness goes to the shared directory
#      ~/.agents/skills; only the ones that talk to pi's own extensions stay in
#      ~/.pi/agent/skills.
#
# stow can express neither. It either folds a whole directory into one symlink
# into the repo — so every local file lands in the working copy — or it links
# file by file and aborts on absolute symlinks. These trees are therefore
# excluded from stow (.stow-local-ignore) and owned here.
#
# OWNERSHIP RULES (deliberately non-pruning)
#   entry present in the repo               -> managed, linked
#   entry listed in LOCAL_ONLY_ENTRIES      -> never touched
#   any other entry in a target directory   -> never touched, it is local
#   target symlink resolving into this repo -> ours, safe to relink or prune
#   target symlink resolving anywhere else  -> not ours, never touched
#
# The mattpocock-skills submodule is the one thing inside this repo that is not
# ours: its own linker deploys it into the shared directories, so ownership
# stops short of it.
#
# Usage:
#   scripts/link-pi-agent-entries.sh              # link managed entries
#   scripts/link-pi-agent-entries.sh --list       # show the classification
#   scripts/link-pi-agent-entries.sh --dry-run    # show what linking would do
#   scripts/link-pi-agent-entries.sh --unfold     # migrate a folded directory
#   scripts/link-pi-agent-entries.sh --prune      # drop our own dangling links
#   scripts/link-pi-agent-entries.sh skills       # limit to one source tree
#=============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ROOT="$REPO/pi/.pi/agent"
DEST_ROOT="$HOME/.pi/agent"
SHARED_SKILLS="$HOME/.agents/skills"
CLAUDE_SKILLS="$HOME/.claude/skills"
DIRS=(extensions skills)

# Deployed by pi/mattpocock-skills/scripts/link-skills.sh. Its links resolve
# inside $REPO too, so ownership has to stop short of them or the two linkers
# would fight over a name.
FOREIGN_ROOT="$REPO/pi/mattpocock-skills"

#--------------------------------------------------------------------------
# Entries that sit in the repo tree but belong to the machine. They are
# pointers into paths that exist on one host only, or they are installed and
# owned by the OS. Never touched; whoever owns them places them in the target.
# Paths are relative to pi/.pi/agent/.
#--------------------------------------------------------------------------
LOCAL_ONLY_ENTRIES=(
    "skills/diagnose-crash"
    "skills/omarchy"
    "skills/omarchy-app"
    "extensions/mlxmon.ts"
    "extensions/vllm-mlx.ts"
)

#--------------------------------------------------------------------------
# Skills that only make sense inside pi, because they drive pi's own
# extensions. They stay in ~/.pi/agent/skills. Everything else is harness
# agnostic and goes to the shared ~/.agents/skills.
#--------------------------------------------------------------------------
PI_ONLY_SKILLS=(
    "init-three-agent-team"
    "pi-skill-creator"
    "team-amend-contracts"
    "team-from-plan"
)

DRY_RUN=0
DO_LIST=0
DO_UNFOLD=0
DO_PRUNE=0

info() { echo "  $1"; }
warn() { echo "  ! $1" >&2; }
die()  { echo "error: $1" >&2; exit 1; }

# Exit 2 means "the operator has to run --unfold", which the installer turns
# into an actionable warning instead of a failed install.
die_unfold() { echo "error: $1" >&2; exit 2; }

run() {
    if [[ "$DRY_RUN" == "1" ]]; then
        echo "  [dry-run] $*"
    else
        "$@"
    fi
}

usage() {
    sed -n '2,54p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# Short, unambiguous name for a target directory. Several of them are called
# "skills", so the basename alone tells the reader nothing.
dir_label() {
    case "$1" in
        "$SHARED_SKILLS")        echo "~/.agents/skills" ;;
        "$CLAUDE_SKILLS")        echo "~/.claude/skills" ;;
        "$DEST_ROOT/skills")    echo "~/.pi/agent/skills" ;;
        "$DEST_ROOT/extensions") echo "~/.pi/agent/extensions" ;;
        *) printf '%s' "$1" ;;
    esac
}

# Directories shared with other tools. We link into them but do not describe
# what else lives there: the mattpocock linker and the OS own the rest.
is_shared_dir() {
    [[ "$1" == "$SHARED_SKILLS" || "$1" == "$CLAUDE_SKILLS" ]]
}

#=============================================================================
# CLASSIFICATION
#=============================================================================
is_local_only() {
    local rel="$1" entry
    for entry in "${LOCAL_ONLY_ENTRIES[@]}"; do
        [[ "$entry" == "$rel" ]] && return 0
    done
    return 1
}

is_pi_only_skill() {
    local name="$1" entry
    for entry in "${PI_ONLY_SKILLS[@]}"; do
        [[ "$entry" == "$name" ]] && return 0
    done
    return 1
}

# True when the given path is a symlink we created: it resolves into this
# repository but not into the submodule that has its own linker.
is_ours() {
    local target="$1" resolved
    [[ -L "$target" ]] || return 1
    resolved="$(readlink -f "$target" 2>/dev/null || true)"
    [[ -n "$resolved" ]] || return 1
    case "$resolved" in
        "$FOREIGN_ROOT"|"$FOREIGN_ROOT"/*) return 1 ;;
    esac
    case "$resolved" in
        "$REPO"|"$REPO"/*) return 0 ;;
    esac
    return 1
}

# Where an entry in a target directory came from, for reporting.
classify_target() {
    local dst="$1"

    if [[ -L "$dst" ]]; then
        if is_ours "$dst"; then
            if [[ -e "$dst" ]]; then echo "managed"; else echo "ours-dangling"; fi
        else
            echo "local-link"
        fi
    elif [[ -e "$dst" ]]; then
        echo "local"
    else
        echo "absent"
    fi
}

#=============================================================================
# DESTINATIONS
#=============================================================================
# Directories this entry belongs in, primary first. The primary gets a link to
# the repo; the rest mirror the primary so the content has exactly one home.
#
# pi-specific skills stay in ~/.pi/agent/skills. Everything else is harness
# agnostic, so it goes to ~/.agents/skills (which Codex and pi read natively)
# and is mirrored into ~/.claude/skills (which is all Claude Code reads).
entry_dest_dirs() {
    case "$1" in
        extensions|extensions/*) printf '%s\n' "$DEST_ROOT/extensions" ;;
        skills|skills/*)
            if is_pi_only_skill "${1##*/}"; then
                printf '%s\n' "$DEST_ROOT/skills"
            else
                printf '%s\n' "$SHARED_SKILLS" "$CLAUDE_SKILLS"
            fi
            ;;
    esac
}

entry_primary_dir() { entry_dest_dirs "$1" | head -1; }

# Every directory that could hold a link for this tree. Used to find links that
# landed somewhere the entry no longer belongs, e.g. after a skill was
# reclassified as pi-specific or the other way round.
entry_all_dirs() {
    case "$1" in
        skills|skills/*)          printf '%s\n' "$DEST_ROOT/skills" "$SHARED_SKILLS" "$CLAUDE_SKILLS" ;;
        extensions|extensions/*)  printf '%s\n' "$DEST_ROOT/extensions" ;;
    esac
}

# True when the entry belongs in the given directory, as primary or mirror.
entry_uses_dir() {
    local rel="$1" want="$2" d
    while IFS= read -r d; do
        [[ "$d" == "$want" ]] && return 0
    done < <(entry_dest_dirs "$rel")
    return 1
}

# A folded target directory is one symlink into the repo. While it is in that
# state every entry resolves to a real file in the working copy, so per-entry
# ownership cannot be judged and linking would write straight into the repo.
dir_is_folded() {
    [[ -L "$1" ]]
}

report_folded() {
    local dirpath="$1" label="$2"
    printf '  %-11s %-28s %s\n' "FOLDED" "$label" "$(readlink "$dirpath")"
    printf '  %-11s %-28s %s\n' "" "" "whole directory is one link into the repo"
    printf '  %-11s %-28s %s\n' "" "" "run with --unfold to migrate to per-entry links"
}

#=============================================================================
# LINKING
#=============================================================================
# Returns 0 when links were written, 1 when the entry was left alone.
link_one_entry() {
    local rel="$1" src="$2"
    local name dest_dir candidate dst state

    name="$(basename "$src")"
    dest_dir="$(entry_primary_dir "$rel")"

    # Clear links of ours that ended up in a directory this entry no longer
    # belongs to. Anything there that is not ours is left alone.
    while IFS= read -r candidate; do
        if entry_uses_dir "$rel" "$candidate"; then
            continue
        fi
        dst="$candidate/$name"
        [[ -L "$dst" ]] || continue
        if is_ours "$dst"; then
            run rm "$dst"
            info "unlinked $rel from $(dir_label "$candidate")/ (belongs in $(dir_label "$dest_dir")/)"
        fi
    done < <(entry_all_dirs "$rel")

    run mkdir -p "$dest_dir"
    dst="$dest_dir/$name"
    state="$(classify_target "$dst")"

    case "$state" in
        local|local-link)
            info "keep     $rel ($state at $(dir_label "$dest_dir")/, not ours)"
            return 1
            ;;
    esac

    if [[ "$state" == "ours-dangling" ]]; then
        if [[ "$DO_PRUNE" == "1" ]]; then
            run rm "$dst"
            info "pruned   $rel (dangling link into the repo)"
        else
            info "dangling $rel (our link, target gone; pass --prune)"
            return 1
        fi
        state="absent"
    fi

    run ln -sfn "$src" "$dst"
    if [[ "$state" == "absent" ]]; then
        info "linked   $rel -> $(dir_label "$dest_dir")/"
    else
        info "relinked $rel -> $(dir_label "$dest_dir")/"
    fi

    # Mirror the link into the other locations this entry belongs in. Each
    # mirror points at the primary, so the content has exactly one home and
    # Claude Code still loads the skill once.
    while IFS= read -r candidate; do
        [[ "$candidate" == "$dest_dir" ]] && continue
        run mkdir -p "$candidate"
        # Same ownership rule as the primary link above: a real entry or a live
        # link that is not ours stays untouched.
        if [[ -e "$candidate/$name" ]] && ! is_ours "$candidate/$name"; then
            info "keep     $rel at $(dir_label "$candidate")/ (not ours)"
            continue
        fi
        run ln -sfn "$dst" "$candidate/$name"
        info "mirrored $rel -> $(dir_label "$candidate")/"
    done < <(entry_dest_dirs "$rel")

    return 0
}

link_entries() {
    local dir="$1"
    local src_dir="$SRC_ROOT/$dir"
    local dst_dir="$DEST_ROOT/$dir"
    local name rel src dst result
    local linked=0 kept=0

    [[ -d "$src_dir" ]] || { warn "$dir: no $src_dir in the repo"; return 0; }

    if dir_is_folded "$dst_dir"; then
        report_folded "$dst_dir" "$dir/"
        die_unfold "$dir is folded into the repo; refusing to link into the working copy. Use --unfold."
    fi

    for src in "$src_dir"/* "$src_dir"/.[!.]*; do
        [[ -e "$src" || -L "$src" ]] || continue
        name="$(basename "$src")"
        rel="$dir/$name"

        if is_local_only "$rel"; then
            info "skip     $rel (local-only, owned elsewhere)"
            kept=$((kept + 1))
            continue
        fi

        result=""
        if link_one_entry "$rel" "$src"; then
            linked=$((linked + 1))
        else
            kept=$((kept + 1))
        fi
    done

    info "$dir: $linked linked, $kept left alone"
    report_local_entries "$dir"
}

# Surface the entries we deliberately do not own. The pi directories are ours
# to describe entry by entry; the shared ones are shared, so there we only
# account for our own and summarise the rest.
report_local_entries() {
    local dir="$1"
    local src_dir="$SRC_ROOT/$dir"
    local name dst origin foreign=0

    while IFS= read -r candidate; do
        [[ -d "$candidate" ]] || continue
        foreign=0
        for dst in "$candidate"/* "$candidate"/.[!.]*; do
            [[ -e "$dst" || -L "$dst" ]] || continue
            name="$(basename "$dst")"
            [[ -e "$src_dir/$name" || -L "$src_dir/$name" ]] && continue

            # A link of ours whose repo entry disappeared is ours to clean up.
            if is_ours "$dst" && [[ ! -e "$dst" ]]; then
                if [[ "$DO_PRUNE" == "1" ]]; then
                    run rm "$dst"
                    info "pruned   $(dir_label "$candidate")/$name (dangling link into the repo)"
                else
                    info "dangling $(dir_label "$candidate")/$name (our link, target gone; pass --prune)"
                fi
                continue
            fi

            if is_shared_dir "$candidate"; then
                foreign=$((foreign + 1))
                continue
            fi

            if is_local_only "$dir/$name"; then
                info "keep     $(dir_label "$candidate")/$name (local-only, owned elsewhere)"
            else
                origin="real entry"
                [[ -L "$dst" ]] && origin="link -> $(readlink "$dst")"
                info "keep     $(dir_label "$candidate")/$name (local, not in dotfiles: $origin)"
            fi
        done

        if [[ "$foreign" -gt 0 ]]; then
            info "$(dir_label "$candidate")/: $foreign other entries left alone (owned by other tools)"
        fi
    done < <(entry_all_dirs "$dir")
}

#=============================================================================
# LISTING
#=============================================================================
list_entries() {
    local dir="$1"
    local src_dir="$SRC_ROOT/$dir"
    local dst_dir="$DEST_ROOT/$dir"
    local name rel src dst state origin dest_name

    if dir_is_folded "$dst_dir"; then
        echo "$dir/"
        report_folded "$dst_dir" "$dir/"
        echo ""
        return 0
    fi

    for src in "$src_dir"/* "$src_dir"/.[!.]*; do
        [[ -e "$src" || -L "$src" ]] || continue
        name="$(basename "$src")"
        rel="$dir/$name"
        dest_name="$(dir_label "$(entry_primary_dir "$rel")")"

        if is_local_only "$rel"; then
            printf '  %-11s %-26s %-23s %s\n' "local-only" "$name" "(-)" "(skipped, owned elsewhere)"
            continue
        fi

        state="$(classify_target "$(entry_primary_dir "$rel")/$name")"
        case "$state" in
            managed)       printf '  %-11s %-26s %-23s %s\n' "managed"   "$name" "($dest_name)" "(linked)" ;;
            ours-dangling) printf '  %-11s %-26s %-23s %s\n' "dangling"  "$name" "($dest_name)" "(our link, target gone)" ;;
            local)         printf '  %-11s %-26s %-23s %s\n' "LOCAL"     "$name" "($dest_name)" "(real entry, not ours)" ;;
            local-link)    printf '  %-11s %-26s %-23s %s\n' "LOCAL"     "$name" "($dest_name)" "(link -> $(readlink "$(entry_primary_dir "$rel")/$name"))" ;;
            absent)        printf '  %-11s %-26s %-23s %s\n' "unlinked"  "$name" "($dest_name)" "(run without --list)" ;;
        esac
    done

    # Anything in the target directories that the repo does not know about.
    while IFS= read -r candidate; do
        [[ -d "$candidate" ]] || continue
        for dst in "$candidate"/* "$candidate"/.[!.]*; do
            [[ -e "$dst" || -L "$dst" ]] || continue
            name="$(basename "$dst")"
            [[ -e "$src_dir/$name" || -L "$src_dir/$name" ]] && continue
            if is_local_only "$dir/$name"; then
                printf '  %-11s %-26s %-23s %s\n' "local-only" "$name" "($(dir_label "$candidate"))" "(moved out of dotfiles)"
            elif is_shared_dir "$candidate"; then
                printf '  %-11s %-26s %-23s %s\n' "foreign" "$name" "($(dir_label "$candidate"))" "(owned by another tool)"
            else
                origin="real entry"
                [[ -L "$dst" ]] && origin="link -> $(readlink "$dst")"
                printf '  %-11s %-26s %-23s %s\n' "LOCAL" "$name" "($(dir_label "$candidate"))" "($origin, not in dotfiles)"
            fi
        done
    done < <(entry_all_dirs "$dir")
    echo ""
}

#=============================================================================
# UNFOLD
#=============================================================================
# Migration for a directory that stow already folded into one symlink into the
# repo. Nothing is deleted: the folded symlink is moved aside to *.bak-<epoch>
# and left for the operator to remove.
unfold_dir() {
    local dir="$1"
    local dst="$DEST_ROOT/$dir"
    local src_dir="$SRC_ROOT/$dir"
    local name rel entry dest_dir tmp backup candidate final

    if [[ -L "$dst" ]]; then
        local resolved
        resolved="$(readlink -f "$dst" 2>/dev/null || true)"
        case "$resolved" in
            "$src_dir") ;;
            *) die "$dst is a symlink but not the folded repo one ($resolved)"; ;;
        esac
    elif [[ -d "$dst" ]]; then
        info "$dir: already a real directory, nothing to unfold"
        return 0
    else
        info "$dir: no $dst yet, nothing to unfold"
        return 0
    fi

    tmp="$DEST_ROOT/.${dir}.unfold.$$"
    backup="$dst.bak-$(date +%s)"
    info "$dir: unfolding $dst -> $resolved"

    run mkdir -p "$tmp"

    for entry in "$src_dir"/* "$src_dir"/.[!.]*; do
        [[ -e "$entry" || -L "$entry" ]] || continue
        name="$(basename "$entry")"
        rel="$dir/$name"
        dest_dir="$(entry_primary_dir "$rel")"

        if is_local_only "$rel"; then
            # These are pointers to paths outside the repo, so moving them out
            # of the working copy loses nothing. Real entries are copied
            # instead so the repo keeps its content.
            if [[ -L "$entry" ]]; then
                run mv "$entry" "$tmp/$name"
                info "moved    $rel out of the repo (local-only)"
            else
                run cp -a "$entry" "$tmp/$name"
                info "copied   $rel out of the repo (local-only)"
            fi
            continue
        fi

        if [[ "$dest_dir" == "$dst" ]]; then
            run ln -sfn "$entry" "$tmp/$name"
            info "linked   $rel"
            final="$dst/$name"
        else
            run mkdir -p "$dest_dir"
            run ln -sfn "$entry" "$dest_dir/$name"
            info "linked   $rel -> $(dir_label "$dest_dir")/"
            final="$dest_dir/$name"
        fi

        # Mirror into the other locations this entry belongs in.
        while IFS= read -r candidate; do
            [[ "$candidate" == "$dest_dir" ]] && continue
            run mkdir -p "$candidate"
            # Never write inside something we do not own: a real entry, or a live
            # link that resolves outside the repo. That keeps the submodule
            # linker's names its own and stops the mirror from dropping a link
            # inside a local directory. A dangling foreign link is replaced,
            # because this entry owns the name in the repo now.
            if [[ -e "$candidate/$name" ]] && ! is_ours "$candidate/$name"; then
                info "keep     $rel at $(dir_label "$candidate")/ (not ours)"
                continue
            fi
            run ln -sfn "$final" "$candidate/$name"
            info "mirrored $rel -> $(dir_label "$candidate")/"
        done < <(entry_dest_dirs "$rel")
    done

    run mv "$dst" "$backup"
    run mv "$tmp" "$dst"
    info "$dir: real directory in place, folded link kept at $backup"
}

#=============================================================================
# MAIN
#=============================================================================
main() {
    local arg dirs=()

    for arg in "$@"; do
        case "$arg" in
            --dry-run) DRY_RUN=1 ;;
            --list)    DO_LIST=1 ;;
            --unfold)  DO_UNFOLD=1 ;;
            --prune)   DO_PRUNE=1 ;;
            --help|-h) usage; exit 0 ;;
            extensions|skills) dirs+=("$arg") ;;
            *) die "unknown argument: $arg (try --help)" ;;
        esac
    done

    [[ ${#dirs[@]} -gt 0 ]] || dirs=("${DIRS[@]}")

    local dir
    for dir in "${dirs[@]}"; do
        echo "$SRC_ROOT/$dir"
        if [[ "$DO_LIST" == "1" ]]; then
            list_entries "$dir"
        elif [[ "$DO_UNFOLD" == "1" ]]; then
            unfold_dir "$dir"
            echo ""
        else
            link_entries "$dir"
            echo ""
        fi
    done
}

main "$@"
