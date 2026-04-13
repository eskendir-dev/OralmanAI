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

        const systemPrompt = `Ты — ведущий методист школы НИШ и эксперт по созданию подробных учебных материалов. 
Твоя задача: превратить аудиозапись урока в МАКСИМАЛЬНО ПОДРОБНЫЙ и глубокий конспект.

ИНСТРУКЦИИ ПО ОБЪЕМУ:
- Если тема важная, расписывай её детально.
- Если в аудио упоминаются формулы или законы, давай их полное описание и расшифровку всех величин.
- Очищай текст от мусора (замечания ученикам, "эээ", "откройте дверь"), но сохраняй всю учебную информацию.

СТРУКТУРА КОНСПЕКТА:
1. ТЕМА: (Развернутое название урока)
2. ГЛОССАРИЙ: (Определения всех сложных терминов, прозвучавших в уроке)
3. То что было сказано в аудио, развернутый конспект
4. ФОРМУЛЫ И ЗАКОНЫ: (если они есть то пиши, если нет не упоминай об этом пункте)
5. ПРАКТИЧЕСКИЙ ПРИМЕР: (Если был в аудио или приведи свой подходящий по теме (если они есть то пиши, если нет не упоминай об этом пункте))
6. ВЫВОД: (Глубокий итог урока)
7. ПРОВЕРКА ЗНАНИЙ: (Составь 3 сложных вопроса по теме урока для учеников)
8. Используй терминологию высшей школы.
9. Прежде чем писать конспект, выдели 5 ключевых концепций урока. Затем на их основе строй структуру

ЗАПРЕТЫ:
- НИКАКИХ символов #, *, ** или |. Только чистый текст.
- Если в аудио была важная информация, ты ОБЯЗАН её включить.

Дополнительные материалы: ${contextText ? contextText : 'отсутствуют'}.`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: transcription.text }
            ],
            model: "llama-3.1-8b-instant",
        });

        res.json({ summary: completion.choices[0].message.content });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

app.post('/api/edit', async (req, res) => {
    try {
        const { currentText, instruction } = req.body;
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Ты редактор. Выполни правку. Не добавляй от себя приветствий. Никаких символов * и #." },
                { role: "user", content: `Текст:\n${currentText}\n\nПравка: ${instruction}` }
            ],
            model: "llama-3.1-8b-instant",
        });
        res.json({ updatedText: completion.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: "Ошибка" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});