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
        const q = query(collection(db, 'history_v3'), orderBy('issueNumber', 'desc'), limit(10000));
        const snap = await getDocs(q);
        
        let fileContent = "🆔 PERIOD | 🎯 RESULT | 🎲 NUMBER\n";
        fileContent += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
        
        snap.forEach(d => {
            const data = d.data();
            const res = data.number >= 5 ? "BIG" : "SMALL";
            fileContent += `${data.issueNumber} | ${res} | ${data.number}\n`;
        });

        const fileName = `history_report.txt`;
        fs.writeFileSync(fileName, fileContent);
        
        await ctx.replyWithDocument(Input.fromLocalFile(fileName, 'Full_100K_History_Report.txt'), {
            caption: "📊 *Full AI History Data Report (100K Capacity)*"
        });

        fs.unlinkSync(fileName);
    } catch (e) { 
        ctx.reply("❌ Error generating history file."); 
    }
});

// --- Database Cleanup (100,000 Limit) ---
async function cleanupDatabase() {
    try {
        const collRef = collection(db, 'history_v3');
        const snap = await getDocs(collRef);
        // Agar 100,000 se zyada ho jaye toh purana data delete karein
        if (snap.size > 100000) {
            console.log("Cleanup: Deleting extra history...");
            const q = query(collRef, orderBy('issueNumber', 'asc'), limit(20000));
            const oldDocs = await getDocs(q);
            const batch = writeBatch(db);
            oldDocs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
    } catch (e) { console.log("Cleanup Error:", e.message); }
}

async function fetchSafeData() {
    const url = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=20";
    try {
        const res = await axios.get(url, { timeout: 5000 });
        return res.data?.data?.list || res.data?.list || null;
    } catch (e) {
        try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const res = await axios.get(proxyUrl, { timeout: 8000 });
            return res.data?.data?.list || res.data?.list || null;
        } catch (err) { return null; }
    }
}

// --- AI Engine (50,000 History Scan) ---
function getAIPrediction(currentSeq, fullHistory) {
    const winHistory = fullHistory.map(h => parseInt(h.number));
    // Pura 50,000 history scan karne ke liye loop
    for (let len = 9; len >= 2; len--) {
        const pattern = currentSeq.slice(0, len);
        for (let i = 1; i <= winHistory.length - len - 1; i++) {
            const window = winHistory.slice(i, i + len);
            if (window.every((val, idx) => val === pattern[idx])) {
                const predNum = winHistory[i - 1];
                return { r: predNum >= 5 ? "BIG" : "SMALL", l: len, n: predNum };
            }
        }
    }
    const last5 = currentSeq.slice(0, 5);
    const bigs = last5.filter(n => n >= 5).length;
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

        // Fetching 50,000 records for analysis
        const q = query(collection(db, 'history_v3'), orderBy('issueNumber', 'desc'), limit(50000));
        const snap = await getDocs(q);
        
        let history = [];
        snap.forEach(d => history.push(d.data()));
        
        if (history.length === 0) { isLoopRunning = false; return; }

        const latest = history[0];
        const nextPeriodId = (BigInt(latest.issueNumber) + 1n).toString();
        const stateRef = doc(db, 'system', 'state_v3');
        const stateSnap = await getDoc(stateRef);
        let state = stateSnap.exists() ? stateSnap.data() : { issueNumber: "0", done: true };

        // 1. Result Update & Prediction Delete
        if (state.issueNumber === latest.issueNumber && !state.done) {
            const actual = latest.number >= 5 ? "BIG" : "SMALL";
            const isWin = state.prediction === actual;
            const emoji = isWin ? "🏆 WIN" : "😭 LOSS";
            const resText = `📊 *AI RESULT UPDATE*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${latest.issueNumber.slice(-4)}\`\n🎲 *PRED:* ${state.prediction}\n🎯 *RESULT:* ${actual} (${latest.number})\n✨ *STATUS:* ${emoji}\n━━━━━━━━━━━━━━`;
            
            try {
                if (state.msgId) {
                    await bot.telegram.deleteMessage(CHANNEL_ID, state.msgId).catch(() => {});
                }
                await bot.telegram.sendMessage(CHANNEL_ID, resText, { parse_mode: 'Markdown' });
            } catch (e) { console.log("Update Error"); }
            await setDoc(stateRef, { done: true }, { merge: true });
        }

        // 2. New Prediction
        if (state.issueNumber !== nextPeriodId && (state.done || state.issueNumber === latest.issueNumber)) {
            const currentSeq = history.slice(0, 10).map(h => h.number);
            const ai = getAIPrediction(currentSeq, history);
            const predMsg = `🎯 *AI PATTERN PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *PERIOD:* \`#${nextPeriodId.slice(-4)}\`\n🎲 *PREDICTION:* **${ai.r}**\n🌪️ *MATCH:* L-${ai.l}\n🎰 *NUMBER:* ${ai.n}\n⏳ *SCAN:* 50,000 Records\n━━━━━━━━━━━━━━`;
            
            try {
                const s = await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });
                await setDoc(stateRef, { 
                    issueNumber: nextPeriodId, 
                    prediction: ai.r, 
                    level: ai.l, 
                    msgId: s.message_id, 
                    done: false 
                });
            } catch (e) { console.log("Send Error"); }
        }
    } catch (err) { console.log("Loop Error:", err.message); }
    isLoopRunning = false;
}

const app = express();
app.get('/', (req, res) => res.send('Bot Active (100K Mode)'));
app.listen(process.env.PORT || 3000);

setInterval(() => { axios.get(RENDER_EXTERNAL_URL).catch(() => {}); }, 120000);
setInterval(loop, 12000);
setInterval(cleanupDatabase, 7200000); // Check cleanup every 2 hours
loop();

bot.launch({ dropPendingUpdates: true });
