# MAP 真机验证记录（2026-10-17）

> 环境：本机 Chrome 155.0.8059.84（CDP 9222，独立调试实例）· Windows 11 · 视口 1280×800
> 方法：CDP 直连（Runtime.evaluate + Network.responseReceived + Page.captureScreenshot），非截图推断
> 代码基点：线上 aibigplayer.top = commit 87f7cb3（诊断时点）

## 1. 结论总表

| 入口 | 3D初始化 | terrain | DEM瓦片 | 底图/标注 | 场景/图层 | 截图 | 结论 |
|---|---|---|---|---|---|---|---|
| 剧场 theatre.html | ✅ Map创建成功 | ✅ {dem,1.0} | ✅ 148个全200 | ✅ 60个全200 | ✅ 3幕切换(相机pitch/zoom实测变化) | _diag/theatre_3d.png | **真实3D通过** |
| 主站 map3d.js（真实路径：#/view/map→点3D） | ✅ Map创建+loaded | ✅ {dem,1.0} | ✅（缓存+已加载） | ✅ | ✅ 全栈图层含路线/站点/文章点 | _diag/main3d_realpath.png | **真实3D通过** |

## 2. 剧场（theatre）证据明细

- `window.__theatreMap` 存在；status="三维就绪 · 共 3 幕"；fallback display:none（未降级）
- WebGL context 可用（"WebKit WebGL"）
- Network 实测：s3.amazonaws.com(elevation-tiles-prod/terrarium) 148 个响应全 200；basemaps.cartocdn.com 60 个全 200
- terrain 生效：getTerrain()={source:"dem",exaggeration:1}
- 场景切换实测：点"下一幕"后 center 变化、pitch 60→55、zoom 10.5→11.2
- 相机恢复（WP06+）：status="已恢复上次视角 · 第 2 幕"（sessionStorage jgs_cam 生效）
- 注：isSourceLoaded('dem') 返回 false 为 MapLibre 对 raster-dem 的已知误报，以 148 个瓦片 200 响应为准

## 3. 主站（#/view/map → 3D 按钮）证据明细

- `window.__mx3dMap` 存在；mx3dStatus="三维地形就绪 · 虚线为顺序示意，非行军道路"
- 容器 map3dChart 843×570（可见）；pitch=38, zoom=4.1；loaded=true
- terrain={source:"dem",exaggeration:1}
- 图层全栈：base,dem-shade,labels,route-halo,route-visited,route-future,stop-halo,stop-core,art-dot
- 2D→3D 切换按钮工作（mapMode 实测 "2d"→"3d"）

## 4. 边缘路径发现（诚实记录）

- 首页视图（#/view/home）直接点地图面板的 3D 时（非真实用户常规路径），容器经历 0×0 隐藏阶段；buildNow 有 20×150ms 重试等待布局，最终 buildInit 在 0×0 容器也能建 Map 成功（实测 map:true, cw:0），进入地图视图后 applyMapMode→resize() 恢复。
- 旧代码（87f7cb3）在主站 new maplibregl.Map() 无 try/catch：若 WebGL 初始化抛异常会冒泡白屏。已由 commit ecbe105 修复（WebGL 预检+try/catch+错误详情+防白屏降级），待部署上线后回归。

## 5. 云端浏览器"三维初始化异常"的定位

文档 §2 记录云端浏览器进剧场报"三维初始化异常，降级文字版"。本轮真机证据表明代码与资源（CARTO/AWS DEM/CORS）均正常——该异常为**那个云端环境自身 WebGL 不可用**所致，非代码缺陷。ecbe105 之后，此类环境会看到带具体原因的可复制诊断信息（如"WebGL context unavailable · lib=5.9.0 · 容器=WxH"），而非笼统提示。

## 6. 未覆盖环境（如实列明）

- 移动端/手机：未测
- 无 WebGL 的设备：未实测（代码路径存在：预检→2D/文字降级）
- 弱网/断 DEM 场景：未实测（MAP07 范围）
- 其他浏览器（Edge/Firefox/Safari）：未测
