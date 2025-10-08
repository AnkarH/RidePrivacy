const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const h3 = require('h3-js');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// 加载或生成司机数据
const dataFile = path.join(__dirname, '../data/drivers.json');
let driversData;
try {
  const raw = fs.readFileSync(dataFile, 'utf8');
  driversData = JSON.parse(raw);
} catch (e) {
  console.log('未找到司机数据，自动生成...');
  const { randomBytes } = crypto;
  const centerLat = 40.0;
  const centerLon = 116.33;
  const radius = 0.01;
  const tmp = [];
  for (let i = 1; i <= 20; i++) {
    const lat = centerLat + (Math.random() - 0.5) * radius;
    const lon = centerLon + (Math.random() - 0.5) * radius;
    const h3Cell = h3.latLngToCell(lat, lon, 7);
    const encryptedBuckets = [0,1,2].map(() => randomBytes(16).toString('hex'));
    tmp.push({ id: `d-${i}`, lat: +lat.toFixed(6), lon: +lon.toFixed(6), h3Cell, encryptedBuckets, status: 'available' });
  }
  driversData = tmp;
  fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(driversData, null, 2));
}

// 内存存储
let orders = new Map();
let activeConnections = new Map();

// 隐私算法工具函数
class PrivacyUtils {
  // TODO: replace with real Homomorphic / MPC implementation in Phase 2
  static generateLSHSignatures(h3Index, count = 4) {
    const signatures = [];
    for (let i = 0; i < count; i++) {
      const salt = `salt_${i}_${Date.now()}`;
      const signature = crypto.createHash('sha256')
        .update(h3Index + salt)
        .digest('hex')
        .substring(0, 16);
      signatures.push(signature);
    }
    return signatures;
  }

  static generateEncryptedBuckets(signatures, secret = 'demo_secret') {
    return signatures.map(sig => 
      crypto.createHash('sha256')
        .update(sig + secret)
        .digest('hex')
        .substring(0, 32)
    );
  }

  static calculateAdaptiveResolution(lat, lon, drivers) {
    // 计算司机密度来决定H3分辨率
    const nearbyDrivers = drivers.filter(driver => {
      const distance = h3.distance(h3.latLngToCell(lat, lon, 9), driver.h3Cell);
      return distance <= 3; // 附近3个格子内的司机
    });
    
    const density = nearbyDrivers.length;
    if (density > 50) return 9; // 高密度区域，精确匹配
    if (density > 10) return 7; // 中等密度
    return 5; // 低密度区域，模糊匹配
  }
}

// API 路由
app.post('/api/order', (req, res) => {
  const { orderId, userPublicId, lat, lon, destination } = req.body;
  
  // 计算自适应分辨率
  const resolution = PrivacyUtils.calculateAdaptiveResolution(lat, lon, driversData);
  const h3Index = h3.latLngToCell(lat, lon, resolution);
  
  // 生成LSH签名和加密桶
  const lshSignatures = PrivacyUtils.generateLSHSignatures(h3Index);
  const encryptedBuckets = PrivacyUtils.generateEncryptedBuckets(lshSignatures);
  
  // 保存订单信息
  const order = {
    orderId,
    userPublicId,
    lat,
    lon,
    destination,
    h3Index,
    lshSignatures,
    encryptedBuckets,
    resolution,
    status: 'pending',
    timestamp: Date.now()
  };
  
  orders.set(orderId, order);
  
  // 通知所有司机有新的订单
  io.emit('order:created', {
    orderId,
    h3Index,
    encryptedBuckets,
    resolution,
    meta: { poi: "清华东门" } // 演示用POI
  });
  
  res.json({
    status: 'ok',
    orderId,
    h3Index,
    resolution,
    encryptedBuckets
  });
});

app.get('/api/drivers', (req, res) => {
  res.json(driversData);
});

app.post('/api/match', (req, res) => {
  const { orderId } = req.body;
  const order = orders.get(orderId);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  // 基于加密桶交集进行匹配
  const candidates = driversData.filter(driver => {
    const userBuckets = new Set(order.encryptedBuckets);
    const driverBuckets = new Set(driver.encryptedBuckets);
    const intersection = [...userBuckets].filter(bucket => driverBuckets.has(bucket));
    return intersection.length > 0;
  });
  
  // 按交集数量排序
  candidates.sort((a, b) => {
    const aIntersection = [...new Set(order.encryptedBuckets)].filter(bucket => 
      new Set(a.encryptedBuckets).has(bucket)
    ).length;
    const bIntersection = [...new Set(order.encryptedBuckets)].filter(bucket => 
      new Set(b.encryptedBuckets).has(bucket)
    ).length;
    return bIntersection - aIntersection;
  });
  
  res.json({
    candidates: candidates.map(d => ({
      id: d.id,
      maskedId: d.id.replace(/\d/g, '*'),
      lat: d.lat,
      lon: d.lon,
      intersectionCount: [...new Set(order.encryptedBuckets)].filter(bucket => 
        new Set(d.encryptedBuckets).has(bucket)
      ).length
    })),
    debug: {
      totalDrivers: driversData.length,
      intersectionCount: candidates.length
    }
  });
});

// WebSocket 连接处理
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  activeConnections.set(socket.id, { socket, type: 'unknown' });
  
  socket.on('register', (data) => {
    activeConnections.set(socket.id, { 
      socket, 
      type: data.type, 
      id: data.id 
    });
    console.log(`${data.type} 注册:`, data.id);
  });
  
  socket.on('order:accept', (data) => {
    const { orderId, driverId } = data;
    const order = orders.get(orderId);
    
    if (order) {
      order.status = 'accepted';
      order.driverId = driverId;
      
      // 通知用户司机已接单
      io.emit('order:accepted', { orderId, driverId });
      
      // 触发密钥交换
      socket.emit('p2p:initiateKeyExchange', { orderId });
    }
  });
  
  socket.on('p2p:keyExchange', (data) => {
    // 转发密钥交换信息
    io.emit('p2p:keyExchange', data);
  });
  
  socket.on('p2p:encryptedCoords', (data) => {
    // 转发加密坐标信息
    io.emit('p2p:encryptedCoords', data);
  });
  
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    activeConnections.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

