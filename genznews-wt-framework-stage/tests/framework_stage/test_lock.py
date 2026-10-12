from __future__ import annotations

import os
import subprocess
import sys

import pytest

from framework_stage.lock import LockHeldError, file_lock


def _dead_pid() -> int:
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return proc.pid


def test_second_acquire_raises_LockHeldError(tmp_path):
    path = tmp_path / "stage.lock"
    with file_lock(path):
        assert path.read_text().strip() == str(os.getpid())
        with pytest.raises(LockHeldError):
            with file_lock(path):
                pass
        assert path.exists()  # the failed attempt must not remove the holder's lock
    assert not path.exists()


def test_stale_lock_from_dead_pid_is_reclaimed(tmp_path):
    path = tmp_path / "stage.lock"
    path.write_text(str(_dead_pid()))
    with file_lock(path):
        assert path.read_text().strip() == str(os.getpid())
    assert not path.exists()


def test_lock_held_by_live_other_process_raises(tmp_path):
    path = tmp_path / "stage.lock"
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        path.write_text(str(proc.pid))
        with pytest.raises(LockHeldError):
            with file_lock(path):
                pass
        assert path.read_text().strip() == str(proc.pid)
    finally:
        proc.kill()
        proc.wait()


def test_unreadable_pid_is_treated_as_stale(tmp_path):
    path = tmp_path / "stage.lock"
    path.write_text("garbage")
    with file_lock(path):
        pass
    assert not path.exists()


def test_lock_released_after_exception(tmp_path):
    path = tmp_path / "stage.lock"
    with pytest.raises(RuntimeError):
        with file_lock(path):
            raise RuntimeError("boom")
    assert not path.exists()
    with file_lock(path):
        pass
