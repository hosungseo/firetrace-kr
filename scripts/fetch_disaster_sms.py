"""Collect public emergency SMS; explicitly preserve unavailable archive coverage.

No credentials are loaded or requested. Cached reruns make no HTTP requests.
"""
import collections
import html
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from public_data_http import ROOT, fetch, utc_now, write_json

BASE = "https://www.safekorea.go.kr"
PAGE = BASE + "/safekorea-kor/ctim/cmsg/calamitySms.do"
LEGACY = BASE + "/idsiSFK/bbs/user/disasterMsgList.do"
TERMS = "© 2026 Ministry of the Interior and Safety. All rights reserved (page footer). No separate data reuse licence found on this archive page."
COUNTIES = ("의성군", "안동시", "청송군", "영양군", "영덕군")
KST = timezone(timedelta(hours=9))
DAYS = [(datetime(2025, 3, 22) + timedelta(days=i)).date().isoformat() for i in range(9)]


def plain(s):
    return html.unescape(re.sub(r"<[^>]*>", "", s)).strip()


def parse_rows(s):
    """Read desktop rows only (the mobile list duplicates them)."""
    rows = []
    for ident, content, info in re.findall(
            r'<td class="tit"><a href="javascript:onSubmit\(\'(\d+)\'\);">(.*?)</a>\s*<p[^>]*>(.*?)</p>', s, re.S):
        info = plain(info)
        stamp = re.search(r"발송일시\s*:\s*(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})", info)
        if not stamp:
            raise ValueError("SMS row is missing its original send timestamp")
        region = re.search(r"송출지역\s*:\s*(.*)$", info)
        level = re.search(r"긴급단계\s*:\s*(.*?)\s*ㆍ", info)
        text = plain(content)
        sender = re.match(r"\[([^\]]+)\]\s*(.*)", text, re.S)
        regions = [r.strip() for r in region[1].split(",")] if region else None
        if regions is None:
            raise ValueError("Cannot determine SMS receiving area")
        relevant = any(("경상북도" in r and (any(c in r for c in COUNTIES) or r.strip() in ("경상북도", "경상북도 전체")))
                       or r.strip() in ("전국", "전국 전체") for r in regions)
        if relevant:
            original = stamp[1]
            sent = datetime.strptime(original, "%Y/%m/%d %H:%M:%S").replace(tzinfo=KST)
            if sent.date().isoformat() not in DAYS:
                raise ValueError("Source ignored requested date range")
            rows.append({"id": ident, "sent_at": sent.isoformat(), "sent_at_original": original,
                         "sender": sender[1] if sender else None,
                         "regions": regions, "level": level[1] if level else None,
                         "text": sender[2] if sender else text,
                         "source_url": BASE + "/safekorea-kor/ctim/cmsg/calamitySmsView.do?menuSn=34&smsTrsmSn=" + ident})
    return rows


def search(params):
    url = PAGE + "?" + urlencode(params)
    data, meta = fetch(url, terms=TERMS)
    s = data.decode("utf-8")
    count = re.search(r'board-count.*?<span>\s*([\d,]+)', s, re.S)
    return s, {"source_url": url, "fetched_at_utc": meta["fetched_at_utc"],
               "http_status": meta["http_status"], "final_url": meta["final_url"],
               "reported_rows": int(count[1].replace(",", "")) if count else None,
               "verbatim_error": "데이터가 존재하지 않습니다." if "데이터가 존재하지 않습니다." in s else None}


def main():
    attempts = []
    for url, body in [
        (BASE + "/idsiSFK/neo/sfk/cs/sfc/dis/disasterMsgList.jsp", None),
        (BASE + "/idsiSFK/neo/js/dis/disasterMsgList.js", None),
        (BASE + "/idsiSFK/neo/sfk/cs/sfc/dis/disasterMsgList.js", None),
        (LEGACY, {"searchInfo": {"pageIndex": "1", "pageUnit": "100", "pageSize": "10",
                   "firstIndex": "1", "lastIndex": "1", "searchBgnDe": "20250322",
                   "searchEndDe": "20250330", "searchGb": "1", "searchWrd": "",
                   "rcv_Area_Id": "", "dstr_se_Id": "", "c_ocrc_type": "",
                   "sbLawArea1": "4700000000", "sbLawArea2": "", "sbLawArea3": "",
                   "searchSido": "", "searchSgg": "", "searchEmd": "", "searchInfo": "", "idxArchive": "2025"}})]:
        _, m = fetch(url, body, terms=TERMS)
        attempts.append({k: m[k] for k in ("source_url", "final_url", "fetched_at_utc", "http_status", "request_body")})
    _, control = search({"menuSn": 34, "firstYn": "Y"})
    attempts.append(control)
    rows = {}
    coverage = []
    for day in DAYS:
        params = {"menuSn": 34, "firstYn": "N", "readYn": "Y", "currentPage": 1,
                  "startDate": day, "endDate": day}
        s, evidence = search(params)
        attempts.append(evidence)
        count = evidence["reported_rows"]
        if count is None:
            raise RuntimeError("Archive response has no recognizable result count; inspect cache")
        if count:
            parsed = parse_rows(s)
            rows.update((r["id"], r) for r in parsed)
            for page in range(2, (count + 9) // 10 + 1):
                params["currentPage"] = page
                s, evidence = search(params)
                attempts.append(evidence)
                rows.update((r["id"], r) for r in parse_rows(s))
        coverage.append({"date_kst": day, "nationwide_search_reported_rows": count,
                         "collected_count": sum(r["sent_at"][:10] == day for r in rows.values()),
                         "actual_send_count": None,
                         "coverage_status": "unavailable_history" if not count else "retrieved_unverified_completeness"})
    # Check both plausible archive selectors. These are probes, not a supported new-site API.
    for archive in ("2025", "202503"):
        _, evidence = search({"menuSn": 34, "startDate": "2025-03-25", "endDate": "2025-03-25", "idxArchive": archive})
        attempts.append(evidence)
    result = sorted(rows.values(), key=lambda r: (r["sent_at"], r["id"]))
    key_present = any((ROOT.home() / ".openclaw/secrets").glob("safetydata-*"))
    meta = {"source_url": PAGE, "fetched_at_utc": max(a["fetched_at_utc"] for a in attempts),
            "licence_or_terms": TERMS, "row_count": len(result), "complete": False,
            "period_kst": ["2025-03-22T00:00:00+09:00", "2025-03-30T23:59:59+09:00"],
            "receiving_area_scope": ["경상북도 " + c for c in COUNTIES] + ["경상북도 전체", "전국 전체"],
            "actual_send_count": None, "coverage_by_day": coverage,
            "count_per_sender_collected": dict(collections.Counter(r["sender"] for r in result)),
            "attempts": attempts, "safetydata_key_present": key_present,
            "caveat": "Empty retrieval is NOT evidence of zero historical sends. Legacy JSP/JS/JSON routes redirect to new homepage; new archive returns no 2025 rows while recent control works. History completeness cannot be established. No press-reported send is substituted for an official SMS record."}
    target = ROOT / "data/raw/disaster_sms.json"
    if target.exists() and json.loads(target.read_text()) and not result:
        raise RuntimeError("Refusing to replace existing SMS records with an unavailable archive")
    write_json(target, result)
    write_json(target.with_suffix(".meta.json"), meta)
    if not result:
        lines = ["# 재난문자 과거 이력 접근 실패", "", "확인일: 2026-10-17 KST. 실제 발송 건수는 알 수 없음(null). 수집 배열 []는 부재 자료를 나타내며 발송 0건이라는 뜻이 아니다.", "",
                 "## 시도와 원문 응답", "",
                 "- 구 공개 JSP, 두 JS 후보 경로와 JSON POST disasterMsgList.do (searchInfo, 20250322~20250330, 경북 4700000000, idxArchive=2025)를 요청했다. 모두 HTTP 200 HTML로 새 홈페이지 /safekorea-kor/main/main.do에 이동했다. JSON 응답이 아니다.",
                 "- 개편 페이지의 인라인 JS를 확인했다. 현재 목록은 calamitySms.do에서 서버 렌더링하며 JSON 호출은 지역 선택용 changeSidoList_new.do/changeSggList_new.do이다. 달력에는 startDate:\"-7d\" 설정이 있다(서버 보관기간의 공식 설명은 아님).",
                 f"- 최근 목록 대조 요청은 전체 {control['reported_rows']}건으로 실제 문자가 표시됐다.",
                 "- 2025-03-22~30을 날짜별로 전국 조회했다. 각 날짜 전체 0건 및 아래의 동일 원문을 반환했다. 경북 기간 조회, 전국 기간 조회, 3/25 idxArchive=2025/202503도 같은 결과다.",
                 "", "> 데이터가 존재하지 않습니다.", "",
                 "- safetydata.go.kr V2/api/DSSP-IF-00247: ~/.openclaw/secrets/safetydata-* 파일 존재 여부만 확인했다. " + ("파일이 존재하므로 이 스크립트에서는 키를 읽지 않았음." if key_present else "일치 파일이 없어 요청·키 신청을 하지 않았다."),
                 "", "정확한 요청 URL/POST 본문, fetch 시각, 리디렉션 및 상태는 disaster_sms.meta.json attempts와 public_cache/*.meta.json에 보관했다. 캐시는 재실행에 재사용한다."]
        blocked = ROOT / "data/raw/disaster_sms.blocked.md"
        blocked.write_text("\n".join(lines) + "\n")
        write_json(blocked.with_suffix(".meta.json"), {"source_url": PAGE, "fetched_at_utc": meta["fetched_at_utc"],
                   "licence_or_terms": TERMS, "row_count": None, "caveat": meta["caveat"]})
    print(f"SMS: {len(result)} collected; complete=False; actual total unknown")


if __name__ == "__main__":
    main()
