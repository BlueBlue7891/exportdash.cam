/**
 * 高精度坐标转换 - WGS84 (GPS) ↔ GCJ02 (国测局/高德)
 * 
 * 参考实现：
 * - https://github.com/googollee/eviltransform
 * - https://github.com/wandergis/coordTransform_py
 */

const PI = Math.PI;
const X_PI = (PI * 3000.0) / 180.0;
const A = 6378245.0;  // 长半轴
const EE = 0.00669342162296594323;  // 偏心率平方

/**
 * 判断是否在中国境外（不需要转换）
 */
export function isOutOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/**
 * 计算纬度偏移量
 */
function transformLat(lng: number, lat: number): number {
  let ret =
    -100.0 +
    2.0 * lng +
    3.0 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng));
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) +
      20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(lat * PI) +
      40.0 * Math.sin((lat / 3.0) * PI)) *
      2.0) /
    3.0;
  ret +=
    ((160.0 * Math.sin((lat / 12.0) * PI) +
      320.0 * Math.sin((lat * PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

/**
 * 计算经度偏移量
 */
function transformLng(lng: number, lat: number): number {
  let ret =
    300.0 +
    lng +
    2.0 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng));
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) +
      20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(lng * PI) +
      40.0 * Math.sin((lng / 3.0) * PI)) *
      2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((lng / 12.0) * PI) +
      300.0 * Math.sin((lng / 30.0) * PI)) *
      2.0) /
    3.0;
  return ret;
}

/**
 * WGS84 (GPS) → GCJ02 (国测局/高德)
 * 
 * @param lng WGS84 经度
 * @param lat WGS84 纬度
 * @returns [gcjLng, gcjLat] GCJ02 坐标
 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (isOutOfChina(lng, lat)) {
    return [lng, lat];
  }
  
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  
  const gcjLat = lat + dLat;
  const gcjLng = lng + dLng;
  
  return [gcjLng, gcjLat];
}

/**
 * GCJ02 (国测局/高德) → WGS84 (GPS)
 * 使用迭代法提高精度
 * 
 * @param lng GCJ02 经度
 * @param lat GCJ02 纬度
 * @returns [wgsLng, wgsLat] WGS84 坐标
 */
export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (isOutOfChina(lng, lat)) {
    return [lng, lat];
  }
  
  // 迭代法反向求解
  let wgsLng = lng;
  let wgsLat = lat;
  
  for (let i = 0; i < 5; i++) {
    const [gcjLng, gcjLat] = wgs84ToGcj02(wgsLng, wgsLat);
    const diffLng = gcjLng - lng;
    const diffLat = gcjLat - lat;
    
    if (Math.abs(diffLng) < 1e-8 && Math.abs(diffLat) < 1e-8) {
      break;
    }
    
    wgsLng -= diffLng;
    wgsLat -= diffLat;
  }
  
  return [wgsLng, wgsLat];
}

/**
 * GCJ02 → BD09 (百度坐标)
 * 如果需要使用百度地图
 */
export function gcj02ToBd09(lng: number, lat: number): [number, number] {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  const bdLng = z * Math.cos(theta) + 0.0065;
  const bdLat = z * Math.sin(theta) + 0.006;
  return [bdLng, bdLat];
}

/**
 * BD09 (百度) → GCJ02
 */
export function bd09ToGcj02(lng: number, lat: number): [number, number] {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  const gcjLng = z * Math.cos(theta);
  const gcjLat = z * Math.sin(theta);
  return [gcjLng, gcjLat];
}

/**
 * WGS84 → BD09
 */
export function wgs84ToBd09(lng: number, lat: number): [number, number] {
  const [gcjLng, gcjLat] = wgs84ToGcj02(lng, lat);
  return gcj02ToBd09(gcjLng, gcjLat);
}

/**
 * 判断坐标是否在中国境内（简化版）
 */
export function isInChina(lng: number, lat: number): boolean {
  return lng >= 73.0 && lng <= 135.0 && lat >= 3.0 && lat <= 54.0;
}

/**
 * 计算两点之间的距离（米）
 */
export function distance(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const radLat1 = (lat1 * PI) / 180.0;
  const radLat2 = (lat2 * PI) / 180.0;
  const a = radLat1 - radLat2;
  const b = ((lng1 - lng2) * PI) / 180.0;
  const s =
    2 *
    Math.asin(
      Math.sqrt(
        Math.pow(Math.sin(a / 2), 2) +
          Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)
      )
    );
  return s * A;
}

/**
 * 获取坐标精度说明
 */
export function getPrecisionDescription(before: [number, number], after: [number, number]): string {
  const d = distance(before[0], before[1], after[0], after[1]);
  if (d < 10) return '极高';
  if (d < 50) return '高';
  if (d < 100) return '中';
  if (d < 500) return '低';
  return '极低';
}
