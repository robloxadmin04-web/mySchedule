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

  let currentUser = null; // { id, email, username, display_name }
  let activeChatFriend = null; // profile object of friend currently chatting with
  let messageChannel = null; // realtime subscription handle

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
    }

    sb.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await loadCurrentUser(session.user.id);
        await syncProfileFromDashboard();
        scrubUrlHash();
        renderAuthState();
      } else {
        currentUser = null;
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
      .select("friend_id, profiles!friends_friend_id_fkey(id, username, display_name, avatar_url)")
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

  async function sendMessage(friendId, text) {
    const chatId = chatIdFor(currentUser.id, friendId);
    const { error } = await sb.from("messages").insert({
      chat_id: chatId, sender_id: currentUser.id, recipient_id: friendId, text: text.trim()
    });
    if (error) throw error;
  }

  function subscribeToChat(friendId, onNewMessage) {
    if (messageChannel) sb.removeChannel(messageChannel);
    const chatId = chatIdFor(currentUser.id, friendId);
    messageChannel = sb
      .channel(`chat-${chatId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        payload => onNewMessage(payload.new)
      )
      .subscribe();
  }

  // ---- 5. RENDERING ---------------------------------------------------
  function renderAuthState() {
    const authBox = $("#friends-auth");
    const appBox = $("#friends-app");
    if (!authBox || !appBox) return;
    if (currentUser) {
      authBox.classList.add("hidden");
      appBox.classList.remove("hidden");
      renderFriendsList();
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
          el("button", { class: "btn btn-primary btn-sm", onclick: async () => { await acceptRequest(r.id); renderIncomingRequests(); renderFriendsList(); renderMessagesList(); } }, ["Accept"]),
          el("button", { class: "btn btn-ghost btn-sm", onclick: async () => { await declineRequest(r.id); renderIncomingRequests(); } }, ["Decline"])
        ])
      ]));
    });
  }

  function updateRequestsBadge(count) {
    const tab = document.querySelector('.tab-btn[data-tab="requests"]');
    if (!tab) return;
    let badge = tab.querySelector(".tab-badge");
    if (!count) { if (badge) badge.remove(); return; }
    if (!badge) { badge = el("span", { class: "tab-badge" }, [String(count)]); tab.appendChild(badge); }
    else badge.textContent = String(count);
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

  async function renderFriendsList() {
    const box = $("#friends-list");
    if (!box) return;
    box.innerHTML = "";
    let friends;
    try { friends = await getFriends(); } catch (e) { return; }
    setCount("#friends-count", friends.length);
    if (!friends.length) {
      box.appendChild(el("p", { class: "list-empty" }, ["No friends yet. Search Add People to add someone."]));
      return;
    }
    friends.forEach(f => {
      const row = el("div", { class: "conv-item-row" }, [
        buildConvItem(f),
        el("div", { class: "conv-item-actions" }, [
          el("button", { class: "btn btn-ghost btn-sm", onclick: async (e) => {
            e.stopPropagation();
            const name = f.display_name || f.username;
            if (confirm(`Unfriend ${name}?`)) {
              await unfriend(f.id);
              renderFriendsList();
              renderMessagesList();
              if (activeChatFriend && activeChatFriend.id === f.id) closeChat();
            }
          } }, ["Unfriend"])
        ])
      ]);
      box.appendChild(row);
    });
  }

  // "Messages" tab: friends with a last-message preview + time,
  // sorted most-recent-first when history exists.
  async function renderMessagesList() {
    const box = $("#messages-list");
    if (!box) return;
    let friends;
    try { friends = await getFriends(); } catch (e) { return; }
    setCount("#messages-count", friends.length);
    box.innerHTML = "";
    if (!friends.length) {
      box.appendChild(el("p", { class: "list-empty" }, ["No conversations yet. Add a friend to start chatting."]));
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

    withLast.forEach(({ friend, last }) => {
      const preview = last ? ((last.sender_id === currentUser.id ? "You: " : "") + last.text) : null;
      const time = last ? fmtClockTime(last.created_at) : null;
      box.appendChild(buildConvItem(friend, { preview, time }));
    });
  }

  function renderSearchResults(results) {
    const box = $("#friend-search-results");
    if (!box) return;
    box.innerHTML = "";
    if (!results.length) {
      box.appendChild(el("p", { class: "list-empty" }, ["No users found."]));
      return;
    }
    results.forEach(u => {
      const name = u.display_name || u.username;
      const row = el("div", { class: "conv-item-row" }, [
        el("div", { class: "conv-item", style: "cursor:default;" }, [
          avatarNode(name, u.avatar_url),
          el("div", { class: "conv-item-body" }, [
            el("div", { class: "conv-item-name" }, [name])
          ])
        ]),
        el("button", { class: "btn btn-primary btn-sm", onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = "Sent";
          try { await sendFriendRequest(u.id); } catch (err) { e.target.textContent = "Error"; }
        } }, ["Add Friend"])
      ]);
      box.appendChild(row);
    });
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
    $("#chat-with-status").textContent = "Online";

    $("#chat-shell").classList.add("conv-open");

    const log = $("#chat-log");
    log.innerHTML = "<p class='list-empty'>Loading messages...</p>";
    const messages = await loadMessages(friend.id);
    log.innerHTML = "";
    messages.forEach(appendMessageToLog);
    log.scrollTop = log.scrollHeight;
    subscribeToChat(friend.id, (msg) => {
      appendMessageToLog(msg);
      log.scrollTop = log.scrollHeight;
      renderMessagesList();
    });

    renderMessagesList();
  }

  function closeChat() {
    activeChatFriend = null;
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

  function appendMessageToLog(msg) {
    const log = $("#chat-log");
    if (!log) return;
    const mine = msg.sender_id === currentUser.id;
    log.appendChild(el("div", { class: "msg" + (mine ? " mine" : "") }, [msg.text]));
  }

  // ---- 6. WIRE UP EVENTS ------------------------------------------------
  function wireFriendsEvents() {
    const googleSignInBtn = $("#google-signin-btn");
    const signOutBtn = $("#friends-signout-btn");
    const searchBtn = $("#friend-search-btn");
    const sendBtn = $("#chat-send-btn");
    const closeChatBtn = $("#chat-close-btn");
    const backBtn = $("#chat-back-btn");

    if (googleSignInBtn) googleSignInBtn.addEventListener("click", async () => {
      try { await signInWithGoogle(); } catch (e) { alert(e.message); }
    });

    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    if (searchBtn) searchBtn.addEventListener("click", async () => {
      const q = $("#friend-search-input").value;
      try { renderSearchResults(await searchUsers(q)); } catch (e) { alert(e.message); }
    });
    const searchInput = $("#friend-search-input");
    if (searchInput) searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") searchBtn && searchBtn.click();
    });

    if (sendBtn) sendBtn.addEventListener("click", async () => {
      const input = $("#chat-input");
      const text = input.value;
      if (!text.trim() || !activeChatFriend) return;
      input.value = "";
      try { await sendMessage(activeChatFriend.id, text); } catch (e) { alert(e.message); }
    });
    const chatInput = $("#chat-input");
    if (chatInput) chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendBtn && sendBtn.click();
    });

    if (closeChatBtn) closeChatBtn.addEventListener("click", closeChat);
    if (backBtn) backBtn.addEventListener("click", backToList);

    wireTabEvents();
  }

  function wireTabEvents() {
    const tabbar = $("#chat-tabbar");
    if (!tabbar) return;
    $all(".tab-btn", tabbar).forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-tab");
        $all(".tab-btn", tabbar).forEach(b => {
          const isActive = b === btn;
          b.classList.toggle("active", isActive);
          b.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        $all(".tab-panel").forEach(panel => {
          panel.classList.toggle("active", panel.getAttribute("data-panel") === target);
        });
      });
    });
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
    initAuth();
  });

})();
