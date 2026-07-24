# Git Repository Repair Guide

Covers the three types of git corruption that have occurred in this repo and how to fix them.

---

## Quick fix

```bash
bash scripts/fix-git-corruption.sh
```

That script handles everything below automatically.

---

## What causes corruption

All three failure modes stem from the same root cause: **a git operation (`fetch`, `gc`, `push`) was interrupted mid-write** (process killed, machine slept, disk full, etc.). Git writes new objects before cleaning up old ones, so an interruption leaves partial/invalid state.

---

## Failure mode 1: Corrupted pack file

### Symptom

```
error: file .git/objects/pack/pack-<hash>.pack is far too short to be a packfile
```

### Cause

A pack file was being written during `git fetch` or `git gc` and was interrupted. The file exists on disk but is truncated or has a bad header — it doesn't start with the `PACK` magic bytes.

### Manual fix

```bash
# Find the bad pack file (it won't start with "PACK")
for f in .git/objects/pack/*.pack; do
  magic=$(head -c 4 "$f")
  [ "$magic" != "PACK" ] && echo "CORRUPTED: $f"
done

# Delete it and its associated index/rev files
BASE=".git/objects/pack/pack-<hash>"
rm -f "$BASE.pack" "$BASE.idx" "$BASE.rev" "$BASE.bitmap"

# Re-fetch from remote to restore missing objects
git fetch --prune
git gc --prune=now
```

---

## Failure mode 2: Leftover tmp\_\* files

### Symptom

Leftover files in `.git/objects/pack/` named `tmp_pack_*`, `tmp_idx_*`, `tmp_rev_*`. These don't cause errors themselves but waste significant disk space (can be ~16MB each) and are a sign of past interrupted operations.

### Cause

`git fetch` or `git gc` writes new pack data to temp files before atomically renaming them. An interruption leaves the temp files behind.

### Manual fix

```bash
find .git/objects/pack -maxdepth 1 \
  \( -name "tmp_pack_*" -o -name "tmp_idx_*" -o -name "tmp_rev_*" \) \
  -delete
```

---

## Failure mode 3: Invalid ref file name

### Symptom

```
fatal: bad object refs/heads/main 2
error: https://github.com/... did not send all necessary objects
```

`git fetch` or `git push` fails completely.

### Cause

A ref file with a **space in its name** (e.g., `refs/heads/main 2`) was created by an interrupted or buggy git operation. Git parses this as a ref named `main 2`, which is invalid, and fails when it tries to negotiate with the remote.

### Manual fix

```bash
# List all ref files with spaces in their name
ls -la .git/refs/heads/ | grep ' [^ ]* [^ ]*$'

# Delete the invalid ref(s)
rm ".git/refs/heads/main 2"   # adjust name as needed

# Now fetch should work
git fetch --prune
```

---

## Prevention

These corruptions happen when git processes are killed (Ctrl+C, force quit, machine sleep). There's no way to fully prevent it, but you can minimize recovery time:

- **Never `kill -9` a running `git fetch`** — use Ctrl+C and let it clean up
- **Run `git gc` regularly** so the pack files stay consolidated and healthy
- If a `git status` is slow or errors, run `bash scripts/fix-git-corruption.sh` before doing anything else

---

## When the script isn't enough

If corruption is severe (e.g., loose objects are also missing), you may need to re-clone:

```bash
# Save your unpushed commits as a patch first
git format-patch origin/main..HEAD -o /tmp/patches/

# Re-clone
cd ..
git clone <remote-url> overlay-fresh
cd overlay-fresh

# Re-apply your patches
git am /tmp/patches/*.patch
```
