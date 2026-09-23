"""Search readiness and timeout regressions; no external services or credentials."""

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from time import monotonic
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

os.environ.update(OPENAI_API_KEY="test-not-a-real-key", EKT_USERNAME="test", EKT_PASSWORD="test")

import httpx
import openai
from fastapi import HTTPException
import main


def page_response(request):
    page = int(request.url.params["page"])
    rows = [{"id": "1", "name": "Breaker", "properties": {"rating": "16A"}}] if page == 1 else []
    return httpx.Response(200, json={"page": page, "per_page": 500, "count": len(rows), "items": rows})


class CatalogReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "catalog.json"
        self.http = httpx.Client(transport=httpx.MockTransport(page_response))
        self.addCleanup(self.http.close)

    def catalog(self, path=None):
        catalog = main.Catalog(self.http, cache_path=path)
        self.addCleanup(catalog.close)
        return catalog

    def wait_for_load(self, catalog):
        catalog.worker.join(timeout=3)
        self.assertFalse(catalog.worker.is_alive())

    def test_cold_requests_return_immediately_and_share_one_loader(self):
        catalog = self.catalog()
        release = Event()
        entered = Event()
        self.addCleanup(release.set)

        def blocked_load():
            entered.set()
            release.wait(timeout=2)
            return [main.Product(id="1", name="Breaker")], main.datetime.now(main.timezone.utc)

        with patch.object(catalog, "_load", side_effect=blocked_load) as load:
            started = monotonic()
            for _ in range(20):
                with self.assertRaises(HTTPException) as failure:
                    catalog.get()
                self.assertEqual(failure.exception.status_code, 503)
                self.assertEqual(failure.exception.detail["code"], "CATALOG_LOADING")
            self.assertLess(monotonic() - started, 0.3)
            self.assertTrue(entered.wait(timeout=1))
            self.assertEqual(load.call_count, 1)
            self.assertEqual(catalog.status()["status"], "loading")
            release.set()
            self.wait_for_load(catalog)
            self.assertEqual(catalog.get()[0][0].id, "1")
            self.assertEqual(catalog.status()["status"], "ready")

    def test_complete_snapshot_restores_on_restart_without_network_and_keeps_search_text(self):
        first = self.catalog(self.path)
        first.warmup()
        self.wait_for_load(first)
        before = first.get()
        self.assertTrue(self.path.exists())
        self.assertIn("16A", before[0][0].search_text)
        with patch.object(self.http, "get", side_effect=AssertionError("Unexpected network")):
            restored = self.catalog(self.path)
            restored.warmup()
            after = restored.get()
        self.assertIsNone(restored.worker)
        self.assertEqual(before[0][0].search_text, after[0][0].search_text)
        self.assertEqual(before[1], after[1])
        self.assertGreater(restored.expires, monotonic())

    def test_bad_expired_partial_and_auth_response_files_are_not_catalogs(self):
        valid = {
            "version": 1, "complete": True, "count": 1,
            "checked_at": main.datetime.now(main.timezone.utc).isoformat(),
            "products": [{"id": "1", "name": "Breaker"}],
        }
        invalid = [
            {"error": "unauthorized"}, dict(valid, complete=False), dict(valid, version=2),
            dict(valid, count=2), dict(valid, products=[]),
            dict(valid, checked_at="2020-01-01T00:00:00+00:00"),
            dict(valid, checked_at="2035-01-01T00:00:00+00:00"),
            dict(valid, products=[{"id": "1"}]),
            dict(valid, count=2, products=valid["products"] * 2),
        ]
        for payload in invalid:
            with self.subTest(payload=payload):
                self.path.write_text(json.dumps(payload), encoding="utf-8")
                self.assertIsNone(self.catalog(self.path).cached)
        self.path.write_text("{broken", encoding="utf-8")
        self.assertIsNone(self.catalog(self.path).cached)

    def test_failed_load_is_not_persisted_and_has_retry_cooldown(self):
        catalog = self.catalog(self.path)
        with patch.object(catalog, "_load", side_effect=httpx.ConnectError("offline")) as load:
            catalog.warmup()
            self.wait_for_load(catalog)
            for _ in range(5):
                with self.assertRaises(HTTPException) as failure:
                    catalog.get()
                self.assertEqual(failure.exception.detail["code"], "CATALOG_LOAD_FAILED")
            self.assertEqual(load.call_count, 1)
        self.assertFalse(self.path.exists())
        self.assertEqual(catalog.status()["status"], "error")
        self.assertGreater(catalog.status()["retry_after"], 0)

    def test_refresh_failure_preserves_existing_fresh_snapshot_and_file(self):
        catalog = self.catalog(self.path)
        catalog.warmup()
        self.wait_for_load(catalog)
        snapshot = catalog.get()
        previous_file = self.path.read_bytes()
        with patch.object(catalog, "_load", side_effect=ValueError("bad upstream schema")):
            with self.assertRaises(HTTPException):
                catalog.get(fresh=True)
            self.wait_for_load(catalog)
        self.assertEqual(catalog.get(), snapshot)
        self.assertEqual(self.path.read_bytes(), previous_file)
        self.assertEqual(catalog.status()["status"], "ready")

    def test_background_deadline_prevents_loading_or_persisting_partial_catalog(self):
        catalog = self.catalog(self.path)
        with patch.object(main, "CATALOG_LOAD_TIMEOUT", 0):
            catalog.warmup()
            self.wait_for_load(catalog)
        self.assertIsNone(catalog.cached)
        self.assertFalse(self.path.exists())
        self.assertEqual(catalog.status()["status"], "error")

    def test_invalid_page_count_does_not_publish_snapshot(self):
        self.http.close()
        self.http = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(
            200, json={"page": int(request.url.params["page"]), "per_page": 500, "count": 5,
                       "items": [{"id": "1", "name": "Breaker"}]})))
        self.addCleanup(self.http.close)
        catalog = self.catalog(self.path)
        catalog.warmup()
        self.wait_for_load(catalog)
        self.assertIsNone(catalog.cached)
        self.assertFalse(self.path.exists())

    def test_detail_timeout_is_bounded(self):
        catalog = self.catalog()
        with patch.object(self.http, "get", side_effect=httpx.ReadTimeout("slow")) as get:
            with self.assertRaises(HTTPException) as failure:
                catalog.get_detail("1")
        self.assertEqual(failure.exception.detail["code"], "EKT_DETAIL_TIMEOUT")
        self.assertEqual(get.call_args.kwargs["timeout"].read, 8.0)

    def test_health_reports_readiness_separately_from_liveness(self):
        catalog = self.catalog()
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(catalog=catalog)))
        result = main.health(request)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["catalog"]["status"], "empty")

    def test_shutdown_does_not_close_http_under_running_loader_and_is_idempotent(self):
        catalog = self.catalog()
        release, entered, closed = Event(), Event(), Event()
        self.addCleanup(release.set)

        def blocked_load():
            entered.set()
            release.wait(timeout=4)
            self.assertFalse(closed.is_set())
            return [main.Product(id="1", name="Breaker")], main.datetime.now(main.timezone.utc)

        with patch.object(catalog, "_load", side_effect=blocked_load), \
             patch.object(self.http, "close", side_effect=closed.set) as close:
            catalog.warmup()
            self.assertTrue(entered.wait(timeout=1))
            started = monotonic()
            catalog.close(close_http=True)
            self.assertLess(monotonic() - started, 1.5)
            self.assertFalse(closed.is_set())
            release.set()
            self.wait_for_load(catalog)
            self.assertTrue(closed.wait(timeout=1))
            catalog.close(close_http=True)
            close.assert_called_once()


class ModelTimeoutTests(unittest.TestCase):
    def fake_client(self):
        client = Mock()
        client.with_options.return_value.responses.parse.side_effect = openai.APITimeoutError(
            request=httpx.Request("POST", "https://example.invalid"))
        return client

    def test_optional_rewrite_timeout_preserves_original_query(self):
        client = self.fake_client()
        self.assertEqual(main.query_for_catalog(client, "Breaker 16A"), "Breaker 16A")
        client.with_options.assert_called_once_with(timeout=8.0, max_retries=0)

    def test_final_model_timeout_returns_specific_error_without_retry(self):
        client = self.fake_client()
        with self.assertRaises(HTTPException) as failure:
            main.ask_model(client, {})
        self.assertEqual(failure.exception.status_code, 504)
        self.assertEqual(failure.exception.detail["code"], "OPENAI_TIMEOUT")
        client.with_options.assert_called_once_with(timeout=25.0, max_retries=0)


if __name__ == "__main__":
    unittest.main()
