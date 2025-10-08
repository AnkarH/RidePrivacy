# 隐行出行演示系统

基于位置隐匿查询的分段隐私保护网约车演示系统

## 项目简介

隐行出行演示系统展示了在网约车场景下如何通过三阶段隐私保护流程来保护用户位置隐私：

1. **下单阶段**：模糊位置匹配，平台仅获取区域标识
2. **接单阶段**：点对点加密定位，司机获取精确位置
3. **导航阶段**：端到端路径规划，平台不记录完整轨迹

## 核心特性

- **三阶段隐私保护**：分阶段逐步揭示位置信息
- **自适应区域粒度**：根据司机密度动态调整模糊化精度
- **端到端加密**：用户与司机间直接加密通信
- **本地化导航**：行程轨迹在端侧处理
- **可视化演示**：直观展示隐私保护效果

## 技术架构

### 前端技术栈
- **React 18** + **Vite** - 现代化前端框架
- **Leaflet** - 开源地图库（无需API Key）
- **Ant Design** - UI组件库
- **TailwindCSS** - 样式框架
- **h3-js** - H3地理编码库

### 后端技术栈
- **Node.js** + **Express** - 服务器框架
- **Socket.io** - WebSocket实时通信
- **h3-js** - H3地理编码算法
- **crypto** - Node.js内置加密模块

## 快速开始

### 环境要求
- Node.js 16+
- npm 或 yarn

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
# 同时启动前后端
npm run dev:full

# 或分别启动
npm run server  # 后端
npm run dev     # 前端
```

### 访问应用
打开浏览器访问：`http://localhost:5175`

## 演示流程

### 1. 下单阶段（模糊匹配）
- 用户输入起点和目的地
- 系统计算H3区域编码
- 平台仅接收区域标识，无法获取精确坐标
- 地图显示模糊圆圈表示隐私保护区域

### 2. 接单阶段（点对点加密）
- 司机接单后触发密钥协商
- 用户坐标通过端到端加密传输
- 平台仅转发密文，无法解密
- 司机解密获得精确位置

### 3. 导航阶段（本地路径规划）
- 司机端执行本地路径规划
- 实时位置同步采用端到端加密
- 平台仅接收行程状态和支付信息
- 完整轨迹在端侧处理

## 项目结构

```
ride-privacy-demo/
├── src/                          # 前端源码
│   ├── components/
│   │   └── RidePrivacyDemo.tsx   # 主演示组件
│   ├── App.tsx                   # 应用入口
│   ├── main.tsx                  # 主入口文件
│   └── index.css                 # 样式文件
├── server/
│   └── index.js                  # 后端服务器
├── data/
│   └── drivers.json              # 司机数据（自动生成）
├── package.json                  # 项目配置
└── README.md                     # 项目文档
```

## 核心算法

### H3地理编码
```javascript
// 自适应分辨率计算
const resolution = calculateAdaptiveResolution(lat, lon, drivers);
const h3Index = h3.latLngToCell(lat, lon, resolution);
```

### 加密桶生成
```javascript
// 基于LSH签名生成加密桶
const signatures = generateLSHSignatures(h3Index, 4);
const buckets = generateEncryptedBuckets(signatures);
```

### 点对点加密
```javascript
// ECDH密钥协商
const keyPair = generateKeyPair();
const sharedSecret = deriveSharedSecret(privateKey, publicKey);
const encrypted = encrypt(coordinates, sharedSecret);
```

## API接口

### REST API
- `POST /api/order` - 创建订单
- `GET /api/drivers` - 获取司机列表
- `POST /api/match` - 执行匹配

### WebSocket事件
- `order:created` - 订单创建
- `order:accept` - 司机接单
- `p2p:keyExchange` - 密钥交换
- `p2p:encryptedCoords` - 加密坐标传输

## 演示说明

### 操作步骤
1. 输入起点和目的地
2. 点击"立即出发"开始下单
3. 点击"派单中"查看匹配过程
4. 点击"司机接单"进入加密阶段
5. 点击"开始导航"查看路径规划
6. 点击"结束行程"完成演示

### 关键展示点
- **隐私保护**：平台无法获取用户精确位置
- **端到端加密**：用户与司机直接安全通信
- **本地化处理**：导航轨迹在端侧处理
- **自适应粒度**：根据密度调整模糊化精度

## 开发说明

### 环境变量
项目使用环境变量配置，但当前版本使用Leaflet地图无需API Key。

### 扩展开发
- 替换为真实同态加密算法
- 集成安全多方计算协议
- 优化匹配算法性能
- 增加更多隐私保护机制

### 注意事项
- 当前为演示版本，使用模拟加密算法
- 生产环境需要替换为真实加密实现
- 司机数据为模拟生成，实际应用需要真实数据源

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request来改进这个演示系统。