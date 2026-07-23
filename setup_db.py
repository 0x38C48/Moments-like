from pathlib import Path
from typing import List

from db_config import connect_mysql


def split_mysql_script(sql: str) -> List[str]:
    statements: List[str] = []
    delimiter = ";"
    buffer: List[str] = []

    for raw_line in sql.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            buffer.append(line)
            continue
        if stripped.upper().startswith("DELIMITER "):
            pending = "\n".join(buffer).strip()
            if pending:
                statements.append(pending)
                buffer = []
            delimiter = stripped.split(None, 1)[1]
            continue
        buffer.append(line)
        current = "\n".join(buffer).strip()
        if current.endswith(delimiter):
            current = current[: -len(delimiter)].strip()
            if current:
                statements.append(current)
            buffer = []

    pending = "\n".join(buffer).strip()
    if pending:
        statements.append(pending)
    return statements


def main() -> None:
    sql_path = Path(__file__).parent / "sql" / "01_schema_mysql.sql"
    sql = sql_path.read_text(encoding="utf-8")
    statements = split_mysql_script(sql)
    conn = connect_mysql(require_database=False, interactive=True)
    try:
        with conn.cursor() as cur:
            for statement in statements:
                cur.execute(statement)
        conn.commit()
        print("数据库和表结构创建完成。")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()

