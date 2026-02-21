import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import { GeoJsonLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

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

  const layers = [
    new GeoJsonLayer({
      id: 'ai-generated-layout',
      data,
      pickable: true,
      stroked: true,
      filled: true,
      extruded: false, // We can make it extruded if properties have height
      pointType: 'circle',
      lineWidthScale: 20,
      lineWidthMinPixels: 2,
      getFillColor: d => {
        if (d.properties.type === 'perimeter') return [255, 60, 60, 50];
        if (d.properties.type === 'zone') {
          if (d.properties.security_level === 'high') return [255, 0, 0, 80];
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
    
    // Add an explicit scatterplot to highlight clusters
    new ScatterplotLayer({
      id: 'cluster-highlights',
      data: data?.features?.filter(f => f.properties.type === 'cluster') || [],
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
    })
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
          return object.properties.name || object.properties.zone_name || `Type: ${object.properties.type}`;
        }}
      >
        <Map reuseMaps mapStyle={MAP_STYLE} />
      </DeckGL>
    </div>
  );
}
