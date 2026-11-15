const $ = (id) => document.getElementById(id);
let token = "";
let messages = [];

function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}

async function request(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload.data;
}

function connectView(connected) {
  $("connect").classList.toggle("hidden", connected);
  $("inbox").classList.toggle("hidden", !connected);
  $("connection").textContent = connected ? "Connected" : "Not connected";
}

async function loadMessages() {
  try {
    messages = await request("/mail?limit=50");
    $("count").textContent = `${messages.length} recent messages`;
    const list = $("message-list");
    list.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No messages yet."; list.append(empty); return;
    }
    for (const item of messages) {
      const row = document.createElement("div"); row.className = "message"; row.dataset.id = item.id;
      const sender = document.createElement("strong"); sender.textContent = item.sender || "Unknown sender";
      const subject = document.createElement("p"); subject.textContent = item.subject || "(no subject)";
      const date = document.createElement("time"); date.textContent = new Date(item.received_at).toLocaleString();
      row.append(sender, subject, date);
      row.addEventListener("click", () => openMessage(item.id));
      list.append(row);
    }
  } catch (error) { toast(error.message); }
}

async function openMessage(id) {
  try {
    const item = await request(`/mail/${encodeURIComponent(id)}`);
    $("reader-empty").classList.add("hidden");
    $("reader").classList.remove("hidden");
    $("reader-direction").textContent = item.direction;
    $("reader-subject").textContent = item.subject || "(no subject)";
    $("reader-from").textContent = item.sender || "";
    $("reader-date").textContent = new Date(item.received_at).toLocaleString();
    // Render text only. HTML email is deliberately not injected into the app DOM.
    $("reader-body").textContent = item.text_body || "(This message contains no plain-text body.)";
    document.querySelectorAll(".message").forEach(el => el.classList.toggle("selected", el.dataset.id === id));
  } catch (error) { toast(error.message); }
}

$("connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  token = $("api-key").value.trim();
  try {
    const data = await request("/mail?limit=1");
    void data;
    const me = await request("/mail?limit=1");
    $("mail-address").textContent = "Mailbox";
    connectView(true);
    await loadMessages();
  } catch (error) {
    token = "";
    toast(error.message);
  }
});
$("refresh").addEventListener("click", loadMessages);
$("disconnect").addEventListener("click", () => {
  token = "";
  $("api-key").value = "";
  $("reader").classList.add("hidden");
  $("reader-empty").classList.remove("hidden");
  connectView(false);
});
