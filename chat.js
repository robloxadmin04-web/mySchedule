/* ============================================================
   Coursework — Chat page (Supabase, Google sign-in)
   ------------------------------------------------------------
   Fill in SUPABASE_URL / SUPABASE_ANON_KEY below (Project
   Settings > API in your Supabase dashboard). Run
   supabase_friends_schema.sql in the SQL editor first.
   ============================================================ */

(function () {
  "use strict";

  // ---- 1. CONFIG -------------------------------------------------
  const SUPABASE_URL = "https://lvdyxnygzbcnprdncpzx.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2ZHl4bnlnemJjbnByZG5jcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MTc3NDgsImV4cCI6MjEwMjE5Mzc0OH0.qWsRV2mcMCQ35o9Eyg4qHNzS1gzV9pSUh17bvbgCws8";

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- small local helpers (mirrors script.js style) --------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") node.className = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(c => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }
  function initialsOf(nameOrUsername) {
    const s = (nameOrUsername || "?").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  // Builds a <span class="avatar"> that shows the person's real
  // profile photo when one is set (synced from their dashboard
  // profile into Supabase's avatar_url), falling back to initials
  // only when no photo exists.
  function avatarNode(name, avatarUrl, extraClass) {
    const cls = "avatar" + (extraClass ? " " + extraClass : "");
    if (avatarUrl) {
      return el("span", { class: cls }, [el("img", { src: avatarUrl, alt: name || "Avatar" })]);
    }
    return el("span", { class: cls }, [initialsOf(name)]);
  }
  function fmtClockTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function dateKey(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toDateString();
  }
  function fmtDateSeparator(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
    return d.toLocaleDateString([], { month: "long", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }
  // Two messages group together (no repeated name/avatar, single
  // timestamp) when same sender and within 3 minutes of each other.
  const GROUP_WINDOW_MS = 3 * 60 * 1000;
  function sameGroup(a, b) {
    if (!a || !b) return false;
    if (a.sender_id !== b.sender_id) return false;
    return Math.abs(new Date(b.created_at) - new Date(a.created_at)) < GROUP_WINDOW_MS;
  }

  let currentUser = null; // { id, email, username, display_name }
  let activeChatFriend = null; // profile object of friend currently chatting with
  let messageChannel = null; // realtime subscription handle
  let messagesCache = []; // last-rendered {friend, last} list, for client-side search filtering
  let activeMessages = []; // full message list for the open conversation, oldest -> newest
  let unseenWhileScrolledUp = 0; // count for the floating "N new messages" button
  let reactionsByMessage = {}; // message_id -> [{user_id, emoji}]
  let replyingToMsg = null; // message object currently being replied to
  let pendingAttachment = null; // { file, kind: 'image'|'file' } queued before send
  let onlineUserIds = new Set(); // presence: currently-online user ids
  let presenceChannel = null;
  let typingTimeout = null;
  let activeChatSettings = { muted_until: null, blocked: false, blockedByThem: false };
  const REACTION_EMOJI = ["\u2764\ufe0f", "\ud83d\udc4d", "\ud83d\ude02", "\ud83d\ude2e", "\ud83d\ude22", "\ud83d\ude21"];

  function showToast(msg) {
    const t = $("#chat-toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.add("hidden"), 1600);
  }

  function chatIdFor(uidA, uidB) {
    return [uidA, uidB].sort().join("_");
  }

  // ---- 1b. THEME / APPEARANCE (shared with the dashboard) ---------
  // The dashboard (index.html / script.js) keeps theme/density/radius
  // in localStorage under this key. This page reads and updates only
  // those fields, leaving everything else the dashboard stores alone.
  const DASHBOARD_STORAGE_KEY = "coursework.state.v1";

  function readDashboardState() {
    try {
      const raw = localStorage.getItem(DASHBOARD_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // Mirrors index.html's applyBranding(): sidebar logo + app name.
  function applyBranding() {
    const state = readDashboardState();
    const b = (state && state.brand) || { name: "Coursework", logo: "" };
    const nameBox = $("#brand-name");
    const mark = $("#brand-mark");
    if (!nameBox || !mark) return;
    nameBox.textContent = b.name || "Coursework";
    if (b.logo) {
      mark.innerHTML = "";
      mark.appendChild(el("img", { src: b.logo, alt: "Logo" }));
    } else {
      mark.textContent = (b.name || "C").trim().charAt(0).toUpperCase() || "C";
    }
  }

  // Mirrors index.html's mini-profile rendering: the signed-in-to-the
  // -dashboard identity (name/program/avatar set in Profile/Settings),
  // not the Google account used for chat sign-in — same as index.html.
  function applyMiniProfile() {
    const state = readDashboardState();
    const p = (state && state.profile) || {};
    const nameBox = $("#mini-name");
    const subBox = $("#mini-sub");
    const avatarBox = $("#mini-avatar");
    if (!nameBox || !subBox || !avatarBox) return;
    nameBox.textContent = p.name || "Student";
    subBox.textContent = p.program || "My Program";
    if (p.avatar) {
      avatarBox.innerHTML = "";
      avatarBox.appendChild(el("img", { src: p.avatar, alt: "Avatar" }));
    } else {
      avatarBox.textContent = (p.name || "S").trim().charAt(0).toUpperCase() || "S";
    }
  }

  function applyDashboardIdentity() {
    applyBranding();
    applyMiniProfile();
  }

  function applyAppearance() {
    const state = readDashboardState();
    const s = (state && state.settings) || {};
    let theme = s.theme || "light";
    if (theme === "system") {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
    if (s.density) document.documentElement.setAttribute("data-density", s.density);
    if (s.radius) document.documentElement.setAttribute("data-radius", s.radius);
    document.documentElement.setAttribute("data-motion", s.reduceMotion ? "reduce" : "normal");
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      const state = readDashboardState() || {};
      state.settings = state.settings || {};
      state.settings.theme = next;
      localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* best effort — theme still applied for this page */ }
  }

  function openSidebarMobile() { $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); }
  function closeSidebarMobile() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); }

  // ---- 1c. PROFILE SYNC (Coursework dashboard -> Supabase) --------
  function readDashboardProfile() {
    const state = readDashboardState();
    const p = state && state.profile;
    if (!p) return null;
    return { name: (p.name || "").trim(), avatar: p.avatar || "" };
  }

  async function syncProfileFromDashboard() {
    if (!currentUser) return;
    const local = readDashboardProfile();
    if (!local || !local.name) return;

    const needsNameSync = local.name !== currentUser.display_name;
    const needsAvatarSync = local.avatar !== (currentUser.avatar_url || "");
    if (!needsNameSync && !needsAvatarSync) return;

    const { data, error } = await sb
      .from("profiles")
      .update({ display_name: local.name, avatar_url: local.avatar })
      .eq("id", currentUser.id)
      .select()
      .single();
    if (error) { console.error("Profile sync failed:", error.message); return; }

    currentUser = data;
    if (activeChatFriend) $("#chat-with-name") && ($("#chat-with-name").textContent = activeChatFriend.display_name || activeChatFriend.username);
  }

  // ---- 2. AUTH -----------------------------------------------------
  async function initAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await loadCurrentUser(session.user.id);
      await syncProfileFromDashboard();
      scrubUrlHash();
      initPresence();
    }

    sb.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await loadCurrentUser(session.user.id);
        await syncProfileFromDashboard();
        scrubUrlHash();
        renderAuthState();
        initPresence();
      } else {
        currentUser = null;
        if (presenceChannel) { sb.removeChannel(presenceChannel); presenceChannel = null; }
        renderAuthState();
      }
    });

    renderAuthState();

    window.addEventListener("storage", (e) => {
      if (e.key === DASHBOARD_STORAGE_KEY) { syncProfileFromDashboard(); applyAppearance(); applyDashboardIdentity(); }
    });
  }

  function scrubUrlHash() {
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  async function loadCurrentUser(uid) {
    const { data, error } = await sb.from("profiles").select("*").eq("id", uid).single();
    if (!error) currentUser = data;
  }

  async function signInWithGoogle() {
    const cleanUrl = window.location.origin + window.location.pathname;
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: cleanUrl }
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await sb.auth.signOut();
    currentUser = null;
    renderAuthState();
  }

  // ---- 3. FRIEND SEARCH / REQUESTS ---------------------------------
  async function searchUsers(query) {
    if (!query.trim()) return [];
    const { data, error } = await sb
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .ilike("username", `%${query}%`)
      .neq("id", currentUser.id)
      .limit(20);
    if (error) throw error;
    return data;
  }

  async function sendFriendRequest(toId) {
    const { error } = await sb.from("friend_requests").insert({ from_id: currentUser.id, to_id: toId });
    if (error) throw error;
  }

  async function getIncomingRequests() {
    const { data, error } = await sb
      .from("friend_requests")
      .select("id, from_id, status, created_at, profiles!friend_requests_from_id_fkey(username, display_name, avatar_url)")
      .eq("to_id", currentUser.id)
      .eq("status", "pending");
    if (error) throw error;
    return data;
  }

  async function acceptRequest(requestId) {
    const { error } = await sb.rpc("accept_friend_request", { request_id: requestId });
    if (error) throw error;
  }

  async function declineRequest(requestId) {
    const { error } = await sb.from("friend_requests").delete().eq("id", requestId);
    if (error) throw error;
  }

  async function getFriends() {
    const { data, error } = await sb
      .from("friends")
      .select("friend_id, profiles!friends_friend_id_fkey(id, username, display_name, avatar_url, last_seen_at)")
      .eq("user_id", currentUser.id);
    if (error) throw error;
    return data.map(r => r.profiles);
  }

  async function unfriend(friendId) {
    await sb.from("friends").delete().eq("user_id", currentUser.id).eq("friend_id", friendId);
    await sb.from("friends").delete().eq("user_id", friendId).eq("friend_id", currentUser.id);
  }

  // ---- 4. CHAT -------------------------------------------------------
  async function loadMessages(friendId) {
    const chatId = chatIdFor(currentUser.id, friendId);
    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    return data;
  }

  async function getLastMessage(friendId) {
    const chatId = chatIdFor(currentUser.id, friendId);
    const { data, error } = await sb
      .from("messages")
      .select("text, created_at, sender_id")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || !data.length) return null;
    return data[0];
  }

  async function sendMessage(friendId, text, extra) {
    const chatId = chatIdFor(currentUser.id, friendId);
    const row = Object.assign({
      chat_id: chatId, sender_id: currentUser.id, recipient_id: friendId, text: (text || "").trim()
    }, extra || {});
    const { data, error } = await sb.from("messages").insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function editMessageText(messageId, text) {
    const { error } = await sb.from("messages")
      .update({ text: text.trim(), edited_at: new Date().toISOString() })
      .eq("id", messageId).eq("sender_id", currentUser.id);
    if (error) throw error;
  }

  async function deleteForEveryone(messageId) {
    const { error } = await sb.from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId).eq("sender_id", currentUser.id);
    if (error) throw error;
  }

  async function deleteForMe(messageId) {
    const { data, error } = await sb.from("messages").select("deleted_for").eq("id", messageId).single();
    if (error) throw error;
    const arr = (data && data.deleted_for) || [];
    if (arr.includes(currentUser.id)) return;
    arr.push(currentUser.id);
    const { error: e2 } = await sb.from("messages").update({ deleted_for: arr }).eq("id", messageId);
    if (e2) throw e2;
  }

  async function markSeen(friendId) {
    const chatId = chatIdFor(currentUser.id, friendId);
    const nowIso = new Date().toISOString();
    await sb.from("messages")
      .update({ seen_at: nowIso, delivered_at: nowIso })
      .eq("chat_id", chatId).eq("recipient_id", currentUser.id).is("seen_at", null);
  }

  // ---- 4b. REACTIONS --------------------------------------------------
  async function fetchReactionsFor(messageIds) {
    if (!messageIds.length) return {};
    const { data, error } = await sb.from("message_reactions")
      .select("message_id, user_id, emoji").in("message_id", messageIds);
    if (error) return {};
    const map = {};
    data.forEach(r => { (map[r.message_id] = map[r.message_id] || []).push(r); });
    return map;
  }

  async function toggleReaction(messageId, emoji) {
    const existing = (reactionsByMessage[messageId] || []).find(r => r.user_id === currentUser.id && r.emoji === emoji);
    if (existing) {
      await sb.from("message_reactions").delete()
        .eq("message_id", messageId).eq("user_id", currentUser.id).eq("emoji", emoji);
    } else {
      await sb.from("message_reactions").insert({ message_id: messageId, user_id: currentUser.id, emoji });
    }
    reactionsByMessage = await fetchReactionsFor(activeMessages.map(m => m.id));
    renderChatLog(activeMessages);
  }

  // ---- 4c. CHAT SETTINGS (mute / block) --------------------------------
  async function loadChatSettings(friendId) {
    const [{ data: mine }, { data: theirs }] = await Promise.all([
      sb.from("chat_settings").select("*").eq("user_id", currentUser.id).eq("friend_id", friendId).maybeSingle(),
      sb.from("chat_settings").select("blocked").eq("user_id", friendId).eq("friend_id", currentUser.id).maybeSingle()
    ]);
    activeChatSettings = {
      muted_until: mine && mine.muted_until ? mine.muted_until : null,
      blocked: !!(mine && mine.blocked),
      blockedByThem: !!(theirs && theirs.blocked)
    };
    return activeChatSettings;
  }

  async function setMute(friendId, minsOrMode) {
    let muted_until = null;
    if (minsOrMode === "forever") muted_until = "9999-12-31T00:00:00.000Z";
    else if (minsOrMode !== "off") muted_until = new Date(Date.now() + Number(minsOrMode) * 60000).toISOString();
    const { error } = await sb.from("chat_settings")
      .upsert({ user_id: currentUser.id, friend_id: friendId, muted_until, updated_at: new Date().toISOString() },
        { onConflict: "user_id,friend_id" });
    if (error) throw error;
    activeChatSettings.muted_until = muted_until;
  }

  async function setBlocked(friendId, blocked) {
    const { error } = await sb.from("chat_settings")
      .upsert({ user_id: currentUser.id, friend_id: friendId, blocked, updated_at: new Date().toISOString() },
        { onConflict: "user_id,friend_id" });
    if (error) throw error;
    activeChatSettings.blocked = blocked;
  }

  async function fileReport(friendId, reason) {
    const { error } = await sb.from("user_reports").insert({ reporter_id: currentUser.id, reported_id: friendId, reason });
    if (error) throw error;
  }

  // ---- 4d. ATTACHMENTS --------------------------------------------------
  function fmtFileSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function uploadAttachment(friendId, file, kind) {
    const chatId = chatIdFor(currentUser.id, friendId);
    const path = `${chatId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await sb.storage.from("chat-attachments").upload(path, file);
    if (upErr) throw upErr;
    const { data } = sb.storage.from("chat-attachments").getPublicUrl(path);
    return {
      attachment_url: data.publicUrl,
      attachment_type: kind,
      attachment_name: file.name,
      attachment_size: file.size
    };
  }

  // ---- 4e. TYPING + PRESENCE --------------------------------------------
  function broadcastTyping(friendId) {
    if (!messageChannel) return;
    messageChannel.send({ type: "broadcast", event: "typing", payload: { user_id: currentUser.id } });
  }

  function initPresence() {
    if (!currentUser || presenceChannel) return;
    presenceChannel = sb.channel("online-users", { config: { presence: { key: currentUser.id } } });
    presenceChannel.on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onlineUserIds = new Set(Object.keys(state));
      refreshOnlineIndicators();
    });
    presenceChannel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await presenceChannel.track({ user_id: currentUser.id, online_at: new Date().toISOString() });
    });
  }

  function refreshOnlineIndicators() {
    if (activeChatFriend) {
      const online = onlineUserIds.has(activeChatFriend.id);
      const statusEl = $("#chat-with-status");
      if (statusEl) statusEl.textContent = online ? "Online" : formatLastSeen(activeChatFriend.last_seen_at);
    }
    renderMessagesList();
  }

  function formatLastSeen(iso) {
    if (!iso) return "Offline";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "Offline";
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "Last seen just now";
    if (mins < 60) return `Last seen ${mins}m ago`;
    if (mins < 24 * 60) return `Last seen ${Math.round(mins / 60)}h ago`;
    return `Last seen ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  }

  function subscribeToChat(friendId, onNewMessage, onUpdateMessage, onTyping) {
    if (messageChannel) sb.removeChannel(messageChannel);
    const chatId = chatIdFor(currentUser.id, friendId);
    messageChannel = sb
      .channel(`chat-${chatId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        payload => onNewMessage(payload.new)
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        payload => onUpdateMessage && onUpdateMessage(payload.new)
      )
      .on("postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        () => { if (activeChatFriend) refreshReactionsAndRender(); }
      )
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload && payload.payload.user_id !== currentUser.id) onTyping && onTyping();
      })
      .subscribe();
  }

  let reactionsRefreshTimer = null;
  function refreshReactionsAndRender() {
    clearTimeout(reactionsRefreshTimer);
    reactionsRefreshTimer = setTimeout(async () => {
      reactionsByMessage = await fetchReactionsFor(activeMessages.map(m => m.id));
      renderChatLog(activeMessages);
    }, 150);
  }

  // ---- 5. RENDERING ---------------------------------------------------
  function renderAuthState() {
    const authBox = $("#friends-auth");
    const appBox = $("#friends-app");
    if (!authBox || !appBox) return;
    if (currentUser) {
      authBox.classList.add("hidden");
      appBox.classList.remove("hidden");
      renderIncomingRequests();
      renderMessagesList();
    } else {
      authBox.classList.remove("hidden");
      appBox.classList.add("hidden");
      closeChat();
    }
  }

  async function renderIncomingRequests() {
    const box = $("#friend-requests-list");
    if (!box) return;
    box.innerHTML = "";
    let requests;
    try { requests = await getIncomingRequests(); } catch (e) { return; }
    updateRequestsBadge(requests ? requests.length : 0);
    if (!requests.length) {
      box.appendChild(el("p", { class: "list-empty" }, ["No pending friend requests."]));
      return;
    }
    requests.forEach(r => {
      const p = r.profiles;
      const name = p.display_name || p.username;
      box.appendChild(el("div", { class: "request-item" }, [
        avatarNode(name, p.avatar_url),
        el("div", { class: "request-item-body" }, [
          el("div", { class: "request-item-name" }, [name]),
          el("div", { class: "request-item-sub" }, ["Wants to be friends"])
        ]),
        el("div", { class: "conv-item-actions" }, [
          el("button", { class: "btn btn-primary btn-sm", onclick: async () => { await acceptRequest(r.id); renderIncomingRequests(); renderMessagesList(); } }, ["Accept"]),
          el("button", { class: "btn btn-ghost btn-sm", onclick: async () => { await declineRequest(r.id); renderIncomingRequests(); } }, ["Decline"])
        ])
      ]));
    });
  }

  function updateRequestsBadge(count) {
    const badge = $("#req-badge");
    if (!badge) return;
    badge.classList.toggle("hidden", !count);
    badge.textContent = count ? String(count) : "";
  }

  function setCount(selector, count) {
    const node = $(selector);
    if (!node) return;
    node.textContent = count ? String(count) : "";
  }

  // Builds one clickable conversation row (avatar, name, online dot,
  // optional preview + time). No separate "Open" button — the whole
  // row is the click target, Messenger-style.
  function buildConvItem(friend, opts) {
    opts = opts || {};
    const name = friend.display_name || friend.username;
    const children = [
      avatarNode(name, friend.avatar_url, "online"),
      el("div", { class: "conv-item-body" }, [
        el("div", { class: "conv-item-top" }, [
          el("span", { class: "conv-item-name" }, [name]),
          opts.time ? el("span", { class: "conv-item-time" }, [opts.time]) : null
        ].filter(Boolean)),
        el("div", { class: "conv-item-preview" }, [opts.preview || "Tap to start chatting"])
      ])
    ];
    return el("button", {
      class: "conv-item" + (activeChatFriend && activeChatFriend.id === friend.id ? " selected" : ""),
      type: "button",
      onclick: () => openChat(friend)
    }, children);
  }

  // Conversation list: friends with a last-message preview + time,
  // sorted most-recent-first when history exists. Empty state matches
  // the empty state shown in the conversation pane.
  async function renderMessagesList() {
    const box = $("#messages-list");
    if (!box) return;
    let friends;
    try { friends = await getFriends(); } catch (e) { return; }
    box.innerHTML = "";
    if (!friends.length) {
      messagesCache = [];
      box.appendChild(el("p", { class: "list-empty" }, ["No conversations yet. Start one with \u201cNew message\u201d."]));
      toggleEmptyState();
      return;
    }

    const withLast = await Promise.all(friends.map(async f => {
      const last = await getLastMessage(f.id);
      return { friend: f, last };
    }));
    withLast.sort((a, b) => {
      const ta = a.last ? new Date(a.last.created_at).getTime() : 0;
      const tb = b.last ? new Date(b.last.created_at).getTime() : 0;
      return tb - ta;
    });

    messagesCache = withLast;
    renderFilteredMessages($("#conv-search-input") ? $("#conv-search-input").value : "");
  }

  function renderFilteredMessages(query) {
    const box = $("#messages-list");
    if (!box) return;
    const q = (query || "").trim().toLowerCase();
    const rows = q
      ? messagesCache.filter(({ friend }) => (friend.display_name || friend.username || "").toLowerCase().includes(q))
      : messagesCache;

    box.innerHTML = "";
    if (!rows.length) {
      box.appendChild(el("p", { class: "list-empty" }, [q ? "No conversations match." : "No conversations yet. Start one with \u201cNew message\u201d."]));
      return;
    }
    rows.forEach(({ friend, last }) => {
      const preview = last ? ((last.sender_id === currentUser.id ? "You: " : "") + last.text) : null;
      const time = last ? fmtClockTime(last.created_at) : null;
      box.appendChild(buildConvItem(friend, { preview, time }));
    });
  }

  function toggleEmptyState() {
    const hasConvos = messagesCache.length > 0;
    const empty = $("#convo-empty");
    const panel = $("#chat-panel");
    if (!empty || !panel) return;
    if (!hasConvos && !activeChatFriend) {
      empty.querySelector(".convo-empty-title").textContent = "No conversations yet";
      empty.querySelector(".muted.small").textContent = "Start a conversation with your classmates and friends.";
    }
  }

  // "New message" search: shows friends when the box is empty (tap to
  // open instantly) and matching users (friend or not) when typing.
  // Non-friends get an "Add Friend" action instead of a chat row.
  async function renderNewMessageResults(query) {
    const box = $("#friend-search-results");
    if (!box) return;
    box.innerHTML = "";
    const q = (query || "").trim();

    let friends = [];
    try { friends = await getFriends(); } catch (e) { /* ignore */ }
    const friendIds = new Set(friends.map(f => f.id));

    if (!q) {
      if (!friends.length) {
        box.appendChild(el("p", { class: "list-empty" }, ["No friends yet. Search a username to add someone."]));
        return;
      }
      friends.forEach(f => box.appendChild(buildNewMessageRow(f, true)));
      return;
    }

    let results = [];
    try { results = await searchUsers(q); } catch (e) { /* ignore */ }
    if (!results.length) {
      box.appendChild(el("p", { class: "list-empty" }, ["No users found."]));
      return;
    }
    results.forEach(u => box.appendChild(buildNewMessageRow(u, friendIds.has(u.id))));
  }

  function buildNewMessageRow(user, isFriend) {
    const name = user.display_name || user.username;
    if (isFriend) {
      return el("div", { class: "conv-item-row" }, [
        el("button", {
          class: "conv-item", type: "button",
          onclick: () => { closeNewMessageModal(); openChat(user); }
        }, [
          avatarNode(name, user.avatar_url),
          el("div", { class: "conv-item-body" }, [
            el("div", { class: "conv-item-name" }, [name])
          ])
        ])
      ]);
    }
    return el("div", { class: "conv-item-row" }, [
      el("div", { class: "conv-item", style: "cursor:default;" }, [
        avatarNode(name, user.avatar_url),
        el("div", { class: "conv-item-body" }, [
          el("div", { class: "conv-item-name" }, [name])
        ])
      ]),
      el("button", { class: "btn btn-primary btn-sm", onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = "Sent";
        try { await sendFriendRequest(user.id); } catch (err) { e.target.textContent = "Error"; }
      } }, ["Add Friend"])
    ]);
  }

  async function openChat(friend) {
    activeChatFriend = friend;
    const name = friend.display_name || friend.username;

    $("#convo-empty").classList.add("hidden");
    $("#chat-panel").classList.remove("hidden");
    $("#chat-with-name").textContent = name;
    const headerAvatar = $("#chat-with-avatar");
    if (headerAvatar) {
      headerAvatar.innerHTML = "";
      if (friend.avatar_url) headerAvatar.appendChild(el("img", { src: friend.avatar_url, alt: name }));
      else headerAvatar.textContent = initialsOf(name);
    }
    $("#chat-with-status").textContent = onlineUserIds.has(friend.id) ? "Online" : formatLastSeen(friend.last_seen_at);

    $("#chat-shell").classList.add("conv-open");
    cancelReply();
    clearAttachment();
    $("#typing-indicator").classList.add("hidden");

    try { await loadChatSettings(friend.id); } catch (e) { activeChatSettings = { muted_until: null, blocked: false, blockedByThem: false }; }
    updateBlockedBar();

    const log = $("#chat-log");
    log.innerHTML = "<p class='list-empty'>Loading messages...</p>";
    unseenWhileScrolledUp = 0;
    updateScrollBottomBtn();
    activeMessages = await loadMessages(friend.id);
    reactionsByMessage = await fetchReactionsFor(activeMessages.map(m => m.id));
    renderChatLog(activeMessages);
    scrollLogToBottom(log);
    try { await markSeen(friend.id); } catch (e) { /* best effort */ }

    subscribeToChat(friend.id,
      (msg) => { appendMessageToLog(msg); renderMessagesList(); if (msg.sender_id === friend.id) markSeen(friend.id).catch(() => {}); },
      (msg) => { updateMessageInLog(msg); },
      () => showTypingIndicator(friend)
    );

    renderMessagesList();
  }

  function updateBlockedBar() {
    const bar = $("#blocked-bar");
    if (!bar) return;
    if (activeChatSettings.blocked) {
      bar.textContent = "You blocked this person. Unblock to send messages.";
      bar.classList.remove("hidden");
    } else if (activeChatSettings.blockedByThem) {
      bar.textContent = "You can't reply to this conversation.";
      bar.classList.remove("hidden");
    } else {
      bar.classList.add("hidden");
    }
  }

  let typingHideTimer = null;
  function showTypingIndicator(friend) {
    const ind = $("#typing-indicator");
    const txt = $("#typing-indicator-text");
    if (!ind || !txt) return;
    txt.textContent = (friend.display_name || friend.username) + " is typing";
    ind.classList.remove("hidden");
    clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(() => ind.classList.add("hidden"), 2500);
  }

  function closeChat() {
    activeChatFriend = null;
    activeMessages = [];
    reactionsByMessage = {};
    unseenWhileScrolledUp = 0;
    cancelReply();
    clearAttachment();
    const panel = $("#chat-panel");
    const empty = $("#convo-empty");
    const shell = $("#chat-shell");
    if (panel) panel.classList.add("hidden");
    if (empty) empty.classList.remove("hidden");
    if (shell) shell.classList.remove("conv-open");
    if (messageChannel) { sb.removeChannel(messageChannel); messageChannel = null; }
  }

  // On mobile the back button returns to the list without ending the
  // conversation (subscription stays alive); Close ends it outright.
  function backToList() {
    const shell = $("#chat-shell");
    if (shell) shell.classList.remove("conv-open");
  }

  function buildReactionChips(msg) {
    const rs = reactionsByMessage[msg.id] || [];
    if (!rs.length) return null;
    const byEmoji = {};
    rs.forEach(r => { (byEmoji[r.emoji] = byEmoji[r.emoji] || []).push(r); });
    const chips = Object.keys(byEmoji).map(emoji => {
      const list = byEmoji[emoji];
      const mine = list.some(r => r.user_id === currentUser.id);
      return el("button", {
        class: "reaction-chip" + (mine ? " mine" : ""), type: "button",
        onclick: () => toggleReaction(msg.id, emoji)
      }, [emoji + " " + list.length]);
    });
    return el("div", { class: "msg-reactions" }, chips);
  }

  function buildQuote(msg) {
    if (!msg.reply_to_id) return null;
    const original = activeMessages.find(m => m.id === msg.reply_to_id);
    return el("div", {
      class: "msg-quote",
      onclick: () => scrollToMessage(msg.reply_to_id)
    }, [
      el("span", { class: "msg-quote-name" }, [original ? (original.sender_id === currentUser.id ? "You" : (activeChatFriend.display_name || activeChatFriend.username)) : "Original message"]),
      el("span", {}, [original ? (original.deleted_at ? "This message was deleted" : (original.text || (original.attachment_name || "Attachment"))) : "Message not available"])
    ]);
  }

  function buildMessageBody(msg) {
    if (msg.deleted_at) {
      return el("div", { class: "msg deleted" }, ["This message was deleted"]);
    }
    const parts = [];
    const quote = buildQuote(msg);
    if (quote) parts.push(quote);

    if (msg.share_type) {
      parts.push(buildShareCard(msg));
    } else if (msg.attachment_url && msg.attachment_type === "image") {
      parts.push(el("img", {
        class: "msg-image", src: msg.attachment_url, alt: msg.attachment_name || "Image",
        onclick: () => openImageViewer(msg.attachment_url, msg.attachment_name)
      }));
    } else if (msg.attachment_url) {
      parts.push(el("div", { class: "msg-file-card" }, [
        el("div", { class: "msg-file-ico" }, ["\ud83d\udcc4"]),
        el("div", { class: "msg-file-body" }, [
          el("div", { class: "msg-file-name" }, [msg.attachment_name || "File"]),
          el("div", { class: "msg-file-size" }, [fmtFileSize(msg.attachment_size)])
        ]),
        el("a", { class: "msg-file-open", href: msg.attachment_url, target: "_blank", rel: "noopener" }, ["Open"])
      ]));
    }
    if (msg.text) parts.push(document.createTextNode(msg.text));

    return el("div", { class: "msg" }, parts);
  }

  function buildShareCard(msg) {
    const p = msg.share_payload || {};
    const heads = { schedule: "Schedule shared", assignment: "Assignment shared", subject: "Subject shared" };
    const rows = Object.keys(p).filter(k => p[k] != null && p[k] !== "").map(k =>
      el("div", { class: "msg-share-row" }, [k, String(p[k])])
    );
    return el("div", { class: "msg-share-card" }, [
      el("div", { class: "msg-share-head" }, [heads[msg.share_type] || "Shared"]),
      el("div", { class: "msg-share-body" }, [
        el("div", { style: "font-weight:700;" }, [p.title || p.name || "Untitled"]),
        ...rows
      ])
    ]);
  }

  function buildStatusTag(msg) {
    if (msg.sender_id !== currentUser.id) return null;
    if (msg.seen_at) return el("span", { class: "msg-status seen" }, ["\u2713\u2713 Seen"]);
    if (msg.delivered_at) return el("span", { class: "msg-status" }, ["\u2713\u2713"]);
    return el("span", { class: "msg-status" }, ["\u2713"]);
  }

  // Full re-render of the log: date separators + grouped consecutive
  // bubbles from the same sender, timestamp only on the last bubble
  // of each group. Cheap enough at the 200-message load cap.
  function renderChatLog(messages) {
    const log = $("#chat-log");
    if (!log) return;
    const visible = messages.filter(m => !(m.deleted_for || []).includes(currentUser.id));
    log.innerHTML = "";
    let lastDateKey = null;
    let groupEl = null;
    let groupLast = null;

    visible.forEach(msg => {
      const mine = msg.sender_id === currentUser.id;
      const dk = dateKey(msg.created_at);
      if (dk !== lastDateKey) {
        log.appendChild(el("div", { class: "date-sep" }, [fmtDateSeparator(msg.created_at)]));
        lastDateKey = dk;
        groupEl = null; groupLast = null;
      }
      if (!groupEl || !sameGroup(groupLast, msg)) {
        groupEl = el("div", { class: "msg-group" + (mine ? " mine" : "") }, []);
        log.appendChild(groupEl);
      }
      const prevTime = groupEl.querySelector(".msg-time");
      if (prevTime) prevTime.remove();

      const row = el("div", { class: "msg-row", "data-msg-id": msg.id }, []);
      if (!msg.deleted_at) {
        row.appendChild(el("div", { class: "msg-row-actions" }, [
          el("button", { type: "button", title: "React", onclick: (e) => openReactionPicker(e.currentTarget, msg) }, ["\ud83d\ude42"]),
          el("button", { type: "button", title: "More", onclick: (e) => openMessageMenu(e.currentTarget, msg) }, ["\u22ef"])
        ]));
      }
      row.appendChild(buildMessageBody(msg));
      const reactions = buildReactionChips(msg);
      if (reactions) row.appendChild(reactions);
      groupEl.appendChild(row);

      const timeLine = el("div", { class: "msg-time" }, [fmtClockTime(msg.created_at)]);
      if (msg.edited_at && !msg.deleted_at) timeLine.appendChild(el("span", { class: "msg-edited-tag" }, ["\u00b7 edited"]));
      const status = buildStatusTag(msg);
      if (status) timeLine.appendChild(status);
      groupEl.appendChild(timeLine);
      groupLast = msg;
    });
  }

  function scrollToMessage(msgId) {
    const row = document.querySelector(`.msg-row[data-msg-id="${msgId}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("highlight");
    setTimeout(() => row.classList.remove("highlight"), 1400);
  }

  function isNearBottom(log) {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }

  function updateScrollBottomBtn() {
    const btn = $("#scroll-bottom-btn");
    const label = $("#scroll-bottom-label");
    if (!btn) return;
    if (unseenWhileScrolledUp > 0) {
      btn.classList.remove("hidden");
      if (label) label.textContent = unseenWhileScrolledUp === 1 ? "1 new message" : unseenWhileScrolledUp + " new messages";
    } else {
      btn.classList.add("hidden");
    }
  }

  function scrollLogToBottom(log) {
    log.scrollTop = log.scrollHeight;
    unseenWhileScrolledUp = 0;
    updateScrollBottomBtn();
  }

  // Applies an UPDATE payload (edit, delete, or seen/delivered change)
  // to the in-memory list and re-renders in place.
  function updateMessageInLog(msg) {
    const idx = activeMessages.findIndex(m => m.id === msg.id);
    if (idx === -1) return;
    activeMessages[idx] = msg;
    renderChatLog(activeMessages);
  }

  // ---- Message action menu (portal) ------------------------------------
  function closeMessageMenu() { $("#msg-menu").classList.add("hidden"); $("#msg-menu").innerHTML = ""; }
  function closeReactionPicker() { $("#reaction-picker").classList.add("hidden"); $("#reaction-picker").innerHTML = ""; }

  function positionPortal(node, anchorRect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    node.classList.remove("hidden");
    const w = node.offsetWidth || 160, h = node.offsetHeight || 120;
    let left = Math.min(anchorRect.left, vw - w - 8);
    let top = anchorRect.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, anchorRect.top - h - 6);
    if (window.innerWidth <= 760) { node.style.left = ""; node.style.top = ""; return; } // CSS bottom-sheet takes over
    node.style.left = Math.max(8, left) + "px";
    node.style.top = top + "px";
  }

  function openReactionPicker(anchorEl, msg) {
    closeMessageMenu();
    const picker = $("#reaction-picker");
    picker.innerHTML = "";
    REACTION_EMOJI.forEach(emoji => {
      picker.appendChild(el("button", { type: "button", onclick: () => { toggleReaction(msg.id, emoji); closeReactionPicker(); } }, [emoji]));
    });
    positionPortal(picker, anchorEl.getBoundingClientRect());
  }

  function openMessageMenu(anchorEl, msg) {
    closeReactionPicker();
    const menu = $("#msg-menu");
    menu.innerHTML = "";
    const mine = msg.sender_id === currentUser.id;
    const items = [];
    items.push(["Reply", () => { startReply(msg); closeMessageMenu(); }]);
    items.push(["React", () => { openReactionPicker(anchorEl, msg); }]);
    items.push(["Copy", () => { copyMessageText(msg); closeMessageMenu(); }]);
    if (mine) items.push(["Edit", () => { startEdit(msg); closeMessageMenu(); }]);
    if (mine) items.push(["Delete for everyone", () => { deleteForEveryone(msg.id).catch(e => alert(e.message)); closeMessageMenu(); }, true]);
    items.push(["Delete for me", () => { deleteForMe(msg.id).then(() => renderChatLog(activeMessages)).catch(e => alert(e.message)); closeMessageMenu(); }, !mine]);
    items.forEach(([label, fn, danger]) => {
      menu.appendChild(el("button", { type: "button", class: danger ? "danger" : "", onclick: fn }, [label]));
    });
    positionPortal(menu, anchorEl.getBoundingClientRect());
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#msg-menu") && !e.target.closest(".msg-row-actions")) closeMessageMenu();
    if (!e.target.closest("#reaction-picker") && !e.target.closest(".msg-row-actions")) closeReactionPicker();
    if (!e.target.closest("#attach-menu") && !e.target.closest("#attach-btn")) { const am = $("#attach-menu"); if (am) am.classList.add("hidden"); }
  });

  function copyMessageText(msg) {
    const text = msg.text || msg.attachment_name || "";
    if (navigator.clipboard && text) {
      navigator.clipboard.writeText(text).then(() => showToast("Copied")).catch(() => showToast("Copied"));
    } else {
      showToast("Copied");
    }
  }

  function startReply(msg) {
    replyingToMsg = msg;
    const bar = $("#reply-preview-bar");
    if (!bar) return;
    bar.classList.remove("hidden");
    $("#reply-preview-name").textContent = "Replying to " + (msg.sender_id === currentUser.id ? "yourself" : (activeChatFriend.display_name || activeChatFriend.username));
    $("#reply-preview-text").textContent = msg.text || msg.attachment_name || "Attachment";
    const input = $("#chat-input");
    if (input) input.focus();
  }
  function cancelReply() {
    replyingToMsg = null;
    const bar = $("#reply-preview-bar");
    if (bar) bar.classList.add("hidden");
  }

  function startEdit(msg) {
    const row = document.querySelector(`.msg-row[data-msg-id="${msg.id}"] .msg`);
    if (!row) return;
    const box = el("div", { class: "msg-edit-box" }, [
      el("textarea", { rows: 2, id: `edit-ta-${msg.id}` }, []),
      el("div", { class: "msg-edit-actions" }, [
        el("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => renderChatLog(activeMessages) }, ["Cancel"]),
        el("button", { class: "btn btn-primary btn-sm", type: "button", onclick: async () => {
          const ta = document.getElementById(`edit-ta-${msg.id}`);
          const val = ta.value.trim();
          if (!val) return;
          try { await editMessageText(msg.id, val); msg.text = val; msg.edited_at = new Date().toISOString(); updateMessageInLog(msg); }
          catch (e) { alert(e.message); }
        } }, ["Save"])
      ])
    ]);
    row.innerHTML = "";
    row.classList.add("editing-active");
    row.appendChild(box);
    const ta = document.getElementById(`edit-ta-${msg.id}`);
    ta.value = msg.text || "";
    ta.focus();
  }

  // ---- Attachment picking / preview ----------------------------------
  function clearAttachment() {
    pendingAttachment = null;
    const strip = $("#attach-preview-strip");
    if (strip) { strip.innerHTML = ""; strip.classList.add("hidden"); }
    const sendBtn = $("#chat-send-btn"), chatInput = $("#chat-input");
    if (sendBtn && chatInput) sendBtn.disabled = !chatInput.value.trim();
  }

  function setAttachment(file, kind) {
    pendingAttachment = { file, kind };
    const strip = $("#attach-preview-strip");
    strip.innerHTML = "";
    strip.classList.remove("hidden");
    const item = el("div", { class: "attach-preview-item" }, []);
    if (kind === "image") {
      const url = URL.createObjectURL(file);
      item.appendChild(el("img", { src: url, alt: file.name }));
    }
    item.appendChild(el("span", {}, [file.name]));
    item.appendChild(el("button", { type: "button", onclick: () => clearAttachment() }, ["\u00d7"]));
    strip.appendChild(item);
    const sendBtn = $("#chat-send-btn");
    if (sendBtn) sendBtn.disabled = false;
  }

  // ---- Share picker (schedule / assignment / subject, from dashboard state) --
  function getDashboardCollection(kind) {
    const state = readDashboardState() || {};
    const map = { schedule: state.schedule, assignment: state.assignments, subject: state.subjects };
    const raw = map[kind];
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return Object.values(raw);
    return [];
  }

  function openSharePicker(kind) {
    const backdrop = $("#share-picker-backdrop");
    const title = $("#share-picker-title");
    const list = $("#share-picker-list");
    const heads = { schedule: "Share Schedule", assignment: "Share Assignment", subject: "Share Subject" };
    title.textContent = heads[kind] || "Share";
    list.innerHTML = "";
    const items = getDashboardCollection(kind);
    if (!items.length) {
      list.appendChild(el("p", { class: "list-empty" }, ["Nothing to share yet."]));
    } else {
      items.forEach(item => {
        const label = item.title || item.name || item.subject || "Untitled";
        const sub = item.day || item.dueDate || item.due || item.time || "";
        list.appendChild(el("button", {
          class: "conv-item", type: "button",
          onclick: async () => {
            closeSharePicker();
            if (!activeChatFriend) return;
            try {
              const sent = await sendMessage(activeChatFriend.id, "", { share_type: kind, share_payload: item });
              appendMessageToLog(sent);
              renderMessagesList();
            }
            catch (e) { alert(e.message); }
          }
        }, [
          el("div", { class: "conv-item-body" }, [
            el("div", { class: "conv-item-name" }, [label]),
            sub ? el("div", { class: "conv-item-preview" }, [String(sub)]) : null
          ].filter(Boolean))
        ]));
      });
    }
    backdrop.classList.remove("hidden");
  }
  function closeSharePicker() { $("#share-picker-backdrop").classList.add("hidden"); }

  // ---- Image viewer -------------------------------------------------
  function openImageViewer(url, name) {
    const v = $("#image-viewer");
    $("#image-viewer-img").src = url;
    $("#image-viewer-name").textContent = name || "";
    $("#image-viewer-download").href = url;
    v.classList.remove("hidden");
  }
  function closeImageViewer() { $("#image-viewer").classList.add("hidden"); $("#image-viewer-img").src = ""; }

  // Appends one incoming message to the in-memory list and re-renders.
  // Keeps the user's scroll position if they've scrolled up to read
  // history, and surfaces the floating "N new messages" button instead.
  function appendMessageToLog(msg) {
    const log = $("#chat-log");
    if (!log) return;
    if (activeMessages.some(m => m.id === msg.id)) return; // dedupe: optimistic send + realtime echo
    activeMessages.push(msg);
    const wasNearBottom = isNearBottom(log);
    renderChatLog(activeMessages);
    if (wasNearBottom) {
      scrollLogToBottom(log);
    } else {
      unseenWhileScrolledUp += 1;
      updateScrollBottomBtn();
    }
  }

  // ---- 6. WIRE UP EVENTS ------------------------------------------------
  function openNewMessageModal() {
    $("#new-message-backdrop").classList.remove("hidden");
    const input = $("#friend-search-input");
    if (input) { input.value = ""; input.focus(); }
    renderNewMessageResults("");
  }
  function closeNewMessageModal() {
    $("#new-message-backdrop").classList.add("hidden");
  }
  function openRequestsModal() {
    $("#requests-backdrop").classList.remove("hidden");
    renderIncomingRequests();
  }
  function closeRequestsModal() {
    $("#requests-backdrop").classList.add("hidden");
  }

  function wireFriendsEvents() {
    const googleSignInBtn = $("#google-signin-btn");
    const signOutBtn = $("#friends-signout-btn");
    const sendBtn = $("#chat-send-btn");
    const backBtn = $("#chat-back-btn");
    const newMessageBtn = $("#new-message-btn");
    const newMessageEmptyBtn = $("#convo-empty-new-btn");
    const newMessageClose = $("#new-message-close");
    const newMessageBackdrop = $("#new-message-backdrop");
    const requestsBtn = $("#requests-btn");
    const requestsClose = $("#requests-close");
    const requestsBackdrop = $("#requests-backdrop");
    const convSearchInput = $("#conv-search-input");

    if (googleSignInBtn) googleSignInBtn.addEventListener("click", async () => {
      try { await signInWithGoogle(); } catch (e) { alert(e.message); }
    });

    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    if (newMessageBtn) newMessageBtn.addEventListener("click", openNewMessageModal);
    if (newMessageEmptyBtn) newMessageEmptyBtn.addEventListener("click", openNewMessageModal);
    if (newMessageClose) newMessageClose.addEventListener("click", closeNewMessageModal);
    if (newMessageBackdrop) newMessageBackdrop.addEventListener("click", (e) => {
      if (e.target === newMessageBackdrop) closeNewMessageModal();
    });

    if (requestsBtn) requestsBtn.addEventListener("click", openRequestsModal);
    if (requestsClose) requestsClose.addEventListener("click", closeRequestsModal);
    if (requestsBackdrop) requestsBackdrop.addEventListener("click", (e) => {
      if (e.target === requestsBackdrop) closeRequestsModal();
    });

    const searchInput = $("#friend-search-input");
    if (searchInput) searchInput.addEventListener("input", () => {
      renderNewMessageResults(searchInput.value);
    });

    if (convSearchInput) convSearchInput.addEventListener("input", () => {
      renderFilteredMessages(convSearchInput.value);
    });

    const chatInput = $("#chat-input");

    function autosizeInput() {
      if (!chatInput) return;
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    }
    function updateSendState() {
      if (!sendBtn || !chatInput) return;
      sendBtn.disabled = !chatInput.value.trim() && !pendingAttachment;
    }

    async function doSend() {
      if (!chatInput || !activeChatFriend) return;
      if (activeChatSettings.blocked || activeChatSettings.blockedByThem) return;
      const text = chatInput.value;
      if (!text.trim() && !pendingAttachment) return;
      chatInput.value = "";
      autosizeInput();
      updateSendState();
      const extra = {};
      if (replyingToMsg) extra.reply_to_id = replyingToMsg.id;
      cancelReply();
      try {
        if (pendingAttachment) {
          const att = pendingAttachment; pendingAttachment = null; clearAttachment();
          const uploaded = await uploadAttachment(activeChatFriend.id, att.file, att.kind);
          Object.assign(extra, uploaded);
        }
        const sent = await sendMessage(activeChatFriend.id, text, extra);
        appendMessageToLog(sent);
        renderMessagesList();
      } catch (e) { alert(e.message); }
    }

    if (sendBtn) sendBtn.addEventListener("click", doSend);
    if (chatInput) {
      let lastTypingSent = 0;
      chatInput.addEventListener("input", () => {
        autosizeInput(); updateSendState();
        const now = Date.now();
        if (now - lastTypingSent > 1500 && activeChatFriend) { broadcastTyping(activeChatFriend.id); lastTypingSent = now; }
      });
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          doSend();
        }
        // Shift+Enter falls through to the textarea's default newline.
      });
      updateSendState();
    }

    const replyCancelBtn = $("#reply-preview-cancel");
    if (replyCancelBtn) replyCancelBtn.addEventListener("click", cancelReply);

    const chatLog = $("#chat-log");
    if (chatLog) chatLog.addEventListener("scroll", () => {
      if (isNearBottom(chatLog) && unseenWhileScrolledUp > 0) {
        unseenWhileScrolledUp = 0;
        updateScrollBottomBtn();
      }
    });
    const scrollBottomBtn = $("#scroll-bottom-btn");
    if (scrollBottomBtn) scrollBottomBtn.addEventListener("click", () => {
      const log = $("#chat-log");
      if (log) scrollLogToBottom(log);
    });

    if (backBtn) backBtn.addEventListener("click", backToList);
  }

  // ---- Profile panel ---------------------------------------------------
  function openProfilePanel() {
    if (!activeChatFriend) return;
    const f = activeChatFriend;
    const name = f.display_name || f.username;
    const body = $("#profile-panel-body");
    body.innerHTML = "";
    const avatar = avatarNode(name, f.avatar_url, "profile-panel-avatar");
    body.appendChild(avatar);
    body.appendChild(el("div", { class: "profile-panel-name" }, [name]));
    body.appendChild(el("div", { class: "profile-panel-status" }, [onlineUserIds.has(f.id) ? "Online" : formatLastSeen(f.last_seen_at)]));

    const actions = el("div", { class: "profile-panel-actions" }, []);
    actions.appendChild(el("button", { type: "button", onclick: () => { closeProfilePanel(); openConvoSearch(); } }, ["Search in conversation"]));
    actions.appendChild(el("button", { type: "button", onclick: () => { closeProfilePanel(); openMuteModal(); } },
      [activeChatSettings.muted_until ? "Muted \u2014 change" : "Mute notifications"]));
    actions.appendChild(el("button", { type: "button", class: "danger", onclick: () => { closeProfilePanel(); confirmBlockToggle(); } },
      [activeChatSettings.blocked ? "Unblock" : "Block"]));
    actions.appendChild(el("button", { type: "button", class: "danger", onclick: () => { closeProfilePanel(); openReportModal(); } }, ["Report"]));
    body.appendChild(actions);
    if (activeChatSettings.muted_until) {
      body.appendChild(el("div", { class: "profile-panel-state" }, [
        activeChatSettings.muted_until > "9999" ? "Muted until turned back on" : "Muted until " + new Date(activeChatSettings.muted_until).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      ]));
    }
    $("#profile-panel-backdrop").classList.remove("hidden");
  }
  function closeProfilePanel() { $("#profile-panel-backdrop").classList.add("hidden"); }

  async function confirmBlockToggle() {
    if (!activeChatFriend) return;
    const willBlock = !activeChatSettings.blocked;
    const msg = willBlock
      ? "Block " + (activeChatFriend.display_name || activeChatFriend.username) + "? They won't be able to message you."
      : "Unblock " + (activeChatFriend.display_name || activeChatFriend.username) + "?";
    if (!confirm(msg)) return;
    try { await setBlocked(activeChatFriend.id, willBlock); updateBlockedBar(); showToast(willBlock ? "Blocked" : "Unblocked"); }
    catch (e) { alert(e.message); }
  }

  function openMuteModal() { $("#mute-backdrop").classList.remove("hidden"); }
  function closeMuteModal() { $("#mute-backdrop").classList.add("hidden"); }

  function openReportModal() { $("#report-backdrop").classList.remove("hidden"); }
  function closeReportModal() { $("#report-backdrop").classList.add("hidden"); }

  function openConvoSearch() {
    $("#convo-search-backdrop").classList.remove("hidden");
    $("#convo-search-input").value = "";
    renderConvoSearchResults("");
    $("#convo-search-input").focus();
  }
  function closeConvoSearch() { $("#convo-search-backdrop").classList.add("hidden"); }

  function renderConvoSearchResults(query) {
    const box = $("#convo-search-results");
    box.innerHTML = "";
    const q = (query || "").trim().toLowerCase();
    if (!q) { box.appendChild(el("p", { class: "list-empty" }, ["Type to search this conversation."])); return; }
    const matches = activeMessages.filter(m => !m.deleted_at && (m.text || "").toLowerCase().includes(q));
    if (!matches.length) { box.appendChild(el("p", { class: "list-empty" }, ["No messages match."])); return; }
    matches.slice(-50).reverse().forEach(m => {
      const senderName = m.sender_id === currentUser.id ? "You" : (activeChatFriend.display_name || activeChatFriend.username);
      box.appendChild(el("div", {
        class: "search-result-item",
        onclick: () => { closeConvoSearch(); scrollToMessage(m.id); }
      }, [
        el("div", { class: "search-result-sender" }, [senderName]),
        el("div", { class: "search-result-preview" }, [m.text || "Attachment"]),
        el("div", { class: "search-result-date" }, [fmtDateSeparator(m.created_at) + " \u00b7 " + fmtClockTime(m.created_at)])
      ]));
    });
  }

  function wirePhase2Events() {
    const headerIdBtn = $("#chat-header-id-btn");
    if (headerIdBtn) headerIdBtn.addEventListener("click", openProfilePanel);
    const profileClose = $("#profile-panel-close");
    if (profileClose) profileClose.addEventListener("click", closeProfilePanel);
    const profileBackdrop = $("#profile-panel-backdrop");
    if (profileBackdrop) profileBackdrop.addEventListener("click", (e) => { if (e.target === profileBackdrop) closeProfilePanel(); });

    const searchBtn = $("#chat-search-btn");
    if (searchBtn) searchBtn.addEventListener("click", openConvoSearch);
    const searchClose = $("#convo-search-close");
    if (searchClose) searchClose.addEventListener("click", closeConvoSearch);
    const searchBackdrop = $("#convo-search-backdrop");
    if (searchBackdrop) searchBackdrop.addEventListener("click", (e) => { if (e.target === searchBackdrop) closeConvoSearch(); });
    const searchInput = $("#convo-search-input");
    if (searchInput) searchInput.addEventListener("input", () => renderConvoSearchResults(searchInput.value));

    const muteClose = $("#mute-close");
    if (muteClose) muteClose.addEventListener("click", closeMuteModal);
    const muteBackdrop = $("#mute-backdrop");
    if (muteBackdrop) muteBackdrop.addEventListener("click", (e) => { if (e.target === muteBackdrop) closeMuteModal(); });
    const muteOptions = $("#mute-options");
    if (muteOptions) muteOptions.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-mins]");
      if (!btn || !activeChatFriend) return;
      try { await setMute(activeChatFriend.id, btn.dataset.mins); showToast(btn.dataset.mins === "off" ? "Unmuted" : "Muted"); closeMuteModal(); }
      catch (err) { alert(err.message); }
    });

    const reportClose = $("#report-close");
    if (reportClose) reportClose.addEventListener("click", closeReportModal);
    const reportBackdrop = $("#report-backdrop");
    if (reportBackdrop) reportBackdrop.addEventListener("click", (e) => { if (e.target === reportBackdrop) closeReportModal(); });
    const reportReasons = $("#report-reasons");
    if (reportReasons) reportReasons.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-reason]");
      if (!btn || !activeChatFriend) return;
      try { await fileReport(activeChatFriend.id, btn.dataset.reason); showToast("Report submitted"); closeReportModal(); }
      catch (err) { alert(err.message); }
    });

    // Attachments
    const attachBtn = $("#attach-btn");
    const attachMenu = $("#attach-menu");
    const attachFileInput = $("#attach-file-input");
    if (attachBtn) attachBtn.addEventListener("click", (e) => { e.stopPropagation(); attachMenu.classList.toggle("hidden"); });
    if (attachMenu) attachMenu.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-kind]");
      if (!btn) return;
      attachMenu.classList.add("hidden");
      const kind = btn.dataset.kind;
      if (kind === "image" || kind === "file") {
        attachFileInput.accept = kind === "image" ? "image/*" : "";
        attachFileInput.dataset.kind = kind;
        attachFileInput.click();
      } else {
        openSharePicker(kind);
      }
    });
    if (attachFileInput) attachFileInput.addEventListener("change", () => {
      const file = attachFileInput.files && attachFileInput.files[0];
      attachFileInput.value = "";
      if (!file) return;
      setAttachment(file, attachFileInput.dataset.kind || "file");
    });

    const shareClose = $("#share-picker-close");
    if (shareClose) shareClose.addEventListener("click", closeSharePicker);
    const shareBackdrop = $("#share-picker-backdrop");
    if (shareBackdrop) shareBackdrop.addEventListener("click", (e) => { if (e.target === shareBackdrop) closeSharePicker(); });

    // Image viewer
    const ivClose = $("#image-viewer-close");
    if (ivClose) ivClose.addEventListener("click", closeImageViewer);
    const iv = $("#image-viewer");
    if (iv) iv.addEventListener("click", (e) => { if (e.target === iv) closeImageViewer(); });
  }

  function wireChromeEvents() {
    const hamburger = $("#hamburger");
    const scrim = $("#scrim");
    const themeToggle = $("#theme-toggle");
    if (hamburger) hamburger.addEventListener("click", openSidebarMobile);
    if (scrim) scrim.addEventListener("click", closeSidebarMobile);
    if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
  }

  // ---- 7. INIT -------------------------------------------------------
  applyAppearance();
  document.addEventListener("DOMContentLoaded", () => {
    applyAppearance();
    applyDashboardIdentity();
    wireChromeEvents();
    wireFriendsEvents();
    wirePhase2Events();
    initAuth();
  });

})();
