"""Bounded durable acceptance for supervised webhook delivery."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import sqlite3
import stat
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

MAX_BYTES = 32 * 1024 * 1024
MAX_EVENTS = 4096
RECEIPT_RETENTION = 7 * 86400


class InboxError(ValueError):
    pass


class InboxFull(RuntimeError):
    pass


class ManagedInbox:
    def __init__(self, path: Path, activation_id: str):
        self.activation_id = str(UUID(activation_id))
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = path.parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise InboxError("Private inbox directory required")
        self.lock = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self.db = None
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise InboxError("Private inbox file required")
            finally:
                os.close(descriptor)
            self.db = sqlite3.connect(path, timeout=3, isolation_level=None)
            self.db.execute('PRAGMA journal_mode=DELETE')
            self.db.execute('PRAGMA synchronous=FULL')
            self.db.executescript('''
                CREATE TABLE IF NOT EXISTS deliveries (
                    activation TEXT NOT NULL, event_id TEXT NOT NULL, receipt TEXT NOT NULL UNIQUE,
                    digest TEXT NOT NULL, payload TEXT, bytes INTEGER NOT NULL,
                    state TEXT NOT NULL CHECK(state IN ('pending','dispatching','completed','unknown')),
                    received REAL NOT NULL, finished REAL,
                    PRIMARY KEY(activation,event_id)
                );
                CREATE INDEX IF NOT EXISTS deliveries_pending ON deliveries(activation,state,received);
            ''')
            columns = {row[1] for row in self.db.execute('PRAGMA table_info(deliveries)')}
            if 'owner_id' not in columns:
                self.db.execute('ALTER TABLE deliveries ADD COLUMN owner_id TEXT')
            for name, kind in (('boot_id', 'TEXT'), ('settled_at', 'REAL')):
                if name not in columns:
                    self.db.execute(f'ALTER TABLE deliveries ADD COLUMN {name} {kind}')
            self.db.execute("UPDATE deliveries SET boot_id=? WHERE boot_id IS NULL AND state!='completed'", (boot_id(),))
            # A vanished process cannot establish whether its external effects completed.
            self.db.execute("UPDATE deliveries SET state='unknown' WHERE state='dispatching'")
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.db is not None:
            self.db.close()
            self.db = None
        if self.lock is not None:
            os.close(self.lock)
            self.lock = None

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def accept(self, envelope: dict) -> dict:
        metadata = envelope.get('hosted_delivery')
        if (not isinstance(metadata, dict)
                or set(metadata) != {'version', 'activation_id', 'event_id', 'starts_agent'}
                or type(metadata['version']) is not int or metadata['version'] != 1
                or type(metadata['starts_agent']) is not bool
                or metadata['activation_id'] != self.activation_id
                or not isinstance(metadata['event_id'], str)
                or not re.fullmatch(r'evt_[a-f0-9]{64}', metadata['event_id'])
                or envelope.get('id') != metadata['event_id']):
            raise InboxError('Invalid delivery identity')
        payload = json.dumps(envelope, sort_keys=True, separators=(',', ':'), allow_nan=False)
        size = len(payload.encode())
        if size > 512 * 1024:
            raise InboxError('Delivery exceeds size limit')
        # Rehydrated attachment URLs and source projections can change on retry.
        content = {'event_type': envelope.get('event_type'), 'hosted_delivery': metadata}
        digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        with self.transaction():
            self.db.execute("DELETE FROM deliveries WHERE (state='completed' OR settled_at IS NOT NULL) AND finished<?",
                            (time.time() - RECEIPT_RETENTION,))
            row = self.db.execute('SELECT receipt,state,digest,bytes,payload FROM deliveries WHERE activation=? AND event_id=?',
                                  (self.activation_id, metadata['event_id'])).fetchone()
            if row is not None:
                if row[2] != digest:
                    raise InboxError('Conflicting delivery content')
                if row[1] == 'pending':
                    # Refresh source projections, never the routing/scope identity.
                    refreshed = json.loads(row[4])
                    for field in ('data', 'timestamp'):
                        if field in envelope:
                            refreshed[field] = envelope[field]
                    payload = json.dumps(refreshed, sort_keys=True, separators=(',', ':'), allow_nan=False)
                    size = len(payload.encode())
                    used = self.db.execute("SELECT coalesce(sum(bytes),0) FROM deliveries WHERE state != 'completed' AND settled_at IS NULL").fetchone()[0]
                    if size > 512 * 1024 or used - row[3] + size > MAX_BYTES:
                        raise InboxFull('Delivery inbox is full')
                    self.db.execute("UPDATE deliveries SET payload=?,bytes=? WHERE activation=? AND event_id=? AND state='pending'",
                                    (payload, size, self.activation_id, metadata['event_id']))
                return self.receipt(metadata['event_id'], row[0], row[1])
            count, used = self.db.execute("SELECT count(*),coalesce(sum(bytes),0) FROM deliveries WHERE state != 'completed' AND settled_at IS NULL").fetchone()
            if count >= MAX_EVENTS or used + size > MAX_BYTES:
                raise InboxFull('Delivery inbox is full')
            receipt = uuid4().hex
            self.db.execute('INSERT INTO deliveries(activation,event_id,receipt,digest,payload,bytes,state,received,finished) VALUES(?,?,?,?,?,?,?, ?,NULL)',
                            (self.activation_id, metadata['event_id'], receipt, digest, payload, size, 'pending', time.time()))
            return self.receipt(metadata['event_id'], receipt, 'pending')

    def claim(self, *, protocol_only: bool = False) -> tuple[str, dict] | None:
        with self.transaction():
            row = self.db.execute("SELECT d.event_id,d.payload FROM deliveries d WHERE d.activation=? AND d.state='pending' AND json_extract(d.payload, '$.hosted_delivery.starts_agent')=? AND (json_extract(d.payload, '$.hosted_delivery.starts_agent')=0 OR NOT EXISTS(SELECT 1 FROM deliveries busy WHERE busy.activation=d.activation AND busy.state IN ('dispatching','unknown') AND busy.settled_at IS NULL AND json_extract(busy.payload,'$.companion.scope_id')=json_extract(d.payload,'$.companion.scope_id'))) ORDER BY d.received,d.event_id LIMIT 1",
                                  (self.activation_id, not protocol_only)).fetchone()
            if row is None:
                return None
            self.db.execute("UPDATE deliveries SET state='dispatching',boot_id=?,owner_id=? WHERE activation=? AND event_id=?",
                            (boot_id(), os.getenv('INKBOX_MANAGED_OWNER_ID'), self.activation_id, row[0]))
            return row[0], json.loads(row[1])

    def finish(self, event_id: str, *, completed: bool) -> bool:
        if type(completed) is not bool:
            raise InboxError('Invalid delivery outcome')
        with self.transaction():
            row = self.db.execute("UPDATE deliveries SET state=?,finished=?,payload=CASE WHEN ? THEN NULL ELSE payload END,bytes=CASE WHEN ? THEN 0 ELSE bytes END WHERE activation=? AND event_id=? AND state='dispatching'",
                                  ('completed' if completed else 'unknown', time.time(), completed, completed,
                                   self.activation_id, event_id))
            return row.rowcount == 1

    def quarantine(self, event_id: str) -> dict:
        with self.transaction():
            row = self.db.execute("SELECT receipt,state,boot_id,settled_at,owner_id FROM deliveries WHERE activation=? AND event_id=?",
                                  (self.activation_id, event_id)).fetchone()
            if row is None or row[1] != 'unknown':
                raise InboxError('Only unknown outcomes may be quarantined')
            if row[3] is None:
                if not execution_stopped(row[2], row[4]):
                    raise InboxError('Cold restart required to confirm the previous execution has stopped')
                self.db.execute("UPDATE deliveries SET settled_at=?,finished=?,payload=NULL,bytes=0 WHERE activation=? AND event_id=?",
                                (time.time(), time.time(), self.activation_id, event_id))
            return {'event_id': event_id, 'quarantined': True}

    def last_completed_unix_ms(self) -> int:
        """Completion watermark; reading status must not extend the idle window."""
        value = self.db.execute(
            "SELECT COALESCE(MAX(finished),0) FROM deliveries WHERE activation=?",
            (self.activation_id,),
        ).fetchone()[0]
        return int(value * 1000)

    def summary(self) -> dict:
        counts = dict(self.db.execute('SELECT state,count(*) FROM deliveries WHERE activation=? AND settled_at IS NULL GROUP BY state',
                                      (self.activation_id,)))
        review = self.review_required()
        pending = self.db.execute("SELECT count(*) FROM deliveries d WHERE d.activation=? AND d.state='pending' AND (json_extract(d.payload,'$.hosted_delivery.starts_agent')=0 OR NOT EXISTS(SELECT 1 FROM deliveries busy WHERE busy.activation=d.activation AND busy.state='unknown' AND busy.settled_at IS NULL AND json_extract(busy.payload,'$.companion.scope_id')=json_extract(d.payload,'$.companion.scope_id')))", (self.activation_id,)).fetchone()[0]
        return {'pending': pending, 'active': counts.get('dispatching', 0),
                'unknown': counts.get('unknown', 0) - review, 'review_required': review}

    def review_required(self) -> int:
        rows = self.db.execute("SELECT boot_id,owner_id FROM deliveries WHERE activation=? AND state='unknown' AND settled_at IS NULL", (self.activation_id,))
        return sum(execution_stopped(boot, owner) for boot, owner in rows)

    def receipt(self, event_id: str, receipt: str, state: str) -> dict:
        return {'version': 1, 'activation_id': self.activation_id, 'event_id': event_id,
                'receipt_id': receipt, 'state': state if state in {'completed', 'unknown'} else 'accepted'}


def boot_id():
    try:
        return str(UUID(Path('/proc/sys/kernel/random/boot_id').read_text().strip()))
    except (OSError, ValueError):
        return None


def execution_stopped(previous_boot, previous_owner=None):
    current_boot = boot_id()
    current_owner = os.getenv('INKBOX_MANAGED_OWNER_ID')
    return bool((current_boot and previous_boot and current_boot != previous_boot)
                or (current_owner and previous_owner and current_owner != previous_owner))
