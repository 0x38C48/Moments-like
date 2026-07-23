from __future__ import annotations

import hashlib
import sys
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Optional

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from db_config import connect_mysql


app = Flask(__name__)
CORS(app)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    return value


class Database:
    def __enter__(self) -> "Database":
        self.conn = connect_mysql(require_database=True, interactive=False)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc:
            self.conn.rollback()
        self.conn.close()

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def one(self, sql: str, params: Iterable[Any] = ()) -> Optional[dict[str, Any]]:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        with self.conn.cursor() as cur:
            affected = cur.execute(sql, params)
        self.conn.commit()
        return affected

    def callproc(self, name: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self.conn.cursor() as cur:
            cur.callproc(name, params)
            rows = list(cur.fetchall())
        self.conn.commit()
        return rows


def ok(data: Any = None, **extra: Any):
    payload = {"ok": True, **extra}
    if data is not None:
        payload["data"] = normalize(data)
    return jsonify(payload)


def fail(message: str, status: int = 400):
    return jsonify({"ok": False, "message": message}), status


def json_body() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


@app.errorhandler(Exception)
def handle_error(error):
    return fail(str(error), 500)


@app.get("/api/health")
def health():
    with Database() as db:
        row = db.one("SELECT DATABASE() AS database_name, NOW() AS server_time")
    return ok(row)


@app.post("/api/uploads")
def upload_image():
    file = request.files.get("file")
    if file is None or not file.filename:
        return fail("请选择要上传的图片")

    original_name = secure_filename(file.filename)
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return fail("仅支持 jpg、jpeg、png、gif、webp 图片")

    filename = f"{uuid.uuid4().hex}{ext}"
    file.save(UPLOAD_DIR / filename)
    return ok({"url": f"http://127.0.0.1:5000/uploads/{filename}", "filename": filename})


@app.get("/uploads/<path:filename>")
def uploaded_file(filename: str):
    return send_from_directory(UPLOAD_DIR, filename)


@app.post("/api/auth/login")
def login():
    body = json_body()
    wechat_id = body.get("wechat_id", "").strip()
    password = body.get("password", "")
    if not wechat_id or not password:
        return fail("微信号和密码不能为空")
    with Database() as db:
        row = db.one(
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
            return fail("账号或密码错误", 401)
        db.execute("UPDATE users SET last_login_at = NOW() WHERE user_id = %s", (row["user_id"],))
    return ok(row)


@app.get("/api/profile/<int:user_id>")
def profile(user_id: int):
    with Database() as db:
        row = db.one(
            """
            SELECT u.user_id, u.wechat_id, u.phone, u.account_status, u.created_at, u.last_login_at,
                   p.nickname, p.gender, p.birthday, p.region, p.signature, p.avatar_url
            FROM users u
            JOIN user_profiles p ON p.user_id = u.user_id
            WHERE u.user_id = %s
            """,
            (user_id,),
        )
    return ok(row)


@app.put("/api/profile/<int:user_id>")
def update_profile(user_id: int):
    body = json_body()
    with Database() as db:
        db.execute(
            """
            UPDATE user_profiles
            SET nickname = %s, gender = %s, region = %s, signature = %s
            WHERE user_id = %s
            """,
            (
                body.get("nickname", ""),
                body.get("gender", "unknown"),
                body.get("region", ""),
                body.get("signature", ""),
                user_id,
            ),
        )
    return ok(message="资料已更新")


@app.get("/api/users/search")
def search_users():
    keyword = f"%{request.args.get('keyword', '').strip()}%"
    current_user_id = int(request.args.get("current_user_id", "0") or "0")
    with Database() as db:
        rows = db.query(
            """
            SELECT u.user_id, u.wechat_id, p.nickname, p.gender, p.region, p.signature
            FROM users u
            JOIN user_profiles p ON p.user_id = u.user_id
            WHERE u.user_id <> %s
              AND (u.wechat_id LIKE %s OR p.nickname LIKE %s)
            ORDER BY u.user_id
            LIMIT 20
            """,
            (current_user_id, keyword, keyword),
        )
    return ok(rows)


@app.get("/api/friends/<int:user_id>")
def friends(user_id: int):
    with Database() as db:
        rows = db.query(
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
            (user_id, user_id, user_id, user_id),
        )
    return ok(rows)


@app.post("/api/friends/request")
def create_friend_request():
    body = json_body()
    requester_id = int(body.get("requester_id", 0))
    addressee_id = int(body.get("addressee_id", 0))
    if not requester_id or not addressee_id or requester_id == addressee_id:
        return fail("好友申请参数无效")
    with Database() as db:
        existing = db.one(
            """
            SELECT friendship_id, status FROM friendships
            WHERE (requester_id = %s AND addressee_id = %s)
               OR (requester_id = %s AND addressee_id = %s)
            """,
            (requester_id, addressee_id, addressee_id, requester_id),
        )
        if existing:
            return fail(f"已存在好友记录，状态：{existing['status']}")
        db.execute(
            "INSERT INTO friendships(requester_id, addressee_id, status) VALUES(%s, %s, 'pending')",
            (requester_id, addressee_id),
        )
    return ok(message="好友申请已发送")


@app.get("/api/friends/requests/<int:user_id>")
def friend_requests(user_id: int):
    with Database() as db:
        rows = db.query(
            """
            SELECT f.friendship_id, f.requester_id, u.wechat_id, p.nickname, f.created_at
            FROM friendships f
            JOIN users u ON u.user_id = f.requester_id
            JOIN user_profiles p ON p.user_id = f.requester_id
            WHERE f.addressee_id = %s AND f.status = 'pending'
            ORDER BY f.created_at DESC
            """,
            (user_id,),
        )
    return ok(rows)


@app.patch("/api/friends/requests/<int:friendship_id>")
def handle_request(friendship_id: int):
    body = json_body()
    user_id = int(body.get("user_id", 0))
    status = body.get("status", "accepted")
    if status not in {"accepted", "rejected"}:
        return fail("处理结果无效")
    with Database() as db:
        affected = db.execute(
            "UPDATE friendships SET status = %s WHERE friendship_id = %s AND addressee_id = %s",
            (status, friendship_id, user_id),
        )
    return ok({"affected": affected})


@app.patch("/api/friends/<int:friendship_id>/permissions")
def update_permissions(friendship_id: int):
    body = json_body()
    user_id = int(body.get("user_id", 0))
    with Database() as db:
        affected = db.execute(
            """
            UPDATE friendships
            SET can_chat = %s, can_view_my_moments = %s,
                can_view_their_moments = %s, is_starred = %s
            WHERE friendship_id = %s
              AND (requester_id = %s OR addressee_id = %s)
            """,
            (
                int(bool(body.get("can_chat"))),
                int(bool(body.get("can_view_my_moments"))),
                int(bool(body.get("can_view_their_moments"))),
                int(bool(body.get("is_starred"))),
                friendship_id,
                user_id,
                user_id,
            ),
        )
    return ok({"affected": affected})


@app.get("/api/conversations/<int:user_id>")
def conversations(user_id: int):
    with Database() as db:
        rows = db.query(
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
            (user_id,),
        )
    return ok(rows)


@app.post("/api/conversations/private")
def create_private_conversation():
    body = json_body()
    user_id = int(body.get("user_id", 0))
    friend_id = int(body.get("friend_id", 0))
    if not user_id or not friend_id:
        return fail("会话参数无效")
    with Database() as db:
        friendship = db.one(
            """
            SELECT friendship_id FROM friendships
            WHERE status = 'accepted'
              AND can_chat = 1
              AND ((requester_id = %s AND addressee_id = %s)
                OR (requester_id = %s AND addressee_id = %s))
            """,
            (user_id, friend_id, friend_id, user_id),
        )
        if not friendship:
            return fail("对方不是可聊天好友")

        existing = db.one(
            """
            SELECT c.conversation_id
            FROM conversations c
            JOIN conversation_members cm_me
              ON cm_me.conversation_id = c.conversation_id AND cm_me.user_id = %s
            JOIN conversation_members cm_friend
              ON cm_friend.conversation_id = c.conversation_id AND cm_friend.user_id = %s
            WHERE c.conversation_type = 'private'
              AND (
                SELECT COUNT(*)
                FROM conversation_members cm_count
                WHERE cm_count.conversation_id = c.conversation_id
              ) = 2
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
            LIMIT 1
            """,
            (user_id, friend_id),
        )
        if existing:
            return ok({"conversation_id": existing["conversation_id"], "reused": True})

        with db.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations(conversation_type, title, created_by) VALUES('private', %s, %s)",
                (f"私聊 {user_id}-{friend_id}", user_id),
            )
            conversation_id = cur.lastrowid
            cur.executemany(
                "INSERT INTO conversation_members(conversation_id, user_id, member_role) VALUES(%s, %s, %s)",
                [(conversation_id, user_id, "owner"), (conversation_id, friend_id, "member")],
            )
        db.conn.commit()
    return ok({"conversation_id": conversation_id, "reused": False})


@app.get("/api/messages/<int:conversation_id>")
def messages(conversation_id: int):
    user_id = int(request.args.get("user_id", "0") or "0")
    keyword = request.args.get("keyword", "").strip()
    keyword_clause = "AND m.content LIKE %s" if keyword else ""
    params: list[Any] = [user_id, conversation_id]
    if keyword:
        params.append(f"%{keyword}%")
    with Database() as db:
        rows = db.query(
            f"""
            SELECT m.message_id, m.sender_id, p.nickname AS sender, m.message_type, m.content, m.sent_at, m.is_recalled
            FROM messages m
            JOIN user_profiles p ON p.user_id = m.sender_id
            JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = %s
            WHERE m.conversation_id = %s
            {keyword_clause}
            ORDER BY m.sent_at DESC, m.message_id DESC
            LIMIT 50
            """,
            tuple(params),
        )
    return ok(rows)


@app.post("/api/messages")
def send_message():
    body = json_body()
    conversation_id = int(body.get("conversation_id", 0))
    sender_id = int(body.get("sender_id", 0))
    content = body.get("content", "").strip()
    if not conversation_id or not sender_id or not content:
        return fail("消息参数不能为空")
    with Database() as db:
        db.callproc("sp_send_message", (conversation_id, sender_id, content))
    return ok(message="消息已发送")


@app.get("/api/moments/<int:user_id>")
def moments(user_id: int):
    with Database() as db:
        rows = db.query(
            """
            SELECT DISTINCT mp.post_id, mp.author_id, up.nickname AS author, mp.content, mp.visibility_type,
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
                OR (mp.visibility_type = 'friends' AND f.friendship_id IS NOT NULL)
              )
            ORDER BY mp.created_at DESC
            LIMIT 30
            """,
            (user_id, user_id, user_id, user_id),
        )
        post_ids = [row["post_id"] for row in rows]
        media_by_post: dict[int, list[dict[str, Any]]] = {post_id: [] for post_id in post_ids}
        if post_ids:
            placeholders = ", ".join(["%s"] * len(post_ids))
            media_rows = db.query(
                f"""
                SELECT post_id, media_type, media_url, sort_order
                FROM moment_media
                WHERE post_id IN ({placeholders})
                ORDER BY post_id, sort_order, media_id
                """,
                tuple(post_ids),
            )
            for media in media_rows:
                media_by_post.setdefault(media["post_id"], []).append(media)

            comment_rows = db.query(
                f"""
                SELECT mc.post_id, mc.comment_id, mc.user_id, up.nickname, mc.content, mc.commented_at
                FROM moment_comments mc
                JOIN user_profiles up ON up.user_id = mc.user_id
                WHERE mc.post_id IN ({placeholders})
                ORDER BY mc.post_id, mc.commented_at, mc.comment_id
                """,
                tuple(post_ids),
            )
            comments_by_post: dict[int, list[dict[str, Any]]] = {post_id: [] for post_id in post_ids}
            for comment in comment_rows:
                comments_by_post.setdefault(comment["post_id"], []).append(comment)
        else:
            comments_by_post = {}
        for row in rows:
            row["media"] = media_by_post.get(row["post_id"], [])
            row["comments"] = comments_by_post.get(row["post_id"], [])
    return ok(rows)


@app.post("/api/moments")
def publish_moment():
    body = json_body()
    author_id = int(body.get("author_id", 0))
    content = body.get("content", "").strip()
    visibility_type = body.get("visibility_type", "friends")
    location = body.get("location") or None
    if visibility_type not in {"public", "friends", "private", "selected"}:
        return fail("朋友圈可见范围无效")
    if not author_id or not content:
        return fail("朋友圈内容不能为空")
    with Database() as db:
        with db.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO moment_posts(author_id, content, visibility_type, location)
                VALUES(%s, %s, %s, %s)
                """,
                (author_id, content, visibility_type, location),
            )
            post_id = cur.lastrowid
            selected_ids = body.get("visible_user_ids") or []
            if visibility_type == "selected" and selected_ids:
                cur.executemany(
                    "INSERT IGNORE INTO moment_visibility(post_id, visible_user_id) VALUES(%s, %s)",
                    [(post_id, int(uid)) for uid in selected_ids],
                )
            media_urls = body.get("media_urls") or []
            if media_urls:
                cur.executemany(
                    """
                    INSERT INTO moment_media(post_id, media_type, media_url, sort_order)
                    VALUES(%s, 'image', %s, %s)
                    """,
                    [(post_id, str(url), index + 1) for index, url in enumerate(media_urls)],
                )
        db.conn.commit()
    return ok({"post_id": post_id})


@app.post("/api/moments/<int:post_id>/like")
def like_moment(post_id: int):
    user_id = int(json_body().get("user_id", 0))
    with Database() as db:
        db.execute("INSERT IGNORE INTO moment_likes(post_id, user_id) VALUES(%s, %s)", (post_id, user_id))
    return ok(message="点赞成功")


@app.post("/api/moments/<int:post_id>/comments")
def comment_moment(post_id: int):
    body = json_body()
    user_id = int(body.get("user_id", 0))
    content = body.get("content", "").strip()
    if not user_id or not content:
        return fail("评论内容不能为空")
    with Database() as db:
        db.execute(
            "INSERT INTO moment_comments(post_id, user_id, content) VALUES(%s, %s, %s)",
            (post_id, user_id, content),
        )
    return ok(message="评论成功")


@app.get("/api/statistics/<int:user_id>/<string:kind>")
def statistics(user_id: int, kind: str):
    with Database() as db:
        if kind == "messages":
            rows = db.query(
                """
                SELECT user_id, wechat_id, nickname, sent_message_count, last_sent_at
                FROM v_message_statistics
                ORDER BY sent_message_count DESC, user_id
                LIMIT 10
                """
            )
        elif kind == "moments":
            rows = db.query(
                """
                SELECT post_id, author_nickname, content_preview, like_count, comment_count,
                       interaction_count, created_at
                FROM v_moment_interaction_statistics
                ORDER BY interaction_count DESC, created_at DESC
                LIMIT 10
                """
            )
        elif kind == "permissions":
            rows = db.callproc("sp_friend_permission_summary", (user_id,))
        elif kind == "conversations":
            rows = db.query(
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
                (user_id,),
            )
        else:
            return fail("未知统计类型")
    return ok(rows)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
