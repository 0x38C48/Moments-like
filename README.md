# Moments-like 微信式个人资料与聊天记录管理系统

这是一个数据库课程设计项目，采用前后端分离结构：

- 后端：Python Flask + PyMySQL
- 前端：HTML + CSS + JavaScript
- 数据库：MySQL，强制使用 MySQL，不使用 SQLite 或其他数据库

系统覆盖个人基本资料、好友关系、朋友权限、私聊/群聊、聊天记录、朋友圈、点赞评论、统计报表等模块。
朋友圈模块支持本地图片上传，图片会保存到后端 `backend/uploads` 目录，并通过 MySQL 的 `moment_media` 表关联到朋友圈动态。

## 默认 MySQL 配置

项目已按要求固定为：

```text
host=127.0.0.1
port=3306
user=nonfor
password=523399
database=wechat_course_design
```

正常情况下不需要每次输入用户名和密码。若要临时覆盖，可设置环境变量 `MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。

## 目录结构

```text
wechat_profile_chat_system/
  backend/api_server.py   Flask 后端 API
  frontend/index.html     前端页面
  frontend/styles.css     前端样式
  frontend/app.js         前端交互逻辑
  app.py                  Python 控制台版本
  db_config.py            MySQL 连接配置
  setup_db.py             执行 MySQL 建库建表脚本
  seed_data.py            生成演示数据
  sql/01_schema_mysql.sql MySQL 表、约束、索引、视图、触发器、存储过程
  docs/design.md          需求分析、模块设计、ER 图、报告说明
```

## 初始化

```powershell
cd .\wechat_profile_chat_system
pip install -r requirements.txt
python setup_db.py
python seed_data.py
```

种子数据会生成：

- 36 个用户
- 72 条朋友圈
- 36 个好友标签
- 36 个会话
- 260 条好友关系
- 超过 280 条聊天消息
- 超过 280 条点赞评论关系

演示账号：

```text
微信号：u001
密码：123456
```

## 启动前后端

启动后端 API：

```powershell
python backend\api_server.py
```

后端地址：

```text
http://127.0.0.1:5000/api
```

打开前端页面：

```text
frontend/index.html
```

如果浏览器拦截本地文件请求，也可以启动一个静态文件服务：

```powershell
python -m http.server 8000 -d frontend
```

然后访问：

```text
http://127.0.0.1:8000
```

## 课堂演示流程

1. 登录 `u001 / 123456`。
2. 查看并修改个人资料。
3. 搜索用户并发起好友申请。
4. 查看好友列表并切换朋友权限。
5. 创建私聊会话。
6. 发送消息并检索聊天记录。
7. 发布朋友圈。
8. 上传并显示朋友圈图片。
9. 点赞和评论朋友圈。
10. 展示统计报表：消息量排行、朋友圈互动排行、朋友权限统计、会话活跃度。

## 评分点覆盖

- 数据表远超 5 个。
- 有完整需求分析、模块设计、ER 图和关系模式说明。
- MySQL 使用主键、外键、唯一约束、检查约束、索引。
- MySQL 使用视图、触发器、存储过程。
- 演示数据满足“实体数据不少于 30 条，关联关系数据不少于 200 条”。
- 前后端分离，演示界面比纯控制台更直观。
