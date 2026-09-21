#!/usr/bin/env python3
"""Build the exact Git index and pinned submodules in a fresh Ubuntu container."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def git(root, *args, env=None):
    return subprocess.check_output(["git", "-C", str(root), *args], env=env, text=True).strip()


def snapshot(root, destination, tree, env):
    subprocess.run(["git", "clone", "--quiet", "--shared", "--no-checkout", str(root), str(destination)], env=env, check=True)
    if git(destination, "cat-file", "-t", tree, env=env) == "commit":
        git(destination, "update-ref", "--no-deref", "HEAD", tree, env=env)
    git(destination, "read-tree", tree, env=env)
    git(destination, "checkout-index", "--all", env=env)
    for entry in git(destination, "ls-tree", "-rz", tree, env=env).split("\0"):
        if not entry:
            continue
        info, name = entry.split("\t", 1)
        mode, kind, revision = info.split()
        if mode == "160000":
            snapshot(root / name, destination / name, revision, env)


def main():
    root = Path(__file__).resolve().parent.parent
    # Capture Git's selected index before clearing hook-local environment variables.
    tree = git(root, "write-tree")
    env = os.environ.copy()
    for name in git(root, "rev-parse", "--local-env-vars").splitlines():
        env.pop(name, None)
    parent = root / "build/ci-runs"
    parent.mkdir(parents=True, exist_ok=True)
    result = Path(tempfile.mkdtemp(prefix="run-", dir=parent))
    print(f"Clean Ubuntu CI results: {result}", flush=True)
    (result / "source.txt").write_text(f"tree={tree}\nplatform=linux/amd64\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"site={result / 'site'}\n")
    with tempfile.TemporaryDirectory(prefix="jlxip-pages-") as tmp, (result / "run.log").open("w") as log:
        source = Path(tmp) / "source"
        snapshot(root, source, tree, env)
        # Shared clones refer to host object stores. Materialize self-contained Git
        # metadata so submodule preparation also works inside the container.
        for repo in (source, source / "my98", source / "my98/slop86"):
            subprocess.run(["git", "-C", str(repo), "repack", "-a", "-d"], env=env, check=True, stdout=log, stderr=subprocess.STDOUT)
            (repo / ".git/objects/info/alternates").unlink(missing_ok=True)

        def run(args):
            print("Clean CI: " + " ".join(args), flush=True)
            log.write("$ " + " ".join(args) + "\n")
            log.flush()
            try:
                subprocess.run(args, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
            except subprocess.CalledProcessError:
                log.flush()
                print("\n".join((result / "run.log").read_text().splitlines()[-60:]), flush=True)
                raise

        image = "jlxip-pages-ci:" + tree
        try:
            run(["docker", "build", "--platform", "linux/amd64", "--tag", image, str(source / ".github/workflows/ci")])
            run(["docker", "run", "--rm", "--platform", "linux/amd64", "--user", f"{os.getuid()}:{os.getgid()}", "--env", "CARGO_HOME=/tmp/cargo", "--env", "npm_config_cache=/tmp/npm", "--mount", f"type=bind,src={source},dst=/work", image])
            shutil.copytree(source / "build/site", result / "site")
            print("Clean Ubuntu build and artifact: PASS", flush=True)
        finally:
            print(f"Log: {result / 'run.log'}", flush=True)


if __name__ == "__main__":
    main()
