const API = "http://127.0.0.1:5000/api";

const state = {
  user: JSON.parse(localStorage.getItem("momentsUser") || "null"),
  conversationId: null,
  conversationTitle: "",
  profileUserId: null,
  friends: [],
  selectedFriendId: null,
  miniConversationId: null,
  miniConversationTitle: "",
  activeTab: "moments",
  friendFilter: "all",
  viewerIndex: 0,
  viewerItems: [],
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
      state.profileUserId = user.user_id;
      clearUserScopedViews();
    }
    localStorage.setItem("momentsUser", JSON.stringify(user));
    $("loginPanel").classList.add("hidden");
    $("userCard").classList.remove("hidden");
    $("nickname").textContent = user.nickname;
    $("wechatId").textContent = user.wechat_id;
    $("avatar").textContent = user.nickname.slice(0, 1).toUpperCase();
  } else {
    localStorage.removeItem("momentsUser");
    $("loginPanel").classList.remove("hidden");
    $("userCard").classList.add("hidden");
    state.conversationId = null;
    state.conversationTitle = "";
    state.profileUserId = null;
    clearUserScopedViews();
  }
  updateTopbarActions();
}

function clearUserScopedViews() {
  $("friendList").innerHTML = "";
  $("userList").innerHTML = "";
  $("conversationList").innerHTML = "";
  $("messageList").innerHTML = "";
  $("miniMessageList").innerHTML = "";
  $("momentList").innerHTML = "";
  $("profileMomentList").innerHTML = "";
  $("statsTable").innerHTML = "";
  $("historyResults").innerHTML = "";
  state.friends = [];
  state.selectedFriendId = null;
  state.miniConversationId = null;
  state.miniConversationTitle = "";
  $("chatPeerTitle").textContent = "消息";
  resetFriendDetail();
  closeHistoryDrawer();
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

function openHistoryDrawer() {
  updateHistoryTitle();
  if (!$("historyResults").innerHTML.trim()) {
    renderHistoryNotice("输入关键词后，结果会直接显示在这里。");
  }
  $("historyDrawer").classList.remove("hidden");
  $("messageKeyword").focus();
}

function closeHistoryDrawer() {
  $("historyDrawer").classList.add("hidden");
}

function updateHistoryTitle() {
  $("historyConversationTitle").textContent = state.conversationId
    ? state.conversationTitle || `会话 #${state.conversationId}`
    : "还没有打开会话";
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
  if (state.activeTab === "profile") await loadProfile(state.profileUserId || state.user.user_id);
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

function avatarMarkup(row, name, className = "friend-avatar", userId = row.user_id || row.friend_id || row.author_id) {
  const avatarText = (name || "U").slice(0, 1).toUpperCase();
  const avatarImage = row.avatar_url
    ? `<img src="${row.avatar_url}" alt="${name}头像" onerror="this.style.display='none'" />`
    : "";
  return `<div class="${className} clickable-avatar" data-profile-id="${userId}" title="查看资料">${avatarImage}<span>${avatarText}</span></div>`;
}

function renderChatEmpty(text) {
  $("messageList").innerHTML = `<div class="message-empty">${text}</div>`;
}

function renderHistoryNotice(text) {
  $("historyResults").innerHTML = `<div class="drawer-hint">${text}</div>`;
}

function resetHistorySearch() {
  $("messageKeyword").value = "";
  updateHistoryTitle();
  renderHistoryNotice("输入关键词后，结果会直接显示在这里。");
}

function messageBubble(row, user, extraClass = "") {
  const ownClass = Number(row.sender_id) === Number(user.user_id) ? "own" : "";
  const node = document.createElement("div");
  node.className = `message ${ownClass} ${extraClass}`.trim();
  node.innerHTML = `
    <div class="bubble">
      <strong class="clickable-name" data-profile-id="${row.sender_id}">${row.sender}</strong>
      <p>${row.content}</p>
      <span class="meta">${row.sent_at}</span>
    </div>
  `;
  return node;
}

function resetFriendDetail() {
  $("friendDetail").classList.add("hidden");
  $("friendDetailEmpty").classList.remove("hidden");
  $("friendPermissionPanel").classList.add("hidden");
  $("friendPermissionPanel").innerHTML = "";
}

function mediaLayoutClass(count) {
  if (count <= 1) return "single";
  if (count === 2) return "double";
  if (count === 3) return "triple";
  if (count === 4) return "quad";
  return "grid";
}

function collectVisibleImages(clickedImage) {
  const activeView = document.querySelector(".view.active");
  const images = Array.from(activeView?.querySelectorAll(".moment-media img[data-image-url]") || []);
  state.viewerItems = images.map((image) => ({
    url: image.dataset.imageUrl,
    author: image.dataset.imageAuthor,
    caption: image.dataset.imageCaption,
    time: image.dataset.imageTime,
    imageIndex: image.dataset.imageIndex,
    imageTotal: image.dataset.imageTotal,
  }));
  state.viewerIndex = Math.max(0, images.indexOf(clickedImage));
}

function showViewerImage() {
  const item = state.viewerItems[state.viewerIndex];
  if (!item) return closeImageViewer();
  $("viewerImage").src = item.url;
  $("viewerAuthor").textContent = item.author || "";
  $("viewerCaption").textContent = item.caption || "";
  $("viewerCounter").textContent = `${state.viewerIndex + 1}/${state.viewerItems.length} · 本动态 ${item.imageIndex}/${item.imageTotal} · ${item.time || ""}`;
}

function openImageViewer(image) {
  collectVisibleImages(image);
  if (!state.viewerItems.length) return;
  $("imageViewer").classList.remove("hidden");
  document.body.classList.add("viewer-open");
  showViewerImage();
}

function closeImageViewer() {
  $("imageViewer").classList.add("hidden");
  document.body.classList.remove("viewer-open");
  $("viewerImage").removeAttribute("src");
}

function moveViewer(step) {
  if (!state.viewerItems.length) return;
  state.viewerIndex = (state.viewerIndex + step + state.viewerItems.length) % state.viewerItems.length;
  showViewerImage();
}

function renderTable(rows) {
  const table = $("statsTable");
  if (!rows || rows.length === 0) {
    table.innerHTML = "<tr><td>暂无数据</td></tr>";
    return;
  }
  const columns = Object.keys(rows[0]).filter((col) => col !== "user_id");
  const headerLabels = {
    wechat_id: "账号",
    nickname: "昵称",
  };
  table.innerHTML = `
    <thead><tr>${columns.map((col) => `<th>${headerLabels[col] || col}</th>`).join("")}</tr></thead>
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

async function openProfile(userId) {
  const user = requireLogin();
  state.profileUserId = Number(userId) || user.user_id;
  switchTab("profile");
}

async function loadProfile(userId = null) {
  const user = requireLogin();
  const targetUserId = Number(userId) || user.user_id;
  state.profileUserId = targetUserId;
  const profile = await request(`/profile/${targetUserId}`);
  const isSelf = Number(targetUserId) === Number(user.user_id);
  $("profileAvatar").innerHTML = profile.avatar_url
    ? `<img src="${profile.avatar_url}" alt="${profile.nickname || profile.wechat_id}头像" onerror="this.style.display='none'" /><span>${(profile.nickname || "U").slice(0, 1).toUpperCase()}</span>`
    : `<span>${(profile.nickname || "U").slice(0, 1).toUpperCase()}</span>`;
  $("profileDisplayName").textContent = profile.nickname || profile.wechat_id;
  $("profileSignatureText").textContent = profile.signature || "暂无个性签名";
  $("profileModeText").textContent = isSelf ? "我的资料" : "好友资料";
  $("profileMomentsTitle").textContent = isSelf ? "我的朋友圈" : `${profile.nickname || "ta"} 的朋友圈`;
  $("profileInfoGrid").innerHTML = `
    <div><span>账号</span><strong>${profile.wechat_id}</strong></div>
    <div><span>地区</span><strong>${profile.region || "未填写"}</strong></div>
    <div><span>性别</span><strong>${profile.gender || "unknown"}</strong></div>
    <div><span>手机号</span><strong>${isSelf ? profile.phone || "未填写" : "仅本人可见"}</strong></div>
    <div><span>最近登录</span><strong>${profile.last_login_at || "暂无记录"}</strong></div>
  `;
  $("profileEditor").classList.toggle("hidden", !isSelf);
  $("profileChatBtn").classList.toggle("hidden", isSelf);
  $("profileChatBtn").dataset.chat = profile.user_id;
  $("profileChatBtn").dataset.chatName = profile.nickname || profile.wechat_id;
  $("profileMomentsBtn").textContent = isSelf ? "我的朋友圈" : "ta 的朋友圈";
  if (isSelf) {
    $("profileNickname").value = profile.nickname || "";
    $("profileGender").value = profile.gender || "unknown";
    $("profileRegion").value = profile.region || "";
    $("profilePhone").value = profile.phone || "";
    $("profileSignature").value = profile.signature || "";
  }
  await loadProfileMoments(targetUserId);
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
  await loadProfile(state.user.user_id);
}

async function searchUsers() {
  const user = requireLogin();
  showFriendAuxPanel("非好友搜索");
  const rows = await request(
    `/users/search?current_user_id=${user.user_id}&keyword=${encodeURIComponent($("searchKeyword").value)}`
  );
  const list = $("userList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.forEach((row) => {
    const node = card(`
      <div class="friend-main">
        ${avatarMarkup(row, row.nickname || row.wechat_id, "friend-avatar", row.user_id)}
        <div class="friend-info">
          <header><strong>${row.nickname}</strong></header>
          <div class="meta">账号 ${row.wechat_id}${row.phone ? ` · 手机 ${row.phone}` : ""}${row.region ? ` · ${row.region}` : ""}</div>
          <p>${row.signature || ""}</p>
        </div>
      </div>
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
  state.friends = rows;
  const list = $("friendList");
  list.innerHTML = "";
  if (!rows.length) {
    resetFriendDetail();
    return renderEmpty(list, starredOnly ? "暂无星标朋友" : "暂无好友");
  }
  rows.forEach((row) => {
    const remark = displayFriendRemark(row);
    const displayName = remark || row.nickname || row.wechat_id;
    const node = card(`
      <div class="friend-main">
        ${avatarMarkup(row, displayName, "friend-avatar", row.friend_id)}
        <div class="friend-info">
          <header>
            <strong>${displayName}</strong>
            <span class="friend-badges">
              <button class="star-badge ${row.is_starred ? "active" : ""}" data-toggle-star="${row.friendship_id}" title="${row.is_starred ? "取消星标" : "设为星标"}" aria-label="${row.is_starred ? "取消星标" : "设为星标"}">★</button>
              ${row.status === "blocked" ? `<span class="blocked-badge">已拉黑</span>` : ""}
            </span>
          </header>
          <div class="meta">账号 ${row.wechat_id}${remark ? ` · 昵称 ${row.nickname}` : ""}${row.signature ? ` · ${row.signature}` : ""}</div>
          <p class="friend-moment">${latestMomentText(row)}</p>
        </div>
      </div>
    `);
    node.classList.add("friend-card");
    node.dataset.selectFriend = row.friend_id;
    if (Number(row.friend_id) === Number(state.selectedFriendId)) node.classList.add("selected");
    list.appendChild(node);
  });
  if (state.selectedFriendId && rows.some((row) => Number(row.friend_id) === Number(state.selectedFriendId))) {
    renderFriendDetail(state.selectedFriendId);
  } else {
    resetFriendDetail();
  }
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
      <header><strong>${row.nickname}</strong><span class="meta">账号 ${row.wechat_id}</span></header>
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

function friendById(friendId) {
  return state.friends.find((row) => Number(row.friend_id) === Number(friendId));
}

function renderFriendDetail(friendId) {
  const row = friendById(friendId);
  if (!row) return resetFriendDetail();
  state.selectedFriendId = Number(friendId);
  const remark = displayFriendRemark(row);
  const displayName = remark || row.nickname || row.wechat_id;
  $("friendDetailEmpty").classList.add("hidden");
  $("friendDetail").classList.remove("hidden");
  const detailAvatar = $("friendDetailAvatar");
  detailAvatar.classList.add("clickable-avatar");
  detailAvatar.dataset.profileId = row.friend_id;
  detailAvatar.innerHTML = `${row.avatar_url ? `<img src="${row.avatar_url}" alt="${displayName}头像" onerror="this.style.display='none'" />` : ""}<span>${(displayName || "U").slice(0, 1).toUpperCase()}</span>`;
  $("friendDetailName").textContent = displayName;
  $("friendDetailMeta").textContent = `账号 ${row.wechat_id}${remark ? ` · 昵称 ${row.nickname}` : ""}`;
  $("friendDetailSignature").textContent = row.signature || "这个人还没有留下个性签名";
  $("friendLastMoment").textContent = latestMomentText(row);
  $("friendProfileBtn").dataset.profileId = row.friend_id;
  $("friendMomentsBtn").dataset.profileId = row.friend_id;
  $("friendMomentsBtn").dataset.profileMoments = "1";
  $("openFullChatBtn").dataset.chat = row.friend_id;
  $("openFullChatBtn").dataset.chatName = displayName;
  $("openFullChatBtn").classList.toggle("hidden", !Number(row.can_chat));
  renderPermissionPanel(row);
  document.querySelectorAll(".friend-card").forEach((cardNode) => {
    cardNode.classList.toggle("selected", Number(cardNode.dataset.selectFriend) === Number(friendId));
  });
}

function renderPermissionPanel(row) {
  const remark = displayFriendRemark(row);
  $("friendPermissionPanel").innerHTML = `
    <label>备注<input data-permission-field="remark" value="${remark}" placeholder="未设置时显示对方昵称" /></label>
    <div class="permission-switches">
      <label><input type="checkbox" data-permission-field="can_chat" ${checked(row.can_chat)} /> 允许聊天</label>
      <label><input type="checkbox" data-permission-field="can_view_my_moments" ${checked(row.can_view_my_moments)} /> 对方可看我</label>
      <label><input type="checkbox" data-permission-field="can_view_their_moments" ${checked(row.can_view_their_moments)} /> 我可看对方</label>
      <label><input type="checkbox" data-permission-field="is_starred" ${checked(row.is_starred)} /> 星标朋友</label>
      <label><input type="checkbox" data-permission-field="blocked" ${row.status === "blocked" ? "checked" : ""} /> 加入黑名单</label>
    </div>
    <button data-save-permissions="${row.friendship_id}">保存管理设置</button>
  `;
}

async function selectFriend(friendId) {
  const row = friendById(friendId);
  if (!row) return;
  renderFriendDetail(friendId);
  await openMiniConversation(row);
}

function togglePermissionPanel() {
  $("friendPermissionPanel").classList.toggle("hidden");
}

async function savePermissions(friendshipId) {
  const user = requireLogin();
  const panel = $("friendPermissionPanel");
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
  const selectedFriendId = state.selectedFriendId;
  await loadFriends(state.friendFilter === "starred");
  if (selectedFriendId) renderFriendDetail(selectedFriendId);
}

async function toggleStar(friendshipId) {
  const user = requireLogin();
  const row = state.friends.find((item) => Number(item.friendship_id) === Number(friendshipId));
  if (!row) return;
  const nextStarred = !Number(row.is_starred);
  await request(`/friends/${friendshipId}/permissions`, {
    method: "PATCH",
    body: JSON.stringify({
      user_id: user.user_id,
      remark: (row.my_remark || "").trim(),
      can_chat: Boolean(Number(row.can_chat)),
      can_view_my_moments: Boolean(Number(row.can_view_my_moments)),
      can_view_their_moments: Boolean(Number(row.can_view_their_moments)),
      is_starred: nextStarred,
      blocked: row.status === "blocked",
    }),
  });
  toast(nextStarred ? "已设为星标朋友" : "已取消星标");
  const selectedFriendId = state.selectedFriendId;
  await loadFriends(state.friendFilter === "starred");
  if (selectedFriendId) renderFriendDetail(selectedFriendId);
}

async function ensurePrivateConversation(friendId, friendName = "") {
  const user = requireLogin();
  const result = await request("/conversations/private", {
    method: "POST",
    body: JSON.stringify({ user_id: user.user_id, friend_id: Number(friendId) }),
  });
  return {
    conversationId: result.conversation_id,
    conversationTitle: friendName || `私聊 #${friendId}`,
    reused: result.reused,
  };
}

async function createPrivateConversation(friendId, friendName = "") {
  const result = await ensurePrivateConversation(friendId, friendName);
  const previousConversationId = state.conversationId;
  state.conversationId = result.conversationId;
  state.conversationTitle = result.conversationTitle;
  if (Number(previousConversationId) !== Number(state.conversationId)) resetHistorySearch();
  $("chatPeerTitle").textContent = state.conversationTitle;
  switchTab("chat");
  toast(result.reused ? "已打开已有私聊" : "已创建私聊");
  await loadConversations();
  await loadMessages();
}

async function openMiniConversation(row) {
  if (!Number(row.can_chat)) {
    state.miniConversationId = null;
    state.miniConversationTitle = "";
    $("miniMessageList").innerHTML = `<div class="message-empty">当前权限不允许聊天</div>`;
    return;
  }
  const displayName = displayFriendRemark(row) || row.nickname || row.wechat_id;
  const result = await ensurePrivateConversation(row.friend_id, displayName);
  state.miniConversationId = result.conversationId;
  state.miniConversationTitle = result.conversationTitle;
  await loadMiniMessages();
}

async function loadConversations() {
  const user = requireLogin();
  const rows = await request(`/conversations/${user.user_id}`);
  const list = $("conversationList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.forEach((row) => {
    const isPrivate = row.conversation_type === "private" && row.private_peer_id;
    const title = isPrivate ? row.private_peer_name || row.title || "未命名会话" : row.title || "未命名会话";
    const avatar = isPrivate
      ? avatarMarkup({ avatar_url: row.private_peer_avatar, user_id: row.private_peer_id }, row.private_peer_name || title, "friend-avatar", row.private_peer_id)
      : `<div class="friend-avatar group-avatar"><span>群</span></div>`;
    const node = card(`
      <div class="conversation-main">
        ${avatar}
        <div>
          <header><strong>${title}</strong><span class="meta">#${row.conversation_id}</span></header>
          <div class="meta">${row.conversation_type} · ${row.member_count} 人 · ${row.last_message_at || "暂无消息"}</div>
        </div>
      </div>
    `);
    node.classList.add("conversation-card");
    node.dataset.openConversation = row.conversation_id;
    node.dataset.conversationTitle = title;
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
  if (!state.conversationId) return renderChatEmpty("请选择一个会话开始聊天");
  $("chatPeerTitle").textContent = state.conversationTitle || `会话 #${state.conversationId}`;
  updateHistoryTitle();
  const rows = await request(`/messages/${state.conversationId}?user_id=${user.user_id}`);
  const list = $("messageList");
  list.innerHTML = "";
  if (!rows.length) return renderChatEmpty("还没有聊天记录，发一条消息开始吧");
  rows.reverse().forEach((row) => {
    list.appendChild(messageBubble(row, user));
  });
  list.scrollTop = list.scrollHeight;
}

async function searchMessageHistory() {
  const user = requireLogin();
  openHistoryDrawer();
  if (!state.conversationId) return renderHistoryNotice("先从左侧打开一个会话，再搜索聊天记录。");
  const keyword = $("messageKeyword").value.trim();
  if (!keyword) return renderHistoryNotice("输入关键词后，结果会直接显示在这里。");
  const rows = await request(
    `/messages/${state.conversationId}?user_id=${user.user_id}&keyword=${encodeURIComponent(keyword)}`
  );
  const results = $("historyResults");
  results.innerHTML = "";
  if (!rows.length) return renderHistoryNotice("没有搜索到相关聊天记录。");
  const summary = document.createElement("div");
  summary.className = "drawer-hint";
  summary.textContent = `找到 ${rows.length} 条相关记录`;
  results.appendChild(summary);
  rows.forEach((row) => {
    results.appendChild(messageBubble(row, user, "history-message"));
  });
}

async function loadMiniMessages() {
  const user = requireLogin();
  const list = $("miniMessageList");
  list.innerHTML = "";
  if (!state.miniConversationId) {
    list.innerHTML = `<div class="message-empty">选择好友后开始聊天</div>`;
    return;
  }
  const rows = await request(`/messages/${state.miniConversationId}?user_id=${user.user_id}`);
  if (!rows.length) {
    list.innerHTML = `<div class="message-empty">还没有聊天记录</div>`;
    return;
  }
  rows.reverse().slice(-12).forEach((row) => {
    list.appendChild(messageBubble(row, user, "mini-message"));
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

async function sendMiniMessage() {
  const user = requireLogin();
  const content = $("miniMessageContent").value.trim();
  if (!state.miniConversationId || !content) return toast("请选择好友并输入消息");
  await request("/messages", {
    method: "POST",
    body: JSON.stringify({ conversation_id: state.miniConversationId, sender_id: user.user_id, content }),
  });
  $("miniMessageContent").value = "";
  await loadMiniMessages();
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
  preview.className = `image-preview media-${mediaLayoutClass(files.length)}`;
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
  $("momentPreview").className = "image-preview";
  closeMomentComposer();
  toast("朋友圈已发布");
  await loadMoments();
}

function renderMoment(row) {
  const node = document.createElement("article");
  node.className = "moment";
  const mediaItems = row.media || [];
  const mediaHtml = mediaItems
    .map(
      (item, index) =>
        `<img src="${item.media_url}" alt="朋友圈图片" loading="lazy" data-image-url="${item.media_url}" data-image-author="${row.author}" data-image-caption="${row.content}" data-image-time="${row.created_at}" data-image-index="${index + 1}" data-image-total="${mediaItems.length}" />`
    )
    .join("");
  const commentsHtml = (row.comments || [])
    .slice(0, 6)
    .map((item) => `<p><strong>${item.nickname}</strong>：${item.content}</p>`)
    .join("");
  node.innerHTML = `
    ${avatarMarkup({ ...row, user_id: row.author_id }, row.author, "moment-avatar", row.author_id)}
    <div class="moment-body">
      <header>
        <strong class="clickable-name" data-profile-id="${row.author_id}">${row.author}</strong>
        <span class="meta">${row.visibility_type}</span>
      </header>
      <p class="moment-text">${row.content}</p>
      ${mediaHtml ? `<div class="moment-media media-${mediaLayoutClass(mediaItems.length)}">${mediaHtml}</div>` : ""}
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
  return node;
}

async function loadMoments() {
  const user = requireLogin();
  const rows = await request(`/moments/${user.user_id}`);
  const list = $("momentList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list);
  rows.forEach((row) => {
    list.appendChild(renderMoment(row));
  });
}

async function loadProfileMoments(profileUserId) {
  const user = requireLogin();
  const rows = await request(`/moments/${user.user_id}?author_id=${profileUserId}`);
  const list = $("profileMomentList");
  list.innerHTML = "";
  if (!rows.length) return renderEmpty(list, "这里还没有可见的朋友圈");
  rows.forEach((row) => list.appendChild(renderMoment(row)));
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
  $("openHistoryBtn").addEventListener("click", openHistoryDrawer);
  $("closeHistoryBtn").addEventListener("click", closeHistoryDrawer);
  $("closeFriendAuxBtn").addEventListener("click", hideFriendAuxPanel);
  $("friendManageBtn").addEventListener("click", togglePermissionPanel);
  $("miniSendMessageBtn").addEventListener("click", () => sendMiniMessage().catch((error) => toast(error.message)));
  $("profileMomentsBtn").addEventListener("click", () => $("profileMomentList").scrollIntoView({ behavior: "smooth" }));
  $("viewerCloseBtn").addEventListener("click", closeImageViewer);
  $("viewerPrevBtn").addEventListener("click", () => moveViewer(-1));
  $("viewerNextBtn").addEventListener("click", () => moveViewer(1));
  $("imageViewer").addEventListener("click", (event) => {
    if (event.target.id === "imageViewer") closeImageViewer();
  });
  $("saveProfileBtn").addEventListener("click", () => saveProfile().catch((error) => toast(error.message)));
  $("searchUserBtn").addEventListener("click", () => searchUsers().catch((error) => toast(error.message)));
  $("showAllFriendsBtn").addEventListener("click", () => loadFriends(false).catch((error) => toast(error.message)));
  $("showStarredFriendsBtn").addEventListener("click", () => loadFriends(true).catch((error) => toast(error.message)));
  $("loadRequestsBtn").addEventListener("click", () => loadRequests().catch((error) => toast(error.message)));
  $("searchMessagesBtn").addEventListener("click", () => searchMessageHistory().catch((error) => toast(error.message)));
  $("sendMessageBtn").addEventListener("click", () => sendMessage().catch((error) => toast(error.message)));
  $("publishMomentBtn").addEventListener("click", () => publishMoment().catch((error) => toast(error.message)));
  $("momentImages").addEventListener("change", previewMomentImages);

  document.querySelector(".tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (button) switchTab(button.dataset.tab);
  });

  document.body.addEventListener("click", (event) => {
    const imageTarget = event.target.closest(".moment-media img[data-image-url]");
    if (imageTarget) {
      openImageViewer(imageTarget);
      return;
    }

    const profileTarget = event.target.closest("[data-profile-id]");
    if (profileTarget) {
      event.stopPropagation();
      const shouldScrollToMoments = profileTarget.dataset.profileMoments === "1";
      openProfile(profileTarget.dataset.profileId)
        .then(() => {
          if (shouldScrollToMoments) {
            window.setTimeout(() => $("profileMomentList").scrollIntoView({ behavior: "smooth" }), 180);
          }
        })
        .catch((error) => toast(error.message));
      return;
    }

    const starTarget = event.target.closest("[data-toggle-star]");
    if (starTarget) {
      event.stopPropagation();
      toggleStar(starTarget.dataset.toggleStar).catch((error) => toast(error.message));
      return;
    }

    const conversationCard = event.target.closest(".conversation-card");
    if (conversationCard) {
      const previousConversationId = state.conversationId;
      state.conversationId = Number(conversationCard.dataset.openConversation);
      state.conversationTitle = conversationCard.dataset.conversationTitle || `会话 #${state.conversationId}`;
      if (Number(previousConversationId) !== Number(state.conversationId)) resetHistorySearch();
      $("chatPeerTitle").textContent = state.conversationTitle;
      loadMessages().catch((error) => toast(error.message));
      loadConversations().catch(() => {});
      return;
    }

    const friendCard = event.target.closest(".friend-card");
    if (friendCard) {
      selectFriend(friendCard.dataset.selectFriend).catch((error) => toast(error.message));
      return;
    }

    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.tab) {
      if (target.dataset.tab === "profile" && state.user) state.profileUserId = state.user.user_id;
      switchTab(target.dataset.tab);
      return;
    }
    if (target.dataset.add) addFriend(target.dataset.add).catch((error) => toast(error.message));
    if (target.dataset.accept) handleFriendRequest(target.dataset.accept, "accepted").catch((error) => toast(error.message));
    if (target.dataset.reject) handleFriendRequest(target.dataset.reject, "rejected").catch((error) => toast(error.message));
    if (target.dataset.togglePermissionPanel) togglePermissionPanel(target.dataset.togglePermissionPanel);
    if (target.dataset.savePermissions) savePermissions(target.dataset.savePermissions).catch((error) => toast(error.message));
    if (target.id === "friendMomentsBtn") openProfile(target.dataset.profileId).catch((error) => toast(error.message));
    if (target.id === "friendProfileBtn") openProfile(target.dataset.profileId).catch((error) => toast(error.message));
    if (target.dataset.chat) {
      createPrivateConversation(target.dataset.chat, target.dataset.chatName).catch((error) => toast(error.message));
    }
    if (target.dataset.openConversation) {
      const previousConversationId = state.conversationId;
      state.conversationId = Number(target.dataset.openConversation);
      state.conversationTitle = target.dataset.conversationTitle || `会话 #${state.conversationId}`;
      if (Number(previousConversationId) !== Number(state.conversationId)) resetHistorySearch();
      $("chatPeerTitle").textContent = state.conversationTitle;
      loadMessages().catch((error) => toast(error.message));
    }
    if (target.dataset.like) likeMoment(target.dataset.like).catch((error) => toast(error.message));
    if (target.dataset.comment) commentMoment(target.dataset.comment).catch((error) => toast(error.message));
    if (target.dataset.stat) loadStats(target.dataset.stat).catch((error) => toast(error.message));
  });

  document.body.addEventListener("keydown", (event) => {
    if (!$("imageViewer").classList.contains("hidden")) {
      if (event.key === "Escape") closeImageViewer();
      if (event.key === "ArrowLeft") moveViewer(-1);
      if (event.key === "ArrowRight") moveViewer(1);
      return;
    }

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
