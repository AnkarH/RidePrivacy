import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Circle, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import { Input, Button, Card, Modal, message, Spin } from 'antd';
import { latLngToCell, cellToLatLng } from 'h3-js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 修复Leaflet默认图标问题
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// 自定义图标
const createCustomIcon = (color: string, text: string) => {
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="
      background-color: ${color};
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 3px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      color: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    ">${text}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
};

// 地图中心控制组件
function MapCenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);
  return null;
}

type LatLng = [number, number];

interface DriverLite {
  id: string;
  pos: LatLng;
  name: string;
}

export default function RidePrivacyDemo() {
  // 地图与覆盖物
  const mapRef = useRef<L.Map | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([40.000000, 116.330000]);
  const [mapZoom, setMapZoom] = useState(14);

  // 表单与阶段状态
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0); // 0 下单, 1 派单中, 2 接单加密, 3 导航
  const [banner, setBanner] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);

  // 司机状态
  const [selectedDriver, setSelectedDriver] = useState<DriverLite | null>(null);
  const [driverCurrentPos, setDriverCurrentPos] = useState<LatLng | null>(null);

  // 右侧四卡片
  const [panelInput, setPanelInput] = useState<Record<string, string>>({});
  const [panelAlgo, setPanelAlgo] = useState<Record<string, string>>({});
  const [panelOutput, setPanelOutput] = useState<Record<string, string>>({});
  const [panelPlatform, setPanelPlatform] = useState<Record<string, string>>({});

  // 默认示例点（北京清华东门附近）
  const defaultUserPos: LatLng = [40.000000, 116.330000];
  const driverSeed: LatLng[] = [
    [40.0025, 116.332],
    [39.998, 116.3285],
    [40.003, 116.337]
  ];
  const [drivers, setDrivers] = useState<DriverLite[]>(
    driverSeed.map((p, i) => ({ 
      id: `d-${i + 1}`, 
      pos: p,
      name: ['黄师傅', '王师傅', '李师傅'][i]
    }))
  );

  // 获取用户当前位置
  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          setUserLocation([lat, lon]);
        },
        () => {
          setUserLocation(defaultUserPos);
        }
      );
    } else {
      setUserLocation(defaultUserPos);
    }
  };

  // 距离/ETA
  const distEta = (a: LatLng, b: LatLng) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(x));
    const meters = Math.round(km * 1000);
    const etaMin = Math.max(3, Math.round(km * 8));
    return { meters, etaMin };
  };

  // 模拟地理编码（将地址转换为坐标）
  const geocodeAddress = async (address: string): Promise<LatLng | null> => {
    // 模拟一些常见地址的坐标
    const addressMap: Record<string, LatLng> = {
      '清华东门': [40.000000, 116.330000],
      '中关村': [39.983424, 116.306396],
      '天安门': [39.904030, 116.407526],
      '西单': [39.9139, 116.3783],
      '王府井': [39.9097, 116.4134],
      '国贸': [39.9189, 116.4617]
    };
    
    for (const [key, coord] of Object.entries(addressMap)) {
      if (address.includes(key)) {
        return coord;
      }
    }
    
    // 如果没匹配到，返回默认位置
    return defaultUserPos;
  };

  // 启动真实流程
  const cipherTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 平台控制函数
  const startOrder = async () => {
    if (!originText.trim() || !destText.trim()) {
      message.warning('请先输入起点和目的地');
      return;
    }

    setIsLoading(true);

    // 地理编码获取真实坐标
    const originCoord = await geocodeAddress(originText);
    const destCoord = await geocodeAddress(destText);
    
    if (!originCoord || !destCoord) {
      message.error('地址解析失败，请重新输入');
      setIsLoading(false);
      return;
    }

    setUserLocation(originCoord);
    setDestination(destCoord);

    // 更新地图中心到起点
    setMapCenter(originCoord);
    setMapZoom(14);

    // 阶段1：H3 区域编码
    const res = 7;
    const h3 = latLngToCell(originCoord[0], originCoord[1], res);
    const [clat, clon] = cellToLatLng(h3);
    setPanelInput({ 
      '用户真实坐标': `${originCoord[0].toFixed(6)}, ${originCoord[1].toFixed(6)}`,
      '用户输入地址': `${originText} → ${destText}`
    });
    setPanelAlgo({ 
      'GeoHash/H3 区域粒度编码': `GeoHash(6) → 1km²`,
      '区域聚合算法': 'H3 Cell ID 生成'
    });
    setPanelOutput({ 
      '区域标识符': h3,
      '区域中心点坐标': `${clat.toFixed(6)}, ${clon.toFixed(6)}`
    });
    setPanelPlatform({ 
      '平台接收数据': '仅区域标识，不含真实坐标'
    });
    setBanner('派单中… 正在计算加密桶交集');
    setStage(1);
    Modal.info({ 
      title: '① 下单阶段：数据已加密传输，平台正在为您派单', 
      content: '您的真实位置已被模糊化为区域标识，平台无法获取精确坐标',
      centered: true 
    });

    setIsLoading(false);
  };

  const toMatching = () => {
    if (stage < 1) return;
    setBanner('派单中… 正在计算加密桶交集');
    message.info('平台正在派单中...');
  };

  const toAccepted = () => {
    if (stage < 1) return;
    
    // 选择最近的司机作为接单司机
    const nearestDriver = drivers.reduce((closest, driver) => {
      const currentDist = distEta(userLocation!, closest.pos).meters;
      const driverDist = distEta(userLocation!, driver.pos).meters;
      return driverDist < currentDist ? driver : closest;
    });
    
    setSelectedDriver(nearestDriver);
    setDriverCurrentPos(nearestDriver.pos); // 司机当前位置
    
    setPanelInput({ 
      '用户坐标': `${userLocation![0].toFixed(6)}, ${userLocation![1].toFixed(6)}`,
      '司机坐标': `${nearestDriver.pos[0].toFixed(6)}, ${nearestDriver.pos[1].toFixed(6)}`,
      '临时密钥': 'ECDH(ephemeral)'
    });
    setPanelAlgo({ 
      '同态加密 + 密钥协商': 'ECDH 密钥交换',
      '加密算法': 'AES-GCM 对称加密'
    });
    setPanelOutput({ 
      '加密坐标数据包': randomHex(64) + '…',
      '密文状态': 'Ciphertext'
    });
    setPanelPlatform({ 
      '平台接收数据': '仅转发密文，不可解密'
    });
    setBanner('② 接单阶段：匹配成功，司机正在加速赶来');
    setStage(2);
    Modal.success({ 
      title: '② 接单阶段：匹配成功', 
      content: '司机已接单，数据已加密传输，平台无法解密您的精确位置',
      centered: true 
    });

    // 加密动画
    if (cipherTimerRef.current) clearInterval(cipherTimerRef.current);
    cipherTimerRef.current = setInterval(() => {
      setPanelOutput({ 
        '加密坐标数据包': randomHex(64) + '…',
        '密文状态': 'Ciphertext'
      });
    }, 500);

    // 模拟司机移动到用户位置（3秒后）
    setTimeout(() => {
      setDriverCurrentPos(userLocation!);
      setBanner('② 接单阶段：司机已到达，请上车');
    }, 3000);
  };

  const toNavigate = () => {
    if (stage < 2) return;
    
    if (cipherTimerRef.current) { 
      clearInterval(cipherTimerRef.current); 
      cipherTimerRef.current = null; 
    }
    
    setPanelInput({ 
      '用户目的地坐标': `${destination![0].toFixed(6)}, ${destination![1].toFixed(6)}`
    });
    setPanelAlgo({ 
      '端侧路径规划': '离线或端到端加密',
      '导航算法': '本地路径计算'
    });
    setPanelOutput({ 
      '导航路径': '加密中间点序列',
      '路径状态': '端到端加密'
    });
    setPanelPlatform({ 
      '平台接收数据': '行程开始、结束标志 + 支付金额'
    });
    setBanner('③ 导航阶段：已上车，正在前往目的地');
    setStage(3);
    Modal.info({ 
      title: '③ 导航阶段：已上车', 
      content: '正在前往目的地，行程轨迹端侧加密处理，平台仅记录行程状态',
      centered: true 
    });
  };

  const toComplete = () => {
    if (stage < 3) return;
    
    setBanner('行程已完成');
    setStage(0);
    Modal.success({ 
      title: '行程已完成', 
      content: '感谢使用隐行出行，您的隐私得到全程保护',
      centered: true 
    });
    
    // 重置状态
    setUserLocation(null);
    setDestination(null);
    setSelectedDriver(null);
    setDriverCurrentPos(null);
    setOriginText('');
    setDestText('');
    setPanelInput({});
    setPanelAlgo({});
    setPanelOutput({});
    setPanelPlatform({});
    setMapCenter([40.000000, 116.330000]);
    setMapZoom(14);
  };

  useEffect(() => () => { if (cipherTimerRef.current) clearInterval(cipherTimerRef.current); }, []);

  return (
    <div className="w-full min-h-screen flex flex-col">
      {/* 顶部条 使用新配色 */}
      <div className="text-white px-4 py-3" style={{ background: 'linear-gradient(135deg, #345ea7 0%, #3c8ac4 100%)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="text-lg font-bold">隐行：基于位置隐匿查询的分段隐私保护系统</div>
          <div className="space-x-2">
            <Button size="small" type="primary" onClick={startOrder} disabled={stage > 0}>
              开始下单
            </Button>
            <Button size="small" onClick={toMatching} disabled={stage < 1}>
              派单中
            </Button>
            <Button size="small" onClick={toAccepted} disabled={stage < 1}>
              司机接单
            </Button>
            <Button size="small" onClick={toNavigate} disabled={stage < 2}>
              开始导航
            </Button>
            <Button size="small" danger onClick={toComplete} disabled={stage < 3}>
              结束行程
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto w-full p-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* 左侧表单 + 司机列表 */}
          <div className="lg:col-span-3 space-y-4">
            <Card bodyStyle={{ padding: 16, background: 'linear-gradient(135deg, #efdbcb 0%, #ffffff 100%)', border: 'none' }}>
              <div className="space-y-3">
                <Input prefix={<span className="text-gray-400">📍</span>} placeholder="请输入起点（示例：清华东门）" value={originText} onChange={e => setOriginText(e.target.value)} />
                <Input prefix={<span className="text-gray-400">🏁</span>} placeholder="请输入目的地（示例：中关村）" value={destText} onChange={e => setDestText(e.target.value)} />
                <Button 
                  type="primary" 
                  block 
                  style={{ background: 'linear-gradient(135deg, #4ab3df 0%, #3c8ac4 100%)', borderColor: '#4ab3df' }} 
                  onClick={startOrder}
                  loading={isLoading}
                  disabled={stage > 0}
                >
                  {isLoading ? '正在处理...' : '立即出发'}
                </Button>
              </div>
            </Card>
            <Card 
              title={<div className="font-semibold" style={{ color: '#345ea7' }}>寻找附近的司机 <span className="text-gray-400 text-xs ml-2">{stage < 2 ? '派单中' : '已接单'}</span></div>}
              bodyStyle={{ background: 'linear-gradient(135deg, #efdbcb 0%, #ffffff 100%)', border: 'none' }}
            >
              <div className="divide-y">
                {userLocation ? (
                  stage >= 2 ? (
                    // 司机接单后显示
                    <div className="py-3">
                      <div className="text-sm font-medium text-green-600">京B·xxxxx {selectedDriver?.name} 已接单</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {stage === 2 ? '正在向您全力赶来' : '正在前往目的地'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {stage === 2 
                          ? driverCurrentPos && userLocation
                            ? `距离${Math.round(distEta(userLocation, driverCurrentPos).meters)}m，预计需要${Math.round(distEta(userLocation, driverCurrentPos).etaMin)}分钟`
                            : '司机正在赶来...'
                          : destination && driverCurrentPos
                            ? `距离${Math.round(distEta(driverCurrentPos, destination).meters / 1000)}km，预计需要${Math.round(distEta(driverCurrentPos, destination).etaMin)}分钟`
                            : ''
                        }
                      </div>
                    </div>
                  ) : (
                    // 派单中显示所有司机
                    drivers.map((d, i) => {
                      const { meters, etaMin } = distEta(userLocation, d.pos);
                      return (
                        <div key={d.id} className="flex items-center justify-between py-3">
                          <div className="text-sm">京B·xxxxx {d.name}</div>
                          <div className="text-xs text-gray-500">{meters}m · {etaMin}分钟</div>
                        </div>
                      );
                    })
                  )
                ) : (
                  <div className="text-center text-gray-400 py-4">请先输入起点和目的地</div>
                )}
              </div>
            </Card>
          </div>

          {/* 中间地图 */}
          <div className="lg:col-span-6">
            {/* 顶部阶段显示信息 */}
            {banner && (
              <div className="mb-3">
                <Card size="small" bodyStyle={{ padding: 10, background: 'linear-gradient(135deg, #efdbcb 0%, #ffffff 100%)', border: 'none' }}>
                  <div className="text-sm" style={{ color: '#345ea7' }}>{banner} · 平台仅见：区域标识/密文；用户↔司机：端到端加密</div>
                </Card>
              </div>
            )}
            
            <Card bodyStyle={{ padding: 0, border: 'none', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ width: '100%', height: 600 }}>
                <MapContainer
                  center={mapCenter}
                  zoom={mapZoom}
                  style={{ height: '100%', width: '100%' }}
                  ref={mapRef}
                >
                  <MapCenter center={mapCenter} zoom={mapZoom} />
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  
                  {/* 用户位置标记（起点）- 使用新配色 */}
                  {userLocation && (
                    <Marker 
                      position={userLocation}
                      icon={createCustomIcon('#4ab3df', '起')}
                    >
                      <Popup>
                        <div>
                          <strong>起点</strong><br/>
                          {originText}<br/>
                          坐标: {userLocation[0].toFixed(6)}, {userLocation[1].toFixed(6)}
                        </div>
                      </Popup>
                    </Marker>
                  )}
                  
                  {/* 目的地标记（终点）- 使用新配色 */}
                  {destination && (
                    <Marker 
                      position={destination}
                      icon={createCustomIcon('#345ea7', '终')}
                    >
                      <Popup>
                        <div>
                          <strong>终点</strong><br/>
                          {destText}<br/>
                          坐标: {destination[0].toFixed(6)}, {destination[1].toFixed(6)}
                        </div>
                      </Popup>
                    </Marker>
                  )}
                  
                  {/* 模糊圆圈（阶段1） */}
                  {userLocation && stage >= 1 && stage < 2 && (
                    <Circle
                      center={userLocation}
                      radius={500}
                      pathOptions={{
                        color: '#4ab3df',
                        fillColor: '#4ab3df',
                        fillOpacity: 0.2,
                        weight: 2
                      }}
                    />
                  )}
                  
                  {/* 司机标记 - 根据阶段显示不同内容 */}
                  {userLocation && (
                    stage >= 2 ? (
                      // 司机接单后：只显示接单司机
                      driverCurrentPos && (
                        <Marker 
                          position={driverCurrentPos}
                          icon={createCustomIcon('#3c8ac4', '🚗')}
                        >
                          <Popup>
                            <div>
                              <strong>{selectedDriver?.name} 已接单</strong><br/>
                              京B·xxxxx<br/>
                              {stage === 2 ? '正在赶来' : '正在导航'}
                            </div>
                          </Popup>
                        </Marker>
                      )
                    ) : (
                      // 派单中：显示所有司机，使用新配色
                      drivers.map((driver) => (
                        <Marker 
                          key={driver.id} 
                          position={driver.pos}
                          icon={createCustomIcon('#efdbcb', '🚗')}
                        >
                          <Popup>
                            <div>
                              <strong>{driver.name}</strong><br/>
                              京B·xxxxx<br/>
                              距离: {Math.round(distEta(userLocation, driver.pos).meters)}m<br/>
                              预计: {Math.round(distEta(userLocation, driver.pos).etaMin)}分钟
                            </div>
                          </Popup>
                        </Marker>
                      ))
                    )
                  )}
                  
                  {/* 司机接单后与用户位置的连线（阶段2） */}
                  {userLocation && driverCurrentPos && stage >= 2 && stage < 3 && (
                    <Polyline
                      positions={[driverCurrentPos, userLocation]}
                      pathOptions={{
                        color: '#4ab3df',
                        weight: 3,
                        opacity: 0.8,
                        dashArray: '10, 5'
                      }}
                    />
                  )}
                  
                  {/* 导航路径（阶段3） */}
                  {userLocation && destination && stage >= 3 && (
                    <Polyline
                      positions={[userLocation, destination]}
                      pathOptions={{
                        color: '#3c8ac4',
                        weight: 5,
                        opacity: 0.8
                      }}
                    />
                  )}
                </MapContainer>
              </div>
            </Card>
          </div>

          {/* 右侧四卡片 */}
          <div className="lg:col-span-3 space-y-3">
            <Card 
              title={<span style={{ color: '#345ea7', fontWeight: 'bold' }}>输入数据</span>}
              bodyStyle={{ background: 'linear-gradient(135deg, #efdbcb 0%, #ffffff 100%)', border: 'none' }}
            >
              <KV data={panelInput} />
            </Card>
            <Card 
              title={<span style={{ color: '#345ea7', fontWeight: 'bold' }}>使用算法</span>}
              bodyStyle={{ background: 'linear-gradient(135deg, #efdbcb 0%, #ffffff 100%)', border: 'none' }}
            >
              <KV data={panelAlgo} />
            </Card>
            <Card 
              title={<span style={{ color: '#345ea7', fontWeight: 'bold' }}>输出数据</span>}
              bodyStyle={{ background: 'linear-gradient(135deg, #efdbcb 0%, #ffffff 100%)', border: 'none' }}
            >
              <KV data={panelOutput} />
            </Card>
            <Card 
              title={<span style={{ color: '#345ea7', fontWeight: 'bold' }}>平台接收数据</span>}
              bodyStyle={{ background: 'linear-gradient(135deg, #efdbcb 0%, #ffffff 100%)', border: 'none' }}
            >
              <KV data={panelPlatform} />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ data }: { data: Record<string, string> }) {
  const entries = useMemo(() => Object.entries(data || {}), [data]);
  if (!entries.length) return <div className="text-sm text-gray-400">—</div>;
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex text-sm">
          <span className="w-28 text-gray-500 mr-2">{k}：</span>
          <span className="flex-1 break-all text-gray-800">{v}</span>
        </div>
      ))}
    </div>
  );
}

function randomHex(n: number) {
  const chars = 'abcdef0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}