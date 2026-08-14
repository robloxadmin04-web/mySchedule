/* ============================================================
   mySchedule — Chat module (Supabase, Google sign-in)
   ------------------------------------------------------------
   HOW TO USE:
   1. Add to chat.html <head>, BEFORE this file's <script> tag:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   2. Add this file AFTER supabase-js:
        <script src="chat.js"></script>
   3. Fill in SUPABASE_URL and SUPABASE_ANON_KEY below
      (Project Settings > API in your Supabase dashboard).
   4. In your Supabase dashboard, enable the Google provider under
      Authentication > Providers, and add this page's URL (and your
      production URL) to Authentication > URL Configuration >
      Redirect URLs.
   5. Run supabase_friends_schema.sql in the Supabase SQL editor first.
      Once signed in with Google here, the same Supabase session is
      shared (via localStorage) with the rest of the app on this
      origin — no separate login needed elsewhere.
   6. PROFILE SYNC: whenever the user is signed in, this file reads
      the dashboard's local profile (name + avatar, from index.html's
      "coursework.state.v1" localStorage entry) and pushes it into
      the Supabase "profiles" row (display_name, avatar_url), so
      friends/chat always show whatever identity the user set on
      their dashboard. If a user is signed in but hasn't set a
      dashboard name yet, the existing Supabase profile is left as-is.
   ============================================================ */

(function () {
  "use strict";

  // ---- 1. CONFIG -------------------------------------------------
  const SUPABASE_URL = "https://lvdyxnygzbcnprdncpzx.supabase.co"; // e.g. https://xxxx.supabase.co
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

  // chat.css expects an .avatar with 1-2 letter initials inside .list-row
  function initialsOf(nameOrUsername) {
    const s = (nameOrUsername || "?").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  let currentUser = null; // { id, email, username, display_name }
  let activeChatFriend = null; // profile object of friend currently chatting with
  let messageChannel = null; // realtime subscription handle

  function chatIdFor(uidA, uidB) {
    return [uidA, uidB].sort().join("_");
  }

  // ---- 1b. PROFILE SYNC (Coursework dashboard -> Supabase) --------
  // The dashboard (index.html / script.js) keeps its own "profile"
  // (name, avatar) in localStorage under this key, separate from the
  // Supabase profiles table. Whenever we're signed in, push name/avatar
  // from the dashboard's local profile into Supabase so friends/chat
  // always show the same identity the user set on their dashboard.
  const DASHBOARD_STORAGE_KEY = "coursework.state.v1";

  function readDashboardProfile() {
    try {
      const raw = localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      const p = state && state.profile;
      if (!p) return null;
      return {
        name: (p.name || "").trim(),
        avatar: p.avatar || ""
      };
    } catch (e) {
      return null;
    }
  }

  async function syncProfileFromDashboard() {
    if (!currentUser) return;
    const local = readDashboardProfile();
    if (!local || !local.name) return; // nothing set on dashboard yet

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
    // Reflect the synced identity anywhere our own name/avatar shows.
    renderBrandIdentity();
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

    // Live-sync if the dashboard profile changes in another tab
    // (or in this same tab, if index.html and chat.html ever share a page).
    window.addEventListener("storage", (e) => {
      if (e.key === DASHBOARD_STORAGE_KEY) syncProfileFromDashboard();
    });
  }

  // Removes "#access_token=..." (and any stray extra "#..." fragments)
  // from the address bar once Supabase has read the session from it,
  // so it never carries over into the next sign-in redirect.
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
    // IMPORTANT: use a clean redirect URL with no leftover hash/query.
    // If a previous OAuth attempt left "#access_token=..." in the URL,
    // window.location.href would carry that stale fragment along, and
    // the new "#access_token=..." from this login gets appended after
    // it — producing a URL with multiple "#" fragments that Supabase's
    // session parser cannot read, silently breaking sign-in.
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
    const { error } = await sb.from("friend_requests").insert({
      from_id: currentUser.id,
      to_id: toId
    });
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

  async function sendMessage(friendId, text) {
    const chatId = chatIdFor(currentUser.id, friendId);
    const { error } = await sb.from("messages").insert({
      chat_id: chatId,
      sender_id: currentUser.id,
      recipient_id: friendId,
      text: text.trim()
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
    }
    renderBrandIdentity();
  }

  // Shows the signed-in user's own synced profile (avatar + name) in the
  // sidebar brand slot, in place of the static "C" / "Coursework" — so
  // it's easy to see at a glance whether the dashboard profile synced.
  function renderBrandIdentity() {
    const mark = $("#brand-mark");
    const name = $("#brand-name");
    if (!mark || !name) return;

    if (!currentUser) {
      mark.innerHTML = "C";
      name.textContent = "Coursework";
      return;
    }

    const displayName = currentUser.display_name || currentUser.username || "Coursework";
    name.textContent = displayName;

    if (currentUser.avatar_url) {
      mark.innerHTML = "";
      mark.appendChild(el("img", {
        src: currentUser.avatar_url,
        alt: displayName,
        style: "width:100%;height:100%;object-fit:cover;border-radius:inherit;"
      }));
    } else {
      mark.innerHTML = "";
      mark.textContent = initialsOf(displayName);
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
      box.appendChild(el("div", { class: "list-row" }, [
        el("div", { class: "list-row-id" }, [
          el("span", { class: "avatar" }, [initialsOf(name)]),
          el("span", { class: "list-row-name" }, [name])
        ]),
        el("div", { class: "list-row-actions" }, [
          el("button", { class: "btn btn-primary btn-sm", onclick: async () => { await acceptRequest(r.id); renderIncomingRequests(); renderFriendsList(); renderMessagesList(); } }, ["Accept"]),
          el("button", { class: "btn btn-ghost btn-sm", onclick: async () => { await declineRequest(r.id); renderIncomingRequests(); } }, ["Decline"])
        ])
      ]));
    });
  }

  // Small numbered dot on the "Requests" tab so pending requests are
  // visible without needing to switch tabs first.
  function updateRequestsBadge(count) {
    const tab = document.querySelector('.tab-btn[data-tab="requests"]');
    if (!tab) return;
    let badge = tab.querySelector(".tab-badge");
    if (!count) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = el("span", { class: "tab-badge" }, [String(count)]);
      tab.appendChild(badge);
    } else {
      badge.textContent = String(count);
    }
  }

  async function renderFriendsList() {
    const box = $("#friends-list");
    if (!box) return;
    box.innerHTML = "";
    let friends;
    try { friends = await getFriends(); } catch (e) { return; }
    if (!friends.length) {
      box.appendChild(el("p", { class: "list-empty" }, ["No friends yet. Search the Add Friend tab to add someone."]));
      return;
    }
    friends.forEach(f => {
      const name = f.display_name || f.username;
      box.appendChild(el("div", { class: "list-row" }, [
        el("div", { class: "list-row-id", onclick: () => openChat(f) }, [
          el("span", { class: "avatar online" }, [initialsOf(name)]),
          el("span", { class: "list-row-name" }, [name])
        ]),
        el("div", { class: "list-row-actions" }, [
          el("button", { class: "btn btn-ghost btn-sm", onclick: () => openChat(f) }, ["Chat"]),
          el("button", { class: "btn btn-ghost btn-sm", onclick: async () => {
            if (confirm(`Unfriend ${name}?`)) {
              await unfriend(f.id);
              renderFriendsList();
              renderMessagesList();
              if (activeChatFriend && activeChatFriend.id === f.id) closeChat();
            }
          } }, ["Unfriend"])
        ])
      ]));
    });
  }

  // "Messages" tab: a lighter conversation-starter view over the same
  // friends list, without the friend-management actions (Unfriend) —
  // just the people you can open a chat with. Placeholder for a real
  // last-message preview if/when message history is surfaced here.
  async function renderMessagesList() {
    const box = $("#messages-list");
    if (!box) return;
    box.innerHTML = "";
    let friends;
    try { friends = await getFriends(); } catch (e) { return; }
    if (!friends.length) {
      box.appendChild(el("p", { class: "list-empty" }, ["No conversations yet. Add a friend to start chatting."]));
      return;
    }
    friends.forEach(f => {
      const name = f.display_name || f.username;
      box.appendChild(el("div", { class: "list-row" }, [
        el("div", { class: "list-row-id", onclick: () => openChat(f) }, [
          el("span", { class: "avatar online" }, [initialsOf(name)]),
          el("span", { class: "list-row-name" }, [name])
        ]),
        el("div", { class: "list-row-actions" }, [
          el("button", { class: "btn btn-ghost btn-sm", onclick: () => openChat(f) }, ["Open"])
        ])
      ]));
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
      box.appendChild(el("div", { class: "list-row" }, [
        el("div", { class: "list-row-id" }, [
          el("span", { class: "avatar" }, [initialsOf(name)]),
          el("span", { class: "list-row-name" }, [name])
        ]),
        el("div", { class: "list-row-actions" }, [
          el("button", { class: "btn btn-primary btn-sm", onclick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = "Sent";
            try { await sendFriendRequest(u.id); } catch (err) { e.target.textContent = "Error"; }
          } }, ["Add Friend"])
        ])
      ]));
    });
  }

  async function openChat(friend) {
    activeChatFriend = friend;
    $("#chat-panel").classList.remove("hidden");
    $("#chat-with-name").textContent = friend.display_name || friend.username;
    const log = $("#chat-log");
    log.innerHTML = "<p class='list-empty'>Loading messages...</p>";
    const messages = await loadMessages(friend.id);
    log.innerHTML = "";
    messages.forEach(appendMessageToLog);
    log.scrollTop = log.scrollHeight;
    subscribeToChat(friend.id, (msg) => {
      appendMessageToLog(msg);
      log.scrollTop = log.scrollHeight;
    });
  }

  function closeChat() {
    activeChatFriend = null;
    $("#chat-panel").classList.add("hidden");
    if (messageChannel) { sb.removeChannel(messageChannel); messageChannel = null; }
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

    if (googleSignInBtn) googleSignInBtn.addEventListener("click", async () => {
      try { await signInWithGoogle(); } catch (e) { alert(e.message); }
    });

    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    if (searchBtn) searchBtn.addEventListener("click", async () => {
      const q = $("#friend-search-input").value;
      try { renderSearchResults(await searchUsers(q)); } catch (e) { alert(e.message); }
    });

    if (sendBtn) sendBtn.addEventListener("click", async () => {
      const input = $("#chat-input");
      const text = input.value;
      if (!text.trim() || !activeChatFriend) return;
      input.value = "";
      try { await sendMessage(activeChatFriend.id, text); } catch (e) { alert(e.message); }
    });

    if (closeChatBtn) closeChatBtn.addEventListener("click", closeChat);

    wireTabEvents();
  }

  // Switches between the Messages / Friends / Requests / Add Friend
  // panels so they're never all shown crowded together at once.
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

  // ---- 7. INIT -------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    wireFriendsEvents();
    initAuth();
  });

})();

/* ============================================================
   INDEX_HTML_SNIPPET — add this markup to index.html

   1. New nav button, next to your other .nav-item buttons:

   <button class="nav-item" data-view="friends">
     <span class="nav-ico" data-ico="user"></span>Friends
   </button>

   2. New view section, alongside your other <div class="view" id="view-...">
      sections (give it the same "view" class so switchView() shows/hides it):

   <div class="view" id="view-friends">

     <div id="friends-auth">
       <h2>Sign in to use Friends</h2>
       <button class="btn btn-primary" id="google-signin-btn">Sign in with Google</button>
     </div>

     <div id="friends-app" class="hidden">
       <button class="btn btn-ghost btn-sm" id="friends-signout-btn">Sign Out</button>

       <h3>Add a Friend</h3>
       <input type="text" id="friend-search-input" placeholder="Search username...">
       <button class="btn btn-primary btn-sm" id="friend-search-btn">Search</button>
       <div id="friend-search-results"></div>

       <h3>Friend Requests</h3>
       <div id="friend-requests-list"></div>

       <h3>Your Friends</h3>
       <div id="friends-list"></div>

       <div id="chat-panel" class="hidden">
         <div class="chat-header">
           <span id="chat-with-name"></span>
           <button class="btn btn-ghost btn-sm" id="chat-close-btn">Close</button>
         </div>
         <div id="chat-log" class="chat-log"></div>
         <div class="chat-input-row">
           <input type="text" id="chat-input" placeholder="Type a message...">
           <button class="btn btn-primary" id="chat-send-btn">Send</button>
         </div>
       </div>
     </div>
   </div>

   3. In <head>, ADD BEFORE this file's script tag:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

   4. At the end of <body>, add:
   <script src="chat.js"></script>
   ============================================================ */
