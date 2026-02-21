import json
import math
from typing import Dict, List, Tuple


def _polygon_rings(state: Dict) -> List[List[List[float]]]:
    rings = []
    for f in state.get("features", []):
        if f.get("geometry", {}).get("type") == "Polygon" and f.get("properties", {}).get("type") == "perimeter":
            coords = f.get("geometry", {}).get("coordinates", [])
            if coords and coords[0]:
                rings.append(coords[0])
    return rings


def _point_in_ring(point: Tuple[float, float], ring: List[List[float]]) -> bool:
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) + 1e-9) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _geometry_inside_perimeter(geom: Dict, perimeters: List[List[List[float]]]) -> bool:
    if not perimeters:
        return False
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])
    points = []
    if gtype == "Point":
        points = [coords]
    elif gtype == "LineString":
        points = coords
    elif gtype == "Polygon":
        points = coords[0] if coords else []
    else:
        return True

    for p in points:
        if not any(_point_in_ring((p[0], p[1]), ring) for ring in perimeters):
            return False
    return True


def _count_types(state: Dict) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for f in state.get("features", []):
        t = f.get("properties", {}).get("type", "unknown")
        counts[t] = counts.get(t, 0) + 1
    return counts


def _facility_load_kw(facility_type: str) -> Tuple[float, bool]:
    ft = (facility_type or "").lower()
    if "hospital" in ft or "medical" in ft:
        return 450.0, True
    if "hq" in ft or "command" in ft:
        return 320.0, True
    if "comms" in ft:
        return 260.0, True
    if "hangar" in ft:
        return 220.0, False
    if "barrack" in ft or "housing" in ft:
        return 180.0, False
    if "warehouse" in ft or "logistics" in ft:
        return 140.0, False
    if "substation" in ft:
        return 80.0, False
    return 150.0, False


def _power_supply_from_assets(features: List[Dict]) -> Tuple[float, float, float]:
    generator_kw = 0.0
    solar_kw = 0.0
    battery_kwh = 0.0
    for f in features:
        if f.get("properties", {}).get("type") != "power_asset":
            continue
        props = f.get("properties", {})
        kind = str(props.get("asset_kind", "")).lower()
        cap = float(props.get("capacity_kw", 0.0))
        if "generator" in kind:
            generator_kw += cap
        elif "solar" in kind:
            solar_kw += cap
        elif "battery" in kind:
            battery_kwh += cap * 2.5
    return generator_kw, solar_kw, battery_kwh


def _is_critical_facility(feature: Dict) -> bool:
    props = feature.get("properties", {})
    ft = str(props.get("facility_type", "")).lower()
    return any(k in ft for k in ["hospital", "medical", "hq", "command", "comms"])


def _centroid(feature: Dict) -> Tuple[float, float]:
    geom = feature.get("geometry", {})
    if geom.get("type") == "Point":
        lon, lat = geom.get("coordinates", [0, 0])
        return lon, lat
    if geom.get("type") == "Polygon":
        ring = geom.get("coordinates", [[]])[0]
        if not ring:
            return 0.0, 0.0
        lon = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        return lon, lat
    return 0.0, 0.0


def _distance_m(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * 111000 * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (a[1] - b[1]) * 111000
    return math.sqrt(dx * dx + dy * dy)


def _redundancy_score(features: List[Dict]) -> Tuple[float, int, int]:
    crits = [f for f in features if f.get("properties", {}).get("type") == "facility" and _is_critical_facility(f)]
    links = [f for f in features if f.get("properties", {}).get("type") == "power_link"]
    if not crits:
        return 0.0, 0, 0

    redundant = 0
    for c in crits:
        cc = _centroid(c)
        attached = 0
        for link in links:
            line = link.get("geometry", {}).get("coordinates", [])
            if len(line) < 2:
                continue
            if _distance_m(cc, tuple(line[0])) < 250 or _distance_m(cc, tuple(line[-1])) < 250:
                attached += 1
        if attached >= 2:
            redundant += 1
    return (redundant / len(crits)) * 100.0, redundant, len(crits)


def _simulate_readiness(features: List[Dict]) -> Dict:
    facilities = [f for f in features if f.get("properties", {}).get("type") == "facility"]
    generator_kw, solar_kw, battery_kwh = _power_supply_from_assets(features)

    critical_load = 0.0
    noncritical_load = 0.0
    for f in facilities:
        load, critical = _facility_load_kw(str(f.get("properties", {}).get("facility_type", "")))
        if critical:
            critical_load += load
        else:
            noncritical_load += load
    total_load = critical_load + noncritical_load

    fuel_hours_nominal = 36.0
    fuel_kwh = generator_kw * fuel_hours_nominal
    battery_store = battery_kwh

    critical_covered_hours = 0
    critical_fail_streak = 0
    failure_penalty = 0.0
    exposure_hours = 0

    hourly = []
    for hour in range(72):
        day_hour = hour % 24
        solar_factor = max(0.0, 1 - abs(day_hour - 12) / 12)
        solar_out = solar_kw * solar_factor

        gen_out = generator_kw if fuel_kwh > 0 else 0.0
        fuel_kwh = max(0.0, fuel_kwh - gen_out)

        primary_supply = gen_out + solar_out
        deficit = max(0.0, total_load - primary_supply)
        battery_dispatch = min(battery_store, deficit)
        battery_store -= battery_dispatch
        served = primary_supply + battery_dispatch

        critical_served = min(critical_load, served)
        critical_ratio = 1.0 if critical_load <= 0 else critical_served / critical_load
        if critical_ratio >= 0.999:
            critical_covered_hours += 1
            critical_fail_streak = 0
        else:
            critical_fail_streak += 1
            exposure_hours += 1
            if critical_fail_streak >= 2:
                failure_penalty += 1.2

        hourly.append(
            {
                "hour": hour,
                "critical_ratio": round(critical_ratio, 3),
                "battery_kwh": round(battery_store, 1),
            }
        )

    critical_coverage_pct = (critical_covered_hours / 72.0) * 100.0
    grid_exposure_pct = (exposure_hours / 72.0) * 100.0
    autonomy_hours = (battery_kwh + generator_kw * fuel_hours_nominal) / max(total_load, 1.0)

    return {
        "critical_load_kw": round(critical_load, 1),
        "total_load_kw": round(total_load, 1),
        "fuel_autonomy_hours": round(autonomy_hours, 1),
        "critical_coverage_pct": round(critical_coverage_pct, 1),
        "grid_dependency_exposure_pct": round(grid_exposure_pct, 1),
        "failure_penalty": round(failure_penalty, 2),
        "hourly": hourly,
    }


def analyze_state(state: Dict) -> Dict:
    perimeters = _polygon_rings(state)
    counts = _count_types(state)
    features = state.get("features", [])

    validations = []
    validations.append({"id": "perimeter_present", "label": "Base perimeter present", "ok": len(perimeters) >= 1})
    validations.append({"id": "zones_min", "label": "At least 3 zones", "ok": counts.get("zone", 0) >= 3})
    validations.append({"id": "facilities_min", "label": "At least 4 facilities", "ok": counts.get("facility", 0) >= 4})
    validations.append({"id": "power_assets_min", "label": "At least 2 power assets", "ok": counts.get("power_asset", 0) >= 2})
    validations.append({"id": "routes_min", "label": "At least 2 routes", "ok": counts.get("route", 0) >= 2})
    validations.append({"id": "power_links_min", "label": "At least 2 power links", "ok": counts.get("power_link", 0) >= 2})

    spatial_ok = True
    for f in features:
        if f.get("properties", {}).get("type") == "perimeter":
            continue
        if not _geometry_inside_perimeter(f.get("geometry", {}), perimeters):
            spatial_ok = False
            break
    validations.append({"id": "spatial_bounds", "label": "All assets inside perimeter", "ok": spatial_ok})

    sim = _simulate_readiness(features)
    redundancy_pct, redundant_count, critical_count = _redundancy_score(features)
    validations.append(
        {
            "id": "critical_redundancy",
            "label": "Critical facilities have redundant power links",
            "ok": critical_count == 0 or redundancy_pct >= 50.0,
        }
    )

    is_valid = all(v["ok"] for v in validations)
    coverage = sim["critical_coverage_pct"]
    autonomy = min(100.0, (sim["fuel_autonomy_hours"] / 72.0) * 100.0)
    redundancy = redundancy_pct
    exposure_inverse = max(0.0, 100.0 - sim["grid_dependency_exposure_pct"])
    readiness_score = (
        0.40 * coverage
        + 0.25 * autonomy
        + 0.20 * redundancy
        + 0.15 * exposure_inverse
        - sim["failure_penalty"]
    )
    readiness_score = max(0.0, min(100.0, readiness_score))

    return {
        "counts": counts,
        "validation": {"is_valid": is_valid, "checks": validations},
        "simulation": {
            "critical_coverage_pct": sim["critical_coverage_pct"],
            "fuel_autonomy_hours": sim["fuel_autonomy_hours"],
            "grid_dependency_exposure_pct": sim["grid_dependency_exposure_pct"],
            "critical_load_kw": sim["critical_load_kw"],
            "total_load_kw": sim["total_load_kw"],
            "redundancy_pct": round(redundancy_pct, 1),
            "redundant_critical_facilities": redundant_count,
            "critical_facilities_count": critical_count,
            "hourly": sim["hourly"],
        },
        "readiness": {
            "score": round(readiness_score, 1),
            "label": (
                "Mission Ready"
                if readiness_score >= 85
                else "Operationally Viable"
                if readiness_score >= 65
                else "At Risk"
            ),
        },
    }

