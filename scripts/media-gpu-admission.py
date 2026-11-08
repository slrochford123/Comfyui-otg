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
import time
import uuid

GPU_BITS = {"rtx3090": 1, "rtx5060ti": 2}
GPU_3060 = "GPU-e94b5b3f-0d6e-09a7-473f-a85fe4b248ea"
WAIT_TTL_MS = 120_000


def handle(database, packet):
    if not isinstance(packet, dict) or set(packet) - {"action", "gpu", "owner", "token", "ticket", "gpus"}:
        raise ValueError("Invalid admission packet")
    action, gpu, owner = (packet.get(k) for k in ("action", "gpu", "owner"))
    if action not in {"acquire", "release", "status", "enqueue", "cancel"} or gpu not in GPU_BITS:
        raise ValueError("Invalid admission operation")
    if not isinstance(owner, str) or str(uuid.UUID(owner)) != owner:
        raise ValueError("Invalid reservation owner")
    if (action == "release" or "token" in packet) and (action not in {"release","status"} or type(packet.get("token")) is not int or packet["token"] < 1):
        raise ValueError("Invalid fencing token")
    ticket = packet.get("ticket")
    if (ticket is not None and (type(ticket) is not int or ticket < 1)) or (action == "cancel" and ticket is None):
        raise ValueError("Invalid waiting ticket")
    if "gpus" in packet and action != "enqueue":
        raise ValueError("Eligibility is only accepted when registering a ticket")
    choices = packet.get("gpus", [gpu])
    if not isinstance(choices, list) or not choices or len(choices) > 2 or any(not isinstance(g, str) or g not in GPU_BITS for g in choices) or len(set(choices)) != len(choices) or gpu not in choices:
        raise ValueError("Invalid qualified GPU choices")
    mask = sum(GPU_BITS[g] for g in choices)
    now = int(time.time() * 1000)
    database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with sqlite3.connect(str(database), timeout=10) as db:
        db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE IF NOT EXISTS grants(token INTEGER PRIMARY KEY AUTOINCREMENT, gpu TEXT UNIQUE NOT NULL, owner TEXT UNIQUE NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS tickets(sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT UNIQUE NOT NULL, gpu_mask INTEGER NOT NULL, state TEXT NOT NULL, expires_at INTEGER NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        # Only ungranted waiting intent expires. Active work NEVER expires.
        db.execute("UPDATE tickets SET state='expired' WHERE state='waiting' AND expires_at<=?", (now,))
        waiting = db.execute("SELECT sequence,gpu_mask,state FROM tickets WHERE owner=?", (owner,)).fetchone()
        owned = db.execute("SELECT gpu,token FROM grants WHERE owner=?", (owner,)).fetchone()
        current = db.execute("SELECT owner,token FROM grants WHERE gpu=?", (gpu,)).fetchone()
        if action == "enqueue":
            if waiting and waiting[1] != mask:
                raise ValueError("A ticket cannot change its qualified GPU set")
            if waiting and waiting[2] == "expired":
                db.execute("DELETE FROM tickets WHERE owner=? AND state='expired'", (owner,))
                waiting = None  # New sequence fences delayed claims/cancels.
            if not waiting:
                sequence = db.execute("INSERT INTO tickets(owner,gpu_mask,state,expires_at) VALUES(?,?,?,?)",
                    (owner, mask, "granted" if owned else "waiting", now + WAIT_TTL_MS)).lastrowid
                waiting = (sequence, mask, "granted" if owned else "waiting")
            elif waiting[2] == "waiting":
                db.execute("UPDATE tickets SET expires_at=? WHERE owner=?", (now + WAIT_TTL_MS, owner))
            return {"ticket": waiting[0], "state": waiting[2]}
        if action == "cancel":
            if owned:
                return {"done": False, "matched": False}  # Cancel cannot release a grant.
            changed = db.execute("UPDATE tickets SET state='canceled' WHERE owner=? AND sequence=? AND state IN ('waiting','expired')", (owner, ticket)).rowcount
            return {"done": True, "matched": changed == 1}
        head = db.execute("SELECT owner FROM tickets WHERE state='waiting' AND (gpu_mask & ?) != 0 ORDER BY sequence LIMIT 1", (GPU_BITS[gpu],)).fetchone()
        turn = head is None or head[0] == owner
        if action == "status":
            return {"protocol": 2, "waiting_ttl_ms": WAIT_TTL_MS, "busy": current is not None, "owned": current is not None and current[0] == owner, "turn": turn, "fenced": current is not None and current == (owner, packet.get("token"))}
        if action == "release":
            changed = db.execute("DELETE FROM grants WHERE gpu=? AND owner=? AND token=?", (gpu, owner, packet["token"])).rowcount
            if changed:
                db.execute("UPDATE tickets SET state='done' WHERE owner=? AND state='granted'", (owner,))
            return {"done": True, "matched": changed == 1}
        if ticket is not None and (not waiting or waiting[0] != ticket or waiting[2] not in {"waiting", "granted"} or not waiting[1] & GPU_BITS[gpu]):
            return {"granted": False}
        if current:
            return {"granted": current[0] == owner, **({"token": current[1]} if current[0] == owner else {})}
        if owned:
            raise ValueError("Owner already reserved another physical GPU")
        if not turn or (waiting and (ticket != waiting[0] or waiting[2] != "waiting")):
            return {"granted": False}  # Legacy non-ticket callers may not jump the queue.
        token = db.execute("INSERT INTO grants(gpu,owner) VALUES(?,?)", (gpu, owner)).lastrowid
        if waiting:
            db.execute("UPDATE tickets SET state='granted' WHERE owner=? AND sequence=?", (owner, ticket))
        return {"granted": True, "token": token}


def main():
    os.umask(0o077)
    raw = sys.stdin.buffer.readline(4097)
    if len(raw) > 4096 or not raw.endswith(b"\n") or len(sys.argv) != 1:
        raise ValueError("Invalid admission protocol")
    directory = Path(__file__).resolve().parent
    # One shared ledger for the dedicated physical device. It is
    # not another authority for either renderer; the shared renderer ledger
    # and its existing grants remain exactly where they are.
    if (directory / "rtx3060-only").is_file():
        GPU_BITS.clear()
        GPU_BITS[GPU_3060] = 4
    response = handle(directory / "admission.sqlite", json.loads(raw))
    print(json.dumps({"ok": True, **response}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"ok": False, "error": "Shared GPU admission is unavailable; no GPU operation was authorized"}))
        sys.exit(1)
