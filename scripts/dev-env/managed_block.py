"""Keep one named block of text in a dotfile, between marker comments.

Usage: python3 -I managed_block.py <file> <name> <content-file> [--check]

The block looks like:
    # >>> dev-env: <name> >>>
    ...content...
    # <<< dev-env: <name> <<<

Prints one word and exits 0:
    ok        the block is already there and up to date
    updated   the block was there with different content and was replaced
    adopted   the content was already there without markers (added by hand); markers were added around it
    added     the block was appended
With --check nothing is written and the words are prefixed with "would-" (except ok).
A copy of the file is saved once as <file>.bak-devenv before the first change.
"""
import os
import re
import shutil
import sys


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--check"]
    check = "--check" in sys.argv[1:]
    if len(args) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    path, name, content_file = args
    with open(content_file, encoding="utf-8") as f:
        content = f.read().strip("\n")

    text = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            text = f.read()

    begin = f"# >>> dev-env: {name} >>>"
    end = f"# <<< dev-env: {name} <<<"
    block = f"{begin}\n{content}\n{end}"
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.S)

    if pattern.search(text):
        if pattern.search(text).group(0) == block:
            print("ok")
            return 0
        new, result = pattern.sub(lambda _: block, text, count=1), "updated"
    elif content in text:
        new, result = text.replace(content, block, 1), "adopted"
    else:
        sep = "" if not text or text.endswith("\n\n") else ("\n" if text.endswith("\n") else "\n\n")
        new, result = f"{text}{sep}{block}\n", "added"

    if check:
        print(f"would-{result}")
        return 0
    if os.path.exists(path) and not os.path.exists(path + ".bak-devenv"):
        shutil.copy2(path, path + ".bak-devenv")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(new)
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
