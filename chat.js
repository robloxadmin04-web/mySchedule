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

  let currentUser = null; // { id, email, username, display_name }
  let activeChatFriend = null; // profile object of friend currently chatting with
  let messageChannel = null; // realtime subscription handle

  function chatIdFor(uidA, uidB) {
    return [uidA, uidB].sort().join("_");
  }

  // ---- 2. AUTH -----------------------------------------------------
  async function initAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await loadCurrentUser(session.user.id);

    sb.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await loadCurrentUser(session.user.id);
        renderAuthState();
      } else {
        currentUser = null;
        renderAuthState();
      }
    });

    renderAuthState();
  }

  async function loadCurrentUser(uid) {
    const { data, error } = await sb.from("profiles").select("*").eq("id", uid).single();
    if (!error) currentUser = data;
  }

  async function signInWithGoogle() {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href }
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
    } else {
      authBox.classList.remove("hidden");
      appBox.classList.add("hidden");
    }
  }

  async function renderIncomingRequests() {
    const box = $("#friend-requests-list");
    if (!box) return;
    box.innerHTML = "";
    let requests;
    try { requests = await getIncomingRequests(); } catch (e) { return; }
    if (!requests.length) {
      box.appendChild(el("p", { class: "muted" }, ["No pending friend requests."]));
      return;
    }
    requests.forEach(r => {
      const p = r.profiles;
      box.appendChild(el("div", { class: "friend-request-row" }, [
        el("span", {}, [p.display_name || p.username]),
        el("button", { class: "btn btn-primary btn-sm", onclick: async () => { await acceptRequest(r.id); renderIncomingRequests(); renderFriendsList(); } }, ["Accept"]),
        el("button", { class: "btn btn-ghost btn-sm", onclick: async () => { await declineRequest(r.id); renderIncomingRequests(); } }, ["Decline"])
      ]));
    });
  }

  async function renderFriendsList() {
    const box = $("#friends-list");
    if (!box) return;
    box.innerHTML = "";
    let friends;
    try { friends = await getFriends(); } catch (e) { return; }
    if (!friends.length) {
      box.appendChild(el("p", { class: "muted" }, ["No friends yet. Search above to add someone."]));
      return;
    }
    friends.forEach(f => {
      box.appendChild(el("div", { class: "friend-row" }, [
        el("span", { onclick: () => openChat(f) }, [f.display_name || f.username]),
        el("button", { class: "btn btn-outline btn-sm", onclick: () => openChat(f) }, ["Chat"]),
        el("button", { class: "btn btn-ghost btn-sm", onclick: async () => {
          if (confirm(`Unfriend ${f.display_name || f.username}?`)) {
            await unfriend(f.id);
            renderFriendsList();
            if (activeChatFriend && activeChatFriend.id === f.id) closeChat();
          }
        } }, ["Unfriend"])
      ]));
    });
  }

  function renderSearchResults(results) {
    const box = $("#friend-search-results");
    if (!box) return;
    box.innerHTML = "";
    if (!results.length) {
      box.appendChild(el("p", { class: "muted" }, ["No users found."]));
      return;
    }
    results.forEach(u => {
      box.appendChild(el("div", { class: "friend-row" }, [
        el("span", {}, [u.display_name || u.username]),
        el("button", { class: "btn btn-primary btn-sm", onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = "Sent";
          try { await sendFriendRequest(u.id); } catch (err) { e.target.textContent = "Error"; }
        } }, ["Add Friend"])
      ]));
    });
  }

  async function openChat(friend) {
    activeChatFriend = friend;
    $("#chat-panel").classList.remove("hidden");
    $("#chat-with-name").textContent = friend.display_name || friend.username;
    const log = $("#chat-log");
    log.innerHTML = "<p class='muted'>Loading messages...</p>";
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
    log.appendChild(el("div", { class: "chat-bubble " + (mine ? "mine" : "theirs") }, [msg.text]));
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
