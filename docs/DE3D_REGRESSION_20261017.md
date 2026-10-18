# P01 去 3D 回归记录与服务停用清单（2026-10-17）

> commit：c9377f1（P01 代码退出）· 基线 tag：de3d-baseline（af8f3ca）
> 验证：本机 Chrome 155 CDP 直连 + 本地 8000 实测

## 1. 退出范围（已实施）

| 项 | 处置 |
|---|---|
| 首页/导航 3D剧场按钮 | ✅ 删除（导航剩：研读/目录/舆图/年谱/图谱/AI研究室） |
| 三维地形切换按钮（data-mm） | ✅ 删除 |
| map3dChart / mx3dStatus / mx3dFollow DOM | ✅ 删除 |
| app.js 3D bridge（ensureMap3d/loadMap3dModule/mx3dFail/__MX3D__/applyMapMode/setMapMode） | ✅ 删除 |
| state.mapMode / histPlay 3D 分支 / map3d_* 事件字典 | ✅ 删除 |
| map3d.js / map3d.html / maplibre-gl.js/css / terrain-test.html | ✅ 删除（-1492 行） |
| theatre.html | ✅ 改为迁移说明页（保留文章深链提示） |
| 文章「返回剧场」按钮 | ✅ 改为来源感知「返回」（research referrer 或目录） |
| 宣传文案「地形舆图/真实地形/落于真实地形」 | ✅ 改为「舆图/山川舆图」 |
| 3D CSS 死代码 | ✅ 删除 |
| sw.js 缓存 | ✅ mx-v5 → mx-v6（驱逐旧 shell） |
| CI map3d.js 硬编码 | ✅ 从语法检查列表移除 |
| AMap key/secret | ✅ 前端零残留（grep 校验） |

## 2. 回归验证（真机）

| 页面 | 3D请求 | JS错误 | 结论 |
|---|---|---|---|
| 首页 | 0（清SW后） | 0 | ✅ 导航6项正常、2D Leaflet 正常（hasMapChart、hasLeaflet=true）、4 张 homeCard |
| 剧场迁移页 | 0 | 0（仅 favicon 404，无害） | ✅ 迁移说明正常显示 |
| AI研究室 | 0 | 0 | ✅ |
| 文章深链 #/art/ | — | — | 保留（CI 旧URL检查通过） |

**诚实记录**：首次回归曾观察到 13 个「3D词」请求 + 1 个 `LngLat(NaN,NaN)` 异常，深挖后定位为**旧 Service Worker（mx-v5）缓存 serve 了旧版 app.js**（旧 3D 代码在 DOM 已删后跑出 NaN）。SW 升级 mx-v6 后新标签页复测 = 0 请求 0 异常，自我修正。旧访客首次加载可能短暂受旧缓存影响，SW activate 后即恢复。

## 3. 服务停用清单（P01.5）

| 服务 | 状态 | 处置 |
|---|---|---|
| 高德 JS API（key 55db0e…） | 前端不再引用 | ⚠️ **待账号持有人**在高德控制台停用/撤销（本环境无控制台权限，未操作） |
| 高德 DEM（restapi.amap.com/rest/lbs/dem） | 不再请求 | 随 key 停用 |
| AWS elevation-tiles-prod（terrarium DEM） | 不再请求 | 无账号操作，无需处置 |
| CARTO basemaps（basemaps.cartocdn.com） | 不再请求 | 无账号操作，无需处置 |

2D 地图继续使用本地瓦片（assets/tiles/）+ Leaflet，无外部地图服务依赖。

## 4. 用户数据保护（P01.4）

- 仅清理废弃 `mx_mapmode`（localStorage.removeItem，精确 key）
- **未动**：mx_marks（收藏）、mx_read（阅读记录）、mx_recent（最近）、mx_research_cards（研究卡）
- 未使用 localStorage.clear()
- jgs_scene / jgs_cam 为 sessionStorage，会话结束自动失效，无需主动处理

## 5. M1 里程碑状态

M1「收敛产品」= P01 + P02。P01 已完成（退出无残留、旧链接兼容、主要功能可用）。P02（五项导航统一 + 首页开始/继续）待执行。
