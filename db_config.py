import getpass
import os
from typing import Any, Dict, Optional

import pymysql
from pymysql.cursors import DictCursor


def connection_config(database: Optional[str] = None) -> Dict[str, Any]:
    config: Dict[str, Any] = {
        "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("MYSQL_USER", "nonfor"),
        "password": os.getenv("MYSQL_PASSWORD", "523399"),
        "charset": "utf8mb4",
        "cursorclass": DictCursor,
        "autocommit": False,
    }
    if database is not None:
        config["database"] = database
    return config


def connect_mysql(require_database: bool = True, interactive: bool = True):
    database = os.getenv("MYSQL_DATABASE", "wechat_course_design") if require_database else None
    config = connection_config(database)
    try:
        return pymysql.connect(**config)
    except pymysql.MySQLError as first_error:
        if not interactive:
            raise
        print("默认 MySQL 连接失败。本系统强制使用 MySQL，请确认 MySQL 服务已启动。")
        print(f"原因：{first_error}")
        print("请按你的本机 MySQL 配置重新输入，直接回车表示使用括号内默认值。")
        config["host"] = input(f"主机 [{config['host']}]: ").strip() or config["host"]
        raw_port = input(f"端口 [{config['port']}]: ").strip()
        if raw_port:
            config["port"] = int(raw_port)
        config["user"] = input(f"用户名 [{config['user']}]: ").strip() or config["user"]
        config["password"] = getpass.getpass("密码: ")
        if require_database:
            config["database"] = input(
                f"数据库 [{config.get('database', 'wechat_course_design')}]: "
            ).strip() or config.get("database", "wechat_course_design")
        return pymysql.connect(**config)
