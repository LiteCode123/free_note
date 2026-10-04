"""Functional checks using synthetic records and an isolated temporary database."""

import sqlite3
import tempfile
import unittest
from pathlib import Path

import app as notes


class NotesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_path = notes.DB_PATH
        self.original_key = notes._key
        notes.DB_PATH = str(Path(self.directory.name) / "test.db")
        notes._key = None
        notes.app.config["TESTING"] = True
        notes.init_db()
        self.client = notes.app.test_client()

    def tearDown(self):
        notes.DB_PATH = self.original_path
        notes._key = self.original_key
        self.directory.cleanup()

    def setup_password(self):
        response = self.client.post("/api/setup", json={"master_password": "demo-passphrase"})
        self.assertEqual(response.status_code, 200)

    def create_note(self):
        response = self.client.post("/api/records", json={
            "title": "示例笔记", "category": "测试分类",
            "fields": {"账号": "demo-user", "密码": "synthetic-secret", "备注": "示例步骤"},
        })
        self.assertEqual(response.status_code, 200)
        return response.get_json()["id"]

    def test_fresh_install_and_static_files(self):
        self.assertEqual(self.client.get("/api/status").get_json(), {
            "setup_done": False, "unlocked": False, "auto_unlock": False,
        })
        for path in ("/", "/static/app.js", "/static/style.css"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()

    def test_locked_api_rejects_reads_and_writes(self):
        for method, path in (("get", "/api/records"), ("get", "/api/categories"),
                             ("post", "/api/records"), ("put", "/api/records/1"),
                             ("delete", "/api/records/1")):
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.get_json()["error"], "locked")

    def test_password_setup_validation(self):
        self.assertEqual(self.client.post("/api/setup", json={"master_password": "short"}).status_code, 400)
        self.setup_password()
        self.assertEqual(self.client.post("/api/setup", json={"master_password": "another-demo"}).status_code, 400)

    def test_lock_unlock_and_restart(self):
        self.setup_password()
        self.create_note()
        self.client.post("/api/lock")
        self.assertEqual(self.client.get("/api/records").status_code, 401)
        self.assertEqual(self.client.post("/api/unlock", json={"master_password": "wrong-demo"}).status_code, 401)
        self.assertFalse(self.client.get("/api/status").get_json()["unlocked"])
        self.assertEqual(self.client.post("/api/unlock", json={"master_password": "demo-passphrase"}).status_code, 200)
        self.assertEqual(len(self.client.get("/api/records").get_json()["records"]), 1)
        notes._key = None
        notes.auto_load_key()
        self.assertFalse(self.client.get("/api/status").get_json()["unlocked"])

    def test_create_search_update_delete_and_categories(self):
        self.setup_password()
        rid = self.create_note()
        self.assertEqual(self.client.get("/api/categories").get_json()["categories"], {"测试分类": 1})
        for query in ("示例笔记", "测试分类", "DEMO-USER", "synthetic-secret", "示例步骤"):
            with self.subTest(query=query):
                records = self.client.get("/api/records", query_string={"q": query}).get_json()["records"]
                self.assertEqual([record["id"] for record in records], [rid])
        self.assertEqual(self.client.get("/api/records?q=missing-example").get_json()["records"], [])
        self.assertEqual(self.client.put(f"/api/records/{rid}", json={
            "title": "修改后的笔记", "category": "新分类", "fields": {"备注": "新步骤"},
        }).status_code, 200)
        record = self.client.get("/api/records").get_json()["records"][0]
        self.assertEqual(record["fields"], {"备注": "新步骤"})
        self.assertEqual(self.client.get("/api/categories").get_json()["categories"], {"新分类": 1})
        self.assertEqual(self.client.delete(f"/api/records/{rid}").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/records/{rid}").status_code, 404)
        self.assertEqual(self.client.get("/api/records").get_json()["records"], [])

    def test_fields_encrypted_and_default_key_not_persisted(self):
        self.setup_password()
        self.create_note()
        with sqlite3.connect(notes.DB_PATH) as db:
            title, category, content = db.execute("SELECT title, category, content FROM records").fetchone()
            self.assertEqual((title, category), ("示例笔记", "测试分类"))
            for value in (b"demo-user", b"synthetic-secret", "示例步骤".encode()):
                self.assertNotIn(value, content)
            self.assertIsNone(db.execute("SELECT value FROM meta WHERE key='auto_key'").fetchone())
        self.assertEqual(notes.decrypt_content(content)["密码"], "synthetic-secret")

    def test_optional_auto_unlock_persists_key(self):
        self.setup_password()
        self.create_note()
        self.assertEqual(self.client.post("/api/migrate-to-key", json={"master_password": "wrong-demo"}).status_code, 401)
        self.assertFalse(self.client.get("/api/status").get_json()["auto_unlock"])
        self.assertEqual(self.client.post("/api/migrate-to-key", json={"master_password": "demo-passphrase"}).status_code, 200)
        notes._key = None
        notes.auto_load_key()
        self.assertTrue(self.client.get("/api/status").get_json()["auto_unlock"])
        self.assertTrue(self.client.get("/api/status").get_json()["unlocked"])
        self.assertEqual(len(self.client.get("/api/records").get_json()["records"]), 1)
        self.client.post("/api/lock")
        self.assertTrue(self.client.get("/api/status").get_json()["unlocked"])


if __name__ == "__main__":
    unittest.main()
