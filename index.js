const { Telegraf, Input } = require('telegraf');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const { initializeApp, getApps, getApp } = require('firebase/app');
const {
    getFirestore, doc, setDoc, getDocs,
    collection, getDoc, query, orderBy, limit, writeBatch, deleteDoc
} = require('firebase/firestore');

// --- Configuration ---
const BOT_TOKEN = '8507091469:AAFV-310hO3VNKXTQykRj0Uec_iVdEAsjH8'; 
const CHANNEL_ID = '-1003727896599'; 
const RENDER_EXTERNAL_URL = "https://package-js-js.onrender.com"; 

const firebaseConfig = {
  apiKey: "AIzaSyAB7arXNA-1IRfKswmuAa6Dglwt11iRny0",
  authDomain: "ogcyoc-fbe74.firebaseapp.com",
  projectId: "ogcyoc-fbe74",
  storageBucket: "ogcyoc-fbe74.firebasestorage.app",
  messagingSenderId: "159386806122",
  appId: "1:159386806122:web:93c080fee0923b592e2713",
  measurementId: "G-93Q5MYLDVS"
};

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

let localHistory = []; 
let isLoopRunning = false;
let lastKnownState = { issueNumber: "0", done: true, prediction: "", msgId: null };

// --- 1. Smart Sync & Auto-Delete (30,000 Limit) ---
async function syncAndCleanup() {
    try {
        console.log("🔄 Initializing: 20K Scan Mode...");
        const q = query(collection(db, 'history_v3'), orderBy('issueNumber', 'desc'), limit(30005));
        const snap = await getDocs(q);
        
        let temp = [];
        snap.forEach(d => temp.push(d.data()));
        
        // Auto-Delete logic: Agar 30,000 se zyada hain
        if (temp.length > 30000) {
            console.log("🧹 Cleanup: 30K limit exceeded, deleting old records...");
            const toDelete = temp.slice(30000);
            const batch = writeBatch(db);
            toDelete.forEach(item => {
                const docRef = doc(db, 'history_v3', item.issueNumber);
                batch.delete(docRef);
            });
            await batch.commit();
            temp = temp.slice(0, 30000);
        }
        
        localHistory = temp;
        console.log("✅ Ready. Current Records in DB:", localHistory.length);
    } catch (e) { console.log("Sync/Cleanup Error:", e.message); }
}

// --- 2. AI Engine (20,000 Records Scan) ---
function getAIPrediction(currentSeq) {
    // RAM se 20,000 records scan karega
    const winHistory = localHistory.slice(0, 20000).map(h => parseInt(h.number));
    
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

// --- 3. Main Loop ---
async function loop() {
    if (isLoopRunning) return;
    isLoopRunning = true;
    try {
        const res = await axios.get("https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=10", { timeout: 8000 });
        const list = res.data?.data?.list || res.data?.list;
        if (!list) throw new Error("API Connection Error");

        for (let item of list) {
            const id = (item.issueNumber || item.period).toString();
            const num = parseInt(item.number || item.result);
            
            if (!localHistory.find(h => h.issueNumber === id)) {
                await setDoc(doc(db, 'history_v3', id), { issueNumber: id, number: num }, { merge: true }).catch(() => {});
                localHistory.unshift({ issueNumber: id, number: num });
                // Memory check
                if (localHistory.length > 30000) localHistory.pop();
            }
        }

        const latest = localHistory[0];
        const nextId = (BigInt(latest.issueNumber) + 1n).toString();

        // Result Logic
        if (lastKnownState.issueNumber === latest.issueNumber && !lastKnownState.done) {
            const actual = latest.number >= 5 ? "BIG" : "SMALL";
            const emoji = (lastKnownState.prediction === actual) ? "🏆 WIN" : "😭 LOSS";
            const resText = `📊 *AI RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${latest.issueNumber.slice(-4)}\`\n🎲 *PRED:* ${lastKnownState.prediction}\n🎯 *RESULT:* ${actual} (${latest.number})\n✨ *STATUS:* ${emoji}\n━━━━━━━━━━━━━━`;
            
            if (lastKnownState.msgId) await bot.telegram.deleteMessage(CHANNEL_ID, lastKnownState.msgId).catch(() => {});
            await bot.telegram.sendMessage(CHANNEL_ID, resText, { parse_mode: 'Markdown' });
            lastKnownState.done = true;
        }

        // New Prediction Logic
        if (lastKnownState.issueNumber !== nextId && (lastKnownState.done || lastKnownState.issueNumber === latest.issueNumber)) {
            const currentSeq = localHistory.slice(0, 10).map(h => h.number);
            const ai = getAIPrediction(currentSeq);
            const predMsg = `🎯 *AI PATTERN PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${nextId.slice(-4)}\`\n🎲 *PREDICTION:* **${ai.r}**\n🌪️ *MATCH:* L-${ai.l}\n🎰 *NUMBER:* ${ai.n}\n⏳ *SCAN:* 20K | *DB:* 30K\n━━━━━━━━━━━━━━`;
            
            const s = await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });
            lastKnownState = { issueNumber: nextId, prediction: ai.r, msgId: s.message_id, done: false };
        }
    } catch (err) { console.log("System Running..."); }
    isLoopRunning = false;
}

const app = express();
app.get('/', (req, res) => res.send('20K Scan Bot Active'));
app.listen(process.env.PORT || 3000);

setInterval(() => axios.get(RENDER_EXTERNAL_URL).catch(() => {}), 120000);
setInterval(loop, 15000); 
setInterval(syncAndCleanup, 3600000); // Har ghante cleanup check karega

syncAndCleanup().then(() => {
    loop();
    bot.launch({ dropPendingUpdates: true });
});
