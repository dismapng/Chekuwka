const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// Конфигурация
const config = {
    TELEGRAM_TOKEN: '8531869138:AAEGXYv4H0If2r8ibEYJg9iaE7kkHjrj7As',
    WEBSITE_URL: 'https://google.com', // Можно заменить на любой сайт
    DEFAULT_CHECK_INTERVAL: 5 * 60 * 1000, // 5 минут по умолчанию
    TIMEOUT: 10000, // 10 секунд таймаут для проверки
    PORT: process.env.PORT || 3000
};

// Инициализация бота с pooling
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
const app = express();

// Хранилище пользовательских настроек
const userSettings = new Map(); // userId -> { notifications: boolean, interval: number (в минутах) }

// Глобальные переменные мониторинга
let monitoringInterval = null;
let currentInterval = config.DEFAULT_CHECK_INTERVAL;
let lastCheckTime = null;
let lastStatus = 'неизвестен';
let failureCount = 0;
const totalChecks = { success: 0, failed: 0 };

// Доступные интервалы проверки (в минутах)
const AVAILABLE_INTERVALS = [1, 3, 5, 10];

// Функция проверки сайта
async function checkWebsite() {
    const startTime = Date.now();
    
    try {
        console.log(`[${new Date().toLocaleString()}] Проверяем сайт: ${config.WEBSITE_URL}`);
        
        const response = await axios.get(config.WEBSITE_URL, {
            timeout: config.TIMEOUT,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            }
        });
        
        const responseTime = Date.now() - startTime;
        console.log(`[${new Date().toLocaleString()}] Сайт доступен. Статус: ${response.status}, Время ответа: ${responseTime}мс`);
        
        lastCheckTime = new Date();
        
        // Если сайт был недоступен, а теперь доступен - отправляем уведомление
        if (lastStatus === 'недоступен' || lastStatus === 'ошибка') {
            sendNotificationsToAll(`✅ Сайт ${config.WEBSITE_URL} снова доступен!\nВремя ответа: ${responseTime}мс\nСтатус код: ${response.status}\nИнтервал проверки: ${currentInterval / 60000} минут`);
        }
        
        lastStatus = 'доступен';
        failureCount = 0;
        totalChecks.success++;
        
        return {
            status: 'доступен',
            responseTime: responseTime,
            statusCode: response.status,
            timestamp: new Date()
        };
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        let errorMessage = 'Неизвестная ошибка';
        
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Соединение отклонено';
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Сайт не найден (DNS ошибка)';
        } else if (error.code === 'ETIMEDOUT') {
            errorMessage = 'Таймаут соединения';
        } else if (error.response) {
            errorMessage = `HTTP ошибка: ${error.response.status}`;
        } else {
            errorMessage = error.message || 'Неизвестная ошибка';
        }
        
        console.log(`[${new Date().toLocaleString()}] Сайт недоступен. Ошибка: ${errorMessage}, Время: ${responseTime}мс`);
        
        lastCheckTime = new Date();
        failureCount++;
        totalChecks.failed++;
        
        // Если сайт был доступен, а теперь недоступен - отправляем уведомление
        if (lastStatus === 'доступен' || failureCount === 1) {
            sendNotificationsToAll(`🚨 Сайт ${config.WEBSITE_URL} недоступен!\nОшибка: ${errorMessage}\nВремя проверки: ${responseTime}мс\nКоличество ошибок подряд: ${failureCount}\nИнтервал проверки: ${currentInterval / 60000} минут`);
        }
        
        lastStatus = 'недоступен';
        
        return {
            status: 'недоступен',
            error: errorMessage,
            responseTime: responseTime,
            timestamp: new Date()
        };
    }
}

// Функция отправки уведомлений всем пользователям с включенными уведомлениями
function sendNotificationsToAll(message) {
    let notifiedCount = 0;
    
    userSettings.forEach((settings, userId) => {
        if (settings.notifications) {
            try {
                bot.sendMessage(userId, message);
                notifiedCount++;
            } catch (error) {
                console.error(`Ошибка отправки сообщения пользователю ${userId}:`, error.message);
            }
        }
    });
    
    console.log(`Уведомления отправлены ${notifiedCount} пользователям`);
}

// Запуск мониторинга с указанным интервалом
function startMonitoring(intervalMinutes = 5) {
    // Останавливаем текущий мониторинг, если он запущен
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
    
    // Конвертируем минуты в миллисекунды
    currentInterval = intervalMinutes * 60 * 1000;
    
    console.log(`🚀 Запуск мониторинга сайта: ${config.WEBSITE_URL}`);
    console.log(`Интервал проверки: ${intervalMinutes} минут (${currentInterval} мс)`);
    
    // Первая проверка сразу при запуске
    checkWebsite();
    
    // Запускаем периодические проверки
    monitoringInterval = setInterval(checkWebsite, currentInterval);
    
    // Отправляем сообщение о запуске всем пользователям
    sendNotificationsToAll(`✅ Мониторинг сайта ${config.WEBSITE_URL} запущен!\nПроверки каждые ${intervalMinutes} минут.`);
    
    return intervalMinutes;
}

// Остановка мониторинга
function stopMonitoring() {
    if (!monitoringInterval) {
        console.log('Мониторинг не запущен');
        return false;
    }
    
    console.log('⏹️ Остановка мониторинга');
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    
    // Отправляем сообщение об остановке всем пользователям
    sendNotificationsToAll(`⏹️ Мониторинг сайта ${config.WEBSITE_URL} остановлен.`);
    
    return true;
}

// Создание главного меню
function createMainMenu(userId) {
    const userSetting = userSettings.get(userId) || { notifications: true, interval: 5 };
    const notificationsStatus = userSetting.notifications ? '🔔 Уведомления: ВКЛ' : '🔕 Уведомления: ВЫКЛ';
    
    return {
        reply_markup: {
            keyboard: [
                [{ text: monitoringInterval ? '⏹️ Остановить мониторинг' : '▶️ Запустить мониторинг' }],
                [{ text: userSetting.notifications ? '🔕 Выключить уведомления' : '🔔 Включить уведомления' }],
                [{ text: '📊 Статус сайта' }, { text: '📈 Статистика' }],
                [{ text: '⚙️ Интервал проверки' }, { text: 'ℹ️ Помощь' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };
}

// Создание меню выбора интервала
function createIntervalMenu(userId) {
    const userSetting = userSettings.get(userId) || { interval: 5 };
    
    const intervalButtons = AVAILABLE_INTERVALS.map(interval => {
        const isCurrent = interval === userSetting.interval;
        return [{ text: `${isCurrent ? '✅ ' : ''}${interval} мин` }];
    });
    
    return {
        reply_markup: {
            keyboard: [
                ...intervalButtons,
                [{ text: '⬅️ Назад в главное меню' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
}

// Обработка команд
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'Пользователь';
    
    // Инициализация настроек пользователя
    if (!userSettings.has(chatId)) {
        userSettings.set(chatId, { 
            notifications: true,
            interval: 5, // 5 минут по умолчанию
            joinedAt: new Date()
        });
    }
    
    const userSetting = userSettings.get(chatId);
    
    const welcomeMessage = `
👋 Привет, ${userName}!

🤖 Я бот для мониторинга сайтов.

📡 Сейчас отслеживается сайт: ${config.WEBSITE_URL}

⚙️ Текущий интервал проверок: ${userSetting.interval} минут

📱 Используйте кнопки ниже для управления:

• Запуск/остановка мониторинга
• Включение/выключение уведомлений
• Настройка интервала проверки
• Проверка текущего статуса сайта
• Просмотр статистики

${monitoringInterval ? `✅ Мониторинг активен (${currentInterval / 60000} мин)` : '⏸️ Мониторинг остановлен'}
${userSetting.notifications ? '🔔 Вы получаете уведомления' : '🔕 Уведомления отключены'}
`;

    bot.sendMessage(chatId, welcomeMessage, createMainMenu(chatId));
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
ℹ️ *Помощь по боту*

*Основные команды:*
/start - Главное меню
/status - Текущий статус сайта
/stats - Статистика проверок
/help - Эта справка

*Управление через кнопки:*
▶️ Запустить мониторинг - начинает проверки
⏹️ Остановить мониторинг - останавливает проверки
🔔 Включить уведомления - вы будете получать уведомления
🔕 Выключить уведомления - уведомления отключатся
⚙️ Интервал проверки - выбор интервала (1, 3, 5, 10 мин)
📊 Статус сайта - текущее состояние сайта
📈 Статистика - общая статистика проверок

*Доступные интервалы:*
• 1 минута - частая проверка
• 3 минуты - оптимальная частота
• 5 минут - стандартный интервал
• 10 минут - редкая проверка

*Примечание:*
• Каждый пользователь настраивает уведомления индивидуально
• Интервал проверки устанавливается для всех одинаково
• При проблемах с сайтом уведомления получат все с включенными уведомлениями
`;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userSetting = userSettings.get(chatId) || { notifications: true, interval: 5 };
    
    let statusMessage = `
📊 *Текущий статус*

🌐 Сайт: ${config.WEBSITE_URL}
📅 Последняя проверка: ${lastCheckTime ? lastCheckTime.toLocaleString() : 'ещё не было'}
🔄 Статус: ${lastStatus === 'доступен' ? '✅ Доступен' : lastStatus === 'недоступен' ? '❌ Недоступен' : '❓ Неизвестен'}
⚙️ Интервал проверки: ${currentInterval / 60000} минут
`;

    if (lastStatus === 'недоступен') {
        statusMessage += `\n⚠️ Количество ошибок подряд: ${failureCount}`;
    }

    statusMessage += `\n\n🔔 Ваши уведомления: ${userSetting.notifications ? 'ВКЛ' : 'ВЫКЛ'}`;
    statusMessage += `\n📡 Мониторинг: ${monitoringInterval ? 'АКТИВЕН' : 'ОСТАНОВЛЕН'}`;

    bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const activeUsers = Array.from(userSettings.values()).filter(s => s.notifications).length;
    const totalUsers = userSettings.size;
    
    const statsMessage = `
📈 *Статистика проверок*

🌐 Мониторинг сайта: ${config.WEBSITE_URL}
📅 Начало работы: ${new Date().toLocaleString()}
📊 Всего проверок: ${totalChecks.success + totalChecks.failed}
✅ Успешных: ${totalChecks.success}
❌ Неудачных: ${totalChecks.failed}
📈 Успешность: ${totalChecks.success + totalChecks.failed > 0 ? 
        Math.round((totalChecks.success / (totalChecks.success + totalChecks.failed)) * 100) : 0}%
🔄 Текущий статус: ${lastStatus}
⚙️ Интервал проверок: ${currentInterval / 60000} минут
👥 Пользователей: ${totalUsers} (${activeUsers} с уведомлениями)
`;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/interval/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Выберите интервал проверки:', createIntervalMenu(chatId));
});

// Обработка нажатий на кнопки
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Инициализация пользователя, если его нет
    if (!userSettings.has(chatId)) {
        userSettings.set(chatId, { 
            notifications: true,
            interval: 5,
            joinedAt: new Date()
        });
    }
    
    const userSetting = userSettings.get(chatId);
    
    switch(text) {
        case '▶️ Запустить мониторинг':
            const intervalToUse = userSetting.interval || 5;
            startMonitoring(intervalToUse);
            bot.sendMessage(chatId, `✅ Мониторинг запущен!\nИнтервал проверки: ${intervalToUse} минут`, createMainMenu(chatId));
            break;
            
        case '⏹️ Остановить мониторинг':
            if (stopMonitoring()) {
                bot.sendMessage(chatId, '⏹️ Мониторинг остановлен!', createMainMenu(chatId));
            } else {
                bot.sendMessage(chatId, 'Мониторинг и так не запущен.', createMainMenu(chatId));
            }
            break;
            
        case '🔔 Включить уведомления':
            userSetting.notifications = true;
            userSettings.set(chatId, userSetting);
            bot.sendMessage(chatId, '🔔 Уведомления включены! Вы будете получать сообщения о проблемах с сайтом.', createMainMenu(chatId));
            break;
            
        case '🔕 Выключить уведомления':
            userSetting.notifications = false;
            userSettings.set(chatId, userSetting);
            bot.sendMessage(chatId, '🔕 Уведомления выключены! Вы не будете получать сообщения о проблемах с сайтом.', createMainMenu(chatId));
            break;
            
        case '⚙️ Интервал проверки':
            bot.sendMessage(chatId, `Выберите интервал проверки (текущий: ${userSetting.interval} мин):`, createIntervalMenu(chatId));
            break;
            
        case '📊 Статус сайта':
            let statusMsg = `🌐 Сайт: ${config.WEBSITE_URL}\n`;
            statusMsg += `📅 Последняя проверка: ${lastCheckTime ? lastCheckTime.toLocaleString() : 'ещё не было'}\n`;
            statusMsg += `🔄 Статус: ${lastStatus === 'доступен' ? '✅ Доступен' : lastStatus === 'недоступен' ? '❌ Недоступен' : '❓ Неизвестен'}\n`;
            statusMsg += `⚙️ Интервал проверки: ${currentInterval / 60000} минут\n`;
            statusMsg += `🔔 Ваши уведомления: ${userSetting.notifications ? 'ВКЛ' : 'ВЫКЛ'}\n`;
            statusMsg += `📡 Мониторинг: ${monitoringInterval ? '✅ АКТИВЕН' : '⏸️ ОСТАНОВЛЕН'}`;
            
            if (lastStatus === 'недоступен') {
                statusMsg += `\n⚠️ Количество ошибок подряд: ${failureCount}`;
            }
            
            bot.sendMessage(chatId, statusMsg, createMainMenu(chatId));
            break;
            
        case '📈 Статистика':
            const activeUsers = Array.from(userSettings.values()).filter(s => s.notifications).length;
            const totalUsers = userSettings.size;
            const statsMsg = `
📊 Статистика:

🌐 Сайт: ${config.WEBSITE_URL}
📊 Всего проверок: ${totalChecks.success + totalChecks.failed}
✅ Успешных: ${totalChecks.success}
❌ Неудачных: ${totalChecks.failed}
⚙️ Интервал проверки: ${currentInterval / 60000} минут
👥 Пользователей: ${totalUsers} (${activeUsers} с уведомлениями)
🔄 Текущий статус: ${lastStatus}
            `;
            bot.sendMessage(chatId, statsMsg.trim(), createMainMenu(chatId));
            break;
            
        case 'ℹ️ Помощь':
            const helpMsg = `
📱 *Управление ботом*

• Используйте кнопки для управления
• Уведомления настраиваются индивидуально
• Интервал проверки устанавливается для всех
• При проблемах уведомления получат все пользователи с ВКЛ уведомлениями

/help - подробная справка
            `;
            bot.sendMessage(chatId, helpMsg.trim(), { parse_mode: 'Markdown', ...createMainMenu(chatId) });
            break;
            
        case '⬅️ Назад в главное меню':
            bot.sendMessage(chatId, 'Главное меню:', createMainMenu(chatId));
            break;
            
        // Обработка выбора интервала
        default:
            // Проверяем, является ли сообщение выбором интервала (например, "1 мин", "5 мин")
            const intervalMatch = text.match(/(\d+)\s*мин/);
            if (intervalMatch) {
                const selectedInterval = parseInt(intervalMatch[1]);
                
                if (AVAILABLE_INTERVALS.includes(selectedInterval)) {
                    userSetting.interval = selectedInterval;
                    userSettings.set(chatId, userSetting);
                    
                    // Если мониторинг активен, перезапускаем с новым интервалом
                    if (monitoringInterval) {
                        startMonitoring(selectedInterval);
                        bot.sendMessage(chatId, `✅ Интервал изменён на ${selectedInterval} минут!\nМониторинг перезапущен с новым интервалом.`, createMainMenu(chatId));
                    } else {
                        bot.sendMessage(chatId, `✅ Интервал установлен: ${selectedInterval} минут\nНажмите "Запустить мониторинг" для начала проверок.`, createMainMenu(chatId));
                    }
                } else {
                    bot.sendMessage(chatId, '❌ Неверный интервал. Выберите из доступных вариантов.', createIntervalMenu(chatId));
                }
            }
            break;
    }
});

// Веб-сервер для Render
app.get('/', (req, res) => {
    const activeUsers = Array.from(userSettings.values()).filter(s => s.notifications).length;
    const totalUsers = userSettings.size;
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Website Monitor Bot</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                color: white;
            }
            .container {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 30px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            h1 {
                text-align: center;
                margin-bottom: 30px;
                font-size: 2.5em;
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            }
            .status-card {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 20px;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 20px 0;
            }
            .stat-item {
                background: rgba(255, 255, 255, 0.1);
                padding: 15px;
                border-radius: 10px;
                text-align: center;
            }
            .bot-info {
                background: rgba(255, 255, 255, 0.15);
                padding: 20px;
                border-radius: 15px;
                margin-top: 30px;
            }
            .telegram-link {
                display: inline-block;
                background: #0088cc;
                color: white;
                padding: 12px 24px;
                border-radius: 25px;
                text-decoration: none;
                font-weight: bold;
                margin-top: 20px;
                transition: transform 0.3s;
            }
            .telegram-link:hover {
                transform: translateY(-2px);
                background: #0077b3;
            }
            .status-badge {
                display: inline-block;
                padding: 5px 15px;
                border-radius: 20px;
                font-weight: bold;
                margin: 5px 0;
            }
            .status-up { background: rgba(76, 175, 80, 0.3); border: 2px solid #4CAF50; }
            .status-down { background: rgba(244, 67, 54, 0.3); border: 2px solid #F44336; }
            .status-unknown { background: rgba(158, 158, 158, 0.3); border: 2px solid #9E9E9E; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🌐 Website Monitor Bot</h1>
            
            <div class="status-card">
                <h2>📊 Текущий статус</h2>
                <p><strong>Сайт:</strong> ${config.WEBSITE_URL}</p>
                <p><strong>Последняя проверка:</strong> ${lastCheckTime ? lastCheckTime.toLocaleString() : 'ещё не было'}</p>
                <p><strong>Статус:</strong> 
                    <span class="status-badge ${lastStatus === 'доступен' ? 'status-up' : lastStatus === 'недоступен' ? 'status-down' : 'status-unknown'}">
                        ${lastStatus === 'доступен' ? '✅ Доступен' : lastStatus === 'недоступен' ? '❌ Недоступен' : '❓ Неизвестен'}
                    </span>
                </p>
                <p><strong>Интервал проверки:</strong> ${currentInterval / 60000} минут</p>
                <p><strong>Мониторинг:</strong> ${monitoringInterval ? '✅ Активен' : '⏸️ Остановлен'}</p>
            </div>
            
            <div class="stats-grid">
                <div class="stat-item">
                    <h3>📈 Всего проверок</h3>
                    <p style="font-size: 2em;">${totalChecks.success + totalChecks.failed}</p>
                </div>
                <div class="stat-item">
                    <h3>✅ Успешных</h3>
                    <p style="font-size: 2em; color: #4CAF50;">${totalChecks.success}</p>
                </div>
                <div class="stat-item">
                    <h3>❌ Неудачных</h3>
                    <p style="font-size: 2em; color: #F44336;">${totalChecks.failed}</p>
                </div>
            </div>
            
            <div class="bot-info">
                <h2>🤖 О боте</h2>
                <p>Telegram бот для мониторинга доступности сайтов.</p>
                <p><strong>Функции:</strong></p>
                <ul>
                    <li>Проверка сайта каждые 1, 3, 5 или 10 минут</li>
                    <li>Уведомления в Telegram при проблемах</li>
                    <li>Индивидуальные настройки уведомлений для каждого пользователя</li>
                    <li>Подробная статистика проверок</li>
                </ul>
                
                <center>
                    <a href="https://t.me/website_monitor_checker_bot" class="telegram-link" target="_blank">
                        🤖 Перейти в бота
                    </a>
                </center>
            </div>
        </div>
        
        <script>
            // Автообновление статуса каждые 30 секунд
            setInterval(() => {
                location.reload();
            }, 30000);
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// Запуск веб-сервера
app.listen(config.PORT, () => {
    console.log(`🌐 Веб-сервер запущен на порту ${config.PORT}`);
    console.log(`🤖 Бот запущен с токеном: ${config.TELEGRAM_TOKEN.substring(0, 10)}...`);
    console.log(`📡 Отслеживаемый сайт: ${config.WEBSITE_URL}`);
    console.log(`⚙️ Доступные интервалы: ${AVAILABLE_INTERVALS.join(', ')} минут`);
    console.log(`✅ Бот готов к работе! Перейдите в Telegram и найдите бота.`);
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error.message);
});

bot.on('error', (error) => {
    console.error('Ошибка бота:', error.message);
});

// Обработка завершения работы
process.on('SIGINT', () => {
    console.log('\n⏹️ Остановка бота...');
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
    }
    process.exit(0);
});
