import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://xrpl-lending-monitor.badjoke-lab.workers.dev"
XRPL = "https://devnet.honeycluster.io/"

checks = []
http_observations = {}
source_samples = []


def iso_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def parse_iso(value):
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def add_check(name, ok, observed=None, expected=None, details=None, scope="required"):
    checks.append({
        "name": name,
        "ok": bool(ok),
        "scope": scope,
        "observed": observed,
        "expected": expected,
        "details": details,
    })


def http_json(url, method="GET", body=None, timeout=40):
    data = None
    headers = {"accept": "application/json", "user-agent": "xrpl-lending-point-audit/1"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            latency_ms = round((time.monotonic() - started) * 1000, 1)
            parsed = json.loads(raw.decode())
            return {
                "ok": True,
                "status": response.status,
                "latency_ms": latency_ms,
                "headers": {
                    "cf-ray": response.headers.get("cf-ray"),
                    "content-type": response.headers.get("content-type"),
                    "server": response.headers.get("server"),
                },
                "json": parsed,
            }
    except urllib.error.HTTPError as error:
        raw = error.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"raw": raw[:1000]}
        return {
            "ok": False,
            "status": error.code,
            "latency_ms": round((time.monotonic() - started) * 1000, 1),
            "headers": {},
            "json": parsed,
        }
    except Exception as error:
        return {
            "ok": False,
            "status": None,
            "latency_ms": round((time.monotonic() - started) * 1000, 1),
            "headers": {},
            "error": f"{type(error).__name__}: {error}",
            "json": None,
        }


def api(path, key=None):
    result = http_json(BASE + path)
    http_observations[key or path] = {
        "status": result.get("status"),
        "latency_ms": result.get("latency_ms"),
        "headers": result.get("headers"),
        "error": result.get("error"),
    }
    return result


def rpc(method, params):
    result = http_json(XRPL, method="POST", body={"method": method, "params": [{**params, "api_version": 2}]})
    payload = result.get("json") or {}
    rpc_result = payload.get("result") if isinstance(payload, dict) else None
    success = result.get("status") == 200 and isinstance(rpc_result, dict) and rpc_result.get("status") == "success"
    return result, rpc_result, success


def rows_for(d1, index):
    try:
        return d1[index]["results"]
    except Exception:
        return []


def canonical(value):
    if isinstance(value, dict):
        return {key: canonical(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def object_diff(worker_raw, source_node, object_id):
    source = dict(source_node or {})
    source.setdefault("index", object_id)
    left = canonical(worker_raw or {})
    right = canonical(source)
    if left == right:
        return []
    keys = sorted(set(left) | set(right))
    mismatches = []
    for key in keys:
        if left.get(key) != right.get(key):
            mismatches.append({
                "field": key,
                "worker": left.get(key),
                "source": right.get(key),
            })
            if len(mismatches) >= 8:
                break
    return mismatches


def fetch_collection(kind, path):
    asc = api(path + "?limit=2&sort=id_asc", key=f"{kind}_asc")
    desc = api(path + "?limit=2&sort=id_desc", key=f"{kind}_desc")
    asc_json = asc.get("json") or {}
    desc_json = desc.get("json") or {}
    ok = (
        asc.get("status") == 200
        and desc.get("status") == 200
        and asc_json.get("availability", {}).get("state") == "available"
        and desc_json.get("availability", {}).get("state") == "available"
        and len(asc_json.get("data") or []) > 0
        and len(desc_json.get("data") or []) > 0
    )
    add_check(
        f"api_{kind}_collections_available",
        ok,
        observed={"asc": len(asc_json.get("data") or []), "desc": len(desc_json.get("data") or [])},
        expected="HTTP 200, available, non-empty in both directions",
    )
    cursor = asc_json.get("page", {}).get("next_cursor")
    page2 = None
    if cursor:
        page2 = api(path + "?limit=2&sort=id_asc&cursor=" + urllib.parse.quote(cursor, safe=""), key=f"{kind}_page2")
        page2_json = page2.get("json") or {}
        add_check(
            f"api_{kind}_pagination",
            page2.get("status") == 200 and page2_json.get("availability", {}).get("state") == "available",
            observed={"status": page2.get("status"), "count": len(page2_json.get("data") or [])},
            expected="valid second page",
        )
    else:
        add_check(f"api_{kind}_pagination", False, observed="no next_cursor", expected="next_cursor present")
    by_id = {}
    for response in (asc_json, desc_json):
        for item in response.get("data") or []:
            if item.get("id"):
                by_id[item["id"]] = item
    return list(by_id.values())


def main():
    generated_at = iso_now()
    with open("d1.json", "r", encoding="utf-8") as handle:
        d1 = json.load(handle)
    with open("schedules.json", "r", encoding="utf-8") as handle:
        schedules = json.load(handle)

    state_rows = rows_for(d1, 0)
    metric_rows = rows_for(d1, 1)
    binding_rows = rows_for(d1, 2)
    quick_rows = rows_for(d1, 3)
    state = state_rows[0] if state_rows else {}
    binding = binding_rows[0] if binding_rows else {}

    quick_value = None
    if quick_rows:
        quick_value = next(iter(quick_rows[0].values()), None)
    add_check("d1_quick_check", str(quick_value).lower() == "ok", observed=quick_value, expected="ok")
    add_check("d1_fast_lane_state_present", bool(state), observed=state or None, expected="one devnet state row")
    add_check("d1_fast_lane_status", state.get("status") == "healthy", observed=state.get("status"), expected="healthy")
    add_check(
        "d1_cycle_closed_at_zero_lag",
        state.get("last_processed_ledger") == state.get("latest_observed_ledger"),
        observed={"processed": state.get("last_processed_ledger"), "observed": state.get("latest_observed_ledger")},
        expected="equal",
    )
    latest_metric = metric_rows[0] if metric_rows else {}
    add_check(
        "d1_latest_metric_committed",
        latest_metric.get("status") == "committed" and latest_metric.get("lag_ledgers") == 0,
        observed=latest_metric or None,
        expected="committed with lag_ledgers=0",
    )
    recent = metric_rows[:3]
    contiguous = len(recent) >= 3 and all(row.get("status") == "committed" for row in recent)
    chronological = list(reversed(recent))
    if contiguous:
        for previous, current in zip(chronological, chronological[1:]):
            if current.get("start_ledger_index") != previous.get("end_ledger_index", -2) + 1:
                contiguous = False
                break
    add_check(
        "d1_recent_ranges_contiguous",
        contiguous,
        observed=[{
            "run_at": row.get("run_at"),
            "status": row.get("status"),
            "start": row.get("start_ledger_index"),
            "end": row.get("end_ledger_index"),
            "lag": row.get("lag_ledgers"),
        } for row in recent],
        expected="latest three committed ranges are contiguous",
    )

    schedule_list = schedules.get("result") or []
    cron_ok = schedules.get("success") is True and len(schedule_list) == 1 and schedule_list[0].get("cron") == "*/5 * * * *"
    add_check("cloudflare_cron_exactly_one", cron_ok, observed=schedule_list, expected="one */5 * * * * schedule")

    health_r = api("/api/health", "health")
    health = health_r.get("json") or {}
    add_check(
        "worker_health",
        health_r.get("status") == 200 and health.get("ok") is True and health.get("network") == "devnet" and health.get("mainnet_enabled") is False,
        observed=health,
        expected="ok=true, devnet, mainnet disabled",
    )

    overview_r = api("/api/overview", "overview")
    overview = overview_r.get("json") or {}
    current = overview.get("current_state_watermark") or {}
    base = overview.get("base") or {}
    counts = overview.get("counts") or {}
    add_check("overview_http", overview_r.get("status") == 200, observed=overview_r.get("status"), expected=200)
    add_check("overview_no_unavailable", overview.get("unavailable") == [], observed=overview.get("unavailable"), expected=[])
    add_check("overview_epoch_current", overview.get("epoch", {}).get("status") == "current", observed=overview.get("epoch"), expected="current")
    add_check("overview_fast_lane_selected", current.get("source") == "fast_lane", observed=current, expected="source=fast_lane")
    add_check(
        "overview_counts_arithmetic",
        all(isinstance(counts.get(key), int) and counts.get(key) > 0 for key in ("vaults", "loan_brokers", "loans"))
        and counts.get("current_objects") == counts.get("vaults", 0) + counts.get("loan_brokers", 0) + counts.get("loans", 0),
        observed=counts,
        expected="positive counts and exact sum",
    )
    add_check(
        "overview_matches_d1_state",
        current.get("ledger_index") == state.get("last_processed_ledger")
        and str(current.get("ledger_hash", "")).upper() == str(state.get("last_processed_hash", "")).upper()
        and current.get("updated_at") == state.get("updated_at"),
        observed={"overview": current, "d1": state},
        expected="ledger, hash, and updated_at identical",
    )
    add_check(
        "base_binding_matches_overview",
        binding.get("shadow_epoch_id") == state.get("epoch_id")
        and binding.get("base_snapshot_id") == base.get("id")
        and binding.get("base_ledger_index") == base.get("ledger_index")
        and str(binding.get("base_ledger_hash", "")).upper() == str(base.get("ledger_hash", "")).upper(),
        observed={"binding": binding, "base": base, "state_epoch": state.get("epoch_id")},
        expected="D1 binding equals active base",
    )

    updated_at = parse_iso(current.get("updated_at"))
    age_seconds = (dt.datetime.now(dt.timezone.utc) - updated_at).total_seconds() if updated_at else None
    add_check("current_state_age", age_seconds is not None and 0 <= age_seconds <= 370, observed=age_seconds, expected="0..370 seconds")

    head_http, head, head_ok = rpc("ledger", {"ledger_index": "validated", "transactions": False, "expand": False})
    live_ledger = head.get("ledger_index") if head else None
    live_hash = head.get("ledger_hash") if head else None
    live_gap = live_ledger - current.get("ledger_index") if isinstance(live_ledger, int) and isinstance(current.get("ledger_index"), int) else None
    add_check("xrpl_live_head", head_ok and isinstance(live_ledger, int), observed={"ledger": live_ledger, "hash": live_hash}, expected="validated ledger")
    add_check("live_gap_within_one_cycle", live_gap is not None and 0 <= live_gap <= 130, observed=live_gap, expected="0..130 ledgers")

    exact_http, exact, exact_ok = rpc("ledger", {"ledger_index": current.get("ledger_index"), "transactions": False, "expand": False})
    add_check(
        "current_watermark_hash_matches_xrpl",
        exact_ok and str(exact.get("ledger_hash", "")).upper() == str(current.get("ledger_hash", "")).upper(),
        observed={"worker": current, "xrpl": {"ledger_index": exact.get("ledger_index") if exact else None, "ledger_hash": exact.get("ledger_hash") if exact else None}},
        expected="same ledger index and hash",
    )
    base_http, base_source, base_ok = rpc("ledger", {"ledger_index": base.get("ledger_index"), "transactions": False, "expand": False})
    add_check(
        "base_snapshot_hash_matches_xrpl",
        base_ok and str(base_source.get("ledger_hash", "")).upper() == str(base.get("ledger_hash", "")).upper(),
        observed={"worker": base, "xrpl": {"ledger_index": base_source.get("ledger_index") if base_source else None, "ledger_hash": base_source.get("ledger_hash") if base_source else None}},
        expected="same base ledger index and hash",
    )

    status_r = api("/api/status", "status")
    add_check("status_endpoint", status_r.get("status") == 200, observed=status_r.get("json"), expected="HTTP 200")
    collector_r = api("/api/status/collector", "collector")
    collector = collector_r.get("json") or {}
    add_check(
        "collector_endpoint_healthy",
        collector_r.get("status") == 200 and collector.get("status") in ("healthy", "ok"),
        observed=collector,
        expected="HTTP 200 and healthy/ok",
    )
    history_r = api("/api/status/history-source", "history_source")
    history = history_r.get("json") or {}
    add_check(
        "history_source_resolves",
        history_r.get("status") == 200 and history.get("status") == "ok" and history.get("chain") is not None,
        observed=history,
        expected="verified history source",
    )
    if history.get("chain"):
        add_check(
            "history_chain_reaches_base",
            history["chain"].get("end_ledger_index") == base.get("ledger_index"),
            observed={"history_end": history["chain"].get("end_ledger_index"), "base": base.get("ledger_index")},
            expected="history end equals active base",
        )

    diagnostic_r = api("/api/internal/current-state-diagnostic", "current_state_diagnostic")
    diagnostic = diagnostic_r.get("json") or {}
    probes = diagnostic.get("probes") or {}
    diagnostic_ok = (
        diagnostic_r.get("status") == 200
        and diagnostic.get("ok") is True
        and diagnostic.get("snapshot_id") == base.get("id")
        and all(probes.get(kind, {}).get("detail_found") is True for kind in ("vaults", "loan_brokers", "loans"))
        and probes.get("invalid_cursor") == "invalid_cursor"
    )
    add_check("read_model_diagnostic", diagnostic_ok, observed=diagnostic, expected="all navigation probes pass")
    add_check("diagnostic_counts_match_overview", diagnostic.get("counts") == {"vaults": counts.get("vaults"), "loan_brokers": counts.get("loan_brokers"), "loans": counts.get("loans")}, observed={"diagnostic": diagnostic.get("counts"), "overview": counts}, expected="same counts")

    collections = {
        "vault": fetch_collection("vaults", "/api/vaults"),
        "loan_broker": fetch_collection("loan_brokers", "/api/loan-brokers"),
        "loan": fetch_collection("loans", "/api/loans"),
    }
    detail_paths = {"vault": "/api/vaults/", "loan_broker": "/api/loan-brokers/", "loan": "/api/loans/"}
    detail_cache = {}
    sample_passes = 0
    sample_total = 0
    for kind, items in collections.items():
        for item in items[:4]:
            object_id = item.get("id")
            if not object_id:
                continue
            sample_total += 1
            detail_r = api(detail_paths[kind] + object_id, key=f"detail_{kind}_{object_id[:8]}")
            detail = detail_r.get("json") or {}
            detail_cache[(kind, object_id)] = detail
            raw = detail.get("data", {}).get("raw")
            rpc_http, ledger_entry, entry_ok = rpc("ledger_entry", {"ledger_index": current.get("ledger_index"), "index": object_id, "binary": False})
            source_node = ledger_entry.get("node") if ledger_entry else None
            mismatches = object_diff(raw, source_node, object_id) if entry_ok and raw else [{"field": "transport", "worker": bool(raw), "source": entry_ok}]
            passed = detail_r.get("status") == 200 and entry_ok and not mismatches
            if passed:
                sample_passes += 1
            source_samples.append({
                "kind": kind,
                "id": object_id,
                "detail_status": detail_r.get("status"),
                "ledger_entry_status": rpc_http.get("status"),
                "match": passed,
                "mismatches": mismatches,
                "previous_ledger_index": detail.get("data", {}).get("previous_ledger_index"),
            })
    add_check(
        "source_object_samples_exact",
        sample_total >= 9 and sample_passes == sample_total,
        observed={"passed": sample_passes, "total": sample_total, "samples": source_samples},
        expected="all sampled current objects exactly match XRPL ledger_entry at current watermark",
    )

    relation_results = []
    relation_ok = True
    for item in collections["loan_broker"][:3]:
        broker_id = item.get("id")
        detail = detail_cache.get(("loan_broker", broker_id)) or {}
        data = detail.get("data") or {}
        vault_id = (data.get("related_vault") or {}).get("id")
        raw_vault_id = (data.get("raw") or {}).get("VaultID")
        vault_r = api("/api/vaults/" + vault_id, key=f"relation_vault_{vault_id[:8]}") if vault_id else {"status": None, "json": {}}
        ok = bool(vault_id) and vault_id == raw_vault_id and vault_r.get("status") == 200 and vault_r.get("json", {}).get("data", {}).get("id") == vault_id
        relation_ok = relation_ok and ok
        relation_results.append({"kind": "broker_to_vault", "broker": broker_id, "vault": vault_id, "ok": ok})
    for item in collections["loan"][:3]:
        loan_id = item.get("id")
        detail = detail_cache.get(("loan", loan_id)) or {}
        data = detail.get("data") or {}
        broker_id = (data.get("related_loan_broker") or {}).get("id")
        raw_broker_id = (data.get("raw") or {}).get("LoanBrokerID")
        broker_r = api("/api/loan-brokers/" + broker_id, key=f"relation_broker_{broker_id[:8]}") if broker_id else {"status": None, "json": {}}
        related_vault = (data.get("related_vault") or {}).get("id")
        broker_vault = (broker_r.get("json", {}).get("data", {}).get("related_vault") or {}).get("id")
        ok = bool(broker_id) and broker_id == raw_broker_id and broker_r.get("status") == 200 and broker_vault == related_vault
        relation_ok = relation_ok and ok
        relation_results.append({"kind": "loan_to_broker_to_vault", "loan": loan_id, "broker": broker_id, "vault": related_vault, "ok": ok})
    add_check("relationship_resolution", relation_ok and len(relation_results) >= 6, observed=relation_results, expected="all sampled relationships resolve exactly")

    activity_r = api("/api/activity?limit=5", "activity")
    add_check("activity_api", activity_r.get("status") == 200 and isinstance(activity_r.get("json"), dict), observed={"status": activity_r.get("status"), "keys": sorted((activity_r.get("json") or {}).keys())}, expected="HTTP 200 JSON")
    lifecycle_r = api("/api/audit/lifecycle?limit=5", "lifecycle")
    add_check("lifecycle_audit_api", lifecycle_r.get("status") == 200, observed={"status": lifecycle_r.get("status"), "keys": sorted((lifecycle_r.get("json") or {}).keys())}, expected="HTTP 200")
    archived_r = api("/api/audit/archived?limit=5", "archived")
    add_check("archive_audit_api", archived_r.get("status") == 200, observed={"status": archived_r.get("status"), "keys": sorted((archived_r.get("json") or {}).keys())}, expected="HTTP 200")

    required = [check for check in checks if check["scope"] == "required"]
    failed = [check for check in required if not check["ok"]]
    result = {
        "generated_at": generated_at,
        "completed_at": iso_now(),
        "audit_type": "point_in_time_read_only",
        "production_mutated": False,
        "verdict": "pass" if not failed else "fail",
        "summary": {
            "required_checks": len(required),
            "passed": len(required) - len(failed),
            "failed": len(failed),
            "failed_names": [check["name"] for check in failed],
            "current_state_ledger": current.get("ledger_index"),
            "current_state_hash": current.get("ledger_hash"),
            "current_state_age_seconds": age_seconds,
            "live_ledger": live_ledger,
            "live_gap_ledgers": live_gap,
            "source_samples_passed": sample_passes,
            "source_samples_total": sample_total,
            "cron_count": len(schedule_list),
            "d1_size_after_bytes": (d1[0].get("meta") or {}).get("size_after") if d1 else None,
        },
        "checks": checks,
        "http_observations": http_observations,
        "source_samples": source_samples,
        "limits": [
            "This is a point-in-time audit, not proof of uninterrupted operation before or after the captured interval.",
            "Full re-enumeration of every XRPL ledger object was not performed; exact source comparison uses ledger/hash anchors plus distributed samples from all three current object types.",
        ],
    }
    with open("point-audit-result.json", "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, ensure_ascii=False)
    print(json.dumps(result["summary"], indent=2))
    if failed:
        print("FAILED:", ", ".join(check["name"] for check in failed), file=sys.stderr)


if __name__ == "__main__":
    main()
