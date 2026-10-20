"""Safe, consistent backup of the Regis database and uploaded photos. Works while the shop is running.

  python scripts/backup.py                 make a backup into data/backups (keeps the newest 14)
  python scripts/backup.py --restore FILE  restore a backup (stop the shop first)

Schedule it daily. Windows: Task Scheduler. Linux: cron, e.g.  0 2 * * *  python /path/to/scripts/backup.py
Copy data/backups somewhere else too (another disk, cloud storage), or a dead disk takes the backups with it.
"""
import argparse
import shutil
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "core"))
import config  # noqa: E402

KEEP = 14


def backup() -> Path:
    out_dir = ROOT / "data" / "backups"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    tmp_db = out_dir / f"tmp-{stamp}.db"
    src = sqlite3.connect(config.DB_PATH)
    dst = sqlite3.connect(tmp_db)
    with dst:
        src.backup(dst)  # SQLite's online backup API: consistent even during writes
    src.close(); dst.close()
    target = out_dir / f"regis-{config.APP_ENV}-{stamp}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tmp_db, "regis.db")
        if config.UPLOAD_DIR.exists():
            for f in config.UPLOAD_DIR.iterdir():
                if f.is_file():
                    z.write(f, f"uploads/{f.name}")
    tmp_db.unlink()
    for old in sorted(out_dir.glob(f"regis-{config.APP_ENV}-*.zip"))[:-KEEP]:
        old.unlink()
    return target


def restore(file: Path) -> None:
    check = sqlite3.connect(":memory:")
    with zipfile.ZipFile(file) as z:
        z.extract("regis.db", ROOT / "data")
        tmp = ROOT / "data" / "regis.db"
        check = sqlite3.connect(tmp)
        ok = check.execute("PRAGMA integrity_check").fetchone()[0]
        check.close()
        if ok != "ok":
            tmp.unlink()
            raise SystemExit(f"Backup failed its integrity check: {ok}")
        if config.DB_PATH.exists():
            shutil.copy2(config.DB_PATH, config.DB_PATH.with_suffix(".before-restore"))
        for ext in ("-wal", "-shm"):
            Path(str(config.DB_PATH) + ext).unlink(missing_ok=True)
        shutil.move(tmp, config.DB_PATH)
        config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        for name in z.namelist():
            if name.startswith("uploads/") and not name.endswith("/"):
                (config.UPLOAD_DIR / Path(name).name).write_bytes(z.read(name))
    print(f"Restored {file} into {config.DB_PATH}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--restore", type=Path)
    a = ap.parse_args()
    if a.restore:
        restore(a.restore)
    else:
        print("Backup written:", backup())
