const express = require('express');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer(); // Для обработки файлов в запросах

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public')); // Раздача фронтенда из папки public

// ==========================================
// 1. ЗАГРУЗКА ВИДЕО ЧЕРЕЗ TELEGRAM BOT API
// ==========================================
app.post('/api/videos/upload', upload.single('video'), async (req, res) => {
  try {
    const { title, description, user_id } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Файл не найден' });
    }

    // Отправка файла в закрытый Telegram-канал
    const formData = new FormData();
    formData.append('chat_id', process.env.TELEGRAM_STORAGE_CHANNEL_ID);
    formData.append('video', file.buffer, file.originalname);

    const tgResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      body: formData
    });

    const tgData = await tgResponse.json();

    if (!tgData.ok) {
      throw new Error('Ошибка сохранения видео в Telegram: ' + tgData.description);
    }

    // Получение Telegram file_id
    const telegramFileId = tgData.result.video.file_id;

    // Сохранение метаданных в БД
    const dbResult = await pool.query(
      'INSERT INTO videos (user_id, title, description, telegram_file_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id || 1, title, description, telegramFileId]
    );

    res.json({ success: true, video: dbResult.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. ГЛАВНАЯ ЛЕНТА (ПОЛУЧЕНИЕ ВИДЕО)
// ==========================================
app.get('/api/videos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videos ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. LUMORA AI STUDIO (GEMINI API INTEGRATION)
// ==========================================
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { videoTitle, videoDescription } = req.body;

    const prompt = `Ты — ИИ-ассистент социальной сети Lumora. Проанализируй контент:
    Название: "${videoTitle}"
    Описание: "${videoDescription}"
    
    Сгенерируй:
    1. 3 интригующих варианта названия.
    2. Улучшенное описание для привлечения зрителей.
    3. 5 релевантных хештегов.`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL_ID}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const aiData = await geminiResponse.json();
    const resultText = aiData.candidates[0].content.parts[0].text;

    res.json({ success: true, analysis: resultText });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка ИИ-анализа: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер Lumora работает на порту ${PORT}`);
});
