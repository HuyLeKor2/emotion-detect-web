// ====== CẤU HÌNH ======
// Use CDN-hosted model weights per user request
const MODEL_URL = "https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js/weights";

// Bản đồ label VN + message
const EMO_LABEL = {
    happy: "Vui vẻ 😄",
    sad: "Buồn bã 😢",
    angry: "Giận dữ 😡",
    fear: "Sợ hãi 😱",
    unknown: "Thử lại nhen 😕"
};
const EMO_ICON = {
    happy: "icons/happy.gif",
    sad: "icons/sad.gif",
    angry: "icons/angry.gif",
    fear: "icons/fear.gif",
    unknown: "" // không icon
};
const EMO_MSG = {
    happy: [
        "Happy teachers, happy students!",
        "Nụ cười của thầy cô là động lực lớn nhất cho học sinh.",
        "Năng lượng tích cực của thầy cô là chìa khóa mở ra cánh cửa tri thức.",
        "Thầy cô hạnh phúc, lớp học sẽ tràn đầy niềm vui và sự sáng tạo.",
        "Hãy lan tỏa niềm vui này, vì mỗi giờ học hạnh phúc là một kỷ niệm đẹp."
    ],
    sad: [
        "Mỗi cảm xúc đều cần được lắng nghe.",
        "Không sao đâu, những khoảnh khắc trầm lắng giúp ta hiểu mình hơn.",
        "Hãy cho phép bản thân nghỉ ngơi, rồi mình lại bước tiếp."
    ],
    angry: [
        "Biến năng lượng tiêu cực thành hành động tích cực.",
        "Hít thở sâu, tâm trí bình tĩnh mới ra quyết định đúng.",
        "Dùng sự tức giận làm động lực để thay đổi."
    ],
    fear: [
        "Can đảm đối diện và vượt qua nỗi sợ.",
        "Nỗi sợ là tín hiệu—chuyển hóa nó thành sự tự tin.",
        "Mọi thử thách đều ẩn cơ hội."
    ],
    unknown: [
        "Mình không chắc lắm, thử chụp lại nhé!",
        "Không phát hiện rõ cảm xúc. Bạn thử lần nữa nhé."
    ]
};

// ====== DOM ======
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const btnCapture = document.getElementById("btnCapture");

const popup = document.getElementById("popup");
const snapshot = document.getElementById("snapshot");
const emoIcon = document.getElementById("emoIcon");
const emoLabel = document.getElementById("emoLabel");
const titleAsk = document.getElementById("titleAsk");
const letter = document.getElementById("letter");
const msgBox = document.getElementById("msgBox");
const btnClose = document.getElementById("btnClose");

// ====== STATE ======
let modelsReady = false;
let detecting = false;
let popupShown = false;
let videoReady = false;
let ssdAvailable = false;
let tinyAvailable = false;

// ====== UTIL ======
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hideEl = (el) => el.classList.add("hidden");
const showEl = (el) => el.classList.remove("hidden");

function resetPopupUI() {
    // giống PyQt: khi mới mở popup, hiện title + thư + pointer; ẩn message
    emoIcon.src = "";
    emoLabel.textContent = "…";
    showEl(titleAsk);
    showEl(letter);
    hideEl(msgBox);
    // hủy click cũ nếu có để tránh nhân đôi listener
    letter.onclick = null;
}

function showPopup() {
    popup.setAttribute("aria-hidden", "false");
    popup.style.display = "flex";
    popupShown = true;
}

function hidePopup() {
    popup.setAttribute("aria-hidden", "true");
    popup.style.display = "none";
    popupShown = false;
    resetPopupUI(); // chuẩn bị cho lần sau
}

// ====== INIT (KHÔNG mở popup ở đây) ======
async function init() {
    // đảm bảo modal ẩn khi khởi động
    hideEl(popup);

    // camera
    try {
        // Prefer a built-in / computer webcam when multiple devices are present.
        async function getPreferredCameraStream() {
            // enumerate devices
            let devices = await navigator.mediaDevices.enumerateDevices();
            // if labels are empty (no permission yet), request a temporary stream to prompt user and then re-enumerate
            const labelsEmpty = devices.every(d => !d.label);
            if (labelsEmpty) {
                console.log('[camera] labels empty, requesting temporary permission to enumerate devices');
                let tmpStream = null;
                try {
                    tmpStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                    // stop tracks immediately after permission granted
                    tmpStream.getTracks().forEach(t => t.stop());
                } catch (e) {
                    console.warn('[camera] temporary permission denied or failed', e);
                }
                devices = await navigator.mediaDevices.enumerateDevices();
            }
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            console.log('[camera] available devices:', videoDevices.map(d => ({ id: d.deviceId, label: d.label })));

            if (videoDevices.length === 0) {
                // no device found
                return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }

            // heuristics to prefer built-in/computer webcams
            const positive = ['integrated', 'internal', 'built-in', 'built in', 'webcam', 'face time', 'facetime', 'logitech', 'hd'];
            const negative = ['iphone', 'android', 'phone', 'pixel', 'galaxy'];

            // try to find device whose label matches positive and not negative
            let chosen = videoDevices.find(d => {
                const lbl = (d.label || '').toLowerCase();
                return positive.some(p => lbl.includes(p)) && !negative.some(n => lbl.includes(n));
            });

            if (!chosen) {
                // try a device that does not look like a phone
                chosen = videoDevices.find(d => {
                    const lbl = (d.label || '').toLowerCase();
                    return !negative.some(n => lbl.includes(n));
                });
            }

            if (chosen && chosen.deviceId) {
                console.log('[camera] chosen device:', chosen.label || chosen.deviceId);
                try {
                    return await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: chosen.deviceId } }, audio: false });
                } catch (e) {
                    console.warn('[camera] failed to open chosen device, falling back', e);
                }
            }

            // fallback to facingMode user
            try {
                return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
            } catch (e) {
                // last resort
                return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
        }

        const stream = await getPreferredCameraStream();
        video.srcObject = stream;
        // listen for playing to mark video ready
        video.addEventListener('playing', () => {
            console.log('[camera] video playing -> ready');
            videoReady = true;
            // enable capture only when models are ready too
            btnCapture.disabled = !(modelsReady && videoReady);
        }, { once: true });
    } catch (e) {
        alert("Không mở được camera. Hãy kiểm tra quyền truy cập.");
        console.error(e);
    }

    // models - check manifests first to avoid 404 for missing model builds
    try {
        async function manifestExists(name) {
            try {
                const url = `${MODEL_URL}/${name}_model-weights_manifest.json`;
                const r = await fetch(url, { method: 'GET' });
                return r.ok;
            } catch (e) {
                return false;
            }
        }

        const needFaceExpr = await manifestExists('face_expression');
        const hasTiny = await manifestExists('tiny_face_detector');
        const hasSsd = await manifestExists('ssd_mobilenetv1');

        if (!needFaceExpr) {
            throw new Error('Required model face_expression not found in ' + MODEL_URL);
        }

        // load face expression for sure
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);

        // load detectors that exist and set flags
        if (hasSsd) {
            await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
            ssdAvailable = true;
            console.log('[models] ssdMobilenetv1 loaded');
        }
        if (hasTiny) {
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
            tinyAvailable = true;
            console.log('[models] tinyFaceDetector loaded');
        }

        if (!ssdAvailable && !tinyAvailable) {
            throw new Error('No face detector model found (ssd_mobilenetv1 or tiny_face_detector) in ' + MODEL_URL);
        }

        modelsReady = true;
        console.log('[models] models loaded, ssd=', ssdAvailable, 'tiny=', tinyAvailable);
        btnCapture.disabled = !(modelsReady && videoReady);
    } catch (e) {
        console.error('Load models lỗi:', e);
        btnCapture.disabled = true;
    }
}

// ====== EMOTION HELPERS ======
function mapTopEmotion(expressions) {
    const mapped = {
        happy: expressions.happy ?? 0,
        sad: expressions.sad ?? 0,
        angry: expressions.angry ?? 0,
        fear: expressions.fearful ?? (expressions.fear ?? 0)
    };
    let key = "unknown", score = 0;
    Object.entries(mapped).forEach(([k, v]) => { if (v > score) { score = v; key = k; } });
    return key;
}

// ====== CAPTURE FLOW (chỉ gọi khi người dùng bấm nút / Space) ======
async function captureAndAnalyze() {
    if (!modelsReady || detecting) return;
    detecting = true;
    btnCapture.disabled = true;

    try {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) throw new Error("Video chưa sẵn sàng");

        // crop vuông như bản Python
        const minEdge = Math.min(w, h);
        const sx = (w - minEdge) / 2, sy = (h - minEdge) / 2;
        canvas.width = minEdge; canvas.height = minEdge;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, sx, sy, minEdge, minEdge, 0, 0, minEdge, minEdge);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        // Show the original captured square image in the popup.
        // Keep this as the snapshot displayed to the user.
        snapshot.src = dataUrl;

        // detect
        // use the canvas element directly as input for face-api (avoid bufferToImage Blob error)
        const input = canvas; // canvas already contains the cropped image
        console.log('[detect] running detection, ssdAvailable=', ssdAvailable, 'tinyAvailable=', tinyAvailable);
        // Robust detection routine: try SSD (if available), then multiple Tiny configs
        async function attemptDetect(img) {
            // try SSD first
            if (ssdAvailable) {
                console.log('[detect] trying SSD minConfidence=0.3');
                const d = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 })).withFaceExpressions();
                if (d && d.length) return { detections: d, method: 'ssd' };
            }

            if (tinyAvailable) {
                const tinyConfigs = [
                    { inputSize: 512, scoreThreshold: 0.25 },
                    { inputSize: 416, scoreThreshold: 0.2 },
                    { inputSize: 320, scoreThreshold: 0.15 },
                    { inputSize: 256, scoreThreshold: 0.12 }
                ];
                for (const cfg of tinyConfigs) {
                    try {
                        console.log('[detect] trying tiny', cfg);
                        const d = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions(cfg)).withFaceExpressions();
                        if (d && d.length) return { detections: d, method: `tiny-${cfg.inputSize}-${cfg.scoreThreshold}` };
                    } catch (e) {
                        console.warn('[detect] tiny attempt failed', cfg, e);
                    }
                }
                // last resort: detect single face with very low threshold
                try {
                    console.log('[detect] trying detectSingleFace tiny fallback');
                    const single = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.08 })).withFaceExpressions();
                    if (single) return { detections: [single], method: 'tiny-single-fallback' };
                } catch (e) {
                    console.warn('[detect] single fallback failed', e);
                }
            }

            return { detections: [], method: 'none' };
        }

        const detectResult = await attemptDetect(input);
        const detections = detectResult.detections || [];
        console.log('[detect] method used:', detectResult.method);

        resetPopupUI(); // trạng thái mở đầu của popup

        console.log('[detect] detections length=', detections.length, detections);
        if (!detections.length) {
            // Không thấy mặt → unknown như Python
            emoIcon.src = EMO_ICON.unknown;
            emoLabel.textContent = EMO_LABEL.unknown;
            // phong bì mở → hiện thông điệp unknown khi click
            letter.onclick = () => {
                hideEl(titleAsk);
                hideEl(letter);
                msgBox.textContent = pick(EMO_MSG.unknown);
                showEl(msgBox);
            };
            showPopup();
            return;
        }

        // Chọn mặt lớn nhất
        const biggest = detections.reduce((max, cur) =>
            cur.detection.box.area > max.detection.box.area ? cur : max
        );

        const key = mapTopEmotion(biggest.expressions);
        emoIcon.src = EMO_ICON[key] || "";
        emoLabel.textContent = EMO_LABEL[key] || EMO_LABEL.unknown;

        // Crop the face ROI from canvas for internal use (e.g., if you want to
        // save/send the face crop). Important: do NOT overwrite the visible
        // `snapshot.src` — keep showing the original captured image to the user.
        let faceCropDataUrl = null;
        try {
            const box = biggest.detection.box;
            const faceCanvas = document.createElement('canvas');
            faceCanvas.width = box.width; faceCanvas.height = box.height;
            const fctx = faceCanvas.getContext('2d');
            // source coordinates were drawn centered into canvas earlier using sx,sy
            // our canvas is the cropped square, so box.x and box.y are relative to canvas
            fctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
            faceCropDataUrl = faceCanvas.toDataURL('image/jpeg', 0.9);
            // If you later want to display the crop instead, set snapshot.src = faceCropDataUrl;
        } catch (e) {
            // fallback: keep original captured image visible; store the full canvas data if needed
            faceCropDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        }

        // click phong bì để lộ thông điệp tương ứng
        letter.onclick = () => {
            hideEl(titleAsk);
            hideEl(letter);
            msgBox.textContent = pick(EMO_MSG[key] || EMO_MSG.unknown);
            showEl(msgBox);
        };

        showPopup();

    } catch (e) {
        console.error(e);
        // trong trường hợp lỗi khi người dùng đã bấm, ta vẫn mở popup báo thử lại
        resetPopupUI();
        emoIcon.src = "";
        emoLabel.textContent = "Thử lại 😕";
        letter.onclick = () => {
            hideEl(titleAsk);
            hideEl(letter);
            msgBox.textContent = pick(EMO_MSG.unknown);
            showEl(msgBox);
        };
        showPopup();
    } finally {
        detecting = false;
        btnCapture.disabled = !modelsReady;
    }
}

// ====== EVENTS ======
// Soft restart helper: when user wants to 'restart' the app without reloading the page
async function restartApp() {
    try {
        // If a popup is visible, hide it (acts like pressing the close button)
        if (popupShown) {
            hidePopup();
            return;
        }

        // stop existing camera tracks if any
        if (video && video.srcObject) {
            try {
                const tracks = video.srcObject.getTracks();
                tracks.forEach(t => t.stop());
            } catch (e) {
                console.warn('[restart] stop tracks failed', e);
            }
            video.srcObject = null;
        }

        // reset some internal flags and UI
        detecting = false;
        videoReady = false;
        popupShown = false;
        resetPopupUI();
        btnCapture.disabled = true;

        // re-run initialization (re-acquire camera and re-check models)
        await init();
    } catch (e) {
        console.error('[restart] failed', e);
    }
}

// 'r' key: act like close popup or restart app (but not a full page reload)
window.addEventListener('keydown', (ev) => {
    // ignore when user is typing into an input or textarea or contenteditable
    const active = document.activeElement;
    const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
    const isTyping = active && (active.isContentEditable || tag === 'input' || tag === 'textarea');
    if (isTyping) return;

    if (ev.key === 'r' || ev.key === 'R') {
        ev.preventDefault();
        // call restartApp (it may be async, don't block)
        restartApp();
    }
});



btnCapture.addEventListener("click", captureAndAnalyze);

// Space: giống Python — đang mở popup thì đóng, ngược lại thì chụp
window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space") {
        ev.preventDefault();
        if (popupShown) hidePopup();
        else captureAndAnalyze();
    }
});

btnClose.addEventListener("click", hidePopup);
window.addEventListener("load", init);
