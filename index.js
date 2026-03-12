const { Telegraf, Input } = require('telegraf');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const { initializeApp, getApps, getApp } = require('firebase/app');
const {
    getFirestore, doc, setDoc, getDocs,
    collection, getDoc, query, orderBy, limit, writeBatch
} = require('firebase/firestore');

// --- Configuration ---
const BOT_TOKEN = '8507091469:AAFV-310hO3VNKXTQykRj0Uec_iVdEAsjH8'; 
const CHANNEL_ID = '-1003727896599'; 
const RENDER_EXTERNAL_URL = "https://package-js-js.onrender.com"; 

const firebaseConfig = {
  apiKey: "AIzaSyCCc6mi1O7AkbAbWImuu59hFRDJmWbNQW0",
  authDomain: "igxigdigd.firebaseapp.com",
  projectId: "igxigdigd",
  storageBucket: "igxigdigd.firebasestorage.app",
  messagingSenderId: "501044877640",
  appId: "1:501044877640:web:2a7e85adc0c1fa27c1fb7d",
  measurementId: "G-3MGL01SRGY"
};

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

let localHistory = []; // Isme data rahega taaki Firebase Quota na khatam ho
let isLoopRunning = false;

// --- 1. Smart Sync (Saves Firebase Free Limit) ---
async function syncLocalHistory() {
    try {
        console.log("🔄 Syncing Data from Firebase...");
        const q = query(collection(db, 'history_v3'), orderBy('issueNumber', 'desc'), limit(20000));
        const snap = await getDocs(q);
        const temp = [];
        snap.forEach(d => temp.push(d.data()));
        if (temp.length > 0) localHistory = temp;
        console.log("✅ Caching Done. Records in Memory:", localHistory.length);
    } catch (e) { console.log("Sync Error:", e.message); }
}

// --- 2. AI Prediction Logic (RAM based) ---
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

// --- 3. Command: History File ---
bot.command('history', async (ctx) => {
    try {
        let fileContent = "🆔 PERIOD | 🎯 RESULT\n━━━━━━━━━━━━━━━━━━━━\n";
        localHistory.slice(0, 5000).forEach(h => {
            fileContent += `${h.issueNumber} | ${h.number >= 5 ? "BIG" : "SMALL"} (${h.number})\n`;
        });
        fs.writeFileSync('history.txt', fileContent);
        await ctx.replyWithDocument(Input.fromLocalFile('history.txt', 'Deep_History.txt'));
        fs.unlinkSync('history.txt');
    } catch (e) { ctx.reply("❌ Error."); }
});

// --- 4. Main Loop ---
async function loop() {
    if (isLoopRunning) return;
    isLoopRunning = true;
    try {
        const res = await axios.get("https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=20", { timeout: 8000 });
        const list = res.data?.data?.list || res.data?.list;
        if (!list) throw new Error("API Failure");

        let newData = false;
        for (let item of list) {
            const id = (item.issueNumber || item.period).toString();
            const num = parseInt(item.number || item.result);
            // Check if already in memory to save Firebase WRITES
            if (!localHistory.find(h => h.issueNumber === id)) {
                await setDoc(doc(db, 'history_v3', id), { issueNumber: id, number: num }, { merge: true });
                localHistory.unshift({ issueNumber: id, number: num });
                if (localHistory.length > 100000) localHistory.pop();
                newData = true;
            }
        }

        if (localHistory.length === 0) { isLoopRunning = false; return; }

        const latest = localHistory[0];
        const nextPeriodId = (BigInt(latest.issueNumber) + 1n).toString();
        const stateRef = doc(db, 'system', 'state_v3');
        const stateSnap = await getDoc(stateRef);
        let state = stateSnap.exists() ? stateSnap.data() : { issueNumber: "0", done: true };

        // 1. Result Update
        if (state.issueNumber === latest.issueNumber && !state.done) {
            const actual = latest.number >= 5 ? "BIG" : "SMALL";
            const isWin = state.prediction === actual;
            const resText = `📊 *AI RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${latest.issueNumber.slice(-4)}\`\n🎲 *PRED:* ${state.prediction}\n🎯 *RESULT:* ${actual} (${latest.number})\n✨ *STATUS:* ${isWin ? "🏆 WIN" : "😭 LOSS"}\n━━━━━━━━━━━━━━`;
            
            if (state.msgId) await bot.telegram.deleteMessage(CHANNEL_ID, state.msgId).catch(() => {});
            await bot.telegram.sendMessage(CHANNEL_ID, resText, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { done: true }, { merge: true });
        }

        // 2. New Prediction
        if (state.issueNumber !== nextPeriodId && (state.done || state.issueNumber === latest.issueNumber)) {
            const currentSeq = localHistory.slice(0, 10).map(h => h.number);
            const ai = getAIPrediction(currentSeq);
            const predMsg = `🎯 *AI PATTERN PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${nextPeriodId.slice(-4)}\`\n🎲 *PREDICTION:* **${ai.r}**\n🌪️ *MATCH:* L-${ai.l}\n🎰 *NUMBER:* ${ai.n}\n⏳ *STATUS:* 24/7 ACTIVE (100K DB)\n━━━━━━━━━━━━━━`;
            
            const s = await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { 
                issueNumber: nextPeriodId, 
                prediction: ai.r, 
                msgId: s.message_id, 
                done: false 
            });
        }
    } catch (err) { console.log("Loop Error:", err.message); }
    isLoopRunning = false;
}

const app = express();
app.get('/', (req, res) => res.send('Bot Status: 24/7 Stable'));
app.listen(process.env.PORT || 3000);

// Keep Render Alive
setInterval(() => axios.get(RENDER_EXTERNAL_URL).catch(() => {}), 120000);
// Fast Loop (Checking every 15s)
setInterval(loop, 15000);
// Full DB Sync every 4 hours just in case
setInterval(syncLocalHistory, 14400000);

syncLocalHistory().then(() => {
    loop();
    bot.launch({ dropPendingUpdates: true });
});
