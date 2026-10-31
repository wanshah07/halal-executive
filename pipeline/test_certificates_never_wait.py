"""A halal certificate reaches the site whatever the models or Drive do, an answer an admin
approved is never rewritten or merged away, and a heavy batch cannot hold the files lane
back (Wan, 31 Oct 2026). Run: python -m unittest pipeline/test_certificates_never_wait.py"""
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch, MagicMock

import he_api
import llm_router
import drive_organiser as organiser
import process_raw
import dedupe_faq


def cert_doc(**kw):
    return dict({"id": "DOC-0040", "status": "current", "kind": "certificate", "category": "halal", "title": "Halal certificate",
                 "drive_file_id": "file", "drive_url": "", "notes": "", "received_at": "2026-10-30"}, **kw)


class OrganiserTest(unittest.TestCase):
    def run_org(self, docs, **patches):
        written = []
        def read(tab):
            return {"Documents": docs, "Certificates": []}.get(tab, [])
        def upsert(tab, rows):
            written.append((tab, rows))
        with patch.object(organiser.he_api, "read", side_effect=read), patch.object(organiser.he_api, "upsert", side_effect=upsert), \
             patch.object(organiser.he_api, "run_log"), patch.object(organiser, "vision_ready", return_value=False), \
             patch.object(organiser, "read_cert_image", return_value=(None, "", "")):
            for target, kw in patches.items():
                pass
            rc = organiser.run()
        return rc, written

    def test_certificate_whose_file_is_gone_keeps_its_card_and_is_not_an_error(self):
        with patch.object(organiser.he_api, "drive_get", side_effect=he_api.ApiError("drive_get: No item with the given ID could be found.")):
            rc, written = self.run_org([cert_doc()])
        self.assertEqual(rc, 0, "a file that is gone cannot be retried, so it is not a failed run")
        certs = [r for tab, rows in written if tab == "Certificates" for r in rows]
        self.assertEqual(len(certs), 1)
        self.assertIn("title-only", certs[0]["notes"])
        self.assertIn("vision-tried", certs[0]["notes"], "or every run would look for the file again")
        self.assertEqual(certs[0]["status"], "nofile", "a certificate with no file is kept for Admin but not shown")
        docs = [r for tab, rows in written if tab == "Documents" for r in rows]
        self.assertTrue(any("file missing" in r["notes"] for r in docs))

    def test_other_document_whose_file_is_gone_is_hidden_not_retried_for_ever(self):
        doc = cert_doc(id="DOC-0050", kind="circular", status="inbox")
        with patch.object(organiser.he_api, "drive_get", side_effect=he_api.ApiError("No item with the given ID could be found")):
            rc, written = self.run_org([doc])
        self.assertEqual(rc, 0)
        self.assertTrue(any(tab == "Documents" and r["status"] == "hidden" for tab, rows in written for r in rows))

    def test_models_down_a_certificate_still_gets_its_card(self):
        doc = cert_doc(id="DOC-0041", status="inbox")
        f = {"name": "scan.pdf", "text": "SIJIL PENGESAHAN HALAL MALAYSIA", "sha256": "h1", "modified": "now"}
        down = llm_router.LLMError("all providers failed")
        with patch.object(organiser.he_api, "drive_get", return_value=f), patch.object(organiser.llm_router, "complete_json", side_effect=down), \
             patch.object(organiser, "read_cert", side_effect=down), \
             patch.object(organiser.he_api, "drive_file", return_value={"url": "u", "modified": "now", "name": "n.pdf"}):
            rc, written = self.run_org([doc])
        self.assertEqual(rc, 0)
        certs = [r for tab, rows in written if tab == "Certificates" for r in rows]
        self.assertTrue(certs, "the card is made from the title while the models are down")
        self.assertIn("title-only", certs[0]["notes"])


class NoFileTest(unittest.TestCase):
    def test_certificates_without_a_file_leave_the_site_and_come_back_with_it(self):
        certs = [
            {"id": "CERT-0025", "status": "current", "notes": "title-only: the file is not in Drive, upload it again in Admin; vision-tried"},
            {"id": "CERT-0030", "status": "current", "notes": "AFIQ full-read"},        # Drive says its file is missing
            {"id": "CERT-M260101", "status": "current", "notes": ""},                       # typed in by hand: no file by design
            {"id": "CERT-0031", "status": "current", "notes": "shown by admin"},
            {"id": "CERT-0032", "status": "nofile", "notes": ""},                           # its file is back
            {"id": "CERT-0033", "status": "current", "notes": "AFIQ full-read"},           # fine
        ]
        state = {"CERT-0025": "missing", "CERT-0030": "missing", "CERT-0031": "missing", "CERT-0032": "ok", "CERT-0033": "ok", "CERT-M260101": "nofile"}
        written = []
        with patch.object(organiser.he_api, "read", return_value=certs), \
             patch.object(organiser.he_api, "post", return_value={"rows": [{"id": k, "state": v} for k, v in state.items()]}), \
             patch.object(organiser.he_api, "upsert", side_effect=lambda t, r: written.append(r[0])):
            n = organiser.hide_certificates_without_file()
        by = {r["id"]: r["status"] for r in written}
        self.assertEqual(by, {"CERT-0025": "nofile", "CERT-0030": "nofile", "CERT-0032": "current"})
        self.assertEqual(n, 3)

    def test_a_certificate_found_in_drive_becomes_a_document_for_the_organiser(self):
        files = [{"id": "known", "name": "a.pdf", "mime": "application/pdf", "modified": "2026-10-30", "path": "00 Inbox/whatsapp"},
                 {"id": "cert1", "name": "scan001.pdf", "mime": "application/pdf", "modified": "2026-10-31", "path": "00 Inbox/whatsapp"},
                 {"id": "menu1", "name": "menu.jpg", "mime": "image/jpeg", "modified": "2026-10-31", "path": "00 Inbox/whatsapp"}]
        texts = {"cert1": {"text": "SIJIL PENGESAHAN HALAL MALAYSIA ... syarikat", "sha256": "h1"}, "menu1": {"text": "nasi lemak RM5", "sha256": "h2"}}
        up = []
        import tempfile
        state_dir = pathlib.Path(tempfile.mkdtemp())
        counter = iter(range(60, 70))
        with patch.object(organiser.he_api, "post", return_value={"files": files}), patch.object(organiser.he_api, "drive_get", side_effect=lambda fid, text=True, **k: texts[fid]), \
             patch.object(organiser.he_api, "upsert", side_effect=lambda t, r: up.extend(r)), patch.object(organiser, "STATE", state_dir):
            out = organiser.sweep_drive([{"id": "DOC-0001", "drive_file_id": "known"}], lambda: f"DOC-{next(counter):04d}")
            again = organiser.sweep_drive([{"id": "DOC-0001", "drive_file_id": "known"}], lambda: f"DOC-{next(counter):04d}")
        self.assertEqual([d["drive_file_id"] for d in out], ["cert1"])
        self.assertEqual(out[0]["kind"], "certificate"); self.assertEqual(out[0]["status"], "inbox"); self.assertEqual(out[0]["id"], "DOC-0060")
        self.assertEqual(again, [], "the menu is remembered as not a certificate, the certificate is now a Documents row")
        self.assertEqual([d["id"] for d in up], ["DOC-0060"])


class FilesLaneTest(unittest.TestCase):
    def test_both_models_down_the_admin_certificate_is_filed_without_them(self):
        row = {"id": "manual-1", "source": "manual", "ts": "2026-10-31T01:00:00Z", "msg_id": "m1", "notes": "",
               "text": process_raw.ADMIN_CERT + " (file name: cert.pdf)",
               "attachments": json.dumps([{"name": "cert.pdf", "mime": "application/pdf", "drive_file_id": "fid", "drive_url": "u", "sha256": "abc"}])}
        calls = {"n": 0}
        def raw_list(**kw):
            if kw.get("status") == "error":
                return []
            calls["n"] += 1
            return [row] if calls["n"] == 1 else []
        upserts, updates = [], []
        with patch.object(he_api, "read", return_value=[]), patch.object(he_api, "post", return_value={"new": 1}), \
             patch.object(he_api, "progress"), patch.object(he_api, "run_log"), patch.object(he_api, "raw_list", side_effect=raw_list), \
             patch.object(he_api, "drive_get", return_value={"text": "", "name": "cert.pdf"}), \
             patch.object(he_api, "upsert", side_effect=lambda t, r: upserts.append((t, r))), \
             patch.object(he_api, "raw_update", side_effect=lambda ids, **kw: updates.append((ids, kw))), \
             patch.object(process_raw.llm_router, "complete_json", side_effect=llm_router.LLMError("both failed")), \
             patch.object(process_raw, "picture_text", return_value=""):
            process_raw.run(["manual"], 5, False, 5, True)
        docs = [r for t, rows in upserts if t == "Documents" for r in rows]
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]["kind"], "certificate")
        self.assertEqual(docs[0]["status"], "inbox", "the organiser gives it its card")
        self.assertTrue(any(ids == ["manual-1"] and kw.get("status") == "processed" for ids, kw in updates), updates)

    def test_a_failed_batch_is_halved_and_the_rest_are_still_read(self):
        rows = [{"id": f"w-{i}", "source": "whatsapp", "ts": "2026-10-31T01:00:00Z", "msg_id": str(i), "notes": "", "text": "Soalan halal " + "x" * 200,
                 "attachments": json.dumps([{"name": f"f{i}.pdf", "mime": "application/pdf", "drive_file_id": f"fid{i}"}])} for i in range(4)]
        done = set()
        sizes = []
        def raw_list(**kw):
            if kw.get("status") == "error":
                return []
            return [r for r in rows if r["id"] not in done]
        def complete(messages, **kw):
            n = len(json.loads(messages[1]["content"])["messages"])
            sizes.append(n)
            if n > 1:
                raise llm_router.LLMError("timed out")   # a heavy batch times out, one message at a time is fine
            return {"provider": "t", "model": "m", "json": {"items": []}}
        def raw_update(ids, **kw):
            if kw.get("status") in ("processed", "skipped"):
                done.update(ids)
        with patch.object(he_api, "read", return_value=[]), patch.object(he_api, "post", return_value={"new": 4}), \
             patch.object(he_api, "progress"), patch.object(he_api, "run_log"), patch.object(he_api, "raw_list", side_effect=raw_list), \
             patch.object(he_api, "drive_get", return_value={"text": "a long text"}), patch.object(he_api, "upsert"), \
             patch.object(he_api, "raw_update", side_effect=raw_update), patch.object(process_raw.llm_router, "complete_json", side_effect=complete), \
             patch.object(process_raw, "picture_text", return_value=""):
            rc = process_raw.run(["whatsapp"], 30, False, 5, True)
        self.assertEqual(done, {"w-0", "w-1", "w-2", "w-3"}, sizes)
        self.assertEqual(rc, 0, "the run recovered, so it is not red")

    def test_an_approved_answer_is_not_overwritten_by_a_new_message(self):
        approved = {"id": "FAQ-0001", "category": "halal", "question_en": "How long is the certificate valid?", "answer_formal_en": "Two years (approved).",
                    "answer_layman_en": "Two years.", "answer_formal_bm": "Dua tahun.", "answer_layman_bm": "Dua tahun.", "status": "published",
                    "source_refs": "whatsapp-1", "approved_at": "2026-10-30T01:00:00Z", "updated_at": "2026-10-30T01:00:00Z"}
        row = {"id": "w-9", "source": "whatsapp", "ts": "2026-10-31T01:00:00Z", "msg_id": "9", "notes": "", "text": "Berapa lama sijil halal sah? [question]", "attachments": "[]"}
        calls = {"n": 0}
        def raw_list(**kw):
            if kw.get("status") == "error":
                return []
            calls["n"] += 1
            return [row] if calls["n"] == 1 else []
        upserts = []
        out = {"provider": "t", "model": "m", "json": {"items": [{"relevant": True, "id": "FAQ-0001", "category": "halal", "question_en": "How long is the certificate valid?",
               "answer_formal_en": "Three years [SAHKAN: x]", "answer_layman_en": "Three.", "answer_formal_bm": "Tiga.", "answer_layman_bm": "Tiga.", "source_msg_ids": ["whatsapp-9"]}]}}
        with patch.object(he_api, "read", side_effect=lambda tab: [approved] if tab == "FAQ" else []), patch.object(he_api, "post", return_value={"new": 1}), \
             patch.object(he_api, "progress"), patch.object(he_api, "run_log"), patch.object(he_api, "raw_list", side_effect=raw_list), \
             patch.object(he_api, "upsert", side_effect=lambda t, r: upserts.append((t, r))), patch.object(he_api, "raw_update"), \
             patch.object(process_raw.llm_router, "complete_json", return_value=out):
            process_raw.run(["whatsapp"], 5, False, 5, None)
        faq = [r for t, rows in upserts if t == "FAQ" for r in rows]
        self.assertEqual(len(faq), 1)
        self.assertEqual(faq[0]["answer_formal_en"], "Two years (approved).")
        self.assertEqual(faq[0]["status"], "published")
        self.assertIn("whatsapp-9", faq[0]["source_refs"], "the new message is still recorded as a source")


class DedupeTest(unittest.TestCase):
    def test_the_answer_an_admin_approved_is_the_one_kept(self):
        a = {"id": "FAQ-0001", "category": "halal", "status": "published", "question_en": "certificate validity period halal", "answer_formal_en": "x" * 500}
        b = {"id": "FAQ-0002", "category": "halal", "status": "published", "question_en": "halal certificate validity period", "answer_formal_en": "short", "approved_at": "2026-10-30T00:00:00Z"}
        upserts = []
        with patch.object(he_api, "read", return_value=[a, b]), patch.object(he_api, "upsert", side_effect=lambda t, r: upserts.append(r)), \
             patch.object(he_api, "run_log"), patch.object(dedupe_faq.llm_router, "complete_json", return_value={"provider": "t", "model": "m", "json": {"same": [1]}}), \
             patch.object(dedupe_faq, "STATE", pathlib.Path(tempfile.mkdtemp())):
            dedupe_faq.main()
        dropped = [r["id"] for rows in upserts for r in rows if r.get("status") == "duplicate"]
        self.assertEqual(dropped, ["FAQ-0001"], "the fuller one would have been kept; the approved one must be")

    def test_two_approved_answers_are_left_alone(self):
        a = {"id": "FAQ-0001", "category": "halal", "status": "published", "question_en": "certificate validity period halal", "approved_at": "x"}
        b = {"id": "FAQ-0002", "category": "halal", "status": "published", "question_en": "halal certificate validity period", "approved_at": "y"}
        upserts = []
        with patch.object(he_api, "read", return_value=[a, b]), patch.object(he_api, "upsert", side_effect=lambda t, r: upserts.append(r)), \
             patch.object(he_api, "run_log"), patch.object(dedupe_faq.llm_router, "complete_json", return_value={"provider": "t", "model": "m", "json": {"same": [1]}}), \
             patch.object(dedupe_faq, "STATE", pathlib.Path(tempfile.mkdtemp())):
            dedupe_faq.main()
        self.assertEqual(upserts, [])


class RouterTest(unittest.TestCase):
    def test_a_503_model_is_replaced_by_another_of_the_same_gateway(self):
        import llm_router as lr
        calls = []
        def resp(code, body):
            m = MagicMock(); m.status_code = code; m.text = json.dumps(body); m.json.return_value = body; return m
        def post(url, json=None, **kw):
            calls.append(json["model"])
            if json["model"] == "glm-5.3-flashx":
                return resp(503, {"error": {"message": "temporarily unavailable"}})
            return resp(200, {"choices": [{"message": {"content": "ok"}}]})
        def get(url, **kw):
            return resp(200, {"data": [{"id": "glm-5.3-flashx"}, {"id": "glm-5.3"}, {"id": "text-embedding-3"}]})
        with patch.dict("os.environ", {"MIRELD_API_KEY": "k"}), patch.object(lr.requests, "post", side_effect=post), patch.object(lr.requests, "get", side_effect=get), \
             patch.object(lr, "resolve_model", return_value="glm-5.3-flashx"):
            out = lr._call("MIRELD", [{"role": "user", "content": "x"}])
        self.assertEqual(out["text"], "ok")
        self.assertEqual(out["model"], "glm-5.3")
        self.assertEqual(calls, ["glm-5.3-flashx", "glm-5.3"])

    def test_fast_asks_for_the_quick_model(self):
        import llm_router as lr
        seen = []
        def resp(code, body):
            m = MagicMock(); m.status_code = code; m.text = json.dumps(body); m.json.return_value = body; return m
        def post(url, json=None, **kw):
            seen.append(json["model"]); return resp(200, {"choices": [{"message": {"content": "ok"}}]})
        def get(url, **kw):
            return resp(200, {"data": [{"id": "glm-5.3"}, {"id": "glm-5.3-flash"}, {"id": "kimi-k3"}]})
        with patch.dict("os.environ", {"AFIQ_API_KEY": "k"}), patch.object(lr.requests, "post", side_effect=post), patch.object(lr.requests, "get", side_effect=get), \
             patch.object(lr, "admin_cfg", return_value={}), patch.object(lr, "resolve_model", return_value="glm-5.3"):
            lr._call("AFIQ", [{"role": "user", "content": "x"}], fast=True)
            lr._call("AFIQ", [{"role": "user", "content": "x"}])
        self.assertEqual(seen, ["glm-5.3-flash", "glm-5.3"])


if __name__ == "__main__":
    unittest.main()
