import json
from langchain_core.tools import tool
from langchain_anthropic import ChatAnthropic
from pathlib import Path

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

async def process_military_data(prompt: str, data_dir, state_file) -> dict:
    global ACTIVE_STATE_FILE
    ACTIVE_STATE_FILE = state_file
    
    # 1. Read context from data_dir
    context_data = ""
    for path in data_dir.glob("raw_*"):
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            context_data += f"\n--- Data from {path.name} ---\n{f.read(2000)}" # Limit for context
            
    # 2. Set up the LLM and Tools
    llm = ChatAnthropic(model="claude-3-5-sonnet-20240620", temperature=0)
    tools = [create_base_perimeter, place_asset_cluster, define_zone]
    llm_with_tools = llm.bind_tools(tools)
    
    tool_map = {t.name: t for t in tools}
    
    messages = [
        ("system", "You are a military logistics and base-planning AI. "
                   "Your task is to orchestrate a spatial layout based on the raw data/brief provided. "
                   "Use the provided tools to construct perimeters, zones, and asset clusters. "
                   "You MUST use tools to define the layout. "
                   "Any data you generate via tools will be appended to the visualization state. "
                   "Be pragmatic and realistic in your placements. If coordinates are not provided, choose a target coordinate (e.g., 33.3, 44.2) and build around it.\n\n"
                   f"Context Data:\n{context_data}"),
        ("user", prompt)
    ]
    
    # Simple agent loop for 1 step (hackathon proxy)
    try:
        res = llm_with_tools.invoke(messages)
    except Exception as e:
        # If Anthropic rejects the key or returns a 404/401, surface it cleanly.
        raise Exception(f"AI Generation Failed. Please check your Anthropic API Key. Details: {str(e)}")
        
    if res.tool_calls:
        for tool_call in res.tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            if tool_name in tool_map:
                try:
                    tool_map[tool_name].invoke(tool_args)
                except Exception as e:
                    print(f"Tool {tool_name} failed: {e}")
                    
    return {"message": "Success", "result": "Layout generated."}
