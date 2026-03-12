const { Telegraf, Input } = require('telegraf');
const axios = require('axios');
const express = require('express');
const fs = require('fs');

// --- 1. Configuration ---
const BOT_TOKEN = '8507091469:AAFV-310hO3VNKXTQykRj0Uec_iVdEAsjH8'; 
const CHANNEL_ID = '-1003727896599'; 
const RENDER_EXTERNAL_URL = "https://package-js-js.onrender.com"; 
const HISTORY_FILE = './unlimited_history.json';

const bot = new Telegraf(BOT_TOKEN);
let localHistory = []; 
let isLoopRunning = false;
let lastKnownState = { issueNumber: "0", done: true, prediction: "", msgId: null };

// --- 2. Database Logic ---
function saveHistoryToFile() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(localHistory.slice(0, 1000000)));
    } catch (e) { console.log("Save Error"); }
}

function loadHistoryFromFile() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE);
            localHistory = JSON.parse(data);
            console.log("📂 Database Loaded:", localHistory.length);
        }
    } catch (e) { console.log("Load Error"); }
}

// --- 3. Command: /history (File Generate Karega) ---
bot.command('history', async (ctx) => {
    try {
        if (localHistory.length === 0) {
            return ctx.reply("❌ Abhi tak koi history collect nahi hui hai.");
        }

        let fileContent = "🆔 PERIOD | 🎯 RESULT | 🎲 NUMBER\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
        localHistory.forEach(h => {
            const resText = h.number >= 5 ? "BIG" : "SMALL";
            fileContent += `${h.issueNumber} | ${resText} | ${h.number}\n`;
        });

        const tempFileName = `History_Report.txt`;
        fs.writeFileSync(tempFileName, fileContent);

        await ctx.replyWithDocument(Input.fromLocalFile(tempFileName), {
            caption: `📊 Total Records: ${localHistory.length}\n🎯 Scan Power: Unlimited`
        });

        fs.unlinkSync(tempFileName); // File bhejne ke baad delete kar dega server se
    } catch (e) {
        ctx.reply("❌ File generate karne mein error aaya.");
        console.log(e.message);
    }
});

// --- 4. AI Engine ---
function getAIPrediction(currentSeq) {
    const winHistory = localHistory.map(h => parseInt(h.number));
    for (let len = 8; len >= 2; len--) {
        const pattern = currentSeq.slice(0, len);
        for (let i = 1; i <= winHistory.length - len - 1; i++) {
            const window = winHistory.slice(i, i + len);
            if (window.every((val, idx) => val === pattern[idx])) {
                const predNum = winHistory[i - 1];
                return { r: predNum >= 5 ? "BIG" : "SMALL", l: len, n: predNum };
            }
        }
    }
    const bigs = currentSeq.slice(0, 5).filter(n => n >= 5).length;
    return { r: bigs >= 3 ? "BIG" : "SMALL", l: "AUTO", n: "?" };
}

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
        if (!latest) { isLoopRunning = false; return; }
        const nextId = (BigInt(latest.issueNumber) + 1n).toString();

        if (lastKnownState.issueNumber === latest.issueNumber && !lastKnownState.done) {
            const actual = latest.number >= 5 ? "BIG" : "SMALL";
            const emoji = (lastKnownState.prediction === actual) ? "🏆 WIN" : "😭 LOSS";
            const resText = `📊 *AI RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${latest.issueNumber.slice(-4)}\`\n🎲 *PRED:* ${lastKnownState.prediction}\n🎯 *RESULT:* ${actual} (${latest.number})\n✨ *STATUS:* ${emoji}\n━━━━━━━━━━━━━━`;
            
            if (lastKnownState.msgId) await bot.telegram.deleteMessage(CHANNEL_ID, lastKnownState.msgId).catch(() => {});
            await bot.telegram.sendMessage(CHANNEL_ID, resText, { parse_mode: 'Markdown' });
            lastKnownState.done = true;
        }

        if (lastKnownState.issueNumber !== nextId && (lastKnownState.done || lastKnownState.issueNumber === latest.issueNumber)) {
            const currentSeq = localHistory.slice(0, 10).map(h => h.number);
            const ai = getAIPrediction(currentSeq);
            const predMsg = `🎯 *AI PATTERN PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${nextId.slice(-4)}\`\n🎲 *PREDICTION:* **${ai.r}**\n🌪️ *MATCH:* L-${ai.l}\n🎰 *NUMBER:* ${ai.n}\n⏳ *SCAN:* 1M RECORDS | 24/7\n━━━━━━━━━━━━━━`;
            const s = await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });
            lastKnownState = { issueNumber: nextId, prediction: ai.r, msgId: s.message_id, done: false };
        }
    } catch (err) { console.log("Bot Working..."); }
    isLoopRunning = false;
}

const app = express();
app.get('/', (req, res) => res.send('Unlimited Bot Active with History Command'));
app.listen(process.env.PORT || 3000);

setInterval(() => axios.get(RENDER_EXTERNAL_URL).catch(() => {}), 120000);
setInterval(loop, 15000); 

loadHistoryFromFile();
loop();
bot.launch({ dropPendingUpdates: true });
