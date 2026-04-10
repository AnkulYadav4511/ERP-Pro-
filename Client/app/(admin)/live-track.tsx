import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, SafeAreaView, Animated, Easing,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { BASE_URL } from '../../services/api';

// ── Constants ────────────────────────────────────────────────────────────────
const MIN_DISTANCE_METERS = 6;
const MAX_ACCURACY_METERS = 30;
const MAX_SPEED_KMH = 200;
const SOCKET_URL = BASE_URL.replace('/api', '');

// ── Light Map Style (matches FieldDashboard) ─────────────────────────────────
const LIGHT_MAP = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e0e0e0' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#bdbdbd' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9dff0' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e8f5e9' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d0eac8' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#e0e0e0' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#eef2eb' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#777777' }] },
];

// ── Haversine (meters) ────────────────────────────────────────────────────────
const haversineMeters = (
  lat1: number, lon1: number, lat2: number, lon2: number
): number => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Haversine (km) for total distance ────────────────────────────────────────
const calculateDistanceKm = (coords: { latitude: number; longitude: number }[]): number => {
  if (coords.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    dist += haversineMeters(
      coords[i].latitude, coords[i].longitude,
      coords[i + 1].latitude, coords[i + 1].longitude
    ) / 1000;
  }
  return dist;
};

// ── Bearing (degrees 0–360) ───────────────────────────────────────────────────
const bearingDeg = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x =
    Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

// ── EMA Location Smoother (same as FieldDashboard) ───────────────────────────
class LocationSmoother {
  private smoothLat: number | null = null;
  private smoothLng: number | null = null;
  private readonly alpha = 0.25;

  smooth(lat: number, lng: number): { latitude: number; longitude: number } {
    if (this.smoothLat === null || this.smoothLng === null) {
      this.smoothLat = lat; this.smoothLng = lng;
    } else {
      this.smoothLat = this.alpha * lat + (1 - this.alpha) * this.smoothLat;
      this.smoothLng = this.alpha * lng + (1 - this.alpha) * this.smoothLng;
    }
    return { latitude: this.smoothLat, longitude: this.smoothLng };
  }

  reset() { this.smoothLat = null; this.smoothLng = null; }
}

// ── Direction Arrow (same as FieldDashboard) ─────────────────────────────────
const DirectionArrow = React.memo(({ rotation }: { rotation: number }) => (
  <View style={{
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: `${rotation}deg` }],
  }}>
    <View style={{
      width: 0, height: 0,
      borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 12,
      borderLeftColor: 'transparent', borderRightColor: 'transparent',
      borderBottomColor: 'rgba(255,255,255,0.95)',
      position: 'absolute',
    }} />
    <View style={{
      width: 0, height: 0,
      borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 8,
      borderLeftColor: 'transparent', borderRightColor: 'transparent',
      borderBottomColor: '#2563EB',
      marginTop: 1,
    }} />
  </View>
));

// ── Module-level smoother ─────────────────────────────────────────────────────
const smoother = new LocationSmoother();

// ─────────────────────────────────────────────────────────────────────────────
export default function LiveTrack() {
  const { shiftId, workerName } = useLocalSearchParams();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastRawRef = useRef<{ lat: number; lng: number } | null>(null);
  const cameraFollowRef = useRef(true);

  const [path, setPath] = useState<{ latitude: number; longitude: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [totalDistance, setTotalDistance] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [accuracy, setAccuracy] = useState(0);

  // ── Animations ──
  const pulseRing = useRef(new Animated.Value(0)).current;
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const markerBeat = useRef(new Animated.Value(1)).current;
  const markerScale = useRef(new Animated.Value(1)).current;

  // Start all animations once
  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.timing(pulseRing, {
          toValue: 1, duration: 2000,
          easing: Easing.out(Easing.ease), useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(markerBeat, { toValue: 1.25, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(markerBeat, { toValue: 1, duration: 700, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const bounceMarker = () => {
    Animated.sequence([
      Animated.timing(markerScale, { toValue: 1.4, duration: 120, useNativeDriver: true }),
      Animated.spring(markerScale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
  };

  // ── Smooth camera pan ──
  const animateToLocation = useCallback((latitude: number, longitude: number) => {
    mapRef.current?.animateCamera({
      center: { latitude, longitude },
      zoom: 18, pitch: 50,
    }, { duration: 800 });
  }, []);

  // ── Apply one incoming point with all filters + smoothing ──
  const applyNewPoint = useCallback((
    rawLat: number,
    rawLng: number,
    opts?: { accuracy?: number; speed?: number }
  ) => {
    // Accuracy gate
    if (opts?.accuracy && opts.accuracy > MAX_ACCURACY_METERS) return;
    // Speed gate
    if (opts?.speed && opts.speed * 3.6 > MAX_SPEED_KMH) return;

    // Min-distance gate (raw coords)
    if (lastRawRef.current) {
      const dist = haversineMeters(lastRawRef.current.lat, lastRawRef.current.lng, rawLat, rawLng);
      if (dist < MIN_DISTANCE_METERS) return;
    }
    lastRawRef.current = { lat: rawLat, lng: rawLng };

    // EMA smooth
    const { latitude, longitude } = smoother.smooth(rawLat, rawLng);

    setPath(prev => {
      // Secondary distance check on smoothed coords
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        const d = haversineMeters(last.latitude, last.longitude, latitude, longitude);
        if (d < MIN_DISTANCE_METERS) return prev;
      }
      const updated = [...prev, { latitude, longitude }];
      setTotalDistance(parseFloat(calculateDistanceKm(updated).toFixed(3)));
      return updated;
    });

    if (opts?.accuracy !== undefined) setAccuracy(Math.round(opts.accuracy));
    if (opts?.speed !== undefined) setSpeed(Math.round(opts.speed * 3.6));

    setLastUpdated(new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));

    bounceMarker();

    if (cameraFollowRef.current) animateToLocation(latitude, longitude);
  }, [animateToLocation]);

  // ── Load initial path from REST ──
  const fetchInitialPath = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE_URL}/admin/shift/${shiftId}`);
      if (res.data?.path?.length) {
        const rawCoords: { latitude: number; longitude: number }[] = res.data.path.map((p: any) => ({
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
        }));

        // Filter with haversine on initial load
        const filtered = rawCoords.filter((point, i) => {
          if (i === 0) return true;
          return haversineMeters(
            rawCoords[i - 1].latitude, rawCoords[i - 1].longitude,
            point.latitude, point.longitude
          ) >= MIN_DISTANCE_METERS;
        });

        setPath(filtered);
        setTotalDistance(parseFloat(calculateDistanceKm(filtered).toFixed(3)));
        setLastUpdated(new Date().toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }));

        if (filtered.length > 0) {
          const last = filtered[filtered.length - 1];
          lastRawRef.current = { lat: last.latitude, lng: last.longitude };
          smoother.reset();
          animateToLocation(last.latitude, last.longitude);
        }
      }
    } catch (err) {
      console.log('Initial fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [shiftId, animateToLocation]);

  // ── Socket.IO ──
  useEffect(() => {
    smoother.reset();
    fetchInitialPath();

    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1500,
      timeout: 10000,
    });

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      socketRef.current?.emit('watch_shift', { shiftId });
    });

    socketRef.current.on('disconnect', () => setIsConnected(false));

    socketRef.current.on('location_updated', ({
      latitude, longitude, accuracy: acc, speed: spd,
    }: { latitude: number; longitude: number; accuracy?: number; speed?: number }) => {
      applyNewPoint(latitude, longitude, { accuracy: acc, speed: spd });
    });

    return () => {
      socketRef.current?.disconnect();
      smoother.reset();
      lastRawRef.current = null;
    };
  }, [shiftId]);

  // ── Derived ──
  const pulseScale = pulseRing.interpolate({ inputRange: [0, 1], outputRange: [1, 3.2] });
  const signalColor = accuracy === 0 ? '#9ca3af' : accuracy < 15 ? '#16a34a' : accuracy < 40 ? '#ca8a04' : '#dc2626';
  const currentLocation = path.length > 0 ? path[path.length - 1] : null;
  const startLocation = path.length > 0 ? path[0] : null;
  const workerInitial = workerName ? (workerName as string).charAt(0).toUpperCase() : 'W';

  // Direction arrows every 5th point
  const arrowPoints = useMemo(() => {
    if (path.length < 6) return [];
    const result: { coord: { latitude: number; longitude: number }; bearing: number }[] = [];
    for (let i = 5; i < path.length; i += 5) {
      const prev = path[i - 1];
      const curr = path[i];
      result.push({
        coord: curr,
        bearing: bearingDeg(prev.latitude, prev.longitude, curr.latitude, curr.longitude),
      });
    }
    return result;
  }, [path]);

  // Breadcrumb dots every 10th point (skip arrow positions)
  const crumbPoints = useMemo(() => {
    if (path.length < 11) return [];
    return path.filter((_, i) => i > 0 && i % 10 === 0 && i % 5 !== 0 && i < path.length - 1);
  }, [path]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={s.loadingText}>Loading live location...</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>

      {/* ── Map ── */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        customMapStyle={LIGHT_MAP}
        pitchEnabled
        rotateEnabled
        showsBuildings
        showsTraffic={false}
        showsCompass={false}
        showsMyLocationButton={false}
        mapPadding={{ top: 0, right: 0, bottom: 260, left: 0 }}
        initialRegion={currentLocation
          ? { ...currentLocation, latitudeDelta: 0.008, longitudeDelta: 0.008 }
          : { latitude: 19.076, longitude: 72.8777, latitudeDelta: 0.05, longitudeDelta: 0.05 }
        }
        onPanDrag={() => { cameraFollowRef.current = false; }}
      >

        {/* Faded full trail */}
        {path.length > 1 && (
          <Polyline
            coordinates={path}
            strokeColor="rgba(37,99,235,0.4)"
            strokeWidth={5}
            geodesic lineCap="round" lineJoin="round"
            zIndex={1}
          />
        )}

        {/* Bright leading edge (last 6 pts) */}
        {path.length > 5 && (
          <Polyline
            coordinates={path.slice(Math.max(path.length - 6, 0))}
            strokeColor="#2563EB"
            strokeWidth={6}
            geodesic lineCap="round" lineJoin="round"
            zIndex={2}
          />
        )}

        {/* Green start pin */}
        {startLocation && (
          <Marker coordinate={startLocation} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={5}>
            <View style={s.startPin}>
              <View style={s.startPinInner} />
            </View>
          </Marker>
        )}

        {/* Direction arrows every 5th point */}
        {arrowPoints.map((item, i) => (
          <Marker key={`arrow-${i}`} coordinate={item.coord}
            anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges={false} zIndex={3}>
            <DirectionArrow rotation={item.bearing} />
          </Marker>
        ))}

        {/* Breadcrumb dots every 10th point */}
        {crumbPoints.map((point, i) => (
          <Marker key={`crumb-${i}`} coordinate={point}
            anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={3}>
            <View style={s.crumbDot} />
          </Marker>
        ))}

        {/* Animated employee marker */}
        {currentLocation && (
          <Marker coordinate={currentLocation}
            anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges zIndex={10}>
            <View style={s.markerWrapper}>
              {/* Expanding pulse ring */}
              <Animated.View style={[s.pulseRing, {
                transform: [{ scale: pulseScale }], opacity: pulseOpacity,
              }]} />
              {/* Accuracy ring — color = signal quality */}
              <View style={[s.accuracyRing, { borderColor: signalColor }]} />
              {/* Blue dot with avatar initial */}
              <Animated.View style={[s.markerDot, {
                transform: [{ scale: Animated.multiply(markerScale, markerBeat) }],
              }]}>
                <Text style={s.markerInitial}>{workerInitial}</Text>
              </Animated.View>
            </View>
          </Marker>
        )}

      </MapView>

      {/* ── Back button ── */}
      <SafeAreaView style={s.backBtn}>
        <TouchableOpacity onPress={() => router.back()} style={s.backCircle}>
          <Ionicons name="arrow-back" size={22} color="#1C1C1E" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* ── Connection badge ── */}
      <View style={s.connectionBadge}>
        <View style={[s.connectionDot, { backgroundColor: isConnected ? '#16a34a' : '#dc2626' }]} />
        <Text style={[s.connectionText, { color: isConnected ? '#16a34a' : '#dc2626' }]}>
          {isConnected ? 'LIVE' : 'CONNECTING...'}
        </Text>
      </View>

      {/* ── Recenter ── */}
      <TouchableOpacity
        style={s.recenterBtn}
        onPress={() => {
          cameraFollowRef.current = true;
          if (currentLocation) animateToLocation(currentLocation.latitude, currentLocation.longitude);
        }}
      >
        <Ionicons name="navigate" size={20} color="#2563EB" />
      </TouchableOpacity>

      {/* ── Info card ── */}
      <View style={s.infoCard}>

        {/* Header row */}
        <View style={s.infoHeader}>
          <View style={s.infoAvatar}>
            <Text style={s.infoAvatarText}>{workerInitial}</Text>
          </View>
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={s.infoName}>{workerName || 'Employee'}</Text>
            <Text style={s.infoRole}>Sales Executive</Text>
          </View>
          <View style={s.liveBadge}>
            <Animated.View style={[s.liveDot, { opacity: pulseOpacity }]} />
            <Text style={s.liveText}>LIVE</Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statItem}>
            <Ionicons name="navigate" size={18} color="#2563EB" />
            <Text style={s.statValue}>{totalDistance.toFixed(2)} km</Text>
            <Text style={s.statLabel}>Distance</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Ionicons name="speedometer" size={18} color="#2563EB" />
            <Text style={s.statValue}>{speed} km/h</Text>
            <Text style={s.statLabel}>Speed</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <View style={[s.signalDot, { backgroundColor: signalColor }]} />
            <Text style={[s.statValue, { color: signalColor }]}>±{accuracy}m</Text>
            <Text style={s.statLabel}>GPS Accuracy</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Ionicons name="time" size={18} color="#2563EB" />
            <Text style={s.statValue}>{lastUpdated || '--'}</Text>
            <Text style={s.statLabel}>Updated</Text>
          </View>
        </View>

        {/* Path info */}
        <View style={s.pathInfo}>
          <Ionicons name="location" size={14} color="#64748b" />
          <Text style={s.pathInfoText}>{path.length} location points recorded</Text>
        </View>

      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 15, fontWeight: '600' },

  // Back
  backBtn: { position: 'absolute', top: 10, left: 15 },
  backCircle: {
    backgroundColor: 'white', width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center', elevation: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4,
  },

  // Connection badge
  connectionBadge: {
    position: 'absolute', top: 20, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white', paddingHorizontal: 14,
    paddingVertical: 6, borderRadius: 20, elevation: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4,
  },
  connectionDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  connectionText: { fontSize: 12, fontWeight: '800' },

  // Recenter
  recenterBtn: {
    position: 'absolute', right: 14, bottom: 280,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6,
    borderWidth: 1, borderColor: '#e2e8f0',
  },

  // Map markers
  startPin: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: '#16a34a',
    borderWidth: 2.5, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center', elevation: 5,
    shadowColor: '#16a34a', shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 }, shadowRadius: 6,
  },
  startPinInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff' },
  crumbDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563EB',
    borderWidth: 1.5, borderColor: '#ffffff', elevation: 2,
  },
  markerWrapper: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute', width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(37,99,235,0.18)',
    borderWidth: 1, borderColor: 'rgba(37,99,235,0.35)',
  },
  accuracyRing: {
    position: 'absolute', width: 38, height: 38, borderRadius: 19,
    borderWidth: 1.5, backgroundColor: 'transparent',
  },
  markerDot: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#2563EB',
    borderWidth: 3, borderColor: '#ffffff', elevation: 8,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  markerInitial: { color: '#fff', fontWeight: '800', fontSize: 14 },
  signalDot: { width: 10, height: 10, borderRadius: 5 },

  // Info card
  infoCard: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
    elevation: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10, shadowRadius: 16,
    borderTopWidth: 1, borderColor: '#e2e8f0',
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  infoAvatar: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: '#2563EB',
    justifyContent: 'center', alignItems: 'center',
  },
  infoAvatarText: { color: 'white', fontWeight: '800', fontSize: 22 },
  infoName: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  infoRole: { fontSize: 13, color: '#64748b', marginTop: 2, fontWeight: '600' },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#dcfce7', paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 10,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16a34a', marginRight: 5 },
  liveText: { fontSize: 11, fontWeight: '900', color: '#16a34a' },

  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: '#f8fafc', borderRadius: 18,
    paddingVertical: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 13, fontWeight: '800', color: '#0f172a', marginTop: 4 },
  statLabel: { fontSize: 10, color: '#94a3b8', marginTop: 2, fontWeight: '700', letterSpacing: 0.4 },
  statDivider: { width: 1, backgroundColor: '#e2e8f0' },

  pathInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4,
  },
  pathInfoText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
});