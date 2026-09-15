/**
 * =================================================================
 * STOCK OPNAME MANDIRI - CORE SYSTEM (Vanilla JS + PWA)
 * =================================================================
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyYHbkn9D0glTUGGHbFV0uk1aIoMrib9aoQ0NzujW43B2heZ7jZBtp6dtMslc9ucqworQ/exec"; // MASUKKAN URL GOOGLE APPS SCRIPT DI SINI

// ==========================================
// 1. INISIALISASI DATABASE OFFLINE (DEXIE)
// ==========================================
const db = new Dexie("SOMandiri_DB");
db.version(1).stores({
    master: 'upc, artikel, deskripsi, departemen, vendor',
    stock: 'upc, qty_sys',
    soQueue: '++id, id_so, waktu, user, lokasi, upc, artikel, deskripsi, qty, keterangan', // Antrean SO
    verifQueue: '++id, id_so, user, qty_verif, selisih, note, status_final' // Antrean Verifikasi
});

// Variabel Global
let currentUser = null;
let currentLokasi = null;
let scannerHTML5 = null;
let isQuaggaRunning = false;
let isFlashlightOn = false;

// ==========================================
// 2. UTILITY & UI COMPONENTS
// ==========================================
const showLoader = (text = "Memproses...") => {
    document.getElementById('loader-text').innerText = text;
    document.getElementById('global-loader').classList.remove('hidden');
};
const hideLoader = () => document.getElementById('global-loader').classList.add('hidden');

function navTo(pageId) {
    document.querySelectorAll('.view-page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.view-page').forEach(p => p.classList.remove('active'));
    
    let target = document.getElementById(pageId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
}

function togglePassword() {
    const input = document.getElementById("password");
    input.type = input.type === "password" ? "text" : "password";
}

// Custom iOS Modal
function showIOSModal(title, desc, buttons) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-desc').innerHTML = desc;
    
    const btnContainer = document.getElementById('modal-buttons');
    btnContainer.innerHTML = '';
    
    buttons.forEach(btn => {
        let b = document.createElement('button');
        b.innerText = btn.text;
        b.className = btn.style || 'btn-confirm'; // style: 'btn-cancel', 'btn-danger', 'btn-confirm'
        b.onclick = () => {
            closeIOSModal();
            if(btn.action) btn.action();
        };
        btnContainer.appendChild(b);
    });
    
    document.getElementById('ios-modal').classList.remove('hidden');
}

function closeIOSModal() {
    document.getElementById('ios-modal').classList.add('hidden');
}

// Cek Koneksi
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

function updateNetworkStatus() {
    const statusEl = document.getElementById('net-status');
    const dot = document.querySelector('.status-pill .dot');
    if(navigator.onLine) {
        statusEl.innerText = "Online";
        dot.className = "dot online";
        syncOfflineData(); // Auto sync jika dapat sinyal
    } else {
        statusEl.innerText = "Offline";
        dot.className = "dot offline";
    }
}

// ==========================================
// 3. AUTHENTICATION & LOCKOUT SYSTEM
// ==========================================
function checkSession() {
    const userStr = localStorage.getItem('activeUser');
    const loginTime = localStorage.getItem('loginTime');
    
    if (userStr && loginTime) {
        // Auto logout 12 Jam
        if (new Date().getTime() - loginTime > 12 * 60 * 60 * 1000) {
            logout("Sesi berakhir (12 Jam). Silakan login kembali.");
            return;
        }
        currentUser = JSON.parse(userStr);
        setupDashboardUI();
    } else {
        navTo('login-page');
    }
}

function handleLogin() {
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value.trim();
    const errorText = document.getElementById('login-error');
    
    if(pass.length < 6) {
        errorText.innerText = "Password minimal 6 karakter!";
        errorText.classList.remove('hidden');
        return;
    }

    // Logic Lockout
    let fails = parseInt(localStorage.getItem('loginFails_' + user) || 0);
    let blockUntil = parseInt(localStorage.getItem('blockUntil_' + user) || 0);
    
    if (blockUntil && new Date().getTime() < blockUntil) {
        let mins = Math.ceil((blockUntil - new Date().getTime()) / 60000);
        errorText.innerText = `Akses diblokir. Coba lagi dalam ${mins} menit.`;
        errorText.classList.remove('hidden');
        return;
    }

    if (!navigator.onLine) {
        errorText.innerText = "Anda harus Online untuk Login pertama kali.";
        errorText.classList.remove('hidden');
        return;
    }

    showLoader("Autentikasi...");
    fetch(`${GAS_URL}?action=login&username=${user}&password=${pass}`)
    .then(res => res.json())
    .then(data => {
        hideLoader();
        if (data.status === "success") {
            // Sukses
            localStorage.setItem('loginFails_' + user, 0);
            localStorage.setItem('blockUntil_' + user, 0);
            localStorage.setItem('activeUser', JSON.stringify(data.data));
            localStorage.setItem('loginTime', new Date().getTime());
            
            currentUser = data.data;
            setupDashboardUI();
            downloadMasterData(); // Download ke DB Lokal
        } else {
            // Gagal
            fails++;
            localStorage.setItem('loginFails_' + user, fails);
            if (fails % 6 === 0) {
                let blockDuration = (fails / 6) * 10 * 60 * 1000; // Kelipatan 10 mnt
                localStorage.setItem('blockUntil_' + user, new Date().getTime() + blockDuration);
                errorText.innerText = `Terlalu banyak percobaan. Diblokir ${(fails/6)*10} menit.`;
            } else {
                errorText.innerText = `${data.message} (${fails}/6)`;
            }
            errorText.classList.remove('hidden');
        }
    }).catch(err => {
        hideLoader();
        errorText.innerText = "Gagal terhubung ke server.";
        errorText.classList.remove('hidden');
    });
}
function forgotPassword() {
    alert("Silakan hubungi Administrator atau IT Support untuk mereset password Anda.");
}

function logout(msg = "") {
    localStorage.removeItem('activeUser');
    localStorage.removeItem('loginTime');
    currentUser = null;
    navTo('login-page');
    if(msg) alert(msg);
}

function setupDashboardUI() {
    document.getElementById('user-greeting').innerText = `Halo, ${currentUser.username}`;
    document.getElementById('user-role').innerText = currentUser.role;
    
    // Sembunyikan menu admin jika user adalah staf
    const adminMenus = document.querySelectorAll('.admin-only');
    const adminDivider = document.querySelector('.admin-divider');
    
    if (currentUser.role.toLowerCase() !== 'admin') {
        adminMenus.forEach(m => m.style.display = 'none');
        if(adminDivider) adminDivider.style.display = 'none';
    } else {
        adminMenus.forEach(m => m.style.display = 'block');
        if(adminDivider) adminDivider.style.display = 'block';
    }
    navTo('dashboard-page');
    updateNetworkStatus();
}

// ==========================================
// 4. MASTER DATA & SYNC LOGIC
// ==========================================
async function downloadMasterData() {
    document.getElementById('sync-status').innerText = "Update DB...";
    try {
        // Ambil Data Master
        let res = await fetch(`${GAS_URL}?action=getMasterData`);
        let json = await res.json();
        if(json.status === "success") {
            await db.master.clear();
            let cleanData = json.data.map(i => ({
                upc: String(i['Kode UPC']), artikel: i['Artikel Number'], deskripsi: i['Deskripsi Produk'], 
                departemen: i['Department'], vendor: i['Vendor Name']
            }));
            await db.master.bulkAdd(cleanData);
        }

        // Ambil Stock System
        let resStock = await fetch(`${GAS_URL}?action=getStockSystem`);
        let jsonStock = await resStock.json();
        if(jsonStock.status === "success") {
            await db.stock.clear();
            let cleanStock = jsonStock.data.map(i => ({ upc: String(i['Kode UPC']), qty_sys: i['Qty System'] }));
            await db.stock.bulkAdd(cleanStock);
        }
        
        document.getElementById('sync-status').innerText = "Up to date";
    } catch (e) {
        document.getElementById('sync-status').innerText = "Offline Mode";
    }
}

// Sinkronisasi Background
async function syncOfflineData() {
    let pendingSO = await db.soQueue.toArray();
    if(pendingSO.length > 0 && navigator.onLine) {
        document.getElementById('sync-status').innerText = "Uploading SO...";
        try {
            let res = await fetch(`${GAS_URL}`, {
                method: 'POST',
                body: JSON.stringify({ action: 'syncSO', user: currentUser.username, data: pendingSO })
            });
            let json = await res.json();
            if(json.status === "success") {
                await db.soQueue.clear(); // Bersihkan jika sukses
                document.getElementById('sync-status').innerText = "Up to date";
            }
        } catch(e) { console.error("Sync SO Error", e); }
    }
}
// Jalankan sync setiap 20 detik jika online
setInterval(syncOfflineData, 20000);

// ==========================================
// 5. LOKASI LOGIC
// ==========================================
async function setLokasi() {
    let input = document.getElementById('input-lokasi').value.trim();
    if(!input) return;
    currentLokasi = input;
    document.getElementById('display-lokasi').innerText = currentLokasi;
    
    // Jika online, register lokasi ke server
    if(navigator.onLine) {
        fetch(`${GAS_URL}?action=addLokasi&nama_lokasi=${input}&user=${currentUser.username}`)
        .then(res => res.json())
        .then(res => {
            currentLokasi = res.id; // Gunakan ID dari server
            document.getElementById('display-lokasi').innerText = input + ` (${res.id})`;
        });
    }
}

function requestDeleteLokasi() {
    if(!currentLokasi) return alert("Belum ada lokasi yang diset.");
    if(!navigator.onLine) return alert("Penghapusan lokasi membutuhkan koneksi internet.");
    
    showIOSModal("Hapus Lokasi", "Yakin ingin menghapus lokasi ini?", [
        { text: "Batal", style: "btn-cancel" },
        { text: "Hapus", style: "btn-danger", action: () => {
            showLoader("Menghapus...");
            fetch(`${GAS_URL}?action=deleteLokasi&id_lokasi=${currentLokasi}&user=${currentUser.username}`)
            .then(res => res.json())
            .then(data => {
                hideLoader();
                alert(data.message); // Notif apakah berhasil atau masuk approval
                if(data.status === "success") {
                    currentLokasi = null;
                    document.getElementById('display-lokasi').innerText = "Belum diset";
                    document.getElementById('input-lokasi').value = "";
                }
            });
        }}
    ]);
}

// ==========================================
// 6. DUAL ENGINE SCANNER (HTML5QR & Quagga)
// ==========================================
async function startScanner() {
    const engine = document.getElementById('scanner-engine').value;
    const btn = document.getElementById('btn-start-scan');
    document.getElementById('cam-overlay').classList.remove('hidden');
    
    if (engine === 'html5') {
        if (!scannerHTML5) {
            scannerHTML5 = new Html5Qrcode("reader");
        }
        try {
            await scannerHTML5.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } },
            (decodedText) => { processScanResult(decodedText); }
            );
            btn.innerText = "Stop Scanner";
            btn.onclick = stopScanner;
        } catch (err) { alert("Akses kamera ditolak/gagal."); }
    } else {
        // QuaggaJS
        if(typeof Quagga === 'undefined') return alert("QuaggaJS tidak termuat. Cek koneksi.");
        Quagga.init({
            inputStream : { name : "Live", type : "LiveStream", target: document.querySelector('#reader'),
                constraints: { facingMode: "environment" }
            },
            decoder : { readers : ["ean_reader", "upc_reader", "code_128_reader"] }
        }, function(err) {
            if (err) return alert(err);
            Quagga.start();
            isQuaggaRunning = true;
            btn.innerText = "Stop Scanner";
            btn.onclick = stopScanner;
        });
        Quagga.onDetected((data) => {
            processScanResult(data.codeResult.code);
        });
    }
}

function stopScanner() {
    const btn = document.getElementById('btn-start-scan');
    document.getElementById('cam-overlay').classList.add('hidden');
    
    if (scannerHTML5 && scannerHTML5.isScanning) {
        scannerHTML5.stop().then(() => {
            btn.innerText = "Mulai Kamera Scanner";
            btn.onclick = startScanner;
        });
    }
    if (isQuaggaRunning) {
        Quagga.stop();
        isQuaggaRunning = false;
        btn.innerText = "Mulai Kamera Scanner";
        btn.onclick = startScanner;
    }
}

function toggleFlashlight() {
    // Senter hanya didukung secara stabil di HTML5Qrcode (jika didukung perangkat)
    if(scannerHTML5 && scannerHTML5.isScanning) {
        isFlashlightOn = !isFlashlightOn;
        scannerHTML5.applyVideoConstraints({ advanced: [{ torch: isFlashlightOn }] });
    } else {
        alert("Senter hanya aktif pada engine HTML5-QR saat kamera menyala.");
    }
}

// ==========================================
// 7. PROSES HASIL SCAN & SO INPUT
// ==========================================
async function processScanResult(upc) {
    stopScanner();
    document.getElementById('input-upc').value = upc;
    
    // Cari di DB Lokal
    let product = await db.master.where('upc').equals(String(upc)).first();
    let stock = await db.stock.where('upc').equals(String(upc)).first();
    
    const detBox = document.getElementById('product-detail');
    if (product) {
        document.getElementById('det-deskripsi').innerText = product.deskripsi;
        document.getElementById('det-dept').innerText = product.departemen;
        document.getElementById('det-vendor').innerText = product.vendor;
        document.getElementById('det-qty-sys').innerText = stock ? stock.qty_sys : '0';
        detBox.classList.remove('hidden');
        document.getElementById('input-qty').focus(); // Otomatis fokus ke qty
    } else {
        detBox.classList.add('hidden');
        showIOSModal("Data Tidak Ditemukan", "Barcode tidak terdaftar di Data Master. Lanjutkan simpan sebagai Unknown?", [
            { text: "Batal", style: "btn-cancel", action: () => { document.getElementById('input-upc').value = ""; } },
            { text: "Lanjutkan", style: "btn-confirm", action: () => { document.getElementById('input-qty').focus(); } }
        ]);
    }
}

// Input Event Listener (Jaga-jaga user ngetik manual / pake scanner eksternal bluetooth)
document.getElementById('input-upc').addEventListener('change', (e) => {
    processScanResult(e.target.value.trim());
});

async function simpanDataSO() {
    let upc = document.getElementById('input-upc').value.trim();
    let qty = parseInt(document.getElementById('input-qty').value);
    let ket = document.getElementById('input-ket').value;
    
    if(!currentLokasi) return alert("Tentukan lokasi terlebih dahulu!");
    if(!upc || isNaN(qty)) return alert("UPC dan Qty wajib diisi!");

    // Cek duplikasi di queue lokal untuk LOKASI yang SAMA
    let exist = await db.soQueue.where({upc: String(upc), lokasi: currentLokasi}).first();
    
    if (exist) {
        showIOSModal("Duplikasi Data", `Data UPC ini sudah diinput di lokasi yang sama dengan QTY: ${exist.qty}. Apa yang ingin dilakukan?`, [
            { text: "Batal", style: "btn-cancel" },
            { text: "Tambah (+)", style: "btn-confirm", action: () => saveToLocalSO(upc, qty, ket, exist, "add") },
            { text: "Timpa (Replace)", style: "btn-danger", action: () => saveToLocalSO(upc, qty, ket, exist, "replace") }
        ]);
    } else {
        saveToLocalSO(upc, qty, ket, null, "new");
    }
}

async function saveToLocalSO(upc, qty, ket, existItem, mode) {
    let product = await db.master.where('upc').equals(String(upc)).first();
    let finalQty = mode === "add" ? (existItem.qty + qty) : qty;

    let payload = {
        id_so: existItem ? existItem.id_so : "SO-" + new Date().getTime(),
        waktu: new Date().toISOString(),
        user: currentUser.username,
        lokasi: currentLokasi,
        upc: String(upc),
        artikel: product ? product.artikel : "Unknown",
        deskripsi: product ? product.deskripsi : "Unknown",
        qty: finalQty,
        keterangan: ket
    };

    if (existItem) {
        await db.soQueue.update(existItem.id, payload);
    } else {
        await db.soQueue.add(payload);
    }
    
    // Reset Form & Render History
    document.getElementById('input-upc').value = "";
    document.getElementById('input-qty').value = "";
    document.getElementById('input-ket').value = "";
    document.getElementById('product-detail').classList.add('hidden');
    renderHistorySO();
}

async function renderHistorySO() {
    // Ambil 5 data terakhir dari antrean lokal
    let items = await db.soQueue.orderBy('id').reverse().limit(5).toArray();
    const list = document.getElementById('list-history-so');
    list.innerHTML = '';
    
    items.forEach(item => {
        list.innerHTML += `
        <li>
            <div class="hist-info">
                <strong>${item.upc}</strong> - ${item.deskripsi.substring(0,20)}...
                <br><span style="font-size:12px;color:gray;">${new Date(item.waktu).toLocaleTimeString()} | Lok: ${item.lokasi}</span>
            </div>
            <div style="font-weight:bold; color:var(--blue-ios);">+${item.qty}</div>
        </li>`;
    });
}

// ==========================================
// 8. INISIALISASI SAAT HALAMAN DIMUAT
// ==========================================
window.onload = () => {
    checkSession();
};
