const API = "http://127.0.0.1:5000/api";

const state = {
  user: JSON.parse(localStorage.getItem("momentsUser") || "null"),
  conversationId: null,
  conversationTitle: "",
  activeTab: "moments",
  friendFilter: "all",
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
  const previousUserId = state.user?.user_id;
  state.user = user;
  if (user) {
    if (previousUserId !== user.user_id) {
      state.conversationId = null;
      state.conversationTitle = "";
      clearUserScopedViews();
    }
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
    state.conversationId = null;
    state.conversationTitle = "";
    clearUserScopedViews();
  }
  updateTopbarActions();
}

function clearUserScopedViews() {
  $("friendList").innerHTML = "";
  $("userList").innerHTML = "";
  $("conversationList").innerHTML = "";
  $("messageList").innerHTML = "";
  $("momentList").innerHTML = "";
  $("statsTable").innerHTML = "";
  $("chatPeerTitle").textContent = "消息";
  hideFriendAuxPanel();
}

async function refreshAllData() {
  const user = requireLogin();
  const profilePromise = loadProfile();
  const friendsPromise = loadFriends();
  const conversationsPromise = loadConversations();
  const momentsPromise = loadMoments();
  const statsPromise = loadStats("messages");
  await Promise.all([profilePromise, friendsPromise, conversationsPromise, momentsPromise, statsPromise]);
  if (state.conversationId) await loadMessages();
  return user;
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
  updateTopbarActions();
  refreshActiveTab().catch((error) => toast(error.message));
}

function updateTopbarActions() {
  const shouldShowComposerButton = state.activeTab === "moments" && Boolean(state.user);
  $("toggleComposerBtn").classList.toggle("hidden", !shouldShowComposerButton);
  if (!shouldShowComposerButton) closeMomentComposer();
}

function openMomentComposer() {
  $("momentComposer").classList.remove("hidden");
  $("momentContent").focus();
}

function closeMomentComposer() {
  $("momentComposer").classList.add("hidden");
}

function toggleMomentComposer() {
  $("momentComposer").classList.contains("hidden") ? openMomentComposer() : closeMomentComposer();
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
    await loadFriends(state.friendFilter === "starred");
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

function setFriendFilter(filter) {
  state.friendFilter = filter;
  document.querySelectorAll("[data-friend-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.friendFilter === filter);
  });
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

function checked(value) {
  return Number(value) ? "checked" : "";
}

function latestMomentText(row) {
  if (!row.latest_moment_at) return "最近还没有朋友圈";
  const location = row.latest_moment_location ? ` · ${row.latest_moment_location}` : "";
  const preview = row.latest_moment_preview ? ` · ${row.latest_moment_preview}` : "";
  return `${row.latest_moment_at}${location}${preview}`;
}

function displayFriendRemark(row) {
  const remark = (row.my_remark || "").trim();
  if (!remark || /^备注\d+$/.test(remark)) return "";
  return remark;
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
  await refreshAllData();
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

async function loadFriends(starredOnly = state.friendFilter === "starred", options = {}) {
  const user = requireLogin();
  if (!options.preserveFilter) setFriendFilter(starredOnly ? "starred" : "all");
  if (!options.preserveAux) hideFriendAuxPanel();
  const query = starredOnly ? "?starred=1" : "";
  const rows = await request(`/friends/${user.user_id}${query}`);
  const list = $("friendList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list, starredOnly ? "暂无星标朋友" : "暂无好友");
  rows.forEach((row) => {
    const remark = displayFriendRemark(row);
    const displayName = remark || row.nickname || row.wechat_id;
    const avatarText = (displayName || "U").slice(0, 1).toUpperCase();
    const avatarImage = row.avatar_url
      ? `<img src="${row.avatar_url}" alt="${displayName}头像" onerror="this.style.display='none'" />`
      : "";
    const node = card(`
      <div class="friend-main">
        <div class="friend-avatar">${avatarImage}<span>${avatarText}</span></div>
        <div class="friend-info">
          <header>
            <strong>${displayName}</strong>
            <span class="meta">${row.is_starred ? "星标" : ""}${row.status === "blocked" ? " · 已拉黑" : ""}</span>
          </header>
          <div class="meta">${row.wechat_id}${remark ? ` · 昵称 ${row.nickname}` : ""}${row.signature ? ` · ${row.signature}` : ""}</div>
          <p class="friend-moment">${latestMomentText(row)}</p>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" data-chat="${row.friend_id}" data-chat-name="${row.nickname}">发消息</button>
        <button data-toggle-permission-panel="${row.friendship_id}">权限设置</button>
      </div>
      <div class="permission-panel hidden" id="permission-${row.friendship_id}">
        <label>好友备注<input data-permission-field="remark" value="${remark}" placeholder="未设置时显示对方昵称" /></label>
        <label><input type="checkbox" data-permission-field="can_chat" ${checked(row.can_chat)} /> 允许聊天</label>
        <label><input type="checkbox" data-permission-field="can_view_my_moments" ${checked(row.can_view_my_moments)} /> 允许对方看我的朋友圈</label>
        <label><input type="checkbox" data-permission-field="can_view_their_moments" ${checked(row.can_view_their_moments)} /> 允许我看对方朋友圈</label>
        <label><input type="checkbox" data-permission-field="is_starred" ${checked(row.is_starred)} /> 星标朋友</label>
        <label><input type="checkbox" data-permission-field="blocked" ${row.status === "blocked" ? "checked" : ""} /> 加入黑名单</label>
        <button data-save-permissions="${row.friendship_id}">保存权限</button>
      </div>
    `);
    list.appendChild(node);
  });
}

async function loadRequests() {
  const user = requireLogin();
  setFriendFilter("requests");
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
  await loadFriends(false, { preserveAux: true, preserveFilter: true });
}

function togglePermissionPanel(friendshipId) {
  const panel = $(`permission-${friendshipId}`);
  if (panel) panel.classList.toggle("hidden");
}

async function savePermissions(friendshipId) {
  const user = requireLogin();
  const panel = $(`permission-${friendshipId}`);
  if (!panel) return;
  const valueOf = (field) => panel.querySelector(`[data-permission-field="${field}"]`);
  await request(`/friends/${friendshipId}/permissions`, {
    method: "PATCH",
    body: JSON.stringify({
      user_id: user.user_id,
      remark: valueOf("remark").value.trim(),
      can_chat: valueOf("can_chat").checked,
      can_view_my_moments: valueOf("can_view_my_moments").checked,
      can_view_their_moments: valueOf("can_view_their_moments").checked,
      is_starred: valueOf("is_starred").checked,
      blocked: valueOf("blocked").checked,
    }),
  });
  toast("朋友权限已保存");
  await loadFriends(state.friendFilter === "starred");
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
  closeMomentComposer();
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

function bindEvents() {
  $("loginBtn").addEventListener("click", () => login().catch((error) => toast(error.message)));
  $("logoutBtn").addEventListener("click", () => setUser(null));
  $("sidebarToggle").addEventListener("click", toggleSidebar);
  $("toggleComposerBtn").addEventListener("click", toggleMomentComposer);
  $("closeComposerBtn").addEventListener("click", closeMomentComposer);
  $("saveProfileBtn").addEventListener("click", () => saveProfile().catch((error) => toast(error.message)));
  $("searchUserBtn").addEventListener("click", () => searchUsers().catch((error) => toast(error.message)));
  $("showAllFriendsBtn").addEventListener("click", () => loadFriends(false).catch((error) => toast(error.message)));
  $("showStarredFriendsBtn").addEventListener("click", () => loadFriends(true).catch((error) => toast(error.message)));
  $("loadRequestsBtn").addEventListener("click", () => loadRequests().catch((error) => toast(error.message)));
  $("searchMessagesBtn").addEventListener("click", () => loadMessages().catch((error) => toast(error.message)));
  $("sendMessageBtn").addEventListener("click", () => sendMessage().catch((error) => toast(error.message)));
  $("publishMomentBtn").addEventListener("click", () => publishMoment().catch((error) => toast(error.message)));
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
    if (target.dataset.togglePermissionPanel) togglePermissionPanel(target.dataset.togglePermissionPanel);
    if (target.dataset.savePermissions) savePermissions(target.dataset.savePermissions).catch((error) => toast(error.message));
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
updateTopbarActions();
if (state.user) {
  refreshAllData().catch(() => {});
}
