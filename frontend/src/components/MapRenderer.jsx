import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import { GeoJsonLayer, ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

const INITIAL_VIEW_STATE = {
  longitude: 44.2, // Defaulting vaguely near Middle East/Eastern Europe or any arbitrary
  latitude: 33.3,
  zoom: 11,
  maxZoom: 20,
  pitch: 45,
  bearing: 0
};

export default function MapRenderer({ data }) {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  // Auto-center map to the first feature when data loads/changes
  useEffect(() => {
    if (data && data.features && data.features.length > 0) {
      const firstFeature = data.features[0];
      let lon, lat;
      
      if (firstFeature.geometry.type === 'Point') {
        [lon, lat] = firstFeature.geometry.coordinates;
      } else if (firstFeature.geometry.type === 'Polygon') {
        [lon, lat] = firstFeature.geometry.coordinates[0][0];
      }
      
      if (lon && lat) {
        setViewState(v => ({...v, longitude: lon, latitude: lat, transitionDuration: 1000}));
      }
    }
  }, [data]);

  const perimeterAndZones = data?.features?.filter(
    f => f?.properties?.type === 'perimeter' || f?.properties?.type === 'zone'
  ) || [];
  const facilities = data?.features?.filter(f => f?.properties?.type === 'facility') || [];
  const clusters = data?.features?.filter(f => f?.properties?.type === 'cluster') || [];
  const powerAssets = data?.features?.filter(f => f?.properties?.type === 'power_asset') || [];
  const routes = data?.features?.filter(f => f?.properties?.type === 'route') || [];
  const powerLinks = data?.features?.filter(f => f?.properties?.type === 'power_link') || [];

  const routePathData = routes
    .filter(f => f.geometry?.type === 'LineString')
    .map(f => ({
      name: f.properties?.name || 'Route',
      routeType: f.properties?.route_type || 'road',
      lanes: f.properties?.lanes || 1,
      path: f.geometry.coordinates,
    }));

  const powerLinkPathData = powerLinks
    .filter(f => f.geometry?.type === 'LineString')
    .map(f => ({
      name: f.properties?.name || 'Power Link',
      voltage: f.properties?.voltage_kv || 13.8,
      role: f.properties?.link_role || 'distribution',
      path: f.geometry.coordinates,
    }));

  const facilityLabelData = facilities
    .filter(f => f.geometry?.type === 'Polygon' && f.geometry.coordinates?.[0]?.length > 2)
    .map(f => {
      const ring = f.geometry.coordinates[0];
      const lon = ring.reduce((acc, p) => acc + p[0], 0) / ring.length;
      const lat = ring.reduce((acc, p) => acc + p[1], 0) / ring.length;
      return { position: [lon, lat], text: f.properties?.name || f.properties?.facility_type || 'Facility' };
    });

  const layers = [
    new GeoJsonLayer({
      id: 'perimeter-zones',
      data: perimeterAndZones,
      pickable: true,
      stroked: true,
      filled: true,
      extruded: false,
      pointType: 'circle',
      lineWidthScale: 20,
      lineWidthMinPixels: 2,
      getFillColor: d => {
        if (d.properties.type === 'perimeter') return [255, 60, 60, 50];
        if (d.properties.type === 'zone') {
          if (d.properties.security_level === 'high') return [255, 0, 0, 80];
          if (d.properties.security_level === 'medium') return [255, 175, 0, 70];
          return [0, 150, 255, 60];
        }
        return [160, 160, 180, 200];
      },
      getLineColor: d => {
        if (d.properties.type === 'perimeter') return [255, 60, 60, 255];
        return [255, 255, 255, 100];
      },
      getPointRadius: d => d.properties.quantity ? Math.max(d.properties.quantity * 2, 10) : 50,
      getLineWidth: 1,
      opacity: 0.8,
    }),

    new GeoJsonLayer({
      id: 'facility-footprints',
      data: facilities,
      pickable: true,
      stroked: true,
      filled: true,
      extruded: true,
      wireframe: true,
      lineWidthMinPixels: 2,
      getLineColor: [35, 35, 35, 220],
      getFillColor: d => {
        const t = (d.properties?.facility_type || '').toLowerCase();
        if (t.includes('hospital') || t.includes('medical')) return [210, 60, 85, 170];
        if (t.includes('hq') || t.includes('command')) return [55, 120, 255, 180];
        if (t.includes('barrack') || t.includes('housing')) return [120, 200, 255, 150];
        if (t.includes('hangar') || t.includes('runway')) return [120, 120, 120, 165];
        return [30, 185, 160, 170];
      },
      getElevation: d => {
        const p = (d.properties?.priority || '').toLowerCase();
        if (p === 'critical' || p === 'high') return 55;
        if (p === 'medium') return 35;
        return 22;
      },
      elevationScale: 2,
      opacity: 0.88,
    }),

    new PathLayer({
      id: 'ground-routes',
      data: routePathData,
      pickable: true,
      getPath: d => d.path,
      getColor: d => {
        const t = (d.routeType || '').toLowerCase();
        if (t.includes('patrol')) return [250, 190, 40, 220];
        if (t.includes('convoy')) return [25, 145, 240, 220];
        if (t.includes('utility')) return [95, 190, 210, 220];
        return [70, 70, 70, 230];
      },
      getWidth: d => Math.max(2, Number(d.lanes) * 2),
      widthMinPixels: 2,
      rounded: true,
      opacity: 0.85,
    }),

    new PathLayer({
      id: 'power-links',
      data: powerLinkPathData,
      pickable: true,
      getPath: d => d.path,
      getColor: d => {
        const v = Number(d.voltage || 13.8);
        if (v >= 69) return [180, 55, 255, 220];
        if (v >= 34.5) return [245, 85, 180, 220];
        return [255, 120, 55, 220];
      },
      getWidth: d => {
        const v = Number(d.voltage || 13.8);
        if (v >= 69) return 5;
        if (v >= 34.5) return 4;
        return 3;
      },
      widthMinPixels: 2,
      rounded: true,
      opacity: 0.92,
    }),

    new ScatterplotLayer({
      id: 'cluster-highlights',
      data: clusters,
      pickable: true,
      opacity: 0.8,
      stroked: true,
      filled: true,
      radiusScale: 6,
      radiusMinPixels: 5,
      radiusMaxPixels: 100,
      lineWidthMinPixels: 2,
      getPosition: d => d.geometry.coordinates,
      getRadius: d => d.properties.quantity || 1,
      getFillColor: [255, 200, 0, 200],
      getLineColor: [255, 255, 255],
    }),

    new ScatterplotLayer({
      id: 'power-assets',
      data: powerAssets,
      pickable: true,
      opacity: 0.95,
      stroked: true,
      filled: true,
      radiusScale: 7,
      radiusMinPixels: 5,
      radiusMaxPixels: 80,
      lineWidthMinPixels: 2,
      getPosition: d => d.geometry.coordinates,
      getRadius: d => Math.max(6, (Number(d.properties?.capacity_kw || 50) / 40)),
      getFillColor: d => {
        const k = (d.properties?.asset_kind || '').toLowerCase();
        if (k.includes('solar')) return [255, 210, 20, 220];
        if (k.includes('battery')) return [20, 220, 180, 220];
        if (k.includes('generator')) return [255, 95, 95, 220];
        if (k.includes('substation') || k.includes('transformer')) return [155, 95, 255, 220];
        return [255, 255, 255, 220];
      },
      getLineColor: [20, 20, 20, 255],
    }),

    new TextLayer({
      id: 'facility-labels',
      data: facilityLabelData,
      pickable: false,
      getPosition: d => d.position,
      getText: d => d.text,
      getColor: [240, 240, 245, 220],
      getSize: 12,
      sizeScale: 1,
      sizeMinPixels: 9,
      getAlignmentBaseline: 'bottom',
    }),
  ];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <DeckGL
        layers={layers}
        viewState={viewState}
        onViewStateChange={e => setViewState(e.viewState)}
        controller={true}
        getTooltip={({object}) => {
          if (!object) return null;
          if (object.properties) {
            const p = object.properties;
            return p.name || p.zone_name || p.facility_type || p.asset_kind || `Type: ${p.type}`;
          }
          return object.name || object.text || 'Feature';
        }}
      >
        <Map reuseMaps mapStyle={MAP_STYLE} />
      </DeckGL>
    </div>
  );
}
