const API = "http://127.0.0.1:5000/api";

const state = {
  user: JSON.parse(localStorage.getItem("momentsUser") || "null"),
  conversationId: null,
  conversationTitle: "",
  activeTab: "profile",
};

const $ = (id) => document.getElementById(id);

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.classList.add("show");
  window.setTimeout(() => box.classList.remove("show"), 2600);
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload.data ?? payload;
}

function requireLogin() {
  if (!state.user) {
    toast("请先登录");
    throw new Error("not logged in");
  }
  return state.user;
}

function setUser(user) {
  state.user = user;
  if (user) {
    localStorage.setItem("momentsUser", JSON.stringify(user));
    $("loginPanel").classList.add("hidden");
    $("userCard").classList.remove("hidden");
    $("nickname").textContent = user.nickname;
    $("wechatId").textContent = `${user.wechat_id} · 用户编号 ${user.user_id}`;
    $("avatar").textContent = user.nickname.slice(0, 1).toUpperCase();
  } else {
    localStorage.removeItem("momentsUser");
    $("loginPanel").classList.remove("hidden");
    $("userCard").classList.add("hidden");
  }
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === tabId);
  });
  const activeButton = document.querySelector(`[data-tab="${tabId}"]`);
  $("pageTitle").textContent = activeButton.dataset.title || activeButton.textContent.trim();
  refreshActiveTab().catch((error) => toast(error.message));
}

function applySidebarState() {
  const collapsed = localStorage.getItem("momentsSidebarCollapsed") === "1";
  $("appShell").classList.toggle("sidebar-collapsed", collapsed);
  $("sidebarToggle").setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function toggleSidebar() {
  const shell = $("appShell");
  const nextCollapsed = !shell.classList.contains("sidebar-collapsed");
  shell.classList.toggle("sidebar-collapsed", nextCollapsed);
  localStorage.setItem("momentsSidebarCollapsed", nextCollapsed ? "1" : "0");
  $("sidebarToggle").setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
}

async function refreshActiveTab() {
  if (!state.user) return;
  if (state.activeTab === "profile") await loadProfile();
  if (state.activeTab === "friends") {
    hideFriendAuxPanel();
    await loadFriends();
  }
  if (state.activeTab === "chat") await loadConversations();
  if (state.activeTab === "moments") await loadMoments();
  if (state.activeTab === "stats") await loadStats("messages");
}

function showFriendAuxPanel(title) {
  $("friendAuxTitle").textContent = title;
  $("friendAuxPanel").classList.remove("hidden");
}

function hideFriendAuxPanel() {
  $("friendAuxPanel").classList.add("hidden");
  $("userList").innerHTML = "";
}

function card(html) {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = html;
  return div;
}

function renderEmpty(target, text = "暂无数据") {
  target.innerHTML = `<div class="card meta">${text}</div>`;
}

function renderTable(rows) {
  const table = $("statsTable");
  if (!rows || rows.length === 0) {
    table.innerHTML = "<tr><td>暂无数据</td></tr>";
    return;
  }
  const columns = Object.keys(rows[0]);
  table.innerHTML = `
    <thead><tr>${columns.map((col) => `<th>${col}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows
        .map((row) => `<tr>${columns.map((col) => `<td>${row[col] ?? ""}</td>`).join("")}</tr>`)
        .join("")}
    </tbody>
  `;
}

async function login() {
  const user = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      wechat_id: $("loginWechatId").value.trim(),
      password: $("loginPassword").value,
    }),
  });
  setUser(user);
  toast("登录成功");
  await loadProfile();
  await Promise.all([loadFriends(), loadConversations(), loadMoments()]);
}

async function loadProfile() {
  const user = requireLogin();
  const profile = await request(`/profile/${user.user_id}`);
  $("profileNickname").value = profile.nickname || "";
  $("profileGender").value = profile.gender || "unknown";
  $("profileRegion").value = profile.region || "";
  $("profilePhone").value = profile.phone || "";
  $("profileSignature").value = profile.signature || "";
}

async function saveProfile() {
  const user = requireLogin();
  await request(`/profile/${user.user_id}`, {
    method: "PUT",
    body: JSON.stringify({
      nickname: $("profileNickname").value.trim(),
      gender: $("profileGender").value,
      region: $("profileRegion").value.trim(),
      signature: $("profileSignature").value.trim(),
    }),
  });
  state.user.nickname = $("profileNickname").value.trim();
  setUser(state.user);
  toast("资料已保存");
}

async function searchUsers() {
  const user = requireLogin();
  showFriendAuxPanel("搜索结果");
  const rows = await request(
    `/users/search?current_user_id=${user.user_id}&keyword=${encodeURIComponent($("searchKeyword").value)}`
  );
  const list = $("userList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.forEach((row) => {
    const node = card(`
      <header><strong>${row.nickname}</strong><span class="meta">#${row.user_id}</span></header>
      <div class="meta">${row.wechat_id} · ${row.region || ""}</div>
      <p>${row.signature || ""}</p>
      <div class="actions"><button data-add="${row.user_id}">加好友</button></div>
    `);
    list.appendChild(node);
  });
}

async function loadFriends() {
  const user = requireLogin();
  const rows = await request(`/friends/${user.user_id}`);
  const list = $("friendList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.forEach((row) => {
    const node = card(`
      <header><strong>${row.nickname}</strong><span class="meta">好友编号 ${row.friend_id}</span></header>
      <div class="meta">${row.wechat_id} · 关系编号 ${row.friendship_id}</div>
      <div class="actions">
        <button class="secondary" data-chat="${row.friend_id}" data-chat-name="${row.nickname}">发消息</button>
        <button data-permission="${row.friendship_id}" data-chat-ok="${row.can_chat}" data-view-my="${row.can_view_my_moments}" data-view-their="${row.can_view_their_moments}" data-star="${row.is_starred}">切换权限</button>
      </div>
      <p class="meta">聊天 ${row.can_chat} · 看我朋友圈 ${row.can_view_my_moments} · 我看对方 ${row.can_view_their_moments} · 星标 ${row.is_starred}</p>
    `);
    list.appendChild(node);
  });
}

async function loadRequests() {
  const user = requireLogin();
  showFriendAuxPanel("好友申请");
  const rows = await request(`/friends/requests/${user.user_id}`);
  const list = $("userList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list, "暂无待处理好友申请");
  rows.forEach((row) => {
    const node = card(`
      <header><strong>${row.nickname}</strong><span class="meta">${row.wechat_id}</span></header>
      <div class="meta">申请编号 ${row.friendship_id} · ${row.created_at}</div>
      <div class="actions">
        <button data-accept="${row.friendship_id}">同意</button>
        <button class="secondary" data-reject="${row.friendship_id}">拒绝</button>
      </div>
    `);
    list.appendChild(node);
  });
}

async function addFriend(addresseeId) {
  const user = requireLogin();
  await request("/friends/request", {
    method: "POST",
    body: JSON.stringify({ requester_id: user.user_id, addressee_id: Number(addresseeId) }),
  });
  toast("好友申请已发送");
}

async function handleFriendRequest(friendshipId, status) {
  const user = requireLogin();
  await request(`/friends/requests/${friendshipId}`, {
    method: "PATCH",
    body: JSON.stringify({ user_id: user.user_id, status }),
  });
  toast("好友申请已处理");
  await loadRequests();
  await loadFriends();
}

async function togglePermission(button) {
  const user = requireLogin();
  await request(`/friends/${button.dataset.permission}/permissions`, {
    method: "PATCH",
    body: JSON.stringify({
      user_id: user.user_id,
      can_chat: Number(button.dataset.chatOk) ? 0 : 1,
      can_view_my_moments: Number(button.dataset.viewMy) ? 0 : 1,
      can_view_their_moments: Number(button.dataset.viewTheir) ? 0 : 1,
      is_starred: Number(button.dataset.star) ? 0 : 1,
    }),
  });
  toast("朋友权限已切换");
  await loadFriends();
}

async function createPrivateConversation(friendId, friendName = "") {
  const user = requireLogin();
  const result = await request("/conversations/private", {
    method: "POST",
    body: JSON.stringify({ user_id: user.user_id, friend_id: Number(friendId) }),
  });
  state.conversationId = result.conversation_id;
  state.conversationTitle = friendName || `私聊 #${friendId}`;
  $("chatPeerTitle").textContent = state.conversationTitle;
  switchTab("chat");
  toast(result.reused ? "已打开已有私聊" : "已创建私聊");
  await loadConversations();
  await loadMessages();
}

async function loadConversations() {
  const user = requireLogin();
  const rows = await request(`/conversations/${user.user_id}`);
  const list = $("conversationList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.forEach((row) => {
    const node = card(`
      <header><strong>${row.title || "未命名会话"}</strong><span class="meta">#${row.conversation_id}</span></header>
      <div class="meta">${row.conversation_type} · ${row.member_count} 人 · ${row.last_message_at || "暂无消息"}</div>
    `);
    node.classList.add("conversation-card");
    node.dataset.openConversation = row.conversation_id;
    node.dataset.conversationTitle = row.title || "未命名会话";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `打开聊天：${row.title || "未命名会话"}`);
    if (Number(row.conversation_id) === Number(state.conversationId)) {
      node.classList.add("selected");
    }
    list.appendChild(node);
  });
}

async function loadMessages() {
  const user = requireLogin();
  if (!state.conversationId) return renderEmpty($("messageList"), "请选择会话");
  $("chatPeerTitle").textContent = state.conversationTitle || `会话 #${state.conversationId}`;
  const keyword = encodeURIComponent($("messageKeyword").value.trim());
  const rows = await request(`/messages/${state.conversationId}?user_id=${user.user_id}&keyword=${keyword}`);
  const list = $("messageList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.reverse().forEach((row) => {
    const node = document.createElement("div");
    node.className = `message ${Number(row.sender_id) === Number(user.user_id) ? "own" : ""}`;
    node.innerHTML = `
      <div class="bubble">
        <strong>${row.sender}</strong>
        <p>${row.content}</p>
        <span class="meta">${row.sent_at}</span>
      </div>
    `;
    list.appendChild(node);
  });
  list.scrollTop = list.scrollHeight;
}

async function sendMessage() {
  const user = requireLogin();
  const content = $("messageContent").value.trim();
  if (!state.conversationId || !content) return toast("请选择会话并输入消息");
  await request("/messages", {
    method: "POST",
    body: JSON.stringify({ conversation_id: state.conversationId, sender_id: user.user_id, content }),
  });
  $("messageContent").value = "";
  await loadMessages();
  await loadConversations();
}

async function uploadMomentImages() {
  const files = Array.from($("momentImages").files || []);
  const uploadedUrls = [];
  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API}/uploads`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || "图片上传失败");
    }
    uploadedUrls.push(payload.data.url);
  }
  return uploadedUrls;
}

function previewMomentImages() {
  const files = Array.from($("momentImages").files || []);
  const preview = $("momentPreview");
  preview.innerHTML = "";
  files.forEach((file) => {
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(image.src);
    image.alt = file.name;
    preview.appendChild(image);
  });
}

async function publishMoment() {
  const user = requireLogin();
  const content = $("momentContent").value.trim();
  if (!content) return toast("请输入朋友圈内容");
  const mediaUrls = await uploadMomentImages();
  await request("/moments", {
    method: "POST",
    body: JSON.stringify({
      author_id: user.user_id,
      content,
      visibility_type: $("momentVisibility").value,
      location: $("momentLocation").value.trim(),
      media_urls: mediaUrls,
    }),
  });
  $("momentContent").value = "";
  $("momentImages").value = "";
  $("momentPreview").innerHTML = "";
  toast("朋友圈已发布");
  await loadMoments();
}

async function loadMoments() {
  const user = requireLogin();
  const rows = await request(`/moments/${user.user_id}`);
  const list = $("momentList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.forEach((row) => {
    const node = document.createElement("article");
    node.className = "moment";
    const mediaHtml = (row.media || [])
      .map((item) => `<img src="${item.media_url}" alt="朋友圈图片" loading="lazy" />`)
      .join("");
    const commentsHtml = (row.comments || [])
      .slice(0, 6)
      .map((item) => `<p><strong>${item.nickname}</strong>：${item.content}</p>`)
      .join("");
    const avatarText = (row.author || "U").slice(0, 1).toUpperCase();
    node.innerHTML = `
      <div class="moment-avatar">${avatarText}</div>
      <div class="moment-body">
        <header>
          <strong>${row.author}</strong>
          <span class="meta">${row.visibility_type}</span>
        </header>
        <p class="moment-text">${row.content}</p>
        ${mediaHtml ? `<div class="moment-media">${mediaHtml}</div>` : ""}
        <div class="moment-footer">
          <span class="meta">${row.location || "未标注位置"} · ${row.created_at}</span>
          <div class="moment-actions">
            <button data-like="${row.post_id}">赞</button>
            <button data-comment="${row.post_id}">评论</button>
          </div>
        </div>
        <div class="moment-social">
          <div class="meta">${row.like_count} 人觉得不错 · ${row.comment_count} 条评论</div>
          ${commentsHtml ? `<div class="moment-comments">${commentsHtml}</div>` : ""}
        </div>
      </div>
    `;
    list.appendChild(node);
  });
}

async function likeMoment(postId) {
  const user = requireLogin();
  await request(`/moments/${postId}/like`, {
    method: "POST",
    body: JSON.stringify({ user_id: user.user_id }),
  });
  await loadMoments();
}

async function commentMoment(postId) {
  const user = requireLogin();
  const content = window.prompt("评论内容");
  if (!content) return;
  await request(`/moments/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ user_id: user.user_id, content }),
  });
  await loadMoments();
}

async function loadStats(kind) {
  const user = requireLogin();
  const rows = await request(`/statistics/${user.user_id}/${kind}`);
  renderTable(rows);
}

async function health() {
  const result = await request("/health");
  $("statusText").textContent = `MySQL：${result.database_name} · ${result.server_time}`;
  toast("后端和 MySQL 连接正常");
}

function bindEvents() {
  $("loginBtn").addEventListener("click", () => login().catch((error) => toast(error.message)));
  $("logoutBtn").addEventListener("click", () => setUser(null));
  $("sidebarToggle").addEventListener("click", toggleSidebar);
  $("healthBtn").addEventListener("click", () => health().catch((error) => toast(error.message)));
  $("loadProfileBtn").addEventListener("click", () => loadProfile().catch((error) => toast(error.message)));
  $("saveProfileBtn").addEventListener("click", () => saveProfile().catch((error) => toast(error.message)));
  $("searchUserBtn").addEventListener("click", () => searchUsers().catch((error) => toast(error.message)));
  $("loadFriendsBtn").addEventListener("click", () => {
    hideFriendAuxPanel();
    loadFriends().catch((error) => toast(error.message));
  });
  $("loadRequestsBtn").addEventListener("click", () => loadRequests().catch((error) => toast(error.message)));
  $("loadConversationsBtn").addEventListener("click", () => loadConversations().catch((error) => toast(error.message)));
  $("searchMessagesBtn").addEventListener("click", () => loadMessages().catch((error) => toast(error.message)));
  $("sendMessageBtn").addEventListener("click", () => sendMessage().catch((error) => toast(error.message)));
  $("publishMomentBtn").addEventListener("click", () => publishMoment().catch((error) => toast(error.message)));
  $("loadMomentsBtn").addEventListener("click", () => loadMoments().catch((error) => toast(error.message)));
  $("momentImages").addEventListener("change", previewMomentImages);

  document.querySelector(".tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (button) switchTab(button.dataset.tab);
  });

  document.body.addEventListener("click", (event) => {
    const conversationCard = event.target.closest(".conversation-card");
    if (conversationCard) {
      state.conversationId = Number(conversationCard.dataset.openConversation);
      state.conversationTitle = conversationCard.dataset.conversationTitle || `会话 #${state.conversationId}`;
      $("chatPeerTitle").textContent = state.conversationTitle;
      loadMessages().catch((error) => toast(error.message));
      loadConversations().catch(() => {});
      return;
    }

    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.add) addFriend(target.dataset.add).catch((error) => toast(error.message));
    if (target.dataset.accept) handleFriendRequest(target.dataset.accept, "accepted").catch((error) => toast(error.message));
    if (target.dataset.reject) handleFriendRequest(target.dataset.reject, "rejected").catch((error) => toast(error.message));
    if (target.dataset.permission) togglePermission(target).catch((error) => toast(error.message));
    if (target.dataset.chat) {
      createPrivateConversation(target.dataset.chat, target.dataset.chatName).catch((error) => toast(error.message));
    }
    if (target.dataset.openConversation) {
      state.conversationId = Number(target.dataset.openConversation);
      state.conversationTitle = target.dataset.conversationTitle || `会话 #${state.conversationId}`;
      $("chatPeerTitle").textContent = state.conversationTitle;
      loadMessages().catch((error) => toast(error.message));
    }
    if (target.dataset.like) likeMoment(target.dataset.like).catch((error) => toast(error.message));
    if (target.dataset.comment) commentMoment(target.dataset.comment).catch((error) => toast(error.message));
    if (target.dataset.stat) loadStats(target.dataset.stat).catch((error) => toast(error.message));
  });

  document.body.addEventListener("keydown", (event) => {
    const conversationCard = event.target.closest(".conversation-card");
    if (!conversationCard || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    conversationCard.click();
  });
}

bindEvents();
applySidebarState();
setUser(state.user);
if (state.user) {
  loadProfile().catch(() => {});
  loadFriends().catch(() => {});
  loadConversations().catch(() => {});
  loadMoments().catch(() => {});
}
