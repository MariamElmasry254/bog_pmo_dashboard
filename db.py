"""
Database module - supports BOTH PostgreSQL (production) and SQLite (local dev).

Auto-detects based on DATABASE_URL env var:
  - If DATABASE_URL starts with 'postgres://' or 'postgresql://' → use PostgreSQL
  - Otherwise → fall back to SQLite at PERSIST_DIR/pmo.db

Schema, API, and migration logic are identical for both backends.
"""
import os
import json
import logging
from contextlib import contextmanager
from datetime import datetime

logger = logging.getLogger(__name__)


def _is_postgres_url(url):
    if not url:
        return False
    return url.startswith('postgres://') or url.startswith('postgresql://')


class DB:
    """Universal DB class. Backend chosen by url scheme."""

    def __init__(self, url_or_path):
        self.backend = 'postgres' if _is_postgres_url(url_or_path) else 'sqlite'
        if self.backend == 'postgres':
            # Normalize: psycopg2 prefers 'postgresql://' over 'postgres://'
            self.url = url_or_path.replace('postgres://', 'postgresql://', 1)
            self._init_postgres()
        else:
            if url_or_path.startswith('sqlite:///'):
                self.path = url_or_path[len('sqlite:///'):]
            else:
                self.path = url_or_path
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            self._init_sqlite()

        self._init_schema()
        loc = self.url if self.backend == 'postgres' else self.path
        # Hide password if showing URL
        if self.backend == 'postgres' and '@' in loc:
            parts = loc.split('@')
            scheme_user = parts[0].rsplit(':', 1)[0]  # postgresql://user
            loc = f"{scheme_user}:***@{parts[1]}"
        logger.info(f"DB initialized [{self.backend}] at: {loc}")

    def _init_postgres(self):
        try:
            import psycopg2  # noqa: F401
            import psycopg2.extras  # noqa: F401
        except ImportError:
            raise ImportError("psycopg2 not installed. Add 'psycopg2-binary' to requirements.txt")

    def _init_sqlite(self):
        import sqlite3  # noqa: F401

    @contextmanager
    def conn(self):
        if self.backend == 'postgres':
            import psycopg2
            import psycopg2.extras
            c = psycopg2.connect(self.url, cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                yield c
                c.commit()
            except Exception:
                c.rollback()
                raise
            finally:
                c.close()
        else:
            import sqlite3
            c = sqlite3.connect(self.path, timeout=30)
            c.row_factory = sqlite3.Row
            try:
                yield c
                c.commit()
            except Exception:
                c.rollback()
                raise
            finally:
                c.close()

    def _execute(self, conn, sql, params=()):
        """Cross-backend execute. Returns cursor."""
        if self.backend == 'postgres':
            cur = conn.cursor()
            sql_pg = sql.replace('?', '%s')
            cur.execute(sql_pg, params)
            return cur
        else:
            return conn.execute(sql, params)

    def _close_cur(self, cur):
        """Close cursor (only needed for postgres). Safe no-op otherwise."""
        if self.backend == 'postgres':
            try:
                cur.close()
            except Exception:
                pass

    def _init_schema(self):
        if self.backend == 'postgres':
            ddl = [
                """CREATE TABLE IF NOT EXISTS overrides (
                    id SERIAL PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    phase TEXT NOT NULL DEFAULT '',
                    key TEXT NOT NULL,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(namespace, phase, key)
                )""",
                "CREATE INDEX IF NOT EXISTS idx_overrides_ns ON overrides(namespace, phase)",
                """CREATE TABLE IF NOT EXISTS risks (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS travel (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS audit_log (
                    id SERIAL PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    action TEXT NOT NULL,
                    key TEXT,
                    old_value TEXT,
                    new_value TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                "CREATE INDEX IF NOT EXISTS idx_audit_ns ON audit_log(namespace, timestamp DESC)",
            ]
        else:
            ddl = [
                """CREATE TABLE IF NOT EXISTS overrides (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    namespace TEXT NOT NULL,
                    phase TEXT NOT NULL DEFAULT '',
                    key TEXT NOT NULL,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(namespace, phase, key)
                )""",
                "CREATE INDEX IF NOT EXISTS idx_overrides_ns ON overrides(namespace, phase)",
                """CREATE TABLE IF NOT EXISTS risks (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS travel (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    namespace TEXT NOT NULL,
                    action TEXT NOT NULL,
                    key TEXT,
                    old_value TEXT,
                    new_value TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                "CREATE INDEX IF NOT EXISTS idx_audit_ns ON audit_log(namespace, timestamp DESC)",
            ]

        with self.conn() as c:
            for sql in ddl:
                cur = self._execute(c, sql)
                self._close_cur(cur)

    # ========================================================
    # Helpers to read rows cross-backend
    # ========================================================
    def _row_get(self, row, key, idx):
        if isinstance(row, dict):
            return row.get(key)
        # sqlite3.Row supports both index and key access
        try:
            return row[key]
        except (KeyError, IndexError):
            return row[idx] if idx < len(row) else None

    # ========================================================
    # OVERRIDES
    # ========================================================
    def set_override(self, namespace, phase, key, value):
        old = self.get_override(namespace, phase, key)
        old_json = json.dumps(old) if old is not None else None

        with self.conn() as c:
            if value is None or value == '':
                cur = self._execute(
                    c,
                    "DELETE FROM overrides WHERE namespace=? AND phase=? AND key=?",
                    (namespace, phase or '', key)
                )
                self._close_cur(cur)
                cur = self._execute(
                    c,
                    "INSERT INTO audit_log (namespace, action, key, old_value, new_value) VALUES (?, ?, ?, ?, ?)",
                    (namespace, 'delete', f"{phase}.{key}" if phase else key, old_json, None)
                )
                self._close_cur(cur)
            else:
                value_json = json.dumps(value)
                if self.backend == 'postgres':
                    upsert_sql = """
                        INSERT INTO overrides (namespace, phase, key, value, updated_at)
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(namespace, phase, key) DO UPDATE SET
                            value = EXCLUDED.value,
                            updated_at = CURRENT_TIMESTAMP
                    """
                else:
                    upsert_sql = """
                        INSERT INTO overrides (namespace, phase, key, value, updated_at)
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(namespace, phase, key) DO UPDATE SET
                            value = excluded.value,
                            updated_at = CURRENT_TIMESTAMP
                    """
                cur = self._execute(c, upsert_sql, (namespace, phase or '', key, value_json))
                self._close_cur(cur)
                cur = self._execute(
                    c,
                    "INSERT INTO audit_log (namespace, action, key, old_value, new_value) VALUES (?, ?, ?, ?, ?)",
                    (namespace, 'set', f"{phase}.{key}" if phase else key, old_json, value_json)
                )
                self._close_cur(cur)

    def get_override(self, namespace, phase, key):
        with self.conn() as c:
            cur = self._execute(
                c,
                "SELECT value FROM overrides WHERE namespace=? AND phase=? AND key=?",
                (namespace, phase or '', key)
            )
            row = cur.fetchone()
            self._close_cur(cur)
            if not row:
                return None
            value_str = self._row_get(row, 'value', 0)
            try:
                return json.loads(value_str)
            except Exception:
                return value_str

    def get_namespace_overrides(self, namespace, phase=None):
        with self.conn() as c:
            if phase is not None:
                cur = self._execute(
                    c,
                    "SELECT key, value FROM overrides WHERE namespace=? AND phase=?",
                    (namespace, phase or '')
                )
                rows = cur.fetchall()
                self._close_cur(cur)
                result = {}
                for r in rows:
                    k = self._row_get(r, 'key', 0)
                    v = self._row_get(r, 'value', 1)
                    try:
                        result[k] = json.loads(v)
                    except Exception:
                        result[k] = v
                return result
            else:
                cur = self._execute(
                    c,
                    "SELECT phase, key, value FROM overrides WHERE namespace=?",
                    (namespace,)
                )
                rows = cur.fetchall()
                self._close_cur(cur)
                result = {}
                for r in rows:
                    p = self._row_get(r, 'phase', 0) or ''
                    k = self._row_get(r, 'key', 1)
                    v = self._row_get(r, 'value', 2)
                    if p not in result:
                        result[p] = {}
                    try:
                        result[p][k] = json.loads(v)
                    except Exception:
                        result[p][k] = v
                return result

    def get_all_overrides(self):
        with self.conn() as c:
            cur = self._execute(c, "SELECT namespace, phase, key, value FROM overrides")
            rows = cur.fetchall()
            self._close_cur(cur)
            result = {}
            for r in rows:
                ns = self._row_get(r, 'namespace', 0)
                p = self._row_get(r, 'phase', 1) or ''
                k = self._row_get(r, 'key', 2)
                v = self._row_get(r, 'value', 3)
                if ns not in result:
                    result[ns] = {}
                if p not in result[ns]:
                    result[ns][p] = {}
                try:
                    result[ns][p][k] = json.loads(v)
                except Exception:
                    result[ns][p][k] = v
            return result

    def delete_namespace(self, namespace, phase=None):
        with self.conn() as c:
            if phase is not None:
                cur = self._execute(c, "DELETE FROM overrides WHERE namespace=? AND phase=?", (namespace, phase))
            else:
                cur = self._execute(c, "DELETE FROM overrides WHERE namespace=?", (namespace,))
            self._close_cur(cur)

    # ========================================================
    # RISKS
    # ========================================================
    def list_risks(self):
        with self.conn() as c:
            cur = self._execute(c, "SELECT id, data FROM risks ORDER BY updated_at DESC")
            rows = cur.fetchall()
            self._close_cur(cur)
            result = []
            for r in rows:
                rid = self._row_get(r, 'id', 0)
                data = self._row_get(r, 'data', 1)
                try:
                    d = json.loads(data)
                    d['id'] = rid
                    result.append(d)
                except Exception:
                    pass
            return result

    def upsert_risk(self, risk_id, data):
        data_json = json.dumps(data, ensure_ascii=False)
        with self.conn() as c:
            if self.backend == 'postgres':
                sql = """
                    INSERT INTO risks (id, data, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
                """
            else:
                sql = """
                    INSERT INTO risks (id, data, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
                """
            cur = self._execute(c, sql, (risk_id, data_json))
            self._close_cur(cur)

    def delete_risk(self, risk_id):
        with self.conn() as c:
            cur = self._execute(c, "DELETE FROM risks WHERE id=?", (risk_id,))
            self._close_cur(cur)

    # ========================================================
    # TRAVEL
    # ========================================================
    def list_travel(self):
        with self.conn() as c:
            cur = self._execute(c, "SELECT id, data FROM travel ORDER BY updated_at DESC")
            rows = cur.fetchall()
            self._close_cur(cur)
            result = []
            for r in rows:
                rid = self._row_get(r, 'id', 0)
                data = self._row_get(r, 'data', 1)
                try:
                    d = json.loads(data)
                    d['id'] = rid
                    result.append(d)
                except Exception:
                    pass
            return result

    def upsert_travel(self, travel_id, data):
        data_json = json.dumps(data, ensure_ascii=False)
        with self.conn() as c:
            if self.backend == 'postgres':
                sql = """
                    INSERT INTO travel (id, data, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
                """
            else:
                sql = """
                    INSERT INTO travel (id, data, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
                """
            cur = self._execute(c, sql, (travel_id, data_json))
            self._close_cur(cur)

    def delete_travel(self, travel_id):
        with self.conn() as c:
            cur = self._execute(c, "DELETE FROM travel WHERE id=?", (travel_id,))
            self._close_cur(cur)

    # ========================================================
    # STATS / DIAGNOSTICS
    # ========================================================
    def get_stats(self):
        stats = {'backend': self.backend}
        with self.conn() as c:
            for tbl in ['overrides', 'risks', 'travel', 'audit_log']:
                cur = self._execute(c, f"SELECT COUNT(*) as cnt FROM {tbl}")
                row = cur.fetchone()
                cnt = self._row_get(row, 'cnt', 0)
                self._close_cur(cur)
                stats[f'{tbl}_total'] = cnt

            cur = self._execute(c, "SELECT namespace, COUNT(*) as cnt FROM overrides GROUP BY namespace")
            rows = cur.fetchall()
            self._close_cur(cur)
            ns_breakdown = {}
            for r in rows:
                ns = self._row_get(r, 'namespace', 0)
                cnt = self._row_get(r, 'cnt', 1)
                ns_breakdown[ns] = cnt
            stats['by_namespace'] = ns_breakdown

        if self.backend == 'sqlite' and os.path.exists(self.path):
            stats['db_size_kb'] = round(os.path.getsize(self.path) / 1024, 2)
            stats['db_path'] = self.path
        else:
            stats['db_path'] = 'PostgreSQL (Railway plugin)'

        return stats

    def get_recent_audit(self, limit=50):
        with self.conn() as c:
            cur = self._execute(
                c,
                "SELECT namespace, action, key, old_value, new_value, timestamp "
                "FROM audit_log ORDER BY timestamp DESC LIMIT ?",
                (limit,)
            )
            rows = cur.fetchall()
            self._close_cur(cur)
            result = []
            for r in rows:
                item = {
                    'namespace': self._row_get(r, 'namespace', 0),
                    'action': self._row_get(r, 'action', 1),
                    'key': self._row_get(r, 'key', 2),
                    'old_value': self._row_get(r, 'old_value', 3),
                    'new_value': self._row_get(r, 'new_value', 4),
                }
                ts = self._row_get(r, 'timestamp', 5)
                if ts and hasattr(ts, 'isoformat'):
                    item['timestamp'] = ts.isoformat()
                else:
                    item['timestamp'] = str(ts) if ts else None
                result.append(item)
            return result


def migrate_from_json(db, persist_dir):
    """One-time migration from JSON files to DB."""
    migrated = []

    def migrate_file(filename, migrator):
        path = os.path.join(persist_dir, filename)
        if not os.path.exists(path):
            return
        migrated_path = path + '.migrated'
        if os.path.exists(migrated_path):
            return
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            count = migrator(data)
            os.rename(path, migrated_path)
            migrated.append(f"{filename}: {count} records")
            logger.info(f"Migrated {filename}: {count} records")
        except Exception as e:
            logger.error(f"Failed to migrate {filename}: {e}")

    def migrate_plan(data):
        count = 0
        plan_ov = data.get('plan_overrides', {}) or {}
        for phase, months_data in plan_ov.items():
            if not isinstance(months_data, dict):
                continue
            for month_key, fields in months_data.items():
                if isinstance(fields, dict):
                    for f_key, f_val in fields.items():
                        db.set_override('plan', phase, f"{month_key}.{f_key}", f_val)
                        count += 1
        pos_ov = data.get('position_overrides', {}) or {}
        for emp_name, pos_val in pos_ov.items():
            db.set_override('position', '', emp_name, pos_val)
            count += 1
        return count
    migrate_file('plan_overrides.json', migrate_plan)

    def migrate_budget(data):
        count = 0
        for phase, fields in data.items():
            if not isinstance(fields, dict):
                continue
            for f_key, f_val in fields.items():
                db.set_override('budget', phase, f_key, f_val)
                count += 1
        return count
    migrate_file('budget_overrides.json', migrate_budget)

    def migrate_services(data):
        count = 0
        for svc_key, dept_data in data.items():
            if not isinstance(dept_data, dict):
                continue
            inner = dept_data.get('departments', dept_data)
            for dept, fields in inner.items():
                if isinstance(fields, dict):
                    for f_key, f_val in fields.items():
                        db.set_override('services', svc_key, f"{dept}.{f_key}", f_val)
                        count += 1
        return count
    migrate_file('services_overrides.json', migrate_services)

    def migrate_risks(data):
        count = 0
        if isinstance(data, list):
            for r in data:
                if isinstance(r, dict) and r.get('id'):
                    db.upsert_risk(r['id'], r)
                    count += 1
        return count
    migrate_file('risks_issues.json', migrate_risks)

    def migrate_travel(data):
        count = 0
        if isinstance(data, list):
            for t in data:
                if isinstance(t, dict) and t.get('id') is not None:
                    db.upsert_travel(str(t['id']), t)
                    count += 1
        return count
    migrate_file('travel.json', migrate_travel)

    return migrated
