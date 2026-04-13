const express = require('express');
const multer = require('multer');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse-fork');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const ext = file.fieldname === 'audio' ? '.webm' : path.extname(file.originalname);
        cb(null, Date.now() + '-' + file.fieldname + ext);
    }
});
const upload = multer({ storage: storage });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

async function extractTextFromFile(filePath) {
    if (!fs.existsSync(filePath)) return "";
    const dataBuffer = fs.readFileSync(filePath);
    try {
        const parseFunc = typeof pdf === 'function' ? pdf : pdf.default;
        const data = await parseFunc(dataBuffer);
        return data.text;
    } catch (error) {
        console.error("Ошибка парсинга PDF:", error);
        return "";
    }
}

// Глобальный промпт для редактора (чтобы не дублировать)
const editorSystemPrompt = "Ты редактор. Выполни правку текста конспекта. Не добавляй приветствий. Сохраняй структуру. Никаких символов * и #.";

app.post('/api/generate', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'document', maxCount: 1 }]), async (req, res) => {
    try {
        let contextText = "";
        if (req.files['document']) {
            const docPath = req.files['document'][0].path;
            contextText = await extractTextFromFile(docPath);
            fs.unlinkSync(docPath); 
        }

        const audioPath = req.files['audio'][0].path;
        const targetLanguage = req.body.language || 'ru';

        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-large-v3",
            language: targetLanguage === 'auto' ? undefined : targetLanguage
        });
        fs.unlinkSync(audioPath);

        const systemPrompt = `Ты — ведущий методист школы НИШ. Создай подробный академический конспект.
        
СТРУКТУРА:
1. ТЕМА
2. ГЛОССАРИЙ
3. КОНСПЕКТ (на основе аудио)
4. ФОРМУЛЫ (если есть)
5. ВЫВОД
6. ПРОВЕРКА ЗНАНИЙ (3 вопроса)

ЗАПРЕТЫ: Никаких #, *, ** или |. Только чистый структурированный текст.
Дополнительные материалы: ${contextText ? contextText : 'отсутствуют'}.`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Текст аудиозаписи: ${transcription.text}` }
            ],
            model: "llama-3.3-70b-versatile", // ОБНОВЛЕННАЯ МОДЕЛЬ
            temperature: 0.6
        });

        res.json({ summary: completion.choices[0].message.content });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ error: "Ошибка сервера" });
    }
});

app.post('/api/edit', async (req, res) => {
    try {
        const { currentText, instruction } = req.body;
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: editorSystemPrompt },
                { role: "user", content: `Текст:\n${currentText}\n\nПравка: ${instruction}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.3
        });
        res.json({ updatedText: completion.choices[0].message.content });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Ошибка" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});