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
};

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

let localHistory = []; 
let isLoopRunning = false;

// --- 1. Smart Sync (Saves Quota - Limit 5000 for stability) ---
async function syncLocalHistory() {
    try {
        console.log("🔄 Syncing from Firebase (Limit 5000)...");
        // Firebase limits single fetch to 10k, using 5k for safety
        const q = query(collection(db, 'history_v3'), orderBy('issueNumber', 'desc'), limit(5000));
        const snap = await getDocs(q);
        const temp = [];
        snap.forEach(d => temp.push(d.data()));
        if (temp.length > 0) localHistory = temp;
        console.log("✅ Sync Done. Memory Records:", localHistory.length);
    } catch (e) { 
        console.log("Sync Error (Most likely Quota):", e.message); 
    }
}

// --- 2. AI Engine (Pattern Matching) ---
function getAIPrediction(currentSeq) {
    const winHistory = localHistory.map(h => parseInt(h.number));
    for (let len = 7; len >= 2; len--) {
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

// --- 3. Main Logic Loop ---
async function loop() {
    if (isLoopRunning) return;
    isLoopRunning = true;
    try {
        const res = await axios.get("https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=15", { timeout: 8000 });
        const list = res.data?.data?.list || res.data?.list;
        if (!list) throw new Error("API Offline");

        for (let item of list) {
            const id = (item.issueNumber || item.period).toString();
            const num = parseInt(item.number || item.result);
            
            if (!localHistory.find(h => h.issueNumber === id)) {
                // Try writing but catch Quota errors silently
                try {
                    await setDoc(doc(db, 'history_v3', id), { issueNumber: id, number: num }, { merge: true });
                } catch (writeErr) {
                    console.log("Write Quota Full - Using RAM only");
                }
                localHistory.unshift({ issueNumber: id, number: num });
                if (localHistory.length > 100000) localHistory.pop();
            }
        }

        if (localHistory.length === 0) { isLoopRunning = false; return; }

        const latest = localHistory[0];
        const nextId = (BigInt(latest.issueNumber) + 1n).toString();
        
        // Cache state logic
        const stateRef = doc(db, 'system', 'state_v3');
        let state;
        try {
            const stateSnap = await getDoc(stateRef);
            state = stateSnap.exists() ? stateSnap.data() : { issueNumber: "0", done: true };
        } catch (e) {
            state = { issueNumber: "0", done: true }; // Fallback
        }

        // Result Logic
        if (state.issueNumber === latest.issueNumber && !state.done) {
            const actual = latest.number >= 5 ? "BIG" : "SMALL";
            const status = state.prediction === actual ? "🏆 WIN" : "😭 LOSS";
            const resText = `📊 *AI RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${latest.issueNumber.slice(-4)}\`\n🎲 *PRED:* ${state.prediction}\n🎯 *RESULT:* ${actual} (${latest.number})\n✨ *STATUS:* ${status}\n━━━━━━━━━━━━━━`;
            
            if (state.msgId) await bot.telegram.deleteMessage(CHANNEL_ID, state.msgId).catch(() => {});
            await bot.telegram.sendMessage(CHANNEL_ID, resText, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { done: true }, { merge: true }).catch(() => {});
        }

        // Prediction Logic
        if (state.issueNumber !== nextId && (state.done || state.issueNumber === latest.issueNumber)) {
            const currentSeq = localHistory.slice(0, 10).map(h => h.number);
            const ai = getAIPrediction(currentSeq);
            const predMsg = `🎯 *AI PATTERN PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${nextId.slice(-4)}\`\n🎲 *PREDICTION:* **${ai.r}**\n🌪️ *MATCH:* L-${ai.l}\n🎰 *NUMBER:* ${ai.n}\n⏳ *STATUS:* 24/7 ACTIVE\n━━━━━━━━━━━━━━`;
            
            const s = await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { 
                issueNumber: nextId, 
                prediction: ai.r, 
                msgId: s.message_id, 
                done: false 
            }).catch(() => {});
        }
    } catch (err) { console.log("Loop Error:", err.message); }
    isLoopRunning = false;
}

const app = express();
app.get('/', (req, res) => res.send('Bot is Live (Quota Optimized)'));
app.listen(process.env.PORT || 3000);

setInterval(() => axios.get(RENDER_EXTERNAL_URL).catch(() => {}), 120000);
setInterval(loop, 20000); 
setInterval(syncLocalHistory, 43200000); // 12 ghante mein ek baar sync

syncLocalHistory().then(() => {
    loop();
    bot.launch({ dropPendingUpdates: true });
});
