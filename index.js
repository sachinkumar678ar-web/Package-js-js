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
const BOT_TOKEN = '8507091469:AAE190OpOdyADkTnC0YDdJJC9tiiaWVpdSM'; 
const CHANNEL_ID = '-1003356008714'; 
const RENDER_EXTERNAL_URL = "https://package-js-js.onrender.com"; 

const firebaseConfig = {
  apiKey: "AIzaSyCqfoSHganwfBrcmB_9fHGh6HoQ1QOBZ24",
  authDomain: "tiidtufz.firebaseapp.com",
  projectId: "tiidtufz",
  storageBucket: "tiidtufz.firebasestorage.app",
  messagingSenderId: "992719176298",
  appId: "1:992719176298:web:83648a7b4b2a31ff804013",
  measurementId: "G-JD7VVP8G0W"
};

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

let isLoopRunning = false;

// --- Command: Send History as File ---
bot.command('history', async (ctx) => {
    try {
        const q = query(collection(db, 'history_v3'), orderBy('issueNumber', 'desc'), limit(5000));
        const snap = await getDocs(q);
        let fileContent = "🆔 PERIOD | 🎯 RESULT\n━━━━━━━━━━━━━━━━━━━━\n";
        snap.forEach(d => {
            const data = d.data();
            fileContent += `${data.issueNumber} | ${data.number >= 5 ? "BIG" : "SMALL"} (${data.number})\n`;
        });
        const fileName = `hist.txt`;
        fs.writeFileSync(fileName, fileContent);
        await ctx.replyWithDocument(Input.fromLocalFile(fileName, 'History_Report.txt'));
        fs.unlinkSync(fileName);
    } catch (e) { ctx.reply("❌ Error generating history."); }
});

// --- Database Cleanup (100,000 Limit) ---
async function cleanupDatabase() {
    try {
        const collRef = collection(db, 'history_v3');
        const qSize = query(collRef, limit(100001));
        const snap = await getDocs(qSize);
        if (snap.size > 100000) {
            const q = query(collRef, orderBy('issueNumber', 'asc'), limit(20000));
            const oldDocs = await getDocs(q);
            const batch = writeBatch(db);
            oldDocs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            console.log("🧹 Cleanup Successful");
        }
    } catch (e) { console.log("Cleanup Error:", e.message); }
}

async function fetchSafeData() {
    const url = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=20";
    try {
        const res = await axios.get(url, { timeout: 6000 });
        return res.data?.data?.list || res.data?.list || null;
    } catch (e) { return null; }
}

function getAIPrediction(currentSeq, fullHistory) {
    const winHistory = fullHistory.map(h => parseInt(h.number));
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

async function loop() {
    if (isLoopRunning) return;
    isLoopRunning = true;
    try {
        const list = await fetchSafeData();
        if (!list) { isLoopRunning = false; return; }

        for (let item of list) {
            const id = (item.issueNumber || item.period).toString();
            const num = parseInt(item.number || item.result);
            if (id && !isNaN(num)) {
                await setDoc(doc(db, 'history_v3', id), { issueNumber: id, number: num }, { merge: true });
            }
        }

        // --- OPTIMIZED SCAN: Fetching 10,000 for stability ---
        const q = query(collection(db, 'history_v3'), orderBy('issueNumber', 'desc'), limit(10000));
        const snap = await getDocs(q);
        let history = [];
        snap.forEach(d => history.push(d.data()));
        
        if (history.length === 0) { isLoopRunning = false; return; }

        const latest = history[0];
        const nextPeriodId = (BigInt(latest.issueNumber) + 1n).toString();
        const stateRef = doc(db, 'system', 'state_v3');
        const stateSnap = await getDoc(stateRef);
        let state = stateSnap.exists() ? stateSnap.data() : { issueNumber: "0", done: true };

        // 1. Result Update
        if (state.issueNumber === latest.issueNumber && !state.done) {
            const actual = latest.number >= 5 ? "BIG" : "SMALL";
            const resText = `📊 *AI RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${latest.issueNumber.slice(-4)}\`\n🎲 *PRED:* ${state.prediction}\n🎯 *RESULT:* ${actual} (${latest.number})\n✨ *STATUS:* ${state.prediction === actual ? "🏆 WIN" : "😭 LOSS"}\n━━━━━━━━━━━━━━`;
            if (state.msgId) await bot.telegram.deleteMessage(CHANNEL_ID, state.msgId).catch(() => {});
            await bot.telegram.sendMessage(CHANNEL_ID, resText, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { done: true }, { merge: true });
        }

        // 2. New Prediction
        if (state.issueNumber !== nextPeriodId && (state.done || state.issueNumber === latest.issueNumber)) {
            const currentSeq = history.slice(0, 10).map(h => h.number);
            const ai = getAIPrediction(currentSeq, history);
            const predMsg = `🎯 *AI PATTERN PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${nextPeriodId.slice(-4)}\`\n🎲 *PREDICTION:* **${ai.r}**\n🌪️ *MATCH:* L-${ai.l}\n🎰 *NUMBER:* ${ai.n}\n⏳ *DB:* 100K | *SCAN:* 10K\n━━━━━━━━━━━━━━`;
            const s = await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });
            await setDoc(stateRef, { issueNumber: nextPeriodId, prediction: ai.r, level: ai.l, msgId: s.message_id, done: false });
        }
    } catch (err) { console.log("Error:", err.message); }
    isLoopRunning = false;
}

const app = express();
app.get('/', (req, res) => res.send('Bot Active'));
app.listen(process.env.PORT || 3000);
setInterval(() => axios.get(RENDER_EXTERNAL_URL).catch(() => {}), 120000);
setInterval(loop, 15000); // Increased interval for stability
setInterval(cleanupDatabase, 3600000);
loop();
bot.launch({ dropPendingUpdates: true });
