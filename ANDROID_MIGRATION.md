# 物流QC Android 迁移说明

## 迁移范围

原微信小程序的核心页面已经迁移为原生 Android 单 Activity 应用：

- 首页：日期切换、快捷日期、当日汇总、柱状图、新增记录、线路/车牌字典维护、线路汇总
- 历史：关键词搜索、日期筛选、分日期展示、编辑、删除、CSV 导出、JSON 备份、JSON 导入
- 统计：月度/年度切换、线路筛选、上/下周期、当前周期、汇总图表、趋势明细
- 设置：深色主题、本地同步状态说明、全量数据操作、清空数据

## Android 技术实现

- 语言：Java
- UI：原生 Android View，不依赖 AndroidX 或第三方库
- 数据：SQLiteOpenHelper，本地优先保存
- 导入导出：系统文件选择器，支持 CSV 和 JSON
- 主题：SharedPreferences 保存深色主题设置

## 数据兼容

Android 版沿用小程序字段：

- `date`
- `routeName`
- `plateNumber`
- `sendBlueOut`
- `sendRedOut`
- `blueOut`
- `blueIn`
- `redOut`
- `redIn`
- `remark`
- `createTime`
- `updatedAt`
- `deletedAt`
- `synced`

JSON 备份兼容小程序常见结构：`version`、`timestamp`、`records`、`routes`、`plates`、`routesMeta`、`platesMeta`。

## 云同步说明

微信云开发云函数不能被原生 Android 直接复用。当前 Android 版保留了 `synced`、`updatedAt`、`deletedAt` 等同步字段，并在设置页展示本地同步状态。后续可以把 `login`、`syncRecords` 迁移为 HTTP 服务后，在 `QcRepository` 上增加远端同步实现。

## 验证记录

已完成：

- `javac` 编译全部 Java 源码通过
- `aapt2 compile` 编译资源通过
- `aapt2 link` 链接 Manifest 与资源通过

Gradle 完整 assemble 曾进入 Android 编译阶段，但当前环境提权额度限制阻止继续访问 `~/.gradle` 缓存；项目配置已调整为本机可离线解析的 Groovy Gradle + AGP 8.13.2。
