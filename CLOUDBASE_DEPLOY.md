# CloudBase 部署说明

`cloudbaserc.json` 是本项目的 CloudBase 部署清单，包含 `records`、`userMeta` 集合和同步查询所需的索引。首次部署或索引变更后，在项目根目录执行：

```sh
cloudbase framework deploy
```

部署前需要使用 CloudBase CLI 登录，并确认目标环境为 `cloud1-9gvo70lwa48bb03a`。该命令只负责集合和索引；仍需在微信开发者工具中将 `syncRecords`、`login` 云函数上传并部署到同一环境。

索引变更会影响写入性能，应只保留本文件中与实际查询对应的索引。部署完成后，在 CloudBase 控制台的文档型数据库“索引管理”中核对索引状态为“已就绪”。若集合已存在，先在测试环境验证 `createIndexes` 的创建结果再部署生产环境。
