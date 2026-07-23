import hashlib
import os
from datetime import datetime, timedelta
from typing import Iterable, Tuple

import pymysql
from pymysql.cursors import DictCursor

from db_config import connect_mysql


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def connect():
    return connect_mysql(require_database=True, interactive=True)


def batch(cur, sql: str, rows: Iterable[Tuple]) -> None:
    rows = list(rows)
    if rows:
        cur.executemany(sql, rows)


def main() -> None:
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS = 0")
            for table in [
                "audit_logs",
                "moment_comments",
                "moment_likes",
                "moment_visibility",
                "moment_media",
                "moment_posts",
                "messages",
                "conversation_members",
                "conversations",
                "friend_tag_members",
                "friend_tags",
                "friendships",
                "user_profiles",
                "users",
            ]:
                cur.execute(f"TRUNCATE TABLE {table}")
            cur.execute("SET FOREIGN_KEY_CHECKS = 1")

            users = []
            profiles = []
            regions = ["山东济南", "山东青岛", "北京海淀", "上海浦东", "广东深圳", "浙江杭州"]
            genders = ["unknown", "male", "female"]
            for i in range(1, 37):
                wechat_id = f"u{i:03d}"
                users.append((i, wechat_id, f"1380000{i:04d}", sha256_text("123456")))
                profiles.append(
                    (
                        i,
                        f"用户{i:03d}",
                        genders[i % 3],
                        f"200{i % 10}-0{(i % 9) + 1}-15",
                        regions[i % len(regions)],
                        f"第{i}位测试用户，热爱数据库课程设计",
                        f"https://example.com/avatar/{i}.png",
                    )
                )

            batch(
                cur,
                """
                INSERT INTO users(user_id, wechat_id, phone, password_hash)
                VALUES(%s, %s, %s, %s)
                """,
                users,
            )
            batch(
                cur,
                """
                INSERT INTO user_profiles(user_id, nickname, gender, birthday, region, signature, avatar_url)
                VALUES(%s, %s, %s, %s, %s, %s, %s)
                """,
                profiles,
            )

            friendships = []
            friendship_id = 1
            for a in range(1, 25):
                for b in range(a + 1, 37):
                    if len(friendships) >= 260:
                        break
                    status = "accepted" if (a + b) % 11 != 0 else "pending"
                    friendships.append(
                        (
                            friendship_id,
                            a,
                            b,
                            status,
                            None if (a + b) % 5 else f"同学{b:03d}",
                            None if (a + b) % 5 else f"同学{a:03d}",
                            0 if (a + b) % 17 == 0 else 1,
                            0 if (a * b) % 19 == 0 else 1,
                            0 if (a + b) % 13 == 0 else 1,
                            1 if (a + b) % 9 == 0 else 0,
                        )
                    )
                    friendship_id += 1
                if len(friendships) >= 260:
                    break
            batch(
                cur,
                """
                INSERT INTO friendships(
                  friendship_id, requester_id, addressee_id, status,
                  requester_remark, addressee_remark,
                  can_chat, can_view_my_moments, can_view_their_moments, is_starred
                )
                VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                friendships,
            )

            tags = []
            tag_id = 1
            for owner_id in range(1, 13):
                for tag_name in ["同学", "项目组", "家人"]:
                    tags.append((tag_id, owner_id, tag_name))
                    tag_id += 1
            batch(
                cur,
                "INSERT INTO friend_tags(tag_id, owner_id, tag_name) VALUES(%s, %s, %s)",
                tags,
            )
            tag_members = []
            for tag_id_value, owner_id, _ in tags:
                for offset in range(1, 6):
                    friend_id = ((owner_id + offset - 1) % 36) + 1
                    if friend_id != owner_id:
                        tag_members.append((tag_id_value, friend_id))
            batch(
                cur,
                "INSERT IGNORE INTO friend_tag_members(tag_id, friend_id) VALUES(%s, %s)",
                tag_members,
            )

            now = datetime.now().replace(microsecond=0)
            conversations = []
            conv_members = []
            conversation_id = 1
            for i in range(1, 31):
                a = i
                b = (i % 36) + 1
                conversations.append((conversation_id, "private", f"私聊 {a}-{b}", a, now - timedelta(days=30 - i)))
                conv_members.append((conversation_id, a, "owner"))
                conv_members.append((conversation_id, b, "member"))
                conversation_id += 1
            for group_index in range(1, 7):
                creator = group_index
                conversations.append((conversation_id, "group", f"数据库课设讨论群{group_index}", creator, now - timedelta(days=group_index)))
                for uid in range(group_index, group_index + 8):
                    conv_members.append((conversation_id, ((uid - 1) % 36) + 1, "owner" if uid == group_index else "member"))
                conversation_id += 1
            batch(
                cur,
                """
                INSERT INTO conversations(conversation_id, conversation_type, title, created_by, created_at)
                VALUES(%s, %s, %s, %s, %s)
                """,
                conversations,
            )
            batch(
                cur,
                """
                INSERT IGNORE INTO conversation_members(conversation_id, user_id, member_role)
                VALUES(%s, %s, %s)
                """,
                conv_members,
            )

            cur.execute("SELECT conversation_id, user_id FROM conversation_members ORDER BY conversation_id, user_id")
            member_rows = cur.fetchall()
            members_by_conv = {}
            for row in member_rows:
                members_by_conv.setdefault(row["conversation_id"], []).append(row["user_id"])

            messages = []
            message_id = 1
            message_templates = [
                "今天讨论一下数据库 ER 图。",
                "我已经完成了需求分析。",
                "触发器和存储过程可以放进演示重点。",
                "朋友圈权限这里很适合讲完整性约束。",
                "晚上把 SQL 脚本再跑一遍。",
                "统计报表已经能查出来了。",
            ]
            for conv_id, members in members_by_conv.items():
                for j in range(8):
                    sender_id = members[j % len(members)]
                    sent_at = now - timedelta(days=10 - (conv_id % 10), minutes=message_id)
                    messages.append(
                        (
                            message_id,
                            conv_id,
                            sender_id,
                            "text",
                            f"{message_templates[(message_id + j) % len(message_templates)]} #{message_id}",
                            sent_at,
                        )
                    )
                    message_id += 1
            batch(
                cur,
                """
                INSERT INTO messages(message_id, conversation_id, sender_id, message_type, content, sent_at)
                VALUES(%s, %s, %s, %s, %s, %s)
                """,
                messages,
            )

            posts = []
            media = []
            visibility = []
            visibility_types = ["public", "friends", "private", "selected"]
            for post_id in range(1, 73):
                author_id = ((post_id - 1) % 36) + 1
                vtype = visibility_types[post_id % len(visibility_types)]
                posts.append(
                    (
                        post_id,
                        author_id,
                        f"第{post_id}条朋友圈：记录数据库课程设计进度和生活动态。",
                        vtype,
                        regions[post_id % len(regions)],
                        now - timedelta(hours=post_id),
                    )
                )
                if post_id % 3 == 0:
                    media.append((post_id, "image", f"https://example.com/moment/{post_id}.jpg", 1))
                if vtype == "selected":
                    for offset in range(1, 5):
                        visible_user_id = ((author_id + offset - 1) % 36) + 1
                        visibility.append((post_id, visible_user_id))
            batch(
                cur,
                """
                INSERT INTO moment_posts(post_id, author_id, content, visibility_type, location, created_at)
                VALUES(%s, %s, %s, %s, %s, %s)
                """,
                posts,
            )
            batch(
                cur,
                """
                INSERT INTO moment_media(post_id, media_type, media_url, sort_order)
                VALUES(%s, %s, %s, %s)
                """,
                media,
            )
            batch(
                cur,
                "INSERT IGNORE INTO moment_visibility(post_id, visible_user_id) VALUES(%s, %s)",
                visibility,
            )

            likes = []
            comments = []
            comment_id = 1
            for post_id in range(1, 73):
                author_id = ((post_id - 1) % 36) + 1
                for offset in range(1, 5):
                    liker_id = ((author_id + offset - 1) % 36) + 1
                    if liker_id != author_id:
                        likes.append((post_id, liker_id, now - timedelta(hours=post_id, minutes=offset)))
                for offset in range(1, 3):
                    commenter_id = ((author_id + offset + 5 - 1) % 36) + 1
                    comments.append(
                        (
                            comment_id,
                            post_id,
                            commenter_id,
                            f"评论{comment_id}：这个动态可以作为演示数据。",
                            now - timedelta(hours=post_id, minutes=offset + 10),
                        )
                    )
                    comment_id += 1
            batch(
                cur,
                "INSERT IGNORE INTO moment_likes(post_id, user_id, liked_at) VALUES(%s, %s, %s)",
                likes,
            )
            batch(
                cur,
                """
                INSERT INTO moment_comments(comment_id, post_id, user_id, content, commented_at)
                VALUES(%s, %s, %s, %s, %s)
                """,
                comments,
            )

            cur.execute(
                """
                UPDATE conversations c
                SET last_message_at = (
                  SELECT MAX(m.sent_at) FROM messages m WHERE m.conversation_id = c.conversation_id
                )
                """
            )
        conn.commit()
        print("演示数据生成完成。")
        print("账号：u001 到 u036，统一密码：123456")
        print("实体数据：36 个用户、72 条朋友圈、36 个好友标签、36 个会话。")
        print("关联数据：260 条好友关系、超过 280 条会话成员、超过 280 条消息、超过 280 条点赞评论关系。")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
