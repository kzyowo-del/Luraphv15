const WebSocket = require("ws");


const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port });

console.log("Hub Chat Server running on port " + port);

// =============================
// ROLE CONFIG
// =============================
const ADMINS = {
    owners: ["JJS_TestScript"],
    staffs: ["lam648291", "gshahwgsydhs"],
};

function getRole(username) {
    if (ADMINS.owners.includes(username)) return "owner";
    if (ADMINS.staffs.includes(username)) return "staff";
    return null;
}

// =============================
// BAD WORDS FILTER
// =============================
const BAD_WORDS = [
    // English
    "nigger", "nigga", "niga", "n1gger", "n1gga", "negro",
    "fuck", "fck", "fuuck", "fvck", "f*ck", "f.u.c.k", "mfer", "motherfucker", "stfu",
    "shit", "sh1t", "sht", "sh!t", "bullshit",
    "bitch", "b1tch", "bytch", "biatch", "sonofabitch",
    "dick", "d1ck", "dik", "penis", "cock", "c0ck", "pecker",
    "pussy", "cunt",
    "bastard", "ass", "a55", "asshole", "jackass", "prick",
	"pornhub", "porn", "p o r n", "porn hub",

	// Vietnam
    "dịt", "dit", "đit", "đm", "dm", "đcm", "dcm", "đmm", "dmm", "đjt", "djt",
    "lồn", "l0n", "lon", "l l", "lờ", "cl", "cờ lờ", "vcl", "vclz", "vkl", "vcl",
    "cặc", "cac", "c4c", "kẹc", "kec", "con cặc", "con cac",
    "buồi", "buoi", "bùi", "bui", "cu", "c u",
    "đụ", "du", "đm", "đéo", "deo", "đết", "det",
    "mẹ mày", "me may", "mẹ m", "me m", "mmsv", "mẹ mài",
    "bố mày", "bo may", "cha mày", "cha may", "tổ sư", "ông nội mày",
    "con mẹ", "con me", "thằng chó", "do cho", "đồ chó", "cho de", "chó đẻ",
    "óc chó", "oc cho", "óc vật", "súc vật", "suc vat", "ngu lìn", "ngu lon",
    "hãm", "ham", "hãm lồn", "ham lon",
    "đĩ", "biến thái", "bien thai",
    "vú", "vu", "đít", "dit", "mông", "mong", "phịch", "phich", "xoạc", "nện",
	"nứng",
];

function filterBadWords(text) {
    let result = text;
    for (const word of BAD_WORDS) {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`\\b${escaped}\\b`, "gi");
        result = result.replace(regex, "*".repeat(word.length));
    }
    return result;
}

// =============================
// STATE
// =============================
// rooms[roomId]  = [ws, ...]
let rooms   = {};
// =============================
// BROADCAST ONLINE COUNT
// =============================
function broadcastOnline(room) {
    if (!rooms[room]) return;
    const active = rooms[room].filter(c => c.readyState === WebSocket.OPEN);
    const count  = active.length;
    const payload = JSON.stringify({ type: "online_count", count });
    active.forEach(c => c.send(payload));
    console.log(`[Room ${room}] Online: ${count}`);
}

// =============================
// CONNECTION
// =============================
wss.on("connection", function(ws) {
    let currentRoom = null;
    let currentUser = null;

    ws.on("message", function(data) {
        try {
            const msg = JSON.parse(data);

            // ---- JOIN ----
            if (msg.type === "join") {
                currentRoom = msg.room;
                currentUser = msg.user || "Unknown";

                if (!rooms[currentRoom])   rooms[currentRoom]   = [];

                rooms[currentRoom].push(ws);

                broadcastOnline(currentRoom);
            }

            // ---- CHAT ----
            if (msg.type === "chat" && currentRoom) {
                const role    = getRole(msg.user);   // "owner" | "staff" | null
                const filtered = filterBadWords(msg.text || "");

                const payload = JSON.stringify({
                    type: "chat",
                    user: msg.user,      // tên sạch — client tự render tag
                    role: role,          // client dùng để hiện [OWNER]/[STAFF] + màu
                    text: filtered,
                });

                rooms[currentRoom].forEach(c => {
                    if (c.readyState === WebSocket.OPEN) c.send(payload);
                });
            }

        } catch (err) {
            console.log("Invalid message:", err.message);
        }
    });

    ws.on("close", function() {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom] = rooms[currentRoom].filter(c => c !== ws);

            broadcastOnline(currentRoom);

            if (rooms[currentRoom].length === 0) {
                delete rooms[currentRoom];
            }
        }
    });
});
