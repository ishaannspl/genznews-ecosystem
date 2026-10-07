"""Single-run guard: a pid file created with O_EXCL, with stale-pid reclaim."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


class LockHeldError(RuntimeError):
    """Raised when another live process holds the lock."""


def _create(path: Path) -> bool:
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        return False
    try:
        os.write(fd, str(os.getpid()).encode("ascii"))
    finally:
        os.close(fd)
    return True


def _holder_alive(path: Path) -> bool:
    try:
        raw = path.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        return False
    except (OSError, UnicodeDecodeError):
        raw = ""
    try:
        pid = int(raw)
    except ValueError:
        return False  # unreadable or empty pid file: treat as stale
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists but owned by another user
    return True


@contextmanager
def file_lock(path: Path) -> Iterator[Path]:
    """Hold `path` as a pid lock for the duration of the block.

    Raises LockHeldError if a live process already holds it. A lock whose pid is
    dead (or unreadable) is reclaimed. The file is always removed on exit.
    """
    path = Path(path)
    if not _create(path):
        if _holder_alive(path):
            raise LockHeldError(f"lock is held: {path}")
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        if not _create(path):
            raise LockHeldError(f"lock is held: {path}")
    try:
        yield path
    finally:
        try:
            if path.read_text(encoding="ascii").strip() == str(os.getpid()):
                path.unlink()
        except (OSError, UnicodeDecodeError):
            pass
