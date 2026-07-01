const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ====================== CẤU HÌNH ======================
const HOST = '0.0.0.0';
const PORT = process.env.PORT || 1003;
const POLL_INTERVAL = 5000;   // 5 giây
const RETRY_DELAY = 5000;     // 5 giây
const MAX_HISTORY = 50;
const HISTORY_FILE = path.join(__dirname, 'hit_history.json');

// ====================== BIẾN TOÀN CỤC ======================
let latestResult100 = { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Chưa có", id: "tuanx3000" };
let latestResult101 = { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Chưa có", id: "tuanx3000" };

let history100 = [];
let history101 = [];

let lastSid100 = null;
let lastSid101 = null;
let sidForTx = null;   // lưu sid từ cmd 1008 cho bàn thường

// Hàng đợi cập nhật để tránh xung đột
let updateQueue100 = [];
let updateQueue101 = [];
let isProcessing100 = false;
let isProcessing101 = false;

// ====================== HÀM PHỤ TRỢ ======================
function getTaiXiu(d1, d2, d3) {
    const total = d1 + d2 + d3;
    return total <= 10 ? "Xỉu" : "Tài";
}

function getVNTime() {
    const now = new Date();
    const offset = 7 * 60 * 60 * 1000;
    return new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + offset);
}

function formatTime(date) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

// Lưu lịch sử vào file
function saveHistory() {
    try {
        const data = {
            lastUpdated: new Date().toISOString(),
            history100: history100,
            history101: history101
        };
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`❌ Lỗi lưu lịch sử: ${err.message}`);
    }
}

// Đọc lịch sử từ file
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data.history100) history100 = data.history100;
            if (data.history101) history101 = data.history101;
            console.log(`📂 Đã load ${history100.length} phiên TX và ${history101.length} phiên MD5`);
        }
    } catch (err) {
        console.error(`❌ Lỗi đọc lịch sử: ${err.message}`);
    }
}

// Xử lý queue cập nhật (bàn thường)
function processQueue100() {
    if (isProcessing100 || updateQueue100.length === 0) return;
    isProcessing100 = true;
    const item = updateQueue100.shift();
    const { sid, d1, d2, d3 } = item;

    const total = d1 + d2 + d3;
    const ketQua = getTaiXiu(d1, d2, d3);
    const vnTime = getVNTime();
    const timeStr = formatTime(vnTime);

    const result = {
        Phien: sid,
        Xuc_xac_1: d1,
        Xuc_xac_2: d2,
        Xuc_xac_3: d3,
        Tong: total,
        Ket_qua: ketQua,
        id: "tuanx3000",
        thoi_gian: timeStr
    };

    // Cập nhật latest
    Object.assign(latestResult100, result);
    lastSid100 = sid;

    // Thêm vào lịch sử
    history100.unshift({ ...result });
    if (history100.length > MAX_HISTORY) history100.pop();

    saveHistory();

    console.log(`[TX] Phiên #${sid} - ${d1} ${d2} ${d3} = ${total} (${ketQua})`);

    isProcessing100 = false;
    // Gọi tiếp nếu còn trong queue
    processQueue100();
}

// Xử lý queue cập nhật (bàn MD5)
function processQueue101() {
    if (isProcessing101 || updateQueue101.length === 0) return;
    isProcessing101 = true;
    const item = updateQueue101.shift();
    const { sid, d1, d2, d3 } = item;

    const total = d1 + d2 + d3;
    const ketQua = getTaiXiu(d1, d2, d3);
    const vnTime = getVNTime();
    const timeStr = formatTime(vnTime);

    const result = {
        Phien: sid,
        Xuc_xac_1: d1,
        Xuc_xac_2: d2,
        Xuc_xac_3: d3,
        Tong: total,
        Ket_qua: ketQua,
        id: "tuanx3000",
        thoi_gian: timeStr
    };

    Object.assign(latestResult101, result);
    lastSid101 = sid;

    history101.unshift({ ...result });
    if (history101.length > MAX_HISTORY) history101.pop();

    saveHistory();

    console.log(`[MD5] Phiên #${sid} - ${d1} ${d2} ${d3} = ${total} (${ketQua})`);

    isProcessing101 = false;
    processQueue101();
}

// Thêm vào queue với kiểm tra trùng lặp
function enqueueUpdate(isMd5, sid, d1, d2, d3) {
    if (!sid || !d1 || !d2 || !d3) return;
    const queue = isMd5 ? updateQueue101 : updateQueue100;
    const lastSid = isMd5 ? lastSid101 : lastSid100;

    // Kiểm tra trùng lặp
    if (sid === lastSid) {
        console.log(`⚠️ Bỏ qua phiên ${sid} (đã có)`);
        return;
    }

    // Kiểm tra đã tồn tại trong queue chưa
    const exists = queue.some(item => item.sid === sid);
    if (exists) return;

    queue.push({ sid, d1, d2, d3 });
    if (isMd5) {
        processQueue101();
    } else {
        processQueue100();
    }
}

// ====================== POLL API ======================
async function pollApi(gid, isMd5) {
    const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=${gid}`;
    let retryCount = 0;

    while (true) {
        try {
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Python-Proxy/1.0' },
                timeout: 10000
            });

            const data = response.data;
            if (data.status === 'OK' && Array.isArray(data.data)) {
                // Xử lý từng sự kiện
                for (const game of data.data) {
                    const cmd = game.cmd;
                    const d1 = game.d1;
                    const d2 = game.d2;
                    const d3 = game.d3;
                    const sid = game.sid;

                    if (!isMd5) {
                        // Bàn thường: cập nhật sid từ cmd 1008
                        if (cmd === 1008 && sid) {
                            sidForTx = sid;
                            continue;
                        }
                        // Xử lý kết quả cmd 1003
                        if (cmd === 1003 && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
                            if (sidForTx) {
                                enqueueUpdate(false, sidForTx, d1, d2, d3);
                                sidForTx = null; // reset
                            } else {
                                console.log('⚠️ Chưa có sid cho cmd 1003, bỏ qua');
                            }
                        }
                    } else {
                        // Bàn MD5: xử lý cmd 2007 (hoặc 2006)
                        if ((cmd === 2007 || cmd === 2006) && sid && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
                            enqueueUpdate(true, sid, d1, d2, d3);
                        }
                    }
                }
                retryCount = 0; // reset sau thành công
            } else {
                console.log(`⚠️ API trả về status không OK cho ${gid}`);
            }
        } catch (error) {
            retryCount++;
            console.error(`❌ Lỗi poll ${gid} (lần ${retryCount}): ${error.message}`);
            if (error.response) {
                console.error(`   Status: ${error.response.status}`);
            }
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.min(retryCount, 5)));
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
}

// ====================== EXPRESS APP ======================
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---------- ROUTES ----------
app.get('/api/taixiu', (req, res) => {
    res.json(latestResult100);
});

app.get('/api/taixiumd5', (req, res) => {
    res.json(latestResult101);
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || MAX_HISTORY;
    res.json({
        taixiu: history100.slice(0, limit),
        taixiumd5: history101.slice(0, limit)
    });
});

app.get('/api/history/taixiu', (req, res) => {
    const limit = parseInt(req.query.limit) || MAX_HISTORY;
    res.json({
        total: history100.length,
        history: history100.slice(0, limit)
    });
});

app.get('/api/history/md5', (req, res) => {
    const limit = parseInt(req.query.limit) || MAX_HISTORY;
    res.json({
        total: history101.length,
        history: history101.slice(0, limit)
    });
});

app.get('/api/stats', (req, res) => {
    const tai100 = history100.filter(h => h.Ket_qua === 'Tài').length;
    const xiu100 = history100.length - tai100;
    const tai101 = history101.filter(h => h.Ket_qua === 'Tài').length;
    const xiu101 = history101.length - tai101;

    res.json({
        tx: {
            total: history100.length,
            tai: tai100,
            xiu: xiu100,
            tai_percent: history100.length ? ((tai100 / history100.length) * 100).toFixed(2) : 0,
            xiu_percent: history100.length ? ((xiu100 / history100.length) * 100).toFixed(2) : 0
        },
        md5: {
            total: history101.length,
            tai: tai101,
            xiu: xiu101,
            tai_percent: history101.length ? ((tai101 / history101.length) * 100).toFixed(2) : 0,
            xiu_percent: history101.length ? ((xiu101 / history101.length) * 100).toFixed(2) : 0
        },
        last_update: getVNTime().toISOString()
    });
});

app.get('/api/predict', (req, res) => {
    const allHistory = [...history100, ...history101];
    if (allHistory.length < 5) {
        return res.json({ prediction: "Chưa đủ dữ liệu", confidence: "Thấp", advice: "Chờ thêm" });
    }

    // Lấy 10 phiên gần nhất từ cả 2 bàn (ưu tiên bàn thường)
    const recent = history100.slice(0, 10).concat(history101.slice(0, 10));
    recent.sort((a, b) => new Date(b.thoi_gian) - new Date(a.thoi_gian));
    const last5 = recent.slice(0, 5);

    let tai = 0, xiu = 0;
    last5.forEach(item => {
        if (item.Ket_qua === 'Tài') tai++;
        else xiu++;
    });

    const last = last5[0]?.Ket_qua;
    const prev = last5[1]?.Ket_qua;

    let predict = "Tài";
    let confidence = "Trung bình";
    let advice = "Cân nhắc";

    if (last === prev && last) {
        predict = last;
        confidence = "Cao";
        advice = "Vào mạnh";
    } else {
        predict = last === "Tài" ? "Xỉu" : "Tài";
        confidence = "Trung bình";
        advice = "Đánh nhẹ";
    }

    if (tai >= 4) {
        predict = "Tài";
        confidence = "Cao";
        advice = "Vào mạnh";
    } else if (xiu >= 4) {
        predict = "Xỉu";
        confidence = "Cao";
        advice = "Vào mạnh";
    }

    res.json({
        prediction: predict,
        confidence: confidence,
        advice: advice,
        based_on: last5.length,
        tai_xu_huong: `${tai}/5`,
        xiu_xu_huong: `${xiu}/5`
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: "running",
        last_sid: { taixiu: lastSid100, md5: lastSid101 },
        current_result: { taixiu: latestResult100, md5: latestResult101 },
        history_count: { taixiu: history100.length, md5: history101.length },
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        name: "Hit Tài Xỉu API (nâng cấp)",
        version: "2.0.0",
        author: "tuanx3000",
        description: "Lấy dữ liệu từ Hit platform, hỗ trợ dự đoán và thống kê",
        endpoints: {
            "/api/taixiu": "Kết quả bàn thường",
            "/api/taixiumd5": "Kết quả bàn MD5",
            "/api/history?limit=N": "Lịch sử cả 2 bàn (tối đa 50)",
            "/api/history/taixiu": "Lịch sử bàn thường",
            "/api/history/md5": "Lịch sử bàn MD5",
            "/api/stats": "Thống kê Tài/Xỉu",
            "/api/predict": "Dự đoán dựa trên cầu",
            "/api/status": "Trạng thái hệ thống"
        },
        polling_interval: `${POLL_INTERVAL/1000}s`,
        max_history: MAX_HISTORY
    });
});

// ====================== KHỞI ĐỘNG ======================
async function main() {
    console.clear();
    console.log("=".repeat(60));
    console.log("🚀 HIT TÀI XỈU API – NÂNG CẤP V2.0");
    console.log("=".repeat(60));

    loadHistory();

    console.log("📡 Bắt đầu polling dữ liệu...");
    console.log(`   - Bàn thường (vgmn_100): ${POLL_INTERVAL/1000}s`);
    console.log(`   - Bàn MD5 (vgmn_101): ${POLL_INTERVAL/1000}s`);

    // Chạy hai luồng poll
    pollApi("vgmn_100", false);
    pollApi("vgmn_101", true);

    app.listen(PORT, HOST, () => {
        console.log("\n" + "=".repeat(60));
        console.log("🌐 HTTP SERVER ĐANG CHẠY");
        console.log("=".repeat(60));
        console.log(`   📍 http://${HOST}:${PORT}/api/taixiu`);
        console.log(`   📍 http://${HOST}:${PORT}/api/taixiumd5`);
        console.log(`   📍 http://${HOST}:${PORT}/api/history`);
        console.log(`   📍 http://${HOST}:${PORT}/api/stats`);
        console.log(`   📍 http://${HOST}:${PORT}/api/predict`);
        console.log(`   📍 http://${HOST}:${PORT}/api/status`);
        console.log("=".repeat(60));
        console.log(`📁 Lịch sử lưu tại: ${HISTORY_FILE}`);
        console.log("=".repeat(60));
    });
}

// Xử lý tắt mượt
process.on('SIGINT', () => {
    console.log("\n🛑 Đang dừng chương trình...");
    saveHistory();
    setTimeout(() => process.exit(0), 1000);
});

main();