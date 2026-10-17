"""Small, cached, rate-limited HTTP client for public data (stdlib only).

Never pass credentials: request URLs/bodies are saved for reproducibility.
"""
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/raw/public_cache"
_last_request = 0.0


def redact_public_tokens(data, content_type):
    # Some public map pages embed provider keys. Do not persist those in evidence.
    if content_type and any(t in content_type for t in ("text/", "javascript")):
        data = re.sub(rb"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}",
                      b"[REDACTED_PUBLIC_TOKEN]", data)
        return re.sub(rb"((?:api_?key|service_?key|access_?token|vworld_?key)\s*[=:]\s*)([\"'])([^\"']+)\2",
                      rb"\1\2[REDACTED_PUBLIC_TOKEN]\2", data, flags=re.I)
    return data


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def fetch(url, body=None, *, terms=None, row_count=None, max_bytes=200_000_000):
    """Cache successful AND failed responses. Retry transient failures with backoff."""
    global _last_request
    payload = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    key = hashlib.sha256(url.encode() + b"\0" + (payload or b"")).hexdigest()
    path = CACHE / (key + ".body")
    meta_path = path.with_suffix(".meta.json")
    if path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        data = path.read_bytes()
        redacted = redact_public_tokens(data, meta.get("content_type"))
        changed = False
        if redacted != data:
            path.write_bytes(redacted)
            meta["public_tokens_redacted"] = True
            meta["sha256"] = hashlib.sha256(redacted).hexdigest()
            changed = True
        if terms is not None and meta.get("licence_or_terms") is None:
            meta["licence_or_terms"] = terms
            changed = True
        if row_count is not None and meta.get("row_count") is None:
            meta["row_count"] = row_count
            changed = True
        if changed:
            write_json(meta_path, meta)
        return redacted, meta
    CACHE.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "FiretraceKR-public-data-research/1.0", "Accept": "*/*"}
    if payload is not None:
        headers["Content-Type"] = "application/json; charset=UTF-8"
    attempts = []
    for attempt in range(3):
        # Shared across sequential requests; scripts should not run concurrently.
        time.sleep(max(0, 0.6 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, payload, headers), timeout=45) as res:
                data = res.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise ValueError("Response exceeds configured download size cap")
                status, final_url, content_type = res.status, res.url, res.headers.get("Content-Type")
            break
        except urllib.error.HTTPError as exc:
            data = exc.read(max_bytes + 1)
            status, final_url, content_type = exc.code, exc.url, exc.headers.get("Content-Type")
            attempts.append({"status": status, "error": str(exc)})
            if status not in (429, 500, 502, 503, 504) or attempt == 2:
                break
        except (urllib.error.URLError, TimeoutError) as exc:
            data = str(exc).encode()
            status, final_url, content_type = None, url, "text/plain"
            attempts.append({"status": None, "error": str(exc)})
            if attempt == 2:
                break
        time.sleep(2 ** (attempt + 1))
    redacted = redact_public_tokens(data, content_type)
    tokens_redacted = redacted != data
    data = redacted
    meta = {"source_url": url, "final_url": final_url, "fetched_at_utc": utc_now(),
            "licence_or_terms": terms, "row_count": row_count,
            "caveat": "Research response cache; row_count is null for HTML/JS/binary or unknown. No reuse licence inferred.",
            "http_status": status, "content_type": content_type, "request_body": body,
            "attempts": attempts, "public_tokens_redacted": tokens_redacted,
            "sha256": hashlib.sha256(data).hexdigest()}
    path.write_bytes(data)
    write_json(meta_path, meta)
    return data, meta


def fetch_json(url, body=None, **kwargs):
    data, meta = fetch(url, body, **kwargs)
    if meta["http_status"] != 200:
        raise RuntimeError(f"HTTP {meta['http_status']}: {url}")
    value = json.loads(data)
    count = len(value) if isinstance(value, list) else (
        len(value["features"]) if isinstance(value, dict) and isinstance(value.get("features"), list) else None)
    if count is not None and meta["row_count"] != count:
        meta["row_count"] = count
        key = hashlib.sha256(url.encode() + b"\0" + (b"" if body is None else json.dumps(body, ensure_ascii=False).encode())).hexdigest()
        write_json(CACHE / (key + ".meta.json"), meta)
    return value, meta
