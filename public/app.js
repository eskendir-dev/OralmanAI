let mediaRecorder;
let audioChunks = [];
let audioBlob, audioUrl;

let audioContext, analyser, source, animationId;
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const timerDisplay = document.getElementById('recordTimer');
const volumeWarning = document.getElementById('volumeWarning');
const networkBanner = document.getElementById('networkBanner');
const resultSection = document.getElementById('resultSection');
const summaryContent = document.getElementById('summaryContent');
const vizContainer = document.getElementById('vizContainer');
const downloadAudioBtn = document.getElementById('downloadAudioBtn');
const langSelect = document.getElementById('langSelect');

let timerInterval;
let seconds = 0;
function updateTimer() {
    seconds++;
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    timerDisplay.innerText = `${m}:${s}`;
}

window.addEventListener('offline', () => networkBanner.classList.remove('hidden'));
window.addEventListener('online', () => networkBanner.classList.add('hidden'));

function cleanText(text) { return text.replace(/[#*|]/g, '').trim(); }

// Обновленный Канвас: Неоновая свечащаяся линия
function drawVisualizer() {
    animationId = requestAnimationFrame(drawVisualizer);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = '#111827'; 
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    
    canvasCtx.lineWidth = 4; 
    canvasCtx.strokeStyle = '#10B981'; // Изумрудный неон
    canvasCtx.shadowBlur = 15;
    canvasCtx.shadowColor = '#10B981';
    canvasCtx.beginPath();

    let sum = 0;
    let sliceWidth = canvas.width * 1.0 / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
        let v = dataArray[i] / 128.0;
        let y = v * canvas.height / 2;
        if (i === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
        x += sliceWidth;
        sum += Math.abs(dataArray[i] - 128);
    }
    canvasCtx.lineTo(canvas.width, canvas.height / 2); canvasCtx.stroke();
    
    // Сброс тени для других отрисовок
    canvasCtx.shadowBlur = 0;

    let avgVolume = sum / dataArray.length;
    if (avgVolume < 2 && mediaRecorder && mediaRecorder.state === 'recording') {
        volumeWarning.classList.remove('hidden');
    } else {
        volumeWarning.classList.add('hidden');
    }
}

function triggerAudioDownload() {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `Запись_урока_${new Date().toLocaleDateString()}.webm`;
    a.click();
}

startBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') await audioContext.resume();
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        canvas.width = vizContainer.offsetWidth; canvas.height = 100;
        drawVisualizer();

        let options = { mimeType: 'audio/webm' };
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 };
        }
        
        mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = processAudioData;
        
        audioChunks = [];
        mediaRecorder.start();
        
        seconds = 0;
        timerDisplay.innerText = "00:00";
        timerInterval = setInterval(updateTimer, 1000);

        startBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
        stopBtn.classList.remove('hidden');
        resultSection.classList.add('hidden');
    } catch (err) { alert("Ошибка доступа к микрофону!"); }
};

pauseBtn.onclick = () => {
    if (mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        clearInterval(timerInterval);
        pauseBtn.innerText = "▶ ПРОДОЛЖИТЬ";
        pauseBtn.style.background = "linear-gradient(135deg, #10B981, #059669)";
    } else if (mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        timerInterval = setInterval(updateTimer, 1000);
        pauseBtn.innerText = "⏸ ПАУЗА";
        pauseBtn.style.background = "linear-gradient(135deg, #F59E0B, #D97706)";
    }
};

stopBtn.onclick = () => {
    mediaRecorder.stop();
    clearInterval(timerInterval);
    cancelAnimationFrame(animationId);
    if (audioContext) audioContext.close();
    
    startBtn.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');
    pauseBtn.innerText = "⏸ ПАУЗА";
    pauseBtn.style.background = "";
    volumeWarning.classList.add('hidden');
};

async function processAudioData() {
    resultSection.classList.remove('hidden');
    summaryContent.innerHTML = "<strong>ИИ анализирует аудио и убирает лишний шум. Ожидайте...</strong>";

    audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    if(audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(audioBlob);
    downloadAudioBtn.onclick = triggerAudioDownload;

    const formData = new FormData();
    formData.append('audio', audioBlob, 'lesson.webm');
    
    // Передаем выбранный язык на бэкенд
    formData.append('language', langSelect.value);
    
    const docFile = document.getElementById('docUpload').files[0];
    if (docFile) formData.append('document', docFile);

    try {
        if (!navigator.onLine) throw new Error("Offline");
        const response = await fetch('/api/generate', { method: 'POST', body: formData });
        const data = await response.json();
        summaryContent.innerText = cleanText(data.summary || "Ошибка сервера");
    } catch (e) {
        summaryContent.innerText = "❌ Соединение прервано! Файл сохранен. Нажмите 'Скачать аудио' и загрузите его позже.";
        triggerAudioDownload();
    }
}

document.getElementById('editBtn').onclick = async () => {
    const instruction = document.getElementById('editInstruction').value;
    if (!instruction) return;
    const currentText = summaryContent.innerText;
    summaryContent.innerText = "Редактирование...";
    try {
        const response = await fetch('/api/edit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentText, instruction })
        });
        const data = await response.json();
        summaryContent.innerText = cleanText(data.updatedText);
        document.getElementById('editInstruction').value = '';
    } catch(e) { summaryContent.innerText = currentText; alert("Ошибка при редактировании"); }
};

document.getElementById('copyBtn').onclick = () => { navigator.clipboard.writeText(summaryContent.innerText); alert("Текст скопирован!"); };
document.getElementById('waBtn').onclick = () => { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(summaryContent.innerText)}`); };
document.getElementById('wordBtn').onclick = () => {
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'></head><body><pre style="font-family: sans-serif; font-size: 12pt;">${summaryContent.innerText}</pre></body></html>`;
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' }));
    link.download = 'Конспект_Урока.doc'; link.click();
};