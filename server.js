// ════════════════════════════════════════════════════════════════
// NEXUS AI — COMPLETE BACKEND SERVER
// Run: npm install → npm start
// ════════════════════════════════════════════════════════════════

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static("public"));
app.set('trust proxy', true);

// ─── FILE UPLOAD CONFIG ───
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".txt", ".pdf", ".doc", ".docx", ".csv", ".json"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("File type not supported"));
  },
});

// ════════════════════════════════════════════════════════════════
// DATABASE (JSON files — swap to MongoDB/Supabase later)
// ════════════════════════════════════════════════════════════════
const DB_PATH = "./data";
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });

function loadDB(file) {
  const p = path.join(DB_PATH, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "{}");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function saveDB(file, data) {
  fs.writeFileSync(path.join(DB_PATH, file), JSON.stringify(data, null, 2));
}
function getBusinesses() { return loadDB("businesses.json"); }
function saveBusiness(id, data) {
  const all = getBusinesses();
  all[id] = data;
  saveDB("businesses.json", all);
}
function getBusiness(id) { return getBusinesses()[id] || null; }

// ════════════════════════════════════════════════════════════════
// AI ENGINE — Groq (Llama 3.3) + Rule-Based Fallback
// ════════════════════════════════════════════════════════════════

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function buildSystemPrompt(biz) {
  return `You are the AI assistant for "${biz.name}" — ${biz.type}. ${biz.tagline || ""}

YOUR ROLE: Handle customer support, bookings, recommendations, and collect customer info. Be warm, helpful, concise (max 3 sentences when possible). Use emojis sparingly.

BUSINESS INFO:
- Name: ${biz.name}
- Type: ${biz.type}
- Address: ${biz.address || "Not provided"}
- Phone: ${biz.phone || "Not provided"}
- Email: ${biz.email || "Not provided"}
- Hours: ${biz.hours ? Object.entries(biz.hours).map(([d, h]) => d + ": " + h).join(", ") : "Not specified"}

SERVICES & PRICING:
${(biz.services || []).map(s => "- " + s.name + ": Rs." + s.price + " (" + s.duration + ")").join("\n") || "No services listed."}

CURRENT OFFERS:
${(biz.offers || []).map(o => "- " + o.name + ": " + o.desc + " (Code: " + o.code + ")").join("\n") || "No offers."}

FAQs:
${(biz.faqs || []).map(f => "Q: " + f.q + "\nA: " + f.a).join("\n\n") || "No FAQs."}

${biz.customKnowledge ? "ADDITIONAL KNOWLEDGE:\n" + biz.customKnowledge : ""}

RULES:
1. BOOKING: Ask for service, date, time, name & phone. Confirm before finalizing. Add [BOOKING_CONFIRMED] when done.
2. INFO COLLECTION: Naturally collect name/phone/email. Add [INFO_COLLECTED] when you get details.
3. RECOMMENDATIONS: Suggest relevant services + mention applicable offers with codes.
4. HANDOFF: For complaints/refunds/complex issues say "Let me connect you with our team — they'll reach out within 10 minutes." Add [HANDOFF_REQUIRED].
5. Keep responses short and conversational. No markdown.`;
}

function ruleResponse(input, biz) {
  const l = input.toLowerCase().trim();

  if (/^(hi+|hello|hey|good\s*(morning|afternoon|evening)|howdy|namaste)/i.test(l))
    return "Hello! Welcome to " + biz.name + " 😊 How can I help you today?";

  if (/\b(hour|timing|open|close|when do you)\b/i.test(l)) {
    if (biz.hours) {
      const hrs = Object.entries(biz.hours).map(([d, h]) => d + ": " + h).join("\n");
      return "Our hours:\n" + hrs + "\n\nWant to book an appointment?";
    }
    return "Please contact us for hours. Can I help with something else?";
  }

  if (/\b(where|address|location|direction|map)\b/i.test(l))
    return biz.address ? "We're at " + biz.address + " 📍 Would you like to book a visit?" : "Please contact us for location details.";

  if (/\b(price|cost|rate|how much|charge|fee|menu|service)\b/i.test(l)) {
    if (biz.services && biz.services.length) {
      const list = biz.services.map(s => "• " + s.name + " — Rs." + s.price + " (" + s.duration + ")").join("\n");
      return "Here are our services:\n\n" + list + "\n\nWant to book something?";
    }
    return "Please contact us for current pricing!";
  }

  if (/\b(offer|discount|deal|promo|coupon|code|sale)\b/i.test(l)) {
    if (biz.offers && biz.offers.length) {
      const list = biz.offers.map(o => "• " + o.name + ": " + o.desc + " — Code: " + o.code).join("\n");
      return "Current offers:\n\n" + list + "\n\nWant me to help you book with a discount?";
    }
    return "No active offers right now, but I can help you book a service!";
  }

  if (/\b(book|appointment|schedule|reserve|slot|available)\b/i.test(l))
    return "I'd love to help you book! What service are you interested in? And what date/time works for you?";

  if (/\b(cancel|refund|complaint|problem|issue|worst|terrible|angry|frustrated)\b/i.test(l))
    return "I'm sorry to hear that. Let me connect you with our team — they'll reach out within 10 minutes. [HANDOFF_REQUIRED]";

  if (/\b(pay|payment|upi|card|cash|paytm|gpay|phonepe)\b/i.test(l))
    return "We accept cash, UPI (GPay/PhonePe), all major cards, and Paytm!";

  if (/\b(thank|thanks|thx|ty)\b/i.test(l))
    return "You're welcome! 😊 Reach out anytime!";

  if (/\b(bye|goodbye|see you)\b/i.test(l))
    return "Bye! See you at " + biz.name + " soon! 👋";

  return null;
}

async function getAIResponse(userMsg, history, biz) {
  // 1. Rule-based (instant, free)
  const rule = ruleResponse(userMsg, biz);
  if (rule) return { text: rule, source: "rules" };

  // 2. Groq / Llama
  if (GROQ_API_KEY) {
    try {
      const msgs = (history || []).slice(-10).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text || m.content || "",
      }));
      msgs.push({ role: "user", content: userMsg });

      const res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GROQ_API_KEY,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: "system", content: buildSystemPrompt(biz) }, ...msgs],
          max_tokens: 500,
          temperature: 0.7,
        }),
      });
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text) return { text: text, source: "groq-llama" };
    } catch (e) {
      console.error("Groq error:", e.message);
    }
  }

  // 3. Fallback
  return {
    text: "I'd be happy to help! I can assist with bookings, share our services, or answer questions about " + biz.name + ". What would you like to know?",
    source: "fallback",
  };
}

// ════════════════════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════════════════════

// Health check
app.get("/api", (req, res) => {
  res.json({ status: "ok", service: "NexusAI Backend", version: "1.0.0", businesses: Object.keys(getBusinesses()).length });
});

// ─── BUSINESS CRUD ───
app.post("/api/business/create", (req, res) => {
  try {
    const { name, type, phone, email, address, hours, services, offers, faqs, tagline } = req.body;
    if (!name) return res.status(400).json({ error: "Business name is required" });

    const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (getBusiness(id)) return res.status(409).json({ error: "Business ID already exists", id: id });

    const business = {
      id: id,
      name: name,
      type: type || "General Business",
      tagline: tagline || "",
      phone: phone || "",
      email: email || "",
      address: address || "",
      hours: hours || {},
      services: services || [],
      offers: offers || [],
      faqs: faqs || [],
      customKnowledge: "",
      createdAt: new Date().toISOString(),
      conversations: [],
      bookings: [],
      leads: [],
      settings: {
        aiEnabled: true,
        autoHandoff: true,
        collectInfo: true,
        tone: "friendly",
        notifyEmail: email || "",
        notifyWhatsapp: phone || "",
      },
    };

    saveBusiness(id, business);
    const serverUrl = req.protocol + "://" + req.get("host");
    res.json({
      success: true,
      businessId: id,
      embedCode: '<script src="' + serverUrl + '/widget.js" data-business="' + id + '" async></script>',
      chatEndpoint: serverUrl + "/api/chat/" + id,
      message: "Business '" + name + "' created successfully!",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/business/:id", (req, res) => {
  const biz = getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: "Business not found" });
  // Don't expose conversations/leads in public endpoint
  const { conversations, leads, ...safe } = biz;
  res.json(safe);
});

app.put("/api/business/:id", (req, res) => {
  const biz = getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: "Business not found" });
  const updated = { ...biz, ...req.body, id: biz.id, createdAt: biz.createdAt };
  saveBusiness(req.params.id, updated);
  res.json({ success: true });
});

app.get("/api/businesses", (req, res) => {
  const all = getBusinesses();
  const list = Object.values(all).map(b => ({
    id: b.id, name: b.name, type: b.type, createdAt: b.createdAt,
    stats: { conversations: (b.conversations || []).length, bookings: (b.bookings || []).length, leads: (b.leads || []).length },
  }));
  res.json(list);
});

app.delete("/api/business/:id", (req, res) => {
  const all = getBusinesses();
  if (!all[req.params.id]) return res.status(404).json({ error: "Business not found" });
  delete all[req.params.id];
  saveDB("businesses.json", all);
  res.json({ success: true });
});

// ─── DOCUMENT UPLOAD ───
app.post("/api/business/:id/upload", upload.single("file"), (req, res) => {
  try {
    const biz = getBusiness(req.params.id);
    if (!biz) return res.status(404).json({ error: "Business not found" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let content = "";
    try { content = fs.readFileSync(req.file.path, "utf8"); } catch (e) { content = "[Binary file — could not read as text]"; }

    biz.customKnowledge = (biz.customKnowledge || "") + "\n\n--- " + req.file.originalname + " ---\n" + content;
    saveBusiness(req.params.id, biz);
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ success: true, message: "Document processed and added to knowledge base." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CHAT ENDPOINT (the core) ───
app.post("/api/chat/:businessId", async (req, res) => {
  try {
    const { message, sessionId, history } = req.body;
    const biz = getBusiness(req.params.businessId);
    if (!biz) return res.status(404).json({ error: "Business not found. Create it first at POST /api/business/create" });
    if (!message) return res.status(400).json({ error: "message is required" });

    const sid = sessionId || uuidv4();
    const result = await getAIResponse(message, history || [], biz);
    const cleanText = result.text.replace(/\[(HANDOFF_REQUIRED|BOOKING_CONFIRMED|INFO_COLLECTED)\]/g, "").trim();

    const events = [];
    if (result.text.includes("[HANDOFF_REQUIRED]")) events.push("handoff");
    if (result.text.includes("[BOOKING_CONFIRMED]")) events.push("booking");
    if (result.text.includes("[INFO_COLLECTED]")) events.push("lead");

    // Log
    if (!biz.conversations) biz.conversations = [];
    biz.conversations.push({
      sessionId: sid, userMessage: message, aiResponse: cleanText,
      source: result.source, events: events, timestamp: new Date().toISOString(),
    });
    saveBusiness(req.params.businessId, biz);

    if (events.includes("handoff")) {
      console.log("⚠️  HANDOFF NEEDED [" + biz.name + "]: " + message);
    }

    res.json({ reply: cleanText, source: result.source, sessionId: sid, events: events });
  } catch (e) {
    console.error("Chat error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── CONVERSATIONS / BOOKINGS / LEADS ───
app.get("/api/business/:id/conversations", (req, res) => {
  const biz = getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: "Business not found" });
  res.json(biz.conversations || []);
});

app.post("/api/business/:id/bookings", (req, res) => {
  const biz = getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: "Business not found" });
  const booking = { id: uuidv4(), ...req.body, status: "pending", createdAt: new Date().toISOString() };
  if (!biz.bookings) biz.bookings = [];
  biz.bookings.push(booking);
  saveBusiness(req.params.id, biz);
  res.json({ success: true, booking: booking });
});

app.get("/api/business/:id/bookings", (req, res) => {
  const biz = getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: "Business not found" });
  res.json(biz.bookings || []);
});

app.post("/api/business/:id/leads", (req, res) => {
  const biz = getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: "Business not found" });
  const lead = { id: uuidv4(), ...req.body, createdAt: new Date().toISOString() };
  if (!biz.leads) biz.leads = [];
  biz.leads.push(lead);
  saveBusiness(req.params.id, biz);
  res.json({ success: true, lead: lead });
});

// ─── WHATSAPP WEBHOOK ───
app.get("/webhook/whatsapp", (req, res) => {
  const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "nexusai-verify";
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages && messages[0]) {
      const msg = messages[0];
      console.log("📱 WhatsApp from " + msg.from + ": " + (msg.text?.body || ""));
      // TODO: Map phone → business, call getAIResponse, reply via WhatsApp API
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("WhatsApp error:", e);
    res.sendStatus(500);
  }
});

// ════════════════════════════════════════════════════════════════
// SERVE WIDGET.JS
// ════════════════════════════════════════════════════════════════
app.get("/widget.js", (req, res) => {
  const serverUrl = req.protocol + "://" + req.get("host");
  res.setHeader("Content-Type", "application/javascript");
  res.send(getWidgetScript(serverUrl));
});

function getWidgetScript(SERVER) {
  return `(function(){
  var d=document,businessId=d.currentScript?.getAttribute("data-business")||"demo",
  color=d.currentScript?.getAttribute("data-color")||"#10B981",
  pos=d.currentScript?.getAttribute("data-position")||"right",
  SERVER="${SERVER}",
  sessionId=sessionStorage.getItem("nx_s")||"s_"+Math.random().toString(36).substr(2,9),
  history=[],isOpen=false;
  sessionStorage.setItem("nx_s",sessionId);

  var css=d.createElement("style");
  css.textContent=\`
  #nx-btn{position:fixed;bottom:24px;\${pos}:24px;width:60px;height:60px;border-radius:50%;background:\${color};border:none;cursor:pointer;z-index:99998;box-shadow:0 4px 20px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;transition:transform .2s}
  #nx-btn:hover{transform:scale(1.1)}
  #nx-btn svg{width:28px;height:28px;fill:#fff}
  #nx-frame{position:fixed;bottom:96px;\${pos}:24px;width:380px;height:540px;border-radius:16px;overflow:hidden;z-index:99999;box-shadow:0 12px 48px rgba(0,0,0,0.4);display:none;flex-direction:column;background:#0E1117;border:1px solid #252D3A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  #nx-frame.open{display:flex;animation:nxUp .3s ease}
  @keyframes nxUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  #nx-hdr{padding:14px 16px;background:#12161D;border-bottom:1px solid #252D3A;display:flex;align-items:center;gap:10px}
  #nx-hdr-dot{width:9px;height:9px;border-radius:50%;background:\${color};box-shadow:0 0 6px \${color}}
  #nx-hdr-name{font-weight:700;font-size:14px;color:#E2E6ED}
  #nx-hdr-sub{font-size:11px;color:#6B7A90}
  #nx-close{margin-left:auto;background:none;border:none;color:#6B7A90;font-size:22px;cursor:pointer;padding:0 4px;line-height:1}
  #nx-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
  .nx-m{max-width:82%;padding:10px 14px;font-size:13px;line-height:1.55;border-radius:14px;word-wrap:break-word;white-space:pre-wrap}
  .nx-m.b{background:#1A1E25;border:1px solid #252D3A;color:#E2E6ED;align-self:flex-start;border-bottom-left-radius:4px}
  .nx-m.u{background:\${color};color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
  .nx-t{display:flex;gap:4px;padding:10px 16px;background:#1A1E25;border:1px solid #252D3A;border-radius:14px;align-self:flex-start}
  .nx-d{width:6px;height:6px;border-radius:50%;background:#6B7A90;animation:nxB 1s infinite}
  .nx-d:nth-child(2){animation-delay:.15s}.nx-d:nth-child(3){animation-delay:.3s}
  @keyframes nxB{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
  #nx-bar{padding:12px;border-top:1px solid #252D3A;display:flex;gap:8px;background:#12161D}
  #nx-inp{flex:1;padding:9px 14px;border-radius:8px;background:#1A1E25;border:1px solid #252D3A;color:#E2E6ED;font-size:13px;outline:none;font-family:inherit}
  #nx-snd{width:36px;height:36px;border-radius:8px;background:\${color};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center}
  #nx-snd svg{width:14px;height:14px;fill:#fff}
  #nx-pw{text-align:center;padding:6px;font-size:9px;color:#4A5568}
  .nx-qr{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .nx-qr button{padding:6px 12px;border-radius:100px;font-size:11px;background:transparent;border:1px solid #252D3A;color:#E2E6ED;cursor:pointer;font-family:inherit;transition:border-color .2s}
  .nx-qr button:hover{border-color:\${color};color:\${color}}
  \`;
  d.head.appendChild(css);

  var btn=d.createElement("button");btn.id="nx-btn";
  btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  d.body.appendChild(btn);

  var frame=d.createElement("div");frame.id="nx-frame";
  frame.innerHTML='<div id="nx-hdr"><div id="nx-hdr-dot"></div><div><div id="nx-hdr-name">AI Assistant</div><div id="nx-hdr-sub">Replies instantly</div></div><button id="nx-close">&times;</button></div><div id="nx-msgs"></div><div id="nx-bar"><input id="nx-inp" placeholder="Type a message..."><button id="nx-snd"><svg viewBox="0 0 24 24"><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div><div id="nx-pw">Powered by NexusAI</div>';
  d.body.appendChild(frame);

  var msgs=d.getElementById("nx-msgs"),inp=d.getElementById("nx-inp"),loaded=false;

  btn.onclick=function(){isOpen=!isOpen;frame.classList.toggle("open",isOpen);if(isOpen&&!loaded){loaded=true;loadBiz();}inp.focus();};
  d.getElementById("nx-close").onclick=function(){isOpen=false;frame.classList.remove("open");};

  function addMsg(t,cls){var e=d.createElement("div");e.className="nx-m "+cls;e.textContent=t;msgs.appendChild(e);msgs.scrollTop=msgs.scrollHeight;return e;}
  function showTyping(){var e=d.createElement("div");e.className="nx-t";e.id="nx-tp";e.innerHTML='<div class="nx-d"></div><div class="nx-d"></div><div class="nx-d"></div>';msgs.appendChild(e);msgs.scrollTop=msgs.scrollHeight;}
  function hideTyping(){var e=d.getElementById("nx-tp");if(e)e.remove();}

  function addQuickReplies(items){
    var wrap=d.createElement("div");wrap.className="nx-qr";
    items.forEach(function(text){
      var b=d.createElement("button");b.textContent=text;
      b.onclick=function(){wrap.remove();sendMsg(text);};
      wrap.appendChild(b);
    });
    msgs.appendChild(wrap);msgs.scrollTop=msgs.scrollHeight;
  }

  async function loadBiz(){
    try{
      var r=await fetch(SERVER+"/api/business/"+businessId);
      var biz=await r.json();
      if(biz.name){d.getElementById("nx-hdr-name").textContent=biz.name;d.getElementById("nx-hdr-sub").textContent=biz.type||"Replies instantly";}
      addMsg("Hello! Welcome to "+(biz.name||"our business")+" \\u{1F60A} How can I help you today?","b");
      addQuickReplies(["Services & Prices","Book Appointment","Current Offers","Working Hours"]);
    }catch(e){addMsg("Hi! How can I help you today?","b");}
  }

  async function sendMsg(text){
    var t=text||inp.value.trim();if(!t)return;inp.value="";
    addMsg(t,"u");history.push({role:"user",text:t});showTyping();
    try{
      var r=await fetch(SERVER+"/api/chat/"+businessId,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:t,sessionId:sessionId,history:history})});
      var data=await r.json();hideTyping();
      addMsg(data.reply||"Sorry, please try again.","b");
      history.push({role:"assistant",text:data.reply});
    }catch(e){hideTyping();addMsg("Connection error. Please try again.","b");}
  }

  d.getElementById("nx-snd").onclick=function(){sendMsg();};
  inp.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();sendMsg();}});
})();`;
}

// ════════════════════════════════════════════════════════════════
// SERVE TEST PAGE
// ════════════════════════════════════════════════════════════════
app.get("/", (req, res) => {
  const serverUrl = req.protocol + "://" + req.get("host");
  const businesses = Object.values(getBusinesses());
  const bizListHtml = businesses.length > 0
    ? businesses.map(b => '<div style="background:#1A1E25;border:1px solid #252D3A;border-radius:10px;padding:16px;margin-bottom:8px"><div style="font-weight:700;font-size:15px">' + b.name + '</div><div style="font-size:12px;color:#6B7A90">' + b.type + ' &middot; ID: ' + b.id + '</div><div style="margin-top:8px"><code style="font-size:11px;color:#10B981;background:#0E1117;padding:6px 10px;border-radius:6px;display:block;word-break:break-all">&lt;script src=&quot;' + serverUrl + '/widget.js&quot; data-business=&quot;' + b.id + '&quot; async&gt;&lt;/script&gt;</code></div></div>').join("")
    : '<div style="color:#6B7A90;text-align:center;padding:30px">No businesses yet. Create one using the API.</div>';

  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NexusAI</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#060709;color:#E2E6ED;padding:40px;max-width:700px;margin:0 auto}
h1{font-size:28px;font-weight:800;margin-bottom:4px}p{color:#6B7A90;font-size:14px;margin-bottom:24px}
.card{background:#0E1117;border:1px solid #252D3A;border-radius:12px;padding:24px;margin-bottom:16px}
h2{font-size:16px;font-weight:700;margin-bottom:12px}
code{font-size:12px;color:#10B981;background:#161B24;padding:8px 12px;border-radius:6px;display:block;margin:8px 0;word-break:break-all}
.badge{display:inline-block;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:700;background:rgba(16,185,129,0.1);color:#10B981}
</style></head><body>
<div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
<div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#10B981,#059669);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff">N</div>
<div><h1>NexusAI</h1><p style="margin:0">AI Support Agent Platform</p></div>
<span class="badge" style="margin-left:auto">● Running</span>
</div>

<div class="card">
<h2>📡 Server Status</h2>
<div style="display:flex;gap:20px;flex-wrap:wrap">
<div><div style="font-size:20px;font-weight:700;color:#10B981">${businesses.length}</div><div style="font-size:11px;color:#6B7A90">Businesses</div></div>
<div><div style="font-size:20px;font-weight:700;color:#3B82F6">${GROQ_API_KEY ? "Connected" : "Not Set"}</div><div style="font-size:11px;color:#6B7A90">Groq AI</div></div>
<div><div style="font-size:20px;font-weight:700;color:#F59E0B">Llama 3.3</div><div style="font-size:11px;color:#6B7A90">AI Model</div></div>
</div>
</div>

<div class="card">
<h2>🏢 Your Businesses</h2>
${bizListHtml}
</div>

<div class="card">
<h2>🚀 Quick Start</h2>
<p style="font-size:13px;margin-bottom:12px">Create a business:</p>
<code>curl -X POST ${serverUrl}/api/business/create -H "Content-Type: application/json" -d '{"name":"My Business","type":"Salon"}'</code>
<p style="font-size:13px;margin-bottom:12px;margin-top:16px">Test the chat:</p>
<code>curl -X POST ${serverUrl}/api/chat/my-business -H "Content-Type: application/json" -d '{"message":"hello"}'</code>
</div>

${businesses.length > 0 ? '<script src="' + serverUrl + '/widget.js" data-business="' + businesses[0].id + '" async></script>' : ''}
</body></html>`);
});

// ════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║  🚀 NexusAI Backend Running              ║");
  console.log("  ║  Local:  http://localhost:" + PORT + "            ║");
  console.log("  ║  Widget: http://localhost:" + PORT + "/widget.js  ║");
  console.log("  ║  API:    http://localhost:" + PORT + "/api        ║");
  console.log("  ╚══════════════════════════════════════════╝");
  console.log("");
  if (!GROQ_API_KEY) console.log("  ⚠️  No GROQ_API_KEY set — using rule-based fallback only");
  else console.log("  ✅ Groq AI connected — Llama 3.3 70B ready");
  console.log("");
});
