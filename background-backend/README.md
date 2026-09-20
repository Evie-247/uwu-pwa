# UwU Background Push Backend

这个后台只接管“PWA 被 iOS 挂起以后无法继续运行”的部分：保存必要角色状态、随机候选时刻、让角色二次判断是否真的想发、生成主动消息、Web Push、待 PWA 再打开时同步回原聊天记录。

它不会按 scheduler 的频率强制发消息。`SCHEDULER_INTERVAL_MS` 只是服务器醒来检查到期任务的频率。

## 运行前
1. PostgreSQL 建库，执行 `sql/schema.sql`（服务启动也会自动建表）。
2. `npm install`
3. `npm run vapid`，把两条 key 写入 `.env`
4. 复制 `.env.example` 为 `.env`，填写数据库、GitHub Pages Origin、AI API、VAPID。
5. `npm start`
6. 将网页 `js/push_backend_config.js` 的 `enabled` 改为 `true`，填写 HTTPS 后台 URL 与相同的 `CLIENT_TOKEN`。

## 重要
- `AI_API_KEY` 与 `VAPID_PRIVATE_KEY` 只放后台环境变量，绝对不要提交到 GitHub Pages。
- 正式部署必须 HTTPS。
- iOS Web Push 要从主屏幕安装 PWA，并由用户授权通知。
