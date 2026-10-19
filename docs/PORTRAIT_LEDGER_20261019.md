# 人物肖像素材台账（VIS02）— 2026-10-19

> 依据《AIBIGPLAYER_V2_人物肖像卡与研读体验升级_TODO_20261019.md》VIS02 / §3.4
> 口径：**公开可见 ≠ 可任意使用**。每条记录都来自 Wikimedia Commons API 的 `imageinfo.extmetadata`，
> 许可、年代、作者取自平台返回值，不凭记忆填写。
> 机器可读镜像：`site/data/portraits.json`（字段见 §5）

## 1. 总览

| cardId | 人物 | 状态 | 许可 | 原始年代 | 母版尺寸 | 输出 | 审校 |
|---|---|---|---|---|---|---|---|
| mao | 毛泽东 | ✅ 已制作 | Public domain | 1950-11-10 | 673×908 | `mao.webp` 131KB | 待编辑审校 |
| zhou | 周恩来 | ✅ 已制作 | Public domain | 1972-02-21 | 717×961 | `zhou.webp` 80KB | 待编辑审校 |
| zhu | 朱德 | ✅ 已制作 | Public domain | 1955（元帅服） | 830×1097 | `zhu.webp` 56KB | 待编辑审校 |
| chen | 陈云 | ✅ 已制作 | Public domain | 早于 1960 | 500×688 | `chen.webp` 56KB | 待编辑审校 |
| deng | 邓小平 | ✅ 已制作 | Public domain | 1970s 末 | 799×1065 | `deng.webp` 116KB | 待编辑审校 |
| liu | 刘少奇 | ⛔ 素材待补 | — | — | — | 姓名占位 | **blocked** |

**5/6 已具备正式肖像，1/6 缺失。** 按 VIS02「未核实素材不得标记 approved」，全部记录为
`reviewStatus = pending_editorial_review`，刘少奇为 `blocked_missing_material`。

## 2. 逐条记录（来源可点击核对）

| cardId | Commons 文件 | 原始日期 | 许可 |
|---|---|---|---|
| mao | [File:Mao Zedong 1950 Portrait (3x4 cropped)(2).jpg](https://commons.wikimedia.org/wiki/File:Mao_Zedong_1950_Portrait_(3x4_cropped)(2).jpg) | 1950-11-10 | Public domain |
| zhou | [File:Premier Chou En-Lai in the Great Hall of the People's Banquet Hall - DPLA](https://commons.wikimedia.org/wiki/File:Premier_Chou_En-Lai_in_the_Great_Hall_of_the_People%27s_Banquet_Hall_-_DPLA_-_a40021a8100507bc7a244420481bf488.jpg) | 1972-02-21 | Public domain |
| zhu | [File:Zhu De, Commander of PLA.jpg](https://commons.wikimedia.org/wiki/File:Zhu_De,_Commander_of_PLA.jpg) | 1955 | Public domain |
| chen | [File:陈云标准像.jpg](https://commons.wikimedia.org/wiki/File:%E9%99%88%E4%BA%91%E6%A0%87%E5%87%86%E5%83%8F.jpg) | 早于 1960 | Public domain |
| deng | [File:Deng Xiaoping at the arrival ceremony for the Vice Premier of China (cropped).jpg](https://commons.wikimedia.org/wiki/File:Deng_Xiaoping_at_the_arrival_ceremony_for_the_Vice_Premier_of_China_(cropped).jpg) | 1970s 末 | Public domain |

完整字段（含 `downloadUrl`、`artist`、`credit`、sha256、字节数）在 `site/data/portraits.json`，
原始 API 返回留档在 `assets_src/portraits/_records.json`。

## 3. 处理方式（可复现）

```
grayscale → autocontrast(cutoff=1) → UnsharpMask(1.7, 120%, 3)
→ 5 级色调分离(MEDIANCUT) → 双色映射
   纸色 #F5EFE3；墨色按卡：朱砂(176,58,46) / 青灰(74,94,102) / 赭石(150,100,62)
                          墨绿(58,84,66) / 靛蓝(46,74,120)
→ 750×1000 → WebP q82（>250KB 时降到 q66）
```

- 脚本：`_diag/portrait_process.py`（生成）+ 迭代裁切脚本（记录在 WORKLOG）
- **这不是 AI 生成图**：全部为公共领域历史照片的**程序化双色处理**，无生成模型参与，
  因此不存在"AI 编造面容"的风险；卡片中会标注"人物插画（基于历史照片）"。
- 裁切为逐张人工判定（不是自动裁脸）：周恩来 1972 那张原始为半身侧脸、邓小平那张原始右侧有第二个人，
  两处都靠显式裁切框避开，参数写在脚本里。

## 4. 必须让编辑拍板的三件事

1. **刘少奇缺肖像**：Commons 检索到的候选要么是全家福（1948）、会场讲话（1959 带话筒与他人）、
   要么是低分辨率/非 PD。当前用姓名占位；正式交付前需要：另找可核实来源，或改用出版社授权图，
   或把他改为"待开放"不做首屏卡。
2. **周恩来（1972）与邓小平（1970s 末）年代晚于其他三人（1950—1955）**：
   TODO §3.4 要求"不混搭显著不同时期的造型"。跨卡年代跨度是否可接受，需要内容编辑决定；
   若能提供 1950s 的高质量 PD 周恩来/邓小平肖像，我重做这两张。
3. **背景纹样**：当前保留原照片背景（窗帘、墙面、军装），TODO §3.1 要求"背景纹样围绕调查/协作/求证…表达"。
   建议把纹样做成卡面的 CSS/SVG 图层叠加，而不是烧进肖像图——这样六卡统一、可换主题、也不篡改照片。

## 5. 数据契约（与 TODO §5 对齐）

`site/data/portraits.json` 的每个资产含：
`assetId / personId / src / fallbackSrc / width / height / alt / sourceType / sourceRefs{commonsTitle, commonsPage, licenseShort, licenseUrl, dateOriginal, artist, credit} / rightsStatus / reviewStatus / assetVersion / processing{pipeline, tool, webpBytes, sha256_16} / notes`

`rightsStatus` 取值：`public_domain_verified_via_commons_api` | `not_found_yet`
`reviewStatus` 取值：`pending_editorial_review` | `blocked_missing_material`（**没有 `approved`**——审校还没做）

## 6. 回滚

资产是纯静态文件，删除 `site/assets/portraits/*.webp` 与 `site/data/portraits.json` 即回到无肖像状态；
不影响任何用户数据。
