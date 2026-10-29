"""Single persistent physical-GPU admission ledger. Metadata only, no GPU work.

Invoke as the unprivileged SLR operator, locally or over its existing operator
SSH connection. JSON stdin; database fixed beside this installed script. A
reservation never expires merely because a client died or a connection failed.
"""
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid


def handle(database, packet):
    if not isinstance(packet, dict) or set(packet) - {"action", "gpu", "owner", "token"}:
        raise ValueError("Invalid admission packet")
    action, gpu, owner = (packet.get(k) for k in ("action", "gpu", "owner"))
    if action not in {"acquire", "release", "status"} or gpu not in {"rtx3090", "rtx5060ti"}:
        raise ValueError("Invalid admission operation")
    if not isinstance(owner, str) or str(uuid.UUID(owner)) != owner:
        raise ValueError("Invalid reservation owner")
    if action == "release" and (type(packet.get("token")) is not int or packet["token"] < 1):
        raise ValueError("Invalid fencing token")
    database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with sqlite3.connect(str(database), timeout=10) as db:
        db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE IF NOT EXISTS grants(token INTEGER PRIMARY KEY AUTOINCREMENT, gpu TEXT UNIQUE NOT NULL, owner TEXT UNIQUE NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT owner,token FROM grants WHERE gpu=?", (gpu,)).fetchone()
        if action == "status":
            return {"busy": current is not None, "owned": current is not None and current[0] == owner}
        if action == "release":
            changed = db.execute("DELETE FROM grants WHERE gpu=? AND owner=? AND token=?", (gpu, owner, packet["token"])).rowcount
            return {"done": True, "matched": changed == 1}
        if current:
            return {"granted": current[0] == owner, **({"token": current[1]} if current[0] == owner else {})}
        existing = db.execute("SELECT gpu FROM grants WHERE owner=?", (owner,)).fetchone()
        if existing:
            raise ValueError("Owner already reserved another physical GPU")
        token = db.execute("INSERT INTO grants(gpu,owner) VALUES(?,?)", (gpu, owner)).lastrowid
        return {"granted": True, "token": token}


def main():
    os.umask(0o077)
    raw = sys.stdin.buffer.readline(4097)
    if len(raw) > 4096 or not raw.endswith(b"\n") or len(sys.argv) != 1:
        raise ValueError("Invalid admission protocol")
    response = handle(Path(__file__).resolve().parent / "admission.sqlite", json.loads(raw))
    print(json.dumps({"ok": True, **response}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"ok": False, "error": "Shared GPU admission is unavailable; no GPU operation was authorized"}))
        sys.exit(1)
