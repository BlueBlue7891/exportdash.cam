'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { SeiData } from '@/lib/dashcam-mp4';
import { wgs84ToGcj02, gcj02ToWgs84, isInChina, isOutOfChina, distance } from '@/lib/coord-transform';

interface MapViewProps {
  seiData: SeiData | null;
  heading?: number;
}

type MapProvider = 'amap' | 'osm';

export function MapView({ seiData, heading }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapProvider, setMapProvider] = useState<MapProvider>('amap');
  const [L, setL] = useState<typeof import('leaflet') | null>(null);

  const rawLat = seiData?.latitude_deg;
  const rawLng = seiData?.longitude_deg;
  const headingDeg = heading ?? seiData?.heading_deg ?? 0;
  
  // 判断 GPS 是否来自视频原生 SEI（有速度、档位等数据）
  // 还是来自 event.json 回退（只有 lat/lng）
  const hasNativeVideoGps = seiData?.vehicle_speed_mps !== undefined || 
                            seiData?.gear_state !== undefined ||
                            seiData?.autopilot_state !== undefined;

  // 根据位置判断使用哪种地图，并进行坐标转换
  const { lat, lng, isChina, offset } = (() => {
    if (rawLat === undefined || rawLng === undefined ||
        rawLat === 0 && rawLng === 0 || isNaN(rawLat) || isNaN(rawLng)) {
      return { lat: undefined, lng: undefined, isChina: false, offset: 0 };
    }
    const inChina = isInChina(rawLng, rawLat);
    if (inChina && mapProvider === 'amap') {
      // GPS坐标需要转换为高德坐标（高精度转换）
      const [gcjLng, gcjLat] = wgs84ToGcj02(rawLng, rawLat);
      const offsetDistance = distance(rawLng, rawLat, gcjLng, gcjLat);
      return { lat: gcjLat, lng: gcjLng, isChina: true, offset: offsetDistance };
    }
    return { lat: rawLat, lng: rawLng, isChina: inChina, offset: 0 };
  })();

  const hasValidCoords = lat !== undefined && lng !== undefined;

  // Load Leaflet dynamically
  useEffect(() => {
    import('leaflet').then((leaflet) => {
      setL(leaflet.default);
    });
  }, []);

  // Initialize map
  const initMap = useCallback(() => {
    if (!L || !mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: lat && lng ? [lat, lng] : [39.9042, 116.4074], // 默认北京
      zoom: 17,
      zoomControl: false,
      attributionControl: false,
    });

    if (mapProvider === 'amap') {
      // 高德地图瓦片
      L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: '1234',
        maxZoom: 19,
      }).addTo(map);
    } else {
      // OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 19,
      }).addTo(map);
    }

    mapRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
      setIsMapReady(true);
    }, 100);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [L, mapProvider, lat, lng]);

  // Initialize map when provider changes
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
      setIsMapReady(false);
    }
    initMap();
  }, [initMap]);

  const lastHeadingRef = useRef<number>(0);

  // Update marker when coordinates change
  useEffect(() => {
    if (!L || !mapRef.current || !isMapReady) return;

    const map = mapRef.current;

    if (hasValidCoords && lat !== undefined && lng !== undefined) {
      const headingChanged = Math.abs(headingDeg - lastHeadingRef.current) > 5;

      if (!markerRef.current) {
        const carIcon = L.divIcon({
          className: 'car-marker-container',
          html: `
            <div class="car-icon-inner" style="transform: rotate(${headingDeg}deg);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L7 12H17L12 2Z" fill="#3B82F6" stroke="#1E40AF" stroke-width="1.5"/>
                <circle cx="12" cy="15" r="5" fill="#3B82F6" stroke="#1E40AF" stroke-width="1.5"/>
                <circle cx="12" cy="15" r="2" fill="#1E40AF"/>
              </svg>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        markerRef.current = L.marker([lat, lng], { icon: carIcon }).addTo(map);
        lastHeadingRef.current = headingDeg;
      } else {
        markerRef.current.setLatLng([lat, lng]);

        if (headingChanged) {
          const carIcon = L.divIcon({
            className: 'car-marker-container',
            html: `
              <div class="car-icon-inner" style="transform: rotate(${headingDeg}deg);">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L7 12H17L12 2Z" fill="#3B82F6" stroke="#1E40AF" stroke-width="1.5"/>
                  <circle cx="12" cy="15" r="5" fill="#3B82F6" stroke="#1E40AF" stroke-width="1.5"/>
                  <circle cx="12" cy="15" r="2" fill="#1E40AF"/>
                </svg>
              </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          markerRef.current.setIcon(carIcon);
          lastHeadingRef.current = headingDeg;
        }
      }

      map.setView([lat, lng], map.getZoom(), { animate: false });
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [L, lat, lng, headingDeg, hasValidCoords, isMapReady]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-gray-900 w-full h-full" style={{ minHeight: '150px' }}>
      {/* Map provider switcher */}
      <div className="absolute top-2 right-2 z-[1000] flex bg-black/60 rounded-lg overflow-hidden">
        <button
          onClick={() => setMapProvider('amap')}
          className={`px-2 py-1 text-[10px] font-medium transition-colors ${
            mapProvider === 'amap' 
              ? 'bg-blue-600 text-white' 
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          高德
        </button>
        <button
          onClick={() => setMapProvider('osm')}
          className={`px-2 py-1 text-[10px] font-medium transition-colors ${
            mapProvider === 'osm' 
              ? 'bg-blue-600 text-white' 
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          OSM
        </button>
      </div>

      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%' }}
      />

      {/* Loading state */}
      {!isMapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="text-gray-500 text-sm">Loading map...</div>
        </div>
      )}

      {/* No GPS overlay */}
      {isMapReady && !hasValidCoords && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
          <div className="text-center text-gray-500 text-sm px-4">
            <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p>No GPS data in video</p>
            <p className="text-xs text-gray-600 mt-1">Some regions don't include GPS in dashcam footage</p>
          </div>
        </div>
      )}

      {/* Coordinates overlay */}
      {isMapReady && hasValidCoords && (
        <div className="absolute bottom-1 left-1 bg-black/60 rounded px-1.5 py-0.5 text-[9px] font-mono z-[1000] flex flex-col gap-0.5 max-w-[220px]">
          {!hasNativeVideoGps ? (
            // 使用 event.json 回退（视频无原生 GPS）
            <>
              <div className="text-yellow-400">
                估计位置: {lat?.toFixed(5)}, {lng?.toFixed(5)}
              </div>
              <div className="text-[8px] text-gray-500">
                来自 event.json (视频无 GPS)
              </div>
            </>
          ) : isChina && mapProvider === 'amap' ? (
            // 视频包含原生 GPS 数据 + 高德地图
            <>
              <div className="text-green-400">
                高德: {lat?.toFixed(5)}, {lng?.toFixed(5)} 
                {headingDeg > 0 && <span className="text-green-600 ml-1">{Math.round(headingDeg)}°</span>}
              </div>
              <div className="text-[8px] text-gray-500">
                GPS: {rawLat?.toFixed(5)}, {rawLng?.toFixed(5)} (偏移: {offset.toFixed(0)}m)
              </div>
            </>
          ) : (
            // 视频包含原生 GPS 数据 + OSM/国外
            <div className="text-gray-300">
              GPS: {rawLat?.toFixed(5)}, {rawLng?.toFixed(5)}
              {headingDeg > 0 && <span className="text-gray-500 ml-1">{Math.round(headingDeg)}°</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
