"""Derive [minute, sender, level, text, regions]; preserve source timestamps in raw.

An empty source produces an empty array, with unavailability in sms.meta.json.
"""
import collections
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))
T0 = datetime(2025, 3, 21, tzinfo=KST)


def main():
    source = ROOT / "data/raw/disaster_sms.json"
    records = json.loads(source.read_text())
    provenance = json.loads(source.with_suffix(".meta.json").read_text())
    compact, days, senders = [], collections.Counter(), collections.Counter()
    seen = set()
    for r in records:
        assert r["id"] not in seen, "Duplicate SMS id"
        seen.add(r["id"])
        if r["sent_at"] is None:
            minute = None
        else:
            dt = datetime.fromisoformat(r["sent_at"])
            assert dt.utcoffset() == timedelta(hours=9), "Expected KST offset"
            assert datetime(2025, 3, 22, tzinfo=KST) <= dt < datetime(2025, 3, 31, tzinfo=KST)
            # Keep sub-minute precision when the original timestamp includes seconds.
            value = (dt - T0).total_seconds() / 60
            minute = int(value) if value.is_integer() else round(value, 6)
            days[dt.date().isoformat()] += 1
        senders[r["sender"]] += 1
        assert r["level"] in (None, "긴급재난", "안전안내", "위급재난")
        compact.append([minute, r["sender"], r["level"], r["text"], r["regions"]])
    compact.sort(key=lambda r: (r[0] is None, r[0] if r[0] is not None else float("inf"), r[1] or ""))
    target = ROOT / "web/public/data/sms.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(compact, ensure_ascii=False, separators=(",", ":")) + "\n")
    per_day = {(datetime(2025, 3, 22) + timedelta(days=i)).date().isoformat():
               days[(datetime(2025, 3, 22) + timedelta(days=i)).date().isoformat()] for i in range(9)}
    metadata = {"t0": T0.isoformat(), "columns": ["t", "sender", "level", "text", "regions"],
                "time_unit": "minutes; fractional minutes retain seconds", "row_count": len(compact),
                "source_url": provenance["source_url"], "fetched_at_utc": provenance["fetched_at_utc"],
                "licence_or_terms": provenance["licence_or_terms"],
                "complete": provenance["complete"], "actual_send_count": provenance.get("actual_send_count"),
                "count_per_day_collected": per_day,
                "count_per_sender_collected": [{"sender": k, "count": v} for k, v in sorted(senders.items(), key=lambda p: p[0] or "")],
                "caveat": provenance["caveat"]}
    target.with_suffix(".meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    print(f"SMS: {len(compact)} collected; complete={metadata['complete']}; actual total={metadata['actual_send_count']}")
    print("Collected per KST day:")
    for day, count in per_day.items():
        print(f"  {day}: {count}")
    print("Collected per sender: " + (json.dumps(metadata["count_per_sender_collected"], ensure_ascii=False) if senders else "none (historical counts unknown)"))


if __name__ == "__main__":
    main()
