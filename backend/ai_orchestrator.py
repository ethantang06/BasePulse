import json
import math
import re
from langchain_core.tools import tool
from langchain_core.messages import ToolMessage
from langchain_anthropic import ChatAnthropic
import os

# Use a global or passed state reference for the hackathon speed
ACTIVE_STATE_FILE = None

def append_to_state(feature: dict):
    if not ACTIVE_STATE_FILE:
        return
    with open(ACTIVE_STATE_FILE, "r") as f:
        state = json.load(f)
    
    state["features"].append(feature)
    
    with open(ACTIVE_STATE_FILE, "w") as f:
        json.dump(state, f)


def _state_feature_count(state_file) -> int:
    if not state_file:
        return 0
    try:
        with open(state_file, "r") as f:
            state = json.load(f)
        return len(state.get("features", []))
    except Exception:
        return 0


def _rect_polygon(lat: float, lon: float, width_m: float, height_m: float):
    d_lat = (height_m / 2.0) / 111000.0
    d_lon = (width_m / 2.0) / (111000.0 * max(0.2, abs(math.cos(math.radians(lat)))))
    ring = [
        [lon - d_lon, lat - d_lat],
        [lon + d_lon, lat - d_lat],
        [lon + d_lon, lat + d_lat],
        [lon - d_lon, lat + d_lat],
        [lon - d_lon, lat - d_lat],
    ]
    return [ring]


def _infer_anchor_from_prompt(prompt: str) -> tuple[float, float]:
    # Matches "33.3, 44.2" style coords. If none found, use default.
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)", prompt)
    if not match:
        return 33.3, 44.2
    a = float(match.group(1))
    b = float(match.group(2))
    # Heuristic: latitude must be within [-90,90]
    if -90 <= a <= 90 and -180 <= b <= 180:
        return a, b
    if -90 <= b <= 90 and -180 <= a <= 180:
        return b, a
    return 33.3, 44.2


def _fallback_layout(prompt: str) -> None:
    lat, lon = _infer_anchor_from_prompt(prompt)
    create_base_perimeter.invoke({"center_lat": lat, "center_lon": lon, "radius_meters": 520})
    define_zone.invoke(
        {
            "zone_name": "Command Zone",
            "security_level": "high",
            "coordinates_polygon": [[
                [lon - 0.0014, lat - 0.0008],
                [lon + 0.0012, lat - 0.0008],
                [lon + 0.0012, lat + 0.0010],
                [lon - 0.0014, lat + 0.0010],
                [lon - 0.0014, lat - 0.0008],
            ]],
        }
    )
    place_facility.invoke(
        {
            "facility_name": "Fallback HQ",
            "facility_type": "HQ",
            "lat": lat + 0.0004,
            "lon": lon + 0.0002,
            "width_m": 45,
            "height_m": 32,
            "priority": "high",
        }
    )
    place_power_asset.invoke(
        {
            "asset_name": "Fallback Generator",
            "asset_kind": "generator",
            "lat": lat - 0.0007,
            "lon": lon - 0.0006,
            "capacity_kw": 420,
        }
    )
    place_asset_cluster.invoke(
        {
            "asset_type": "supply_truck",
            "quantity": 20,
            "lat": lat - 0.0002,
            "lon": lon + 0.0010,
            "spacing": 7,
        }
    )
    define_route.invoke(
        {
            "route_name": "Fallback Main Route",
            "route_type": "road",
            "coordinates_line": [
                [lon - 0.0018, lat - 0.0012],
                [lon - 0.0005, lat - 0.0002],
                [lon + 0.0006, lat + 0.0005],
                [lon + 0.0018, lat + 0.0014],
            ],
            "lanes": 2,
        }
    )

@tool
def create_base_perimeter(center_lat: float, center_lon: float, radius_meters: float) -> str:
    """Generates the boundary for a military base. Useful for defining the outer limits of an area."""
    import math
    points = 64
    coordinates = []
    for i in range(points):
        angle = math.pi * 2 * i / points
        d_lat = (radius_meters / 111000.0) * math.cos(angle)
        d_lon = (radius_meters / (111000.0 * math.cos(math.radians(center_lat)))) * math.sin(angle)
        coordinates.append([center_lon + d_lon, center_lat + d_lat])
    coordinates.append(coordinates[0]) # close polygon
    
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [coordinates]
        },
        "properties": {
            "type": "perimeter",
            "name": "Base Perimeter"
        }
    }
    append_to_state(feature)
    return "Successfully created base perimeter."

@tool
def place_asset_cluster(asset_type: str, quantity: int, lat: float, lon: float, spacing: float) -> str:
    """Groups similar resources (e.g., parking 50 humvees together). Useful for troop/vehicle placements."""
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat]
        },
        "properties": {
            "type": "cluster",
            "asset_type": asset_type,
            "quantity": quantity,
            "spacing": spacing,
            "name": f"{quantity}x {asset_type} Cluster"
        }
    }
    append_to_state(feature)
    return f"Successfully placed {quantity} {asset_type}s."

@tool
def define_zone(zone_name: str, security_level: str, coordinates_polygon: list) -> str:
    """Designates specific operational areas. coordinates_polygon must be a valid GeoJSON polygon coordinate array: e.g. [[[lon, lat], [lon, lat], ...]]"""
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": coordinates_polygon
        },
        "properties": {
            "type": "zone",
            "zone_name": zone_name,
            "security_level": security_level
        }
    }
    append_to_state(feature)
    return f"Successfully defined zone: {zone_name}."


@tool
def place_facility(
    facility_name: str,
    facility_type: str,
    lat: float,
    lon: float,
    width_m: float,
    height_m: float,
    priority: str = "medium",
) -> str:
    """Places a rectangular facility footprint such as HQ, hospital, barracks, hangar, warehouse, or substation building."""
    feature = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": _rect_polygon(lat, lon, width_m, height_m)},
        "properties": {
            "type": "facility",
            "name": facility_name,
            "facility_type": facility_type,
            "priority": priority,
            "width_m": width_m,
            "height_m": height_m,
        },
    }
    append_to_state(feature)
    return f"Successfully placed facility {facility_name}."


@tool
def place_power_asset(asset_name: str, asset_kind: str, lat: float, lon: float, capacity_kw: float) -> str:
    """Places a power asset point (generator, battery, solar_array, substation, transformer)."""
    feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "type": "power_asset",
            "name": asset_name,
            "asset_kind": asset_kind,
            "capacity_kw": capacity_kw,
        },
    }
    append_to_state(feature)
    return f"Successfully placed power asset {asset_name}."


@tool
def define_route(route_name: str, route_type: str, coordinates_line: list, lanes: int = 1) -> str:
    """Creates a line route such as road, patrol_route, convoy_path, utility_corridor using coordinates [[lon,lat], ...]."""
    feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coordinates_line},
        "properties": {
            "type": "route",
            "name": route_name,
            "route_type": route_type,
            "lanes": lanes,
        },
    }
    append_to_state(feature)
    return f"Successfully defined route {route_name}."


@tool
def connect_power_link(
    link_name: str,
    from_lon: float,
    from_lat: float,
    to_lon: float,
    to_lat: float,
    voltage_kv: float = 13.8,
    link_role: str = "distribution",
) -> str:
    """Creates a power line connection between two points or assets."""
    feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[from_lon, from_lat], [to_lon, to_lat]]},
        "properties": {
            "type": "power_link",
            "name": link_name,
            "voltage_kv": voltage_kv,
            "link_role": link_role,
        },
    }
    append_to_state(feature)
    return f"Successfully connected power link {link_name}."

async def process_military_data(prompt: str, data_dir, state_file) -> dict:
    global ACTIVE_STATE_FILE
    ACTIVE_STATE_FILE = state_file
    
    # 1. Read context from data_dir
    context_data = ""
    for path in data_dir.glob("raw_*"):
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            context_data += f"\n--- Data from {path.name} ---\n{f.read(2000)}" # Limit for context
            
    # 2. Set up the LLM and Tools
    llm = ChatAnthropic(model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5"), temperature=0)
    tools = [
        create_base_perimeter,
        define_zone,
        place_facility,
        place_asset_cluster,
        place_power_asset,
        define_route,
        connect_power_link,
    ]
    llm_with_tools = llm.bind_tools(tools)
    
    tool_map = {t.name: t for t in tools}
    
    messages = [
        ("system", "You are a military logistics and base-planning AI. "
                   "Your task is to orchestrate a spatial layout based on the raw data/brief provided. "
                   "You MUST use tools to define the layout. "
                   "Any data you generate via tools will be appended to the visualization state. "
                   "Use a richer schema where practical: perimeter, zones, facilities, asset clusters, power assets, routes, and power links. "
                   "Target at least: 1 perimeter, 3 zones, 4 facilities, 2 power assets, 2 routes, and 2 power links. "
                   "Be pragmatic and realistic in your placements. If coordinates are not provided, choose a target coordinate (e.g., 33.3, 44.2) and build around it.\n\n"
                   f"Context Data:\n{context_data}"),
        ("user", prompt)
    ]
    
    before_count = _state_feature_count(state_file)

    # Multi-step tool loop so the model can build complete plans.
    try:
        for _ in range(6):
            res = llm_with_tools.invoke(messages)
            messages.append(res)
            if not res.tool_calls:
                break
            for tool_call in res.tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]
                tool_call_id = tool_call["id"]
                if tool_name in tool_map:
                    try:
                        result_text = tool_map[tool_name].invoke(tool_args)
                        messages.append(ToolMessage(content=str(result_text), tool_call_id=tool_call_id))
                    except Exception as e:
                        messages.append(
                            ToolMessage(content=f"Tool {tool_name} failed: {e}", tool_call_id=tool_call_id)
                        )
    except Exception as e:
        # If Anthropic rejects the key or returns a 404/401, surface it cleanly.
        raise Exception(f"AI Generation Failed. Please check your Anthropic API Key. Details: {str(e)}")

    after_count = _state_feature_count(state_file)
    if after_count == before_count:
        # Safety fallback so "Generate" always produces visible map output.
        _fallback_layout(prompt)

    return {"message": "Success", "result": "Layout generated."}
