import type { MapPanelProps } from './MapPanel.types';

export const MAP_HTML = `<!doctype html>
<html lang="id">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <style>
      html, body, #map { width: 100%; height: 100%; min-height: 100%; margin: 0; background: #dce8ee; }
      .leaflet-control-attribution { font-size: 9px; }
      .map-dark .leaflet-tile { filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.85) saturate(0.75); }
      .map-dark .leaflet-control-attribution { background: rgba(15, 23, 42, 0.82); color: #cbd5e1; }
      .map-dark .leaflet-control-attribution a { color: #e2e8f0; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const map = L.map('map', { zoomControl: false }).setView([0, 0], 15);
      let tileLayer = null;
      let currentTheme = null;

      function applyMapTheme(isLightTheme) {
        const nextTheme = isLightTheme ? 'light' : 'dark';
        if (nextTheme === currentTheme) return;
        const mapContainer = document.getElementById('map');
        mapContainer.classList.toggle('map-dark', !isLightTheme);
        document.body.style.background = isLightTheme ? '#dce8ee' : '#111827';
        if (!tileLayer) {
          tileLayer = L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
          ).addTo(map);
        }
        currentTheme = nextTheme;
        map.invalidateSize();
      }
      const markers = new Map();
      const paths = new Map();
      let areaCircle = null;
      let previousArea = '';
      let focusedDetectionId = null;
      let initialized = false;
      let currentData = null;
      let lastInteractionMessageAt = 0;

      function sendMapMessage(message) {
        const serialized = JSON.stringify(message);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(serialized);
        } else {
          window.parent.postMessage(serialized, '*');
        }
      }

      function notifyMapInteraction() {
        if (!currentData?.dismissPinOnInteraction) return;
        const now = Date.now();
        if (now - lastInteractionMessageAt < 500) return;
        lastInteractionMessageAt = now;
        sendMapMessage({ type: 'map-interaction' });
      }

      function updateMap(data) {
        currentData = data;
        applyMapTheme(Boolean(data.isLightTheme));
        const areaKey = JSON.stringify([data.center.latitude, data.center.longitude, data.radiusMeters]);
        if (areaKey !== previousArea) {
          if (areaCircle) map.removeLayer(areaCircle);
          areaCircle = L.circle([data.center.latitude, data.center.longitude], {
            radius: data.radiusMeters,
            color: '#0f766e',
            weight: 2,
            fillColor: '#14b8a6',
            fillOpacity: 0.12
          }).addTo(map);
          if (!initialized || areaKey !== previousArea) {
            map.fitBounds(areaCircle.getBounds(), { padding: [18, 18], maxZoom: 17 });
            initialized = true;
          }
          previousArea = areaKey;
        }

        const currentIds = new Set();
        for (const point of data.points) {
          currentIds.add(point.id);
          const isScanDetection = point.id.startsWith('seeker-scan-detection-');
          const isImpostorPin = point.id.startsWith('impostor-location-pin-');
          const isSpectatorPlayer = point.id.startsWith('spectator-player-');
          let marker = markers.get(point.id);
          if (!marker) {
            marker = L.circleMarker([point.latitude, point.longitude], {
              radius: isScanDetection || isImpostorPin ? 13 : isSpectatorPlayer ? 10 : 8,
              color: isScanDetection ? '#4c1d95' : isImpostorPin ? '#881337' : '#ffffff',
              weight: isScanDetection || isImpostorPin || isSpectatorPlayer ? 3 : 2,
              fillColor: point.color,
              fillOpacity: 1
            }).addTo(map);
            markers.set(point.id, marker);
          } else {
            marker.setLatLng([point.latitude, point.longitude]);
            marker.setStyle({ fillColor: point.color });
          }
          const label = document.createElement('span');
          label.textContent = point.label;
          marker.bindPopup(label);
          if (isScanDetection && focusedDetectionId !== point.id) {
            focusedDetectionId = point.id;
            map.setView([point.latitude, point.longitude], Math.max(map.getZoom(), 17), {
              animate: true
            });
            marker.openPopup();
          }
        }
        for (const [id, marker] of markers) {
          if (!currentIds.has(id)) {
            map.removeLayer(marker);
            markers.delete(id);
          }
        }
        const currentPathIds = new Set();
        for (const path of data.paths ?? []) {
          currentPathIds.add(path.id);
          let polyline = paths.get(path.id);
          const coordinates = path.coordinates.map((point) => [point.latitude, point.longitude]);
          if (!polyline) {
            polyline = L.polyline(coordinates, {
              color: path.color,
              weight: 4,
              opacity: 0.75
            }).addTo(map);
            paths.set(path.id, polyline);
          } else {
            polyline.setLatLngs(coordinates);
            polyline.setStyle({ color: path.color });
          }
        }
        for (const [id, polyline] of paths) {
          if (!currentPathIds.has(id)) {
            map.removeLayer(polyline);
            paths.delete(id);
          }
        }
        map.invalidateSize();
      }

      map.on('click', (event) => {
        if (!currentData?.canPlacePin) return;
        sendMapMessage({
          type: 'pin-place',
          latitude: event.latlng.lat,
          longitude: event.latlng.lng
        });
      });
      const mapContainer = document.getElementById('map');
      mapContainer.addEventListener('pointerdown', notifyMapInteraction, { passive: true });
      mapContainer.addEventListener('touchstart', notifyMapInteraction, { passive: true });
      mapContainer.addEventListener('wheel', notifyMapInteraction, { passive: true });

      const resizeObserver = new ResizeObserver(() => map.invalidateSize());
      resizeObserver.observe(mapContainer);
      window.addEventListener('resize', () => map.invalidateSize());

      function receiveMapData(event) {
        updateMap(JSON.parse(event.data));
      }
      window.addEventListener('message', receiveMapData);
      document.addEventListener('message', receiveMapData);
    </script>
  </body>
</html>`;

export const serializeMapData = (data: MapPanelProps) => JSON.stringify({
  center: data.center,
  radiusMeters: data.radiusMeters,
  points: data.points,
  paths: data.paths ?? [],
  isLightTheme: data.isLightTheme,
  canPlacePin: Boolean(data.canPlacePin),
  dismissPinOnInteraction: Boolean(data.dismissPinOnInteraction),
});
