import getpass
import hashlib
import os
import sys
from typing import Any, Dict, Iterable, List, Optional

try:
    import pymysql
    from pymysql.cursors import DictCursor
except ImportError:
    print("缺少依赖 pymysql，请先执行：pip install -r requirements.txt")
    sys.exit(1)

from db_config import connect_mysql


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def prompt(text: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{text}{suffix}: ").strip()
    return value or default


def prompt_int(text: str, default: Optional[int] = None) -> Optional[int]:
    raw = prompt(text, "" if default is None else str(default))
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        print("请输入数字。")
        return None


class Database:
    def __init__(self) -> None:
        self.conn = connect_mysql(require_database=True, interactive=True)

    def query(self, sql: str, params: Iterable[Any] = ()) -> List[Dict[str, Any]]:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def one(self, sql: str, params: Iterable[Any] = ()) -> Optional[Dict[str, Any]]:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        with self.conn.cursor() as cur:
            affected = cur.execute(sql, params)
        self.conn.commit()
        return affected

    def execute_many(self, sql: str, params: Iterable[Iterable[Any]]) -> int:
        with self.conn.cursor() as cur:
            affected = cur.executemany(sql, params)
        self.conn.commit()
        return affected

    def callproc(self, name: str, params: Iterable[Any] = ()) -> List[Dict[str, Any]]:
        with self.conn.cursor() as cur:
            cur.callproc(name, params)
            rows = list(cur.fetchall())
        self.conn.commit()
        return rows

    def close(self) -> None:
        self.conn.close()


class WechatCourseApp:
    def __init__(self) -> None:
        self.db = Database()
        self.current_user: Optional[Dict[str, Any]] = None

    def run(self) -> None:
        print("微信式个人资料与聊天记录管理系统")
        while True:
            try:
                if not self.current_user:
                    if not self.public_menu():
                        break
                else:
                    self.user_menu()
            except pymysql.MySQLError as exc:
                self.db.conn.rollback()
                print(f"数据库错误：{exc}")
            except KeyboardInterrupt:
                print("\n已退出。")
                break
        self.db.close()

    def public_menu(self) -> bool:
        print("\n1. 登录  2. 注册  0. 退出")
        choice = prompt("请选择")
        if choice == "1":
            self.login()
        elif choice == "2":
            self.register()
        elif choice == "0":
            return False
        else:
            print("无效选项。")
        return True

    def user_menu(self) -> None:
        user = self.current_user
        assert user is not None
        print(f"\n当前用户：{user['wechat_id']} / {user['nickname']}")
        print("1. 查看资料")
        print("2. 修改资料")
        print("3. 搜索用户")
        print("4. 好友列表")
        print("5. 发起好友申请")
        print("6. 处理好友申请")
        print("7. 设置朋友权限")
        print("8. 创建私聊会话")
        print("9. 发送消息")
        print("10. 查看聊天记录")
        print("11. 搜索聊天记录")
        print("12. 发布朋友圈")
        print("13. 查看可见朋友圈")
        print("14. 点赞或评论朋友圈")
        print("15. 统计报表")
        print("0. 退出登录")
        choice = prompt("请选择")
        actions = {
            "1": self.show_profile,
            "2": self.edit_profile,
            "3": self.search_users,
            "4": self.show_friends,
            "5": self.send_friend_request,
            "6": self.handle_friend_requests,
            "7": self.set_friend_permissions,
            "8": self.create_private_conversation,
            "9": self.send_message,
            "10": self.show_messages,
            "11": self.search_messages,
            "12": self.publish_moment,
            "13": self.show_visible_moments,
            "14": self.interact_with_moment,
            "15": self.statistics_menu,
        }
        if choice == "0":
            self.current_user = None
        elif choice in actions:
            actions[choice]()
        else:
            print("无效选项。")

    @property
    def user_id(self) -> int:
        assert self.current_user is not None
        return int(self.current_user["user_id"])

    def refresh_current_user(self) -> None:
        if not self.current_user:
            return
        row = self.db.one(
            """
            SELECT u.user_id, u.wechat_id, u.phone, p.nickname, p.gender, p.region, p.signature
            FROM users u
            JOIN user_profiles p ON p.user_id = u.user_id
            WHERE u.user_id = %s
            """,
            (self.user_id,),
        )
        self.current_user = row

    def login(self) -> None:
        wechat_id = prompt("微信号")
        password = getpass.getpass("密码: ")
        row = self.db.one(
            """
            SELECT u.user_id, u.wechat_id, u.phone, p.nickname, p.gender, p.region, p.signature
            FROM users u
            JOIN user_profiles p ON p.user_id = u.user_id
            WHERE u.wechat_id = %s
              AND u.password_hash = %s
              AND u.account_status = 'active'
            """,
            (wechat_id, sha256_text(password)),
        )
        if not row:
            print("账号或密码错误。")
            return
        self.db.execute("UPDATE users SET last_login_at = NOW() WHERE user_id = %s", (row["user_id"],))
        self.current_user = row
        print("登录成功。")

    def register(self) -> None:
        wechat_id = prompt("微信号")
        phone = prompt("手机号")
        password = getpass.getpass("密码: ")
        nickname = prompt("昵称")
        gender = prompt("性别 unknown/male/female", "unknown")
        region = prompt("地区", "山东济南")
        signature = prompt("个性签名", "这个人很认真地完成数据库课程设计")
        try:
            with self.db.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users(wechat_id, phone, password_hash)
                    VALUES(%s, %s, %s)
                    """,
                    (wechat_id, phone, sha256_text(password)),
                )
                user_id = cur.lastrowid
                cur.execute(
                    """
                    INSERT INTO user_profiles(user_id, nickname, gender, region, signature)
                    VALUES(%s, %s, %s, %s, %s)
                    """,
                    (user_id, nickname, gender, region, signature),
                )
            self.db.conn.commit()
            print(f"注册成功，用户编号：{user_id}")
        except Exception:
            self.db.conn.rollback()
            raise

    def show_profile(self) -> None:
        row = self.db.one(
            """
            SELECT u.user_id, u.wechat_id, u.phone, u.account_status, u.created_at, u.last_login_at,
                   p.nickname, p.gender, p.birthday, p.region, p.signature, p.avatar_url
            FROM users u
            JOIN user_profiles p ON p.user_id = u.user_id
            WHERE u.user_id = %s
            """,
            (self.user_id,),
        )
        self.print_rows([row] if row else [])

    def edit_profile(self) -> None:
        self.refresh_current_user()
        assert self.current_user is not None
        nickname = prompt("昵称", self.current_user["nickname"])
        gender = prompt("性别 unknown/male/female", self.current_user["gender"])
        region = prompt("地区", self.current_user.get("region") or "")
        signature = prompt("个性签名", self.current_user.get("signature") or "")
        self.db.execute(
            """
            UPDATE user_profiles
            SET nickname = %s, gender = %s, region = %s, signature = %s
            WHERE user_id = %s
            """,
            (nickname, gender, region, signature, self.user_id),
        )
        self.refresh_current_user()
        print("资料已更新。")

    def search_users(self) -> None:
        keyword = f"%{prompt('输入微信号或昵称关键词')}%"
        rows = self.db.query(
            """
            SELECT u.user_id, u.wechat_id, p.nickname, p.gender, p.region, p.signature
            FROM users u
            JOIN user_profiles p ON p.user_id = u.user_id
            WHERE u.user_id <> %s
              AND (u.wechat_id LIKE %s OR p.nickname LIKE %s)
            ORDER BY u.user_id
            LIMIT 20
            """,
            (self.user_id, keyword, keyword),
        )
        self.print_rows(rows)

    def send_friend_request(self) -> None:
        addressee_id = prompt_int("对方用户编号")
        if not addressee_id or addressee_id == self.user_id:
            print("用户编号无效。")
            return
        existing = self.db.one(
            """
            SELECT friendship_id, status FROM friendships
            WHERE (requester_id = %s AND addressee_id = %s)
               OR (requester_id = %s AND addressee_id = %s)
            """,
            (self.user_id, addressee_id, addressee_id, self.user_id),
        )
        if existing:
            print(f"已存在好友记录，状态：{existing['status']}")
            return
        self.db.execute(
            """
            INSERT INTO friendships(requester_id, addressee_id, status)
            VALUES(%s, %s, 'pending')
            """,
            (self.user_id, addressee_id),
        )
        print("好友申请已发送。")

    def handle_friend_requests(self) -> None:
        rows = self.db.query(
            """
            SELECT f.friendship_id, f.requester_id, u.wechat_id, p.nickname, f.created_at
            FROM friendships f
            JOIN users u ON u.user_id = f.requester_id
            JOIN user_profiles p ON p.user_id = f.requester_id
            WHERE f.addressee_id = %s AND f.status = 'pending'
            ORDER BY f.created_at DESC
            """,
            (self.user_id,),
        )
        self.print_rows(rows)
        if not rows:
            return
        friendship_id = prompt_int("要处理的申请编号")
        if not friendship_id:
            return
        status = prompt("处理结果 accepted/rejected", "accepted")
        if status not in {"accepted", "rejected"}:
            print("处理结果无效。")
            return
        self.db.execute(
            "UPDATE friendships SET status = %s WHERE friendship_id = %s AND addressee_id = %s",
            (status, friendship_id, self.user_id),
        )
        print("好友申请已处理。")

    def show_friends(self) -> None:
        rows = self.db.query(
            """
            SELECT
              f.friendship_id,
              CASE WHEN f.requester_id = %s THEN f.addressee_id ELSE f.requester_id END AS friend_id,
              u.wechat_id,
              p.nickname,
              f.status,
              f.can_chat,
              f.can_view_my_moments,
              f.can_view_their_moments,
              f.is_starred
            FROM friendships f
            JOIN users u ON u.user_id = CASE WHEN f.requester_id = %s THEN f.addressee_id ELSE f.requester_id END
            JOIN user_profiles p ON p.user_id = u.user_id
            WHERE (f.requester_id = %s OR f.addressee_id = %s)
              AND f.status = 'accepted'
            ORDER BY p.nickname
            """,
            (self.user_id, self.user_id, self.user_id, self.user_id),
        )
        self.print_rows(rows)

    def set_friend_permissions(self) -> None:
        self.show_friends()
        friendship_id = prompt_int("好友关系编号")
        if not friendship_id:
            return
        can_chat = prompt("允许聊天 1/0", "1")
        can_view_my = prompt("允许对方看我的朋友圈 1/0", "1")
        can_view_their = prompt("允许我看对方朋友圈 1/0", "1")
        is_starred = prompt("星标朋友 1/0", "0")
        values = (can_chat, can_view_my, can_view_their, is_starred)
        if any(v not in {"0", "1"} for v in values):
            print("权限值只能输入 0 或 1。")
            return
        affected = self.db.execute(
            """
            UPDATE friendships
            SET can_chat = %s, can_view_my_moments = %s,
                can_view_their_moments = %s, is_starred = %s
            WHERE friendship_id = %s
              AND (requester_id = %s OR addressee_id = %s)
            """,
            (*values, friendship_id, self.user_id, self.user_id),
        )
        print("权限已更新。" if affected else "没有找到可修改的好友关系。")

    def create_private_conversation(self) -> None:
        friend_id = prompt_int("好友用户编号")
        if not friend_id:
            return
        friendship = self.db.one(
            """
            SELECT friendship_id FROM friendships
            WHERE status = 'accepted'
              AND can_chat = 1
              AND ((requester_id = %s AND addressee_id = %s)
                OR (requester_id = %s AND addressee_id = %s))
            """,
            (self.user_id, friend_id, friend_id, self.user_id),
        )
        if not friendship:
            print("对方不是可聊天好友。")
            return
        try:
            with self.db.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO conversations(conversation_type, title, created_by)
                    VALUES('private', %s, %s)
                    """,
                    (f"私聊 {self.user_id}-{friend_id}", self.user_id),
                )
                conversation_id = cur.lastrowid
                cur.executemany(
                    """
                    INSERT INTO conversation_members(conversation_id, user_id, member_role)
                    VALUES(%s, %s, %s)
                    """,
                    [
                        (conversation_id, self.user_id, "owner"),
                        (conversation_id, friend_id, "member"),
                    ],
                )
            self.db.conn.commit()
            print(f"私聊会话创建成功，会话编号：{conversation_id}")
        except Exception:
            self.db.conn.rollback()
            raise

    def show_my_conversations(self) -> List[Dict[str, Any]]:
        rows = self.db.query(
            """
            SELECT c.conversation_id, c.conversation_type, c.title,
                   COUNT(cm2.user_id) AS member_count, c.last_message_at
            FROM conversations c
            JOIN conversation_members cm ON cm.conversation_id = c.conversation_id
            JOIN conversation_members cm2 ON cm2.conversation_id = c.conversation_id
            WHERE cm.user_id = %s
            GROUP BY c.conversation_id, c.conversation_type, c.title, c.last_message_at
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
            LIMIT 20
            """,
            (self.user_id,),
        )
        self.print_rows(rows)
        return rows

    def send_message(self) -> None:
        self.show_my_conversations()
        conversation_id = prompt_int("会话编号")
        content = prompt("消息内容")
        if not conversation_id or not content:
            print("会话编号和消息内容不能为空。")
            return
        self.db.callproc("sp_send_message", (conversation_id, self.user_id, content))
        print("消息已发送。")

    def show_messages(self) -> None:
        self.show_my_conversations()
        conversation_id = prompt_int("会话编号")
        if not conversation_id:
            return
        rows = self.db.query(
            """
            SELECT m.message_id, p.nickname AS sender, m.message_type, m.content, m.sent_at, m.is_recalled
            FROM messages m
            JOIN user_profiles p ON p.user_id = m.sender_id
            JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = %s
            WHERE m.conversation_id = %s
            ORDER BY m.sent_at DESC, m.message_id DESC
            LIMIT 50
            """,
            (self.user_id, conversation_id),
        )
        self.print_rows(rows)

    def search_messages(self) -> None:
        keyword = f"%{prompt('聊天关键词')}%"
        rows = self.db.query(
            """
            SELECT m.message_id, m.conversation_id, p.nickname AS sender, m.content, m.sent_at
            FROM messages m
            JOIN user_profiles p ON p.user_id = m.sender_id
            JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = %s
            WHERE m.content LIKE %s
            ORDER BY m.sent_at DESC
            LIMIT 30
            """,
            (self.user_id, keyword),
        )
        self.print_rows(rows)

    def publish_moment(self) -> None:
        content = prompt("朋友圈内容")
        visibility = prompt("可见范围 public/friends/private/selected", "friends")
        location = prompt("位置", "")
        if visibility not in {"public", "friends", "private", "selected"}:
            print("可见范围无效。")
            return
        try:
            with self.db.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO moment_posts(author_id, content, visibility_type, location)
                    VALUES(%s, %s, %s, %s)
                    """,
                    (self.user_id, content, visibility, location or None),
                )
                post_id = cur.lastrowid
                if visibility == "selected":
                    raw = prompt("指定可见用户编号，用英文逗号分隔")
                    user_ids = [int(x.strip()) for x in raw.split(",") if x.strip().isdigit()]
                    cur.executemany(
                        "INSERT IGNORE INTO moment_visibility(post_id, visible_user_id) VALUES(%s, %s)",
                        [(post_id, uid) for uid in user_ids],
                    )
            self.db.conn.commit()
            print(f"朋友圈发布成功，动态编号：{post_id}")
        except Exception:
            self.db.conn.rollback()
            raise

    def show_visible_moments(self) -> None:
        rows = self.db.query(
            """
            SELECT DISTINCT mp.post_id, up.nickname AS author, mp.content, mp.visibility_type,
                   mp.location, mp.created_at,
                   COALESCE(s.like_count, 0) AS like_count,
                   COALESCE(s.comment_count, 0) AS comment_count
            FROM moment_posts mp
            JOIN user_profiles up ON up.user_id = mp.author_id
            LEFT JOIN v_moment_interaction_statistics s ON s.post_id = mp.post_id
            LEFT JOIN friendships f
              ON f.status = 'accepted'
             AND ((f.requester_id = mp.author_id AND f.addressee_id = %s)
               OR (f.addressee_id = mp.author_id AND f.requester_id = %s))
            LEFT JOIN moment_visibility mv
              ON mv.post_id = mp.post_id AND mv.visible_user_id = %s
            WHERE mp.deleted_at IS NULL
              AND (
                mp.author_id = %s
                OR mp.visibility_type = 'public'
                OR (mp.visibility_type = 'selected' AND mv.visible_user_id IS NOT NULL)
                OR (
                  mp.visibility_type = 'friends'
                  AND f.friendship_id IS NOT NULL
                  AND (
                    (f.requester_id = mp.author_id AND f.can_view_my_moments = 1)
                    OR (f.addressee_id = mp.author_id AND f.can_view_their_moments = 1)
                  )
                )
              )
            ORDER BY mp.created_at DESC
            LIMIT 30
            """,
            (self.user_id, self.user_id, self.user_id, self.user_id),
        )
        self.print_rows(rows)

    def interact_with_moment(self) -> None:
        self.show_visible_moments()
        post_id = prompt_int("朋友圈动态编号")
        if not post_id:
            return
        action = prompt("操作 like/comment", "like")
        if action == "like":
            self.db.execute(
                "INSERT IGNORE INTO moment_likes(post_id, user_id) VALUES(%s, %s)",
                (post_id, self.user_id),
            )
            print("点赞成功。")
        elif action == "comment":
            content = prompt("评论内容")
            self.db.execute(
                """
                INSERT INTO moment_comments(post_id, user_id, content)
                VALUES(%s, %s, %s)
                """,
                (post_id, self.user_id, content),
            )
            print("评论成功。")
        else:
            print("操作无效。")

    def statistics_menu(self) -> None:
        print("\n1. 用户消息量排行")
        print("2. 朋友圈互动排行")
        print("3. 我的朋友权限统计")
        print("4. 会话活跃度统计")
        choice = prompt("请选择")
        if choice == "1":
            rows = self.db.query(
                """
                SELECT user_id, wechat_id, nickname, sent_message_count, last_sent_at
                FROM v_message_statistics
                ORDER BY sent_message_count DESC, user_id
                LIMIT 10
                """
            )
        elif choice == "2":
            rows = self.db.query(
                """
                SELECT post_id, author_nickname, content_preview, like_count, comment_count,
                       interaction_count, created_at
                FROM v_moment_interaction_statistics
                ORDER BY interaction_count DESC, created_at DESC
                LIMIT 10
                """
            )
        elif choice == "3":
            rows = self.db.callproc("sp_friend_permission_summary", (self.user_id,))
        elif choice == "4":
            rows = self.db.query(
                """
                SELECT c.conversation_id, c.conversation_type, c.title,
                       COUNT(m.message_id) AS message_count,
                       MAX(m.sent_at) AS last_message_at
                FROM conversations c
                JOIN conversation_members cm ON cm.conversation_id = c.conversation_id
                LEFT JOIN messages m ON m.conversation_id = c.conversation_id
                WHERE cm.user_id = %s
                GROUP BY c.conversation_id, c.conversation_type, c.title
                ORDER BY message_count DESC, last_message_at DESC
                LIMIT 10
                """,
                (self.user_id,),
            )
        else:
            print("无效选项。")
            return
        self.print_rows(rows)

    @staticmethod
    def print_rows(rows: List[Optional[Dict[str, Any]]]) -> None:
        rows = [row for row in rows if row]
        if not rows:
            print("没有数据。")
            return
        columns = list(rows[0].keys())
        widths = {
            col: min(max(len(str(col)), *(len(str(row.get(col, ""))) for row in rows)), 36)
            for col in columns
        }
        header = " | ".join(str(col).ljust(widths[col]) for col in columns)
        print(header)
        print("-" * len(header))
        for row in rows:
            values = []
            for col in columns:
                text = str(row.get(col, ""))
                if len(text) > widths[col]:
                    text = text[: widths[col] - 3] + "..."
                values.append(text.ljust(widths[col]))
            print(" | ".join(values))


if __name__ == "__main__":
    WechatCourseApp().run()
