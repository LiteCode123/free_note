import base64
import json
import os
import sqlite3
import sys
import threading
import webbrowser
from datetime import datetime

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from flask import Flask, g, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data.db")
PBKDF2_ITERATIONS = 600000

app = Flask(__name__, static_folder="static", static_url_path="/static")

_key = None  # 内存中的解密密钥，解锁后设置，锁定时清空


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            content BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    db.commit()
    db.close()


def auto_load_key():
    global _key
    db = sqlite3.connect(DB_PATH)
    row = db.execute("SELECT value FROM meta WHERE key='auto_key'").fetchone()
    if row:
        _key = row[0].encode("ascii")
    db.close()


def meta_get(db, key):
    row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def meta_set(db, key, value):
    db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))
    db.commit()


def derive_key(password, salt_b64):
    salt = base64.b64decode(salt_b64)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS
    )
    return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))


def is_setup_done():
    db = get_db()
    return meta_get(db, "salt") is not None


def encrypt_content(fields):
    f = Fernet(_key)
    return f.encrypt(json.dumps(fields, ensure_ascii=False).encode("utf-8"))


def decrypt_content(blob):
    f = Fernet(_key)
    return json.loads(f.decrypt(blob).decode("utf-8"))


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/status")
def status():
    db = get_db()
    return jsonify(
        {
            "setup_done": meta_get(db, "salt") is not None,
            "unlocked": _key is not None,
            "auto_unlock": meta_get(db, "auto_key") is not None,
        }
    )


@app.route("/api/setup", methods=["POST"])
def setup():
    global _key
    if is_setup_done():
        return jsonify({"error": "已经初始化"}), 400
    data = request.get_json(silent=True) or {}
    password = (data.get("master_password") or "").strip()
    if len(password) < 6:
        return jsonify({"error": "主密码至少 6 位"}), 400

    salt = os.urandom(16)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    key = derive_key(password, salt_b64)
    master_check = Fernet(key).encrypt(b"ok").decode("ascii")

    db = get_db()
    meta_set(db, "salt", salt_b64)
    meta_set(db, "master_check", master_check)
    _key = key
    return jsonify({"ok": True})


@app.route("/api/unlock", methods=["POST"])
def unlock():
    global _key
    if not is_setup_done():
        return jsonify({"error": "尚未初始化"}), 400
    data = request.get_json(silent=True) or {}
    password = data.get("master_password") or ""
    db = get_db()
    salt_b64 = meta_get(db, "salt")
    master_check = meta_get(db, "master_check")
    key = derive_key(password, salt_b64)
    try:
        Fernet(key).decrypt(master_check.encode("ascii"))
    except InvalidToken:
        return jsonify({"error": "密码错误"}), 401
    _key = key
    return jsonify({"ok": True})


@app.route("/api/migrate-to-key", methods=["POST"])
def migrate_to_key():
    global _key
    if not is_setup_done():
        return jsonify({"error": "尚未初始化"}), 400
    data = request.get_json(silent=True) or {}
    password = data.get("master_password") or ""
    db = get_db()
    salt_b64 = meta_get(db, "salt")
    master_check = meta_get(db, "master_check")
    key = derive_key(password, salt_b64)
    try:
        Fernet(key).decrypt(master_check.encode("ascii"))
    except InvalidToken:
        return jsonify({"error": "密码错误"}), 401
    meta_set(db, "auto_key", key.decode("ascii"))
    _key = key
    return jsonify({"ok": True})


@app.route("/api/lock", methods=["POST"])
def lock():
    global _key
    db = get_db()
    auto_key = meta_get(db, "auto_key")
    if auto_key:
        _key = auto_key.encode("ascii")
    else:
        _key = None
    return jsonify({"ok": True})


@app.route("/api/categories")
def categories():
    if _key is None:
        return jsonify({"error": "locked"}), 401
    db = get_db()
    counts = {}
    for row in db.execute("SELECT category, content FROM records"):
        cat = row["category"]
        counts[cat] = counts.get(cat, 0) + 1
    return jsonify({"categories": counts})


@app.route("/api/records")
def list_records():
    if _key is None:
        return jsonify({"error": "locked"}), 401
    q = (request.args.get("q") or "").strip().lower()
    db = get_db()
    result = []
    for row in db.execute("SELECT * FROM records ORDER BY updated_at DESC"):
        fields = decrypt_content(row["content"])
        record = {
            "id": row["id"],
            "category": row["category"],
            "title": row["title"],
            "fields": fields,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        if q:
            haystack = " ".join(
                [record["title"], record["category"], *[str(v) for v in fields.values()]]
            ).lower()
            if q not in haystack:
                continue
        result.append(record)
    return jsonify({"records": result})


@app.route("/api/records", methods=["POST"])
def create_record():
    if _key is None:
        return jsonify({"error": "locked"}), 401
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    category = (data.get("category") or "").strip() or "其他"
    fields = data.get("fields") or {}
    if not title:
        return jsonify({"error": "标题不能为空"}), 400
    fields = {str(k): str(v) for k, v in fields.items() if str(v) != ""}

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db = get_db()
    cur = db.execute(
        "INSERT INTO records (category, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (category, title, encrypt_content(fields), now, now),
    )
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/records/<int:rid>", methods=["PUT"])
def update_record(rid):
    if _key is None:
        return jsonify({"error": "locked"}), 401
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    category = (data.get("category") or "").strip() or "其他"
    fields = data.get("fields") or {}
    if not title:
        return jsonify({"error": "标题不能为空"}), 400
    fields = {str(k): str(v) for k, v in fields.items() if str(v) != ""}

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db = get_db()
    cur = db.execute(
        "UPDATE records SET category=?, title=?, content=?, updated_at=? WHERE id=?",
        (category, title, encrypt_content(fields), now, rid),
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "记录不存在"}), 404
    return jsonify({"ok": True})


@app.route("/api/records/<int:rid>", methods=["DELETE"])
def delete_record(rid):
    if _key is None:
        return jsonify({"error": "locked"}), 401
    db = get_db()
    cur = db.execute("DELETE FROM records WHERE id=?", (rid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "记录不存在"}), 404
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    auto_load_key()
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:8765")).start()
    app.run(host="127.0.0.1", port=8765, debug=False)
