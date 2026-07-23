CREATE DATABASE IF NOT EXISTS wechat_course_design
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE wechat_course_design;

DROP PROCEDURE IF EXISTS sp_send_message;
DROP PROCEDURE IF EXISTS sp_friend_permission_summary;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS moment_comments;
DROP TABLE IF EXISTS moment_likes;
DROP TABLE IF EXISTS moment_visibility;
DROP TABLE IF EXISTS moment_media;
DROP TABLE IF EXISTS moment_posts;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS friend_tag_members;
DROP TABLE IF EXISTS friend_tags;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  user_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  wechat_id VARCHAR(32) NOT NULL UNIQUE,
  phone VARCHAR(20) UNIQUE,
  password_hash CHAR(64) NOT NULL,
  account_status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  CHECK (wechat_id <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_profiles (
  user_id BIGINT PRIMARY KEY,
  nickname VARCHAR(60) NOT NULL,
  gender ENUM('unknown', 'male', 'female') NOT NULL DEFAULT 'unknown',
  birthday DATE NULL,
  region VARCHAR(120) NULL,
  signature VARCHAR(255) NULL,
  avatar_url VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE friendships (
  friendship_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  requester_id BIGINT NOT NULL,
  addressee_id BIGINT NOT NULL,
  status ENUM('pending', 'accepted', 'rejected', 'blocked') NOT NULL DEFAULT 'pending',
  requester_remark VARCHAR(60) NULL,
  addressee_remark VARCHAR(60) NULL,
  can_chat TINYINT(1) NOT NULL DEFAULT 1,
  can_view_my_moments TINYINT(1) NOT NULL DEFAULT 1,
  can_view_their_moments TINYINT(1) NOT NULL DEFAULT 1,
  is_starred TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_friend_requester FOREIGN KEY (requester_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_friend_addressee FOREIGN KEY (addressee_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT uk_friend_pair UNIQUE (requester_id, addressee_id),
  CONSTRAINT ck_friend_not_self CHECK (requester_id <> addressee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE friend_tags (
  tag_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_id BIGINT NOT NULL,
  tag_name VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tags_owner FOREIGN KEY (owner_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT uk_owner_tag UNIQUE (owner_id, tag_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE friend_tag_members (
  tag_id BIGINT NOT NULL,
  friend_id BIGINT NOT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tag_id, friend_id),
  CONSTRAINT fk_tag_members_tag FOREIGN KEY (tag_id)
    REFERENCES friend_tags(tag_id) ON DELETE CASCADE,
  CONSTRAINT fk_tag_members_friend FOREIGN KEY (friend_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE conversations (
  conversation_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_type ENUM('private', 'group') NOT NULL,
  title VARCHAR(80) NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME NULL,
  CONSTRAINT fk_conversations_creator FOREIGN KEY (created_by)
    REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE conversation_members (
  conversation_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  member_role ENUM('owner', 'member') NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  muted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT fk_conv_members_conv FOREIGN KEY (conversation_id)
    REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_members_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE messages (
  message_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  message_type ENUM('text', 'image', 'file') NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_recalled TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_messages_conv FOREIGN KEY (conversation_id)
    REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_messages_conv_time (conversation_id, sent_at),
  FULLTEXT INDEX ft_messages_content (content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE moment_posts (
  post_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  author_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  visibility_type ENUM('public', 'friends', 'private', 'selected') NOT NULL DEFAULT 'friends',
  location VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  CONSTRAINT fk_posts_author FOREIGN KEY (author_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_posts_author_time (author_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE moment_media (
  media_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id BIGINT NOT NULL,
  media_type ENUM('image', 'video') NOT NULL DEFAULT 'image',
  media_url VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_media_post FOREIGN KEY (post_id)
    REFERENCES moment_posts(post_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE moment_visibility (
  post_id BIGINT NOT NULL,
  visible_user_id BIGINT NOT NULL,
  PRIMARY KEY (post_id, visible_user_id),
  CONSTRAINT fk_visibility_post FOREIGN KEY (post_id)
    REFERENCES moment_posts(post_id) ON DELETE CASCADE,
  CONSTRAINT fk_visibility_user FOREIGN KEY (visible_user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE moment_likes (
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  liked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_likes_post FOREIGN KEY (post_id)
    REFERENCES moment_posts(post_id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE moment_comments (
  comment_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  parent_comment_id BIGINT NULL,
  content VARCHAR(500) NOT NULL,
  commented_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comments_post FOREIGN KEY (post_id)
    REFERENCES moment_posts(post_id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_parent FOREIGN KEY (parent_comment_id)
    REFERENCES moment_comments(comment_id) ON DELETE SET NULL,
  INDEX idx_comments_post_time (post_id, commented_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
  log_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_id BIGINT NULL,
  action_type VARCHAR(40) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id BIGINT NOT NULL,
  detail VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id)
    REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_audit_actor_time (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_users_wechat_id ON users(wechat_id);
CREATE INDEX idx_profiles_nickname ON user_profiles(nickname);
CREATE INDEX idx_friend_status ON friendships(status);
CREATE INDEX idx_posts_visibility ON moment_posts(visibility_type);

CREATE OR REPLACE VIEW v_friend_list AS
SELECT
  f.friendship_id,
  f.requester_id AS user_a_id,
  p1.nickname AS user_a_nickname,
  f.addressee_id AS user_b_id,
  p2.nickname AS user_b_nickname,
  f.status,
  f.can_chat,
  f.can_view_my_moments,
  f.can_view_their_moments,
  f.is_starred,
  f.updated_at
FROM friendships f
JOIN user_profiles p1 ON p1.user_id = f.requester_id
JOIN user_profiles p2 ON p2.user_id = f.addressee_id;

CREATE OR REPLACE VIEW v_message_statistics AS
SELECT
  u.user_id,
  u.wechat_id,
  p.nickname,
  COUNT(m.message_id) AS sent_message_count,
  MAX(m.sent_at) AS last_sent_at
FROM users u
JOIN user_profiles p ON p.user_id = u.user_id
LEFT JOIN messages m ON m.sender_id = u.user_id
GROUP BY u.user_id, u.wechat_id, p.nickname;

CREATE OR REPLACE VIEW v_moment_interaction_statistics AS
SELECT
  mp.post_id,
  mp.author_id,
  up.nickname AS author_nickname,
  LEFT(mp.content, 80) AS content_preview,
  COUNT(DISTINCT ml.user_id) AS like_count,
  COUNT(DISTINCT mc.comment_id) AS comment_count,
  COUNT(DISTINCT ml.user_id) + COUNT(DISTINCT mc.comment_id) AS interaction_count,
  mp.created_at
FROM moment_posts mp
JOIN user_profiles up ON up.user_id = mp.author_id
LEFT JOIN moment_likes ml ON ml.post_id = mp.post_id
LEFT JOIN moment_comments mc ON mc.post_id = mp.post_id
WHERE mp.deleted_at IS NULL
GROUP BY mp.post_id, mp.author_id, up.nickname, mp.content, mp.created_at;

DELIMITER $$

CREATE TRIGGER trg_messages_after_insert
AFTER INSERT ON messages
FOR EACH ROW
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.sent_at
  WHERE conversation_id = NEW.conversation_id;

  INSERT INTO audit_logs(actor_id, action_type, target_type, target_id, detail)
  VALUES(NEW.sender_id, 'send_message', 'conversation', NEW.conversation_id, '发送聊天消息');
END$$

CREATE TRIGGER trg_moment_likes_after_insert
AFTER INSERT ON moment_likes
FOR EACH ROW
BEGIN
  INSERT INTO audit_logs(actor_id, action_type, target_type, target_id, detail)
  VALUES(NEW.user_id, 'like_moment', 'moment_post', NEW.post_id, '点赞朋友圈');
END$$

CREATE PROCEDURE sp_send_message(
  IN p_conversation_id BIGINT,
  IN p_sender_id BIGINT,
  IN p_content TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = p_sender_id
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '发送者不是该会话成员';
  END IF;

  INSERT INTO messages(conversation_id, sender_id, message_type, content)
  VALUES(p_conversation_id, p_sender_id, 'text', p_content);
END$$

CREATE PROCEDURE sp_friend_permission_summary(IN p_user_id BIGINT)
BEGIN
  SELECT
    COUNT(*) AS accepted_friend_count,
    SUM(CASE WHEN can_chat = 0 THEN 1 ELSE 0 END) AS cannot_chat_count,
    SUM(CASE WHEN can_view_my_moments = 0 THEN 1 ELSE 0 END) AS hidden_from_friend_count,
    SUM(CASE WHEN can_view_their_moments = 0 THEN 1 ELSE 0 END) AS cannot_view_friend_count,
    SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) AS starred_count
  FROM friendships
  WHERE status = 'accepted'
    AND (requester_id = p_user_id OR addressee_id = p_user_id);
END$$

DELIMITER ;
