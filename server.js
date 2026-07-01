const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ======================
// Cấu hình
// ======================
const HOST = '0.0.0.0';
const POLL_INTERVAL = 5000; // 5 giây
const RETRY_DELAY = 5000;   // 5 giây
const MAX_HISTORY = 50;

// File lưu lịch sử
const HISTORY_FILE = path.join(__dirname, 'hit_history.json');

// ======================
// Biến toàn cục
// ======================
let latestResult100 = {
    Phien: 0,
    Xuc_xac_1: 0,
    Xuc_xac_2: 0,
    Xuc_xac_3: 0,
    Tong: 0,
    Ket_qua: "Chưa có",
    id: "djtuancon"
};

let latestResult101 = {
    Phien: 0,
    Xuc_xac_1: 0,
    Xuc_xac_2: 0,
    Xuc_xac_3: 0,
    Tong: 0,
    Ket_qua: "Chưa có",
    id: "djtuancon"
};

let history100 = [];
let history101 = [];

let lastSid100 = null;
let lastSid101 = null;
let sidForTx = null;

// Lock cho đồng bộ (dùng mutex)
let isUpdating100 = false;
let isUpdating101 = false;

// ======================
// Hàm phụ trợ
// ======================
function getTaiXiu(d1, d2, d3) {
    const total = d1 + d2 + d3;
    return total <= 10 ? "Xỉu" : "Tài";
}

function saveHistoryToFile() {
    try {
        const data = {
            lastUpdated: new Date().toISOString(),
            history100: history100,
            history101: history101
        };
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`❌ Lỗi lưu lịch sử: ${error.message}`);
    }
}

function loadHistoryFromFile() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            if (data.history100 && Array.isArray(data.history100)) {
                history100 = data.history100;
                console.log(`📂 Đã load ${history100.length} phiên lịch sử TX`);
            }
            if (data.history101 && Array.isArray(data.history101)) {
                history101 = data.history101;
                console.log(`📂 Đã load ${history101.length} phiên lịch sử MD5`);
            }
        }
    } catch (error) {
        console.error(`❌ Lỗi đọc lịch sử: ${error.message}`);
    }
}

function updateResult(store, history, result, isMd5) {
    const updating = isMd5 ? isUpdating101 : isUpdating100;
    const setUpdating = isMd5 ? (val) => { isUpdating101 = val; } : (val) => { isUpdating100 = val; };
    
    // Chờ nếu đang cập nhật
    if (updating) {
        setTimeout(() => updateResult(store, history, result, isMd5), 100);
        return;
    }
    
    setUpdating(true);
    
    try {
        // Cập nhật store
        Object.keys(result).forEach(key => {
            store[key] = result[key];
        });
        
        // Thêm vào lịch sử (đầu mảng)
        history.unshift({ ...result });
        
        // Giới hạn 50 phiên
        while (history.length > MAX_HISTORY) {
            history.pop();
        }
        
        // Lưu vào file
        saveHistoryToFile();
    } catch (error) {
        console.error(`❌ Lỗi cập nhật kết quả: ${error.message}`);
    } finally {
        setUpdating(false);
    }
}

// ======================
// Poll API
// ======================
async function pollApi(gid, isMd5) {
    const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=${gid}`;
    
    while (true) {
        try {
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Python-Proxy/1.0' },
                timeout: 10000
            });
            
            const data = response.data;
            
            if (data.status === 'OK' && Array.isArray(data.data)) {
                // Lấy sid_for_tx từ cmd 1008 (chỉ cho bàn thường)
                if (!isMd5) {
                    for (const game of data.data) {
                        const cmd = game.cmd;
                        if (cmd === 1008) {
                            sidForTx = game.sid;
                            // console.log(`📌 Cập nhật sid_for_tx: ${sidForTx}`);
                        }
                    }
                }
                
                // Xử lý từng game
                for (const game of data.data) {
                    const cmd = game.cmd;
                    
                    // Xử lý MD5 (cmd 2006)
                    if (isMd5 && cmd === 2006) {
                        const sid = game.sid;
                        const d1 = game.d1;
                        const d2 = game.d2;
                        const d3 = game.d3;
                        
                        if (sid && sid !== lastSid101 && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
                            lastSid101 = sid;
                            const total = d1 + d2 + d3;
                            const ketQua = getTaiXiu(d1, d2, d3);
                            
                            const result = {
                                Phien: sid,
                                Xuc_xac_1: d1,
                                Xuc_xac_2: d2,
                                Xuc_xac_3: d3,
                                Tong: total,
                                Ket_qua: ketQua,
                                id: "djtuancon"
                            };
                            
                            updateResult(latestResult101, history101, result, true);
                            console.log(`[MD5] Phiên ${sid} - ${d1} ${d2} ${d3} = ${total} (${ketQua})`);
                        }
                    }
                    
                    // Xử lý bàn thường (cmd 1003)
                    else if (!isMd5 && cmd === 1003) {
                        const d1 = game.d1;
                        const d2 = game.d2;
                        const d3 = game.d3;
                        const sid = sidForTx;
                        
                        if (sid && sid !== lastSid100 && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
                            lastSid100 = sid;
                            const total = d1 + d2 + d3;
                            const ketQua = getTaiXiu(d1, d2, d3);
                            
                            const result = {
                                Phien: sid,
                                Xuc_xac_1: d1,
                                Xuc_xac_2: d2,
                                Xuc_xac_3: d3,
                                Tong: total,
                                Ket_qua: ketQua,
                                id: "djtuancon"
                            };
                            
                            updateResult(latestResult100, history100, result, false);
                            console.log(`[TX] Phiên ${sid} - ${d1} ${d2} ${d3} = ${total} (${ketQua})`);
                            sidForTx = null;
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Lỗi khi lấy dữ liệu API ${gid}: ${error.message}`);
            if (error.response) {
                console.error(`   Status: ${error.response.status}`);
            }
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
        
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
}

// ======================
// Express App
// ======================
const app = express();

// Middleware CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Routes
app.get("/api/taixiu", (req, res) => {
    res.json(latestResult100);
});

app.get("/api/taixiumd5", (req, res) => {
    res.json(latestResult101);
});

app.get("/api/history", (req, res) => {
    res.json({
        taixiu: history100,
        taixiumd5: history101
    });
});

app.get("/api/history/taixiu", (req, res) => {
    res.json({
        total: history100.length,
        history: history100
    });
});

app.get("/api/history/md5", (req, res) => {
    res.json({
        total: history101.length,
        history: history101
    });
});

app.get("/api/status", (req, res) => {
    res.json({
        status: "running",
        last_sid: {
            taixiu: lastSid100,
            md5: lastSid101
        },
        current_result: {
            taixiu: latestResult100,
            md5: latestResult101
        },
        history_count: {
            taixiu: history100.length,
            md5: history101.length
        },
        uptime: process.uptime()
    });
});

app.get("/", (req, res) => {
    res.json({
        name: "Hit Tài Xỉu API",
        version: "1.0.0",
        description: "API Server for TaiXiu from Hit platform",
        endpoints: {
            "/api/taixiu": "Kết quả tài xỉu mới nhất (bàn thường)",
            "/api/taixiumd5": "Kết quả tài xỉu mới nhất (bàn MD5)",
            "/api/history": "Lịch sử cả 2 bàn",
            "/api/history/taixiu": "Lịch sử bàn thường",
            "/api/history/md5": "Lịch sử bàn MD5",
            "/api/status": "Trạng thái hệ thống"
        },
        polling_interval: `${POLL_INTERVAL/1000}s`,
        max_history: MAX_HISTORY
    });
});

// ======================
// Khởi động
// ======================
async function main() {
    console.log("=".repeat(50));
    console.log("🚀 Khởi động hệ thống API Tài Xỉu Hit...");
    console.log("=".repeat(50));
    
    // Load lịch sử từ file
    loadHistoryFromFile();
    
    // Khởi động polling
    console.log("📡 Bắt đầu polling dữ liệu...");
    console.log(`   - Bàn thường (vgmn_100): mỗi ${POLL_INTERVAL/1000}s`);
    console.log(`   - Bàn MD5 (vgmn_101): mỗi ${POLL_INTERVAL/1000}s`);
    
    // Chạy polling không đồng bộ
    pollApi("vgmn_100", false);
    pollApi("vgmn_101", true);
    
    const PORT = process.env.PORT || 1003;
    app.listen(PORT, HOST, () => {
        console.log("\n" + "=".repeat(50));
        console.log("🌐 HTTP SERVER ĐANG CHẠY");
        console.log("=".repeat(50));
        console.log(`   📍 http://${HOST}:${PORT}/api/taixiu       - Kết quả TX mới nhất`);
        console.log(`   📍 http://${HOST}:${PORT}/api/taixiumd5    - Kết quả MD5 mới nhất`);
        console.log(`   📍 http://${HOST}:${PORT}/api/history      - Lịch sử (50 phiên)`);
        console.log(`   📍 http://${HOST}:${PORT}/api/status       - Trạng thái`);
        console.log(`   📍 http://${HOST}:${PORT}/                 - Thông tin`);
        console.log("=".repeat(50));
        console.log(`📁 File lịch sử: ${HISTORY_FILE}`);
        console.log("=".repeat(50));
    });
}

// Xử lý thoát
process.on('SIGINT', () => {
    console.log("\n🛑 Đang dừng chương trình...");
    saveHistoryToFile();
    setTimeout(() => process.exit(0), 1000);
});

main();