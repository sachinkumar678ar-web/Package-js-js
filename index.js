const { Telegraf, Input } = require('telegraf');
const axios = require('axios');
const express = require('express');
const fs = require('fs');

// --- 1. Configuration ---
const BOT_TOKEN = '8669167730:AAEbqxdNZW7F8JVLriXa7ZdaiojkZ0-PXtI';
const RENDER_EXTERNAL_URL = "https://package-js-js.onrender.com"; 
const HISTORY_FILE = '/data/unlimited_history.json'; // Render Disk Path

const CHANNELS = [
    '-1003874474562', 
    '-1003717891014'  // Naye channel ki ID
];

const bot = new Telegraf(BOT_TOKEN);
let localHistory = []; 
let isLoopRunning = false;
let channelStates = {};

CHANNELS.forEach(id => {
    channelStates[id] = { issueNumber: "0", done: true, prediction: "", msgId: null, wins: 0, losses: 0 };
});

// --- 2. Database Logic ---
function saveHistoryToFile() {
    try {
        if (!fs.existsSync('/data')) fs.mkdirSync('/data');
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(localHistory.slice(0, 1000000)));
    } catch (e) { console.log("Save Error:", e.message); }
}

function loadHistoryFromFile() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE);
            localHistory = JSON.parse(data);
            console.log("📂 Database Loaded. Records:", localHistory.length);
        }
    } catch (e) { console.log("No existing history found. Starting fresh."); }
}

// --- 3. AI Engine (L10 to L1 Deep Scan) ---
function getAIPrediction(currentSeq) {
    const winHistory = localHistory.slice(0, 100000).map(h => parseInt(h.number));
    for (let len = 10; len >= 1; len--) {
        const pattern = currentSeq.slice(0, len);
        for (let i = 1; i <= winHistory.length - len - 1; i++) {
            const window = winHistory.slice(i, i + len);
            if (window.every((val, idx) => val === pattern[idx])) {
                const predNum = winHistory[i - 1];
                return { r: predNum >= 5 ? "BIG" : "SMALL", l: len, n: predNum };
            }
        }
    }
    return { r: currentSeq[0] >= 5 ? "SMALL" : "BIG", l: "TREND", n: "?" };
}

// --- 4. Admin Commands ---
bot.command('status', (ctx) => {
    let report = `🤖 *BOT ADMIN DASHBOARD*\n━━━━━━━━━━━━━━\n`;
    report += `📈 *Total History:* ${localHistory.length}\n`;
    report += `⚡ *Scanning Power:* L10 to L1\n`;
    report += `🔌 *Server:* Online (Render)\n\n`;
    CHANNELS.forEach((id, index) => {
        report += `📺 *Channel ${index + 1}:* \`${id}\`\n`;
    });
    ctx.replyWithMarkdown(report);
});

bot.command('history', async (ctx) => {
    try {
        let fileContent = "🆔 PERIOD | 🎯 RESULT | 🎲 NUM\n";
        localHistory.slice(0, 20000).forEach(h => {
            fileContent += `${h.issueNumber} | ${h.number >= 5 ? "BIG" : "SMALL"} | ${h.number}\n`;
        });
        fs.writeFileSync('Full_History.txt', fileContent);
        await ctx.replyWithDocument(Input.fromLocalFile('Full_History.txt'));
        fs.unlinkSync('Full_History.txt');
    } catch (e) { ctx.reply("Error generating file."); }
});

// --- 5. Main Loop ---
async function loop() {
    if (isLoopRunning) return;
    isLoopRunning = true;
    try {
        const res = await axios.get("https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=20", { timeout: 8000 });
        const list = res.data?.data?.list || res.data?.list;
        if (!list) throw new Error("API Offline");

        let isNew = false;
        for (let item of list) {
            const id = (item.issueNumber || item.period).toString();
            const num = parseInt(item.number || item.result);
            if (!localHistory.find(h => h.issueNumber === id)) {
                localHistory.unshift({ issueNumber: id, number: num });
                isNew = true;
                if (localHistory.length > 1000000) localHistory.pop();
            }
        }
        if (isNew) saveHistoryToFile();

        const latest = localHistory[0];
        const nextId = (BigInt(latest.issueNumber) + 1n).toString();

        for (const chanId of CHANNELS) {
            let state = channelStates[chanId];

            if (state.issueNumber === latest.issueNumber && !state.done) {
                const actual = latest.number >= 5 ? "BIG" : "SMALL";
                const isWin = state.prediction === actual;
                if (isWin) state.wins++; else state.losses++;
                
                const resText = `📊 *AI RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${latest.issueNumber.slice(-4)}\`\n🎲 *PRED:* ${state.prediction}\n🎯 *RESULT:* ${actual} (${latest.number})\n✨ *STATUS:* ${isWin ? "🏆 WIN" : "😭 LOSS"}\n━━━━━━━━━━━━━━`;
                
                if (state.msgId) await bot.telegram.deleteMessage(chanId, state.msgId).catch(() => {});
                await bot.telegram.sendMessage(chanId, resText, { parse_mode: 'Markdown' });
                state.done = true;
            }

            if (state.issueNumber !== nextId) {
                const ai = getAIPrediction(localHistory.slice(0, 10).map(h => h.number));
                const predMsg = `🎯 *AI PATTERN PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${nextId.slice(-4)}\`\n🎲 *PREDICTION:* **${ai.r}**\n🌪️ *MATCH:* L-${ai.l}\n🎰 *NUMBER:* ${ai.n}\n⏳ *SCAN:* 100K | 24/7\n━━━━━━━━━━━━━━`;
                
                const s = await bot.telegram.sendMessage(chanId, predMsg, { parse_mode: 'Markdown' });
                state.issueNumber = nextId;
                state.prediction = ai.r;
                state.msgId = s.message_id;
                state.done = false;
            }
        }
    } catch (err) { console.log("Bot Loop Status: Active"); }
    isLoopRunning = false;
}

const app = express();
app.get('/', (req, res) => res.send('Dual Channel Unlimited Bot is Live'));
app.listen(process.env.PORT || 3000);

setInterval(() => axios.get(RENDER_EXTERNAL_URL).catch(() => {}), 120000);
setInterval(loop, 15000); 

loadHistoryFromFile();
loop();
bot.launch({ dropPendingUpdates: true });
